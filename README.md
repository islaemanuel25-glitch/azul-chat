# Azul Chat

Aplicación móvil de conversaciones operativas, **independiente de ERP Azul**.

ERP Azul es la fuente de verdad de usuarios, permisos, locales, ventas, caja,
stock y finanzas. Azul Chat no se conecta a su base: todo dato del ERP pasa por
dos rutas firmadas con HMAC, `POST /api/integraciones/azul-chat/vinculo/canjear`
y `POST /api/integraciones/azul-chat/consultar`. En V1 esa integración es
**solo lectura**.

El contrato es el del ERP desplegado, copiado de su código y no de memoria. Los
fixtures salen de ejecutar ese código: `test/fixtures/erp-8920516.json` (canje,
`mi_alcance`, errores) y `test/fixtures/erp-25172fe.json` (`transferencias_eventos`
y las capacidades por local de `mi_alcance`), este último regenerable con
`scripts/generar-fixture-erp.mjs`. Los eventos del ERP, su ingesta y la lectura
están en `docs/EVENTOS.md`.

## Arquitectura

```
Navegador / app móvil  →  backend de Azul Chat  →(HMAC)→  API del ERP
                                  │
                                  └→ base PROPIA de Azul Chat (PostgreSQL)
```

Nunca el navegador directo al ERP. El secreto de la integración, la clave de
cifrado y el token de delegación viven solo en el servidor de Azul Chat.

## Identidad y sesión

1. La persona, dentro del ERP, toca «Vincular Azul Chat» y obtiene un código
   (`vin1_…`, 10 minutos, un solo uso).
2. Lo pega en Azul Chat. El navegador manda **solo** `{ "codigo": "…" }` a
   `POST /api/sesion/vincular`.
3. El backend controla el Origin y el cupo, canjea el código en el ERP (firmado)
   y recibe `usuarioId`, `vinculoId` y el token de delegación (`del1_…`).
4. El token se cifra con AES-256-GCM y se guarda en la base propia junto con
   el vínculo. Se crea una sesión y se manda una cookie `HttpOnly` con un
   identificador opaco; la base guarda solo su SHA-256.
5. `GET /api/sesion` descifra el token en el servidor, consulta `mi_alcance` y
   devuelve el nombre y los locales que el ERP dice HOY. No se guardan.
6. `DELETE /api/sesion` cierra la sesión de ese dispositivo. No desvincula:
   eso se hace desde el ERP.

El código no se guarda, no se loguea, no va en una URL y no se devuelve.

### Lo que no es atómico

El canje gasta el código en la base del ERP antes de que Azul Chat confirme la
suya. Si el guardado local falla después, se contesta
`VINCULACION_NO_COMPLETADA`, no se reintenta y la persona genera otro código
(generarlo en el ERP revoca el vínculo cuyo token se perdió). Para no gastar
códigos de gusto, la configuración, la base y la instalación se controlan
**antes** del canje. Un canje que se corta por tiempo pudo haberse gastado: la
respuesta lo dice.

### Revocado no es caído

Si el ERP contesta `VINCULO_NO_VALIDO`, el vínculo local se invalida y todas
sus sesiones se revocan. Si el ERP no contesta, da 503, se excede el cupo o
dice `NO_AUTORIZADO`, la sesión queda como está.

### Varios dispositivos

El ERP admite un vínculo vigente por persona, y lo revoca en el momento en que
la persona GENERA un código nuevo (no al canjearlo). Azul Chat guarda una fila
de vínculo por persona y, al canjear, la actualiza con el token nuevo; las
sesiones de los otros dispositivos siguen andando con él. Hay una ventana: si
otro dispositivo consulta entre que se generó el código y se canjeó, el ERP le
rechaza el token viejo y ese dispositivo pierde su sesión. Cerrar sesión en uno
no toca a los demás.

## Estructura

- `src/app/` — Next.js App Router. Las rutas `api/` solo delegan:
  `salud`, `version`, `sesion` (GET, DELETE), `sesion/vincular` (POST) y los
  chats: `chats`, `chats/local` y `chats/general` (GET) y `chats/leido`
  (POST), descritos en `docs/CHATS.md`. No hay proxy genérico.
  - `GET /api/salud` — healthcheck: 200 si la configuración es válida, la base
    contesta y está migrada. No llama al ERP ni escribe.
  - `GET /api/version` — el SHA del commit con que se construyó la imagen
    (`APP_BUILD_ID`).
- `src/components/` — interfaz. **No pueden importar `src/server`.**
- `src/shared/` — tipos y validaciones que puede usar la interfaz. Sin secretos ni red.
- `src/server/` — solo servidor. Cada archivo importa `server-only`.
  - `erp/` — configuración, firma, constructores de cuerpo (`canje`,
    `miAlcance`, `ventasResumen`) y el cliente firmado, sin reintentos.
  - `seguridad/cifradoToken.ts` — AES-256-GCM del token.
  - `http/` — Origin, cupo, lectura del cuerpo y respuestas.
  - `sesion/` — cookie, repositorio, vincular, estado, cerrar y el paso de la
    sesión al token (`delegacion.ts`).
  - `chats/` — autorización viva por capacidad, sincronización con frecuencia
    mínima, historial paginado y las cuatro rutas de chats.
  - `eventos/` — ingesta, eventos guardados y lectura (`docs/EVENTOS.md`).
  - `ventas/ventasResumen.ts` — "ventas" desde una sesión. Servicio interno:
    ninguna ruta lo expone todavía.
  - `configuracion.ts`, `db.ts`, `log.ts`.
