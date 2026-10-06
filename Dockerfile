# syntax=docker/dockerfile:1
#
# IMAGEN DE PRODUCCIÓN DE AZUL CHAT.
#
# Tres etapas y una imagen final:
#
#   builder     instala con `npm ci` (lockfile) y compila Next en modo standalone;
#   prisma-cli  instala SOLO el CLI de Prisma, con su propio lockfile
#               (ops/prisma-cli), para `prisma migrate deploy`;
#   runtime     el servidor standalone, los archivos estáticos, las migraciones y
#               el CLI aislado. Corre como `node`, nunca como root.
#
# La imagen no trae secretos ni archivos de entorno: el contexto es una lista
# blanca (.dockerignore) y todo secreto entra por variables al arrancar.
#
# Las migraciones NO corren al arrancar. Se aplican a propósito, como un paso
# del despliegue (docs/DEPLOY.md):
#   docker compose ... run --rm --no-deps azul-chat-app prisma migrate deploy
#
# Construir:
#   docker build --build-arg APP_BUILD_ID="$(git rev-parse HEAD)" -t azul-chat:local .

# La base, fijada por digest: el mismo Dockerfile produce la misma base siempre.
# Para actualizarla: `docker pull node:22-bookworm-slim` y copiar el nuevo digest.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

# ── base común ──────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
# Prisma necesita libssl, que la imagen slim no trae. Nada más se instala.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
# Ni Next ni Prisma llaman a sus servidores de telemetría o de "hay versión nueva".
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# ── builder ─────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# El SHA completo del commit. Es OBLIGATORIO: una imagen de producción sin
# identidad no se puede verificar después del despliegue (GET /api/version).
ARG APP_BUILD_ID=""
RUN if ! printf '%s' "$APP_BUILD_ID" | grep -Eq '^[0-9a-f]{40}$'; then \
      echo "ERROR: APP_BUILD_ID tiene que ser el SHA completo del commit (40 hex)." >&2; \
      echo "Usar: --build-arg APP_BUILD_ID=\"\$(git rev-parse HEAD)\"" >&2; \
      exit 1; \
    fi

# El schema va antes de `npm ci`: el postinstall corre `prisma generate`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY next.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

# ── prisma-cli ──────────────────────────────────────────────────────────────
FROM base AS prisma-cli
WORKDIR /opt/prisma-cli
COPY ops/prisma-cli/package.json ops/prisma-cli/package-lock.json ./
# Con scripts: el postinstall de @prisma/engines baja el motor de migraciones
# de esta plataforma (debian-openssl-3.0.x), el mismo que el runtime.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# ── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Un ARG no cruza de etapa: se vuelve a declarar y se fija como ENV para que
# /api/version lo lea. Ya se validó en el builder.
ARG APP_BUILD_ID
ENV APP_BUILD_ID=${APP_BUILD_ID}

# Los archivos son de root y solo de lectura para `node`: el proceso no puede
# modificar su propio código. El único directorio escribible es la caché de Next.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli
RUN ln -s /opt/prisma-cli/node_modules/.bin/prisma /usr/local/bin/prisma \
 && mkdir -p /app/.next/cache \
 && chown node:node /app/.next/cache

USER node
EXPOSE 3000

# Next registra SIGTERM: deja de aceptar conexiones, termina las solicitudes en
# curso y sale. `node` directo, sin npm de por medio, para que la señal llegue.
CMD ["node", "server.js"]