- `prisma/` — esquema y migraciones de la base propia: `Instalacion`,
  `Vinculo`, `Sesion`, `Evento`, `CursorIngesta` y `LecturaLocal`. Nada de
  conversaciones, mensajes ni auditoría: la conversación de un local y General
  se derivan de los eventos.
- `test/` — `node:test`. `test/db/` usa una base descartable y un ERP de
  mentira con estado; ningún test llama al ERP real.
- `scripts/verificar-bundle-cliente.mjs` — compila con secretos canario y los
  busca en todo lo que baja al navegador.

## Producción

Procedimiento completo, con PRE, DEPLOY, nginx, POST, rollback y backups:
**`docs/DEPLOY.md`**.

- `Dockerfile` — imagen multi-etapa: Next standalone, usuario `node`,
  `prisma migrate deploy` disponible pero nunca automático. Exige
  `--build-arg APP_BUILD_ID=<SHA completo>`.
- `docker-compose.prod.yml` — `azul-chat-app` (127.0.0.1:3100) y
  `azul-chat-db` (postgres:16, sin puerto en el host), con redes propias y
  separadas del ERP, y entornos separados (`app.env`, `db.env`).
- `ops/produccion/*.env.example` — las variables de producción, sin valores.
- `ops/prisma-cli/` — el CLI de Prisma de la imagen, con su lockfile.
- `ops/backup/backup-azul-chat.sh` — `pg_dump` verificado y rotado.
- `.github/workflows/imagen.yml` — publica la imagen en GHCR por SHA completo,
  solo después de que la CI pasó en `main`. No despliega.

## Variables de entorno

Ver `.env.example`. Copiarlo a `.env.local` (ignorado por git). Sin cualquiera
de ellas, Azul Chat no crea ni lee sesiones (fail closed).

- `DATABASE_URL` — la base propia de Azul Chat, nunca la del ERP.
- `AZUL_CHAT_INSTALACION_ID` — identificador estable de la instalación. Una
  base pertenece a una sola.
- `AZUL_CHAT_ORIGEN_PUBLICO` — origen exacto de la interfaz; crear o cerrar una
  sesión exige ese Origin.
- `ERP_BASE_URL` — origen del ERP (https; http solo contra localhost).
- `AZUL_CHAT_INTEGRACION_SECRET` — mínimo 32 caracteres, distinto del
  `AUTH_SECRET` del ERP.
- `AZUL_CHAT_TOKEN_ENCRYPTION_KEY` — 32 bytes al azar en base64 o base64url.
  **Distinta** del secreto de la integración. Perderla obliga a volver a vincular.

Ninguna lleva `NEXT_PUBLIC_`.

## Firma

```
firma = hex(HMAC_SHA256(secreto, "v1\n" + "azul-chat" + "\n" + marca + "\n" + cuerpo))
```

sobre bytes UTF-8, con `marca` = Unix timestamp en segundos y `cuerpo` =
`JSON.stringify(objeto)` — el mismo string que se manda. Cabeceras:
`content-type: application/json`, `x-erp-integracion-aplicacion: azul-chat`,
`x-erp-integracion-marca`, `x-erp-integracion-firma`.

## Límites conocidos

- El cupo de vinculación vive en memoria del proceso (5 por IP y 15 en total
  por minuto, por debajo de los 20 canjes por minuto que el ERP da a la
  aplicación). Con varias réplicas cada una cuenta lo suyo. La IP sale de
  `X-Forwarded-For`, que sin un proxy delante se puede inventar.
- `npm audit` informa dos avisos de agotamiento de pila, ninguno alcanzable
  desde HTTP:
  - `deepmerge-ts`, a través del CLI `prisma` 6. Está en `/opt/prisma-cli` de
    la imagen, pero solo corre a mano para `migrate deploy` y el servidor no lo
    carga. No hay arreglo dentro de Prisma 6.
  - `braces`, a través de `eslint-config-next`. Es solo de desarrollo y no
    entra a la imagen.

## Comandos

- `npm run dev` — servidor de desarrollo.
- `npm run build` — compilación (standalone); el servidor de producción es la
  imagen Docker (`docs/DEPLOY.md`).
- `npm run typecheck` — TypeScript estricto.
- `npm run lint` — ESLint (config de Next + regla de frontera).
- `npm test` — tests sin base (Node ≥ 22.18).
- `npm run test:db` — tests contra PostgreSQL. Necesita
  `AZUL_CHAT_TEST_DATABASE_URL`, una URL a la base de mantenimiento de un
  servidor LOCAL de pruebas: cada corrida crea bases `azulchat_prueba_…`, les
  aplica las migraciones y las borra. Sin la variable, falla.
- `npm run check` — typecheck + lint + tests + tests de base.
- `npm run verificar:bundle` — build con secretos canario y búsqueda en el bundle.
- `npm run db:migrar:dev` — `prisma migrate dev` contra la base de desarrollo.
