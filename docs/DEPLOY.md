# Azul Chat en producción — runbook

Procedimiento para desplegar Azul Chat en el mismo VPS que ERP Azul, **completamente
separado del ERP**. Es el procedimiento en uso: Azul Chat corre en producción en
`https://chat.operix.cloud` desde octubre de 2026 (el commit que corre está en
`despliegues.log` y en `GET /api/version`). Cada paso dice qué se comprueba y qué
hacer si no da.

## Arquitectura

```
Internet ─► Cloudflare (Full strict) ─► nginx del host ─► 127.0.0.1:3100 ─► azul-chat-app ─► azul-chat-db
                                                                                 │
                                                       https://operix.cloud/api/integraciones/azul-chat/*
```

- **Proyecto Compose `azul-chat`**, en `/srv/produccion/azul-chat`, con
  `docker-compose.prod.yml`.
- **`azul-chat-app`**: la imagen `ghcr.io/islaemanuel25-glitch/azul-chat:<SHA>`.
  - Publicada solo en `127.0.0.1:3100`.
  - Corre como `node`, con el sistema de archivos de solo lectura y sin capacidades.
  - Tiene límites de 1 CPU y 512 MB.
- **`azul-chat-db`**: `postgres:16`, fijada por digest.
  - **Sin puerto en el host.**
  - Sus datos están en `./pgdata`.
  - Tiene límites de 1 CPU y 1 GB, con 512 MB reservados.
- **Redes propias**:
  - `azul-chat-interna` (app ↔ base) es `internal`: no tiene salida a internet.
  - `azul-chat-salida` es solo de la app, para hablar con el ERP y publicarse en 127.0.0.1.
    Desde la Tanda 6A también sale por ella a `https://generativelanguage.googleapis.com`
    (la IA de las preguntas). Es una red común de Docker: no hay que abrir nada,
    pero si el host filtrara la salida, ese destino tiene que estar permitido.
- **Ningún vínculo con el ERP en Docker.** Azul Chat no está en `erpazul_default`,
  no ve `erpazul_db` y no comparte volúmenes ni directorios. Habla con el ERP solo
  por HTTPS público, igual que cualquier cliente.
- **Backups** en `/srv/produccion/backups-azul-chat`, separados de los del ERP
  (`/srv/produccion/backups`).

## Archivos en el servidor

`/srv/produccion/azul-chat` es un **clon del repo** posicionado en el SHA que
corre. Lo que no está en git, y git ignora:

| Archivo | Contenido | Permisos |
| --- | --- | --- |
| `app.env` | variables de la aplicación (`ops/produccion/app.env.example`) | `600` |
| `db.env` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (`ops/produccion/db.env.example`) | `600` |
| `.env` | una sola línea: `AZUL_CHAT_IMAGE=ghcr.io/islaemanuel25-glitch/azul-chat:<SHA>` | `644` |
| `pgdata/` | los datos de PostgreSQL | los pone el contenedor |
| `despliegues.log` | una línea por despliegue: fecha, SHA, digest | `644` |

**`app.env` y `db.env` están separados a propósito.** El contenedor de PostgreSQL
no recibe el secreto de la integración ni la clave de cifrado. Es el problema
del ERP, donde un solo `.env.prod` llega a los dos contenedores, y no se repite.

## Variables

Todas entran por `app.env`. Ninguna lleva `NEXT_PUBLIC_`. Si falta o está mal
cualquiera, `/api/salud` contesta 503 y no se crean sesiones.

- **`DATABASE_URL`**:
  `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@azul-chat-db:5432/<POSTGRES_DB>`.
  - La base propia, por la red interna.
  - La contraseña es la de `db.env`.
- **`ERP_BASE_URL`**: `https://operix.cloud`. Sin barra final.
- **`AZUL_CHAT_ORIGEN_PUBLICO`**: `https://chat.operix.cloud`. Crear o cerrar una
  sesión exige exactamente este Origin.
- **`AZUL_CHAT_INSTALACION_ID`**: un identificador estable (minúsculas, números
  y guiones). Se fija una vez: la base queda atada a él.
- **`AZUL_CHAT_INTEGRACION_SECRET`**: el secreto HMAC.
  - **Lo comparten solo el ERP y Azul Chat.**
  - El mismo valor tiene que estar configurado en el ERP.
  - Mínimo 32 caracteres.
- **`AZUL_CHAT_TOKEN_ENCRYPTION_KEY`**: 32 bytes al azar en base64.
  - **Es exclusiva de Azul Chat**: el ERP no la conoce, y si es igual al secreto
    HMAC la app no arranca.
  - Perderla obliga a que todos vuelvan a vincular, así que se guarda también
    fuera del servidor.
- **`AZUL_CHAT_VAPID_PUBLICA`**, **`AZUL_CHAT_VAPID_PRIVADA`** y
  **`AZUL_CHAT_VAPID_CONTACTO`** (Tanda 5A): las claves de las notificaciones
  push (Web Push estándar, sin Firebase) y el `mailto:` que ve el servicio de
  push. **Opcionales**: sin las tres (o con una pareja que no cierra), no hay
  notificaciones y todo lo demás anda igual; `/api/salud` no las mira.
  - La pública no es secreta: el navegador la pide a `GET /api/push/clave`.
  - La privada sí: se genera en el VPS sin imprimirla (abajo).
  - Cambiarlas invalida todas las suscripciones: cada teléfono tiene que volver
    a activar las notificaciones.
- **`AZUL_CHAT_TAREA_SECRET`** (Tanda 5A): el secreto de
  `POST /api/interno/sincronizar`, la sincronización en segundo plano. Mínimo
  32 caracteres y distinto de todos los demás secretos. Sin él, esa ruta
  contesta 404 a todo y no hay sincronización de fondo ni avisos.
  - El MISMO valor va en `~/.config/azul-chat/tarea.secreto` (permisos 600),
    que es de donde lo lee el timer.
  - El vigía (`POST /api/interno/vigia`, Tanda 12) usa el MISMO secreto y el
    MISMO archivo: no hay un secreto nuevo.
- **`AZUL_CHAT_AVISOS_SISTEMA`** (Tanda 12): a quién avisar por push si la
  sincronización de fondo se cae y cuando vuelve. IDs de persona del ERP
  separados por coma, los mismos de `Vinculo.erpUsuarioId` (por ejemplo `9` o
  `9,11`). **Opcional**: vacía o ausente, el vigía igual abre y cierra el
  incidente pero no manda nada y deja una línea en el journal
  (`"sinEnvio":"SIN_DESTINATARIOS"`); mal escrita (`9;11`, `dueño`), tampoco
  manda y dice `DESTINATARIOS_INVALIDOS`, sin adivinar a quién. No es un
  secreto ni una autorización. Ver "Vigía de la sincronización".
- **`AZUL_CHAT_ADMINISTRADORES`** (Tanda 15): quién administra los accesos
  de Azul Chat. IDs de persona del ERP separados por coma, con el mismo formato
  que la de arriba (el dueño: `9`). Un administrador tiene todo y, desde
  ☰ → Configuración → Accesos, decide quién más entra y a qué partes; sus
  propios accesos no se pueden tocar. **Obligatoria en la práctica: SIN ELLA
  (vacía, ausente o mal escrita) NADIE administra y nadie que no tenga un acceso
  ya guardado puede entrar, el dueño incluido.** Cerrado por defecto, con una
  línea `accesos.sin_administradores` en el log. No es un secreto. Ver
  "Tanda 15: accesos".
- **`AZUL_CHAT_GEMINI_API_KEY`** (Tanda 6A): la clave de Google Gemini para las
  preguntas en lenguaje natural. **Es la MISMA que usa el ERP** (su
  `GEMINI_API_KEY`); se copia de archivo a archivo sin imprimirla (abajo).
  **Opcional**: sin ella no hay caja de preguntas y todo lo demás anda igual;
  `/api/salud` no la mira. Tiene que ser distinta de los otros secretos de Azul
  Chat, o la app la ignora.
- **`AZUL_CHAT_IA_TOPE_USD`** (Tanda 6A): el tope de gasto en IA por mes
  calendario de Argentina, en dólares con hasta dos decimales (`5`, `12.50`).
  Por defecto 5; más de 1000 o un valor mal escrito deja la IA apagada (sin
  caja). Alcanzado, cada pregunta contesta "Saldo de IA agotado" hasta el día 1.
  El gasto del mes se ve en la tabla `ConsumoIa` (abajo).
- **`APP_BUILD_ID`**: **no va en `app.env`.** Viene adentro de la imagen, con el
  SHA del commit (build-arg del workflow `Imagen`). Si un archivo de entorno lo
  definiera, `/api/version` diría un commit que no es el de la imagen.
- **`NODE_ENV`**: lo fija el compose en `production`. Con él, la cookie de sesión
  lleva `Secure`.

Los secretos se generan **una vez, en el servidor o en una máquina de confianza,
nunca en el repo ni en la CI**. Por ejemplo:

```sh
openssl rand -base64 32   # AZUL_CHAT_TOKEN_ENCRYPTION_KEY
openssl rand -base64 48   # AZUL_CHAT_INTEGRACION_SECRET (cargar el MISMO en el ERP)
openssl rand -hex 24      # POSTGRES_PASSWORD (la misma dentro de DATABASE_URL)
```

### Notificaciones push y sincronización de fondo (Tanda 5A)

Se generan **una vez, en el VPS, sin que pasen por la pantalla**: van directo a
los archivos, que quedan en 600. `OBJETIVO` es el SHA de la imagen a desplegar
(trae Node; no hace falta instalar nada en el host).

```sh
cd /srv/produccion/azul-chat
umask 077

# Claves VAPID: P-256. La pública sin comprimir (0x04‖x‖y) y la privada (d),
# las dos en base64url. Se agregan a app.env; no se imprimen.
docker run --rm --entrypoint node "ghcr.io/islaemanuel25-glitch/azul-chat:$OBJETIVO" -e '
  const { generateKeyPairSync } = require("node:crypto");
  const j = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]);
  console.log("AZUL_CHAT_VAPID_PUBLICA=" + pub.toString("base64url"));
  console.log("AZUL_CHAT_VAPID_PRIVADA=" + j.d);' >> app.env
printf 'AZUL_CHAT_VAPID_CONTACTO=mailto:%s\n' '<un correo de contacto>' >> app.env   # completar

# El secreto de la tarea: al archivo del timer y a app.env, sin imprimirlo.
mkdir -p ~/.config/azul-chat
S="$(openssl rand -base64 48 | tr -d '\n=+/')"
printf '%s\n' "$S" > ~/.config/azul-chat/tarea.secreto
printf 'AZUL_CHAT_TAREA_SECRET=%s\n' "$S" >> app.env
unset S
chmod 600 app.env ~/.config/azul-chat/tarea.secreto

# Comprobar SIN mostrar valores: cada nombre una vez, con valor.
grep -cE '^AZUL_CHAT_(VAPID_PUBLICA|VAPID_PRIVADA|VAPID_CONTACTO|TAREA_SECRET)=.+' app.env   # 4
```

Si `app.env` ya tenía esas líneas vacías (copiado del ejemplo), borrarlas antes
de agregar: con dos líneas del mismo nombre gana la última, pero mejor una sola.
Después, recrear la app para que lea el entorno: `$C up -d azul-chat-app`.

### Preguntas en lenguaje natural (Tanda 6A)

La clave de Gemini se copia del entorno del ERP (`/srv/produccion/erpazul/.env.prod`,
variable `GEMINI_API_KEY`) a `app.env`, **sin que pase por la pantalla**: el
valor va de un archivo al otro y lo único que se imprime es un conteo.

```sh
cd /srv/produccion/azul-chat
umask 077
# Si app.env ya tiene la línea vacía del ejemplo, sacarla antes (con dos, gana la última).
sed -i '/^AZUL_CHAT_GEMINI_API_KEY=/d' app.env
grep -m1 '^GEMINI_API_KEY=' /srv/produccion/erpazul/.env.prod \
  | sed 's/^GEMINI_API_KEY=/AZUL_CHAT_GEMINI_API_KEY=/' >> app.env
grep -q '^AZUL_CHAT_IA_TOPE_USD=' app.env || printf 'AZUL_CHAT_IA_TOPE_USD=5\n' >> app.env
chmod 600 app.env

# Comprobar SIN mostrar valores. La clave, sin comillas ni espacios: 1.
grep -cE '^AZUL_CHAT_GEMINI_API_KEY=[A-Za-z0-9_-]{20,200}$' app.env   # 1
grep -c '^AZUL_CHAT_IA_TOPE_USD=' app.env                             # 1
```

Si el primer conteo da 0, la línea del ERP tiene comillas o espacios: no
"arreglarla" mirando el valor; sacar las comillas con `sed` sobre `app.env` y
volver a contar. Después, recrear la app: `$C up -d azul-chat-app`.

La migración es `20261011200000_consumo_ia`: crea la tabla `ConsumoIa` (una
fila por mes con tokens, costo en millonésimas de dólar y preguntas). Entra con
el paso 3 del DEPLOY, como todas.

El gasto del mes, sin datos de nadie:

```sh
docker exec azul-chat-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT mes, preguntas, \"costoMicroUsd\" / 1e6 AS usd FROM \"ConsumoIa\" ORDER BY mes"'
```

Cada pregunta deja en el log de la app una línea `ia.pregunta` con resultado,
duración, tokens y costo; nunca la pregunta ni la clave. El costo de una
pregunta y el cupo del ERP que gasta (1 + N) están en `docs/CHATS.md`.

### Tanda 6C: migración y caché

- La migración es `20261012120000_preguntas_guardadas`: crea la tabla
  `Pregunta` (las preguntas con su respuesta, por persona y chat). Entra con
  el paso 3 del DEPLOY, como todas. La retención de 90 días la hace la corrida
  de fondo de siempre: no hay timer nuevo.
- **`/sw.js` y Cloudflare.** Informado por el dueño en la auditoría del
  2026-10-12, no medido desde este repo: el origen manda `max-age=0` y Cloudflare entrega `max-age=14400` (4 h) —es
  su "Browser Cache TTL", que reemplaza un `max-age` del origen más bajo—. NO
  demora la actualización del service worker en el teléfono: la app lo registra
  con `updateViaCache: "none"` (`src/components/push/notificaciones.ts`), así
  que el navegador busca `sw.js` sin pasar por su caché HTTP. Lo que sí lo
  demoraría es que Cloudflare lo guardara en su BORDE: se comprueba con
  `curl -sI https://chat.operix.cloud/sw.js | grep -i -E '^(cache-control|cf-cache-status|age):'`;
  con `cf-cache-status: HIT`, el teléfono recibe la copia vieja del borde. Para
  que las dos cosas queden alineadas con el origen, una regla en Cloudflare →
  Caching → Cache Rules: "URI Path equals `/sw.js`" → Cache eligibility
  **Bypass cache**, y Browser TTL **Respect origin**. No la pone este repo.
- La recarga por versión NO necesita nada en nginx ni en Cloudflare. Medido
  desde afuera el 2026-10-11 sobre `dda5b80`: `/api/version` ya contestaba
  `cache-control: no-store` y `cf-cache-status: DYNAMIC`. La página `/`
  contestaba `cache-control: s-maxage=31536000` (prerenderada, sin `max-age`
  para el navegador) y `cf-cache-status: DYNAMIC`; desde la 6C se arma en cada
  pedido y Next contesta `no-store`. Lo único a comprobar en el POST:
  `curl -sI https://chat.operix.cloud/ | grep -i -E '^(cache-control|cf-cache-status)'`
  tiene que decir `no-store` y `DYNAMIC`. Si Cloudflare dijera `HIT`, hay una
  regla de caché que guarda HTML: se quita (no la pone este repo).

### Tanda 11: migración del horario de silencio

- La migración es `20261013120000_horario_de_silencio`: agrega a `Vinculo`
  tres columnas con valor por defecto (`silencioActivo` false,
  `silencioDesde` 0, `silencioHasta` 7) y un CHECK de horas de 0 a 23
  distintas. Es aditiva: no toca ninguna fila y todos quedan con el silencio
  APAGADO. Entra con el paso 3 del DEPLOY, como todas; volver a la imagen
  anterior es seguro (el código viejo no mira esas columnas).
- Las rutas nuevas (`/api/push/estado`, `/api/sesion/configuracion`,
  `/api/sesion/silencio`, `/api/sesion/otras`) no necesitan nada en nginx: van
  por el mismo `location` de la app.

### Tanda 15: accesos (migración y variable)

- **ANTES de desplegar esta imagen**, poner en `app.env` el id de persona del
  dueño en `AZUL_CHAT_ADMINISTRADORES` (hoy `9`). Si no, al arrancar nadie
  administra y el dueño mismo ve "Todavía no tenés acceso a Azul Chat.":

  ```sh
  cd /srv/produccion/azul-chat
  grep -c '^AZUL_CHAT_ADMINISTRADORES=' app.env      # si da 1, editarla en vez de agregar
  printf 'AZUL_CHAT_ADMINISTRADORES=%s\n' '9' >> app.env
  ```

  Después del DEPLOY: `docker logs azul-chat-app 2>&1 | grep accesos.sin_administradores`
  no tiene que mostrar nada.
- La migración es `20261016120000_accesos`: crea la tabla `AccesoPersona`
  (seis permisos por persona del ERP —entrar, ventas, caja, stock,
  pendientes, ia—, todos en false por defecto, y quién y cuándo los cambió) y
  agrega a `Vinculo` la columna `erpNombre` (el nombre que dio el ERP, solo
  para mostrarlo). Aditiva: no toca ninguna fila. Hoy la única persona
  vinculada es el dueño, que entra por la variable: no hace falta cargar nada.
  Volver a la imagen anterior es seguro (el código viejo no mira ni la tabla
  ni la columna, y deja entrar a todos como antes).
- **Cómo habilita el dueño a otra persona**, en palabras simples: la persona
  genera su código en el ERP y lo pega en Azul Chat (docs/CHATS.md, "Cómo se
  suma un dueño"); ve "Todavía no tenés acceso a Azul Chat.". El dueño, en su
  teléfono, abre ☰ → Configuración → Accesos, busca a esa persona por su
  nombre y prende "Entrar" y lo que quiera que vea (Ventas, Caja, Stock,
  Pendientes, IA). Rige en el próximo toque de esa persona, sin que tenga que
  volver a entrar.

### Tanda 14: migración del turno de fondo

- La migración es `20261015120000_turno_de_fondo`: agrega a `Vinculo` la
  columna `ultimoTurnoFondoEn`, nula, sin valor por defecto ni CHECK. Es
  aditiva: las filas que ya están quedan en null ("nunca le tocó") y van
  primero en la próxima corrida, en el mismo orden que hasta hoy. Entra con el
  paso 3 del DEPLOY; volver a la imagen anterior es seguro (el código viejo no
  la mira).
- Para sumar otro dueño no hay nada que configurar en el servidor: se vincula
  solo, con su usuario del ERP (`docs/CHATS.md`, "Cómo se suma un dueño").
  `AZUL_CHAT_AVISOS_SISTEMA` no cambia: los avisos del vigía siguen yendo solo
  a quien figure ahí.

### Tanda 12: migración de la salud de la sincronización

- La migración es `20261014120000_salud_sincronizacion`: crea la tabla
  `SaludSincronizacion`, de **una sola fila** (CHECK `unica = true`), con el
  último éxito, la última falla y su motivo (código cerrado:
  `ERP_NO_DISPONIBLE`, `ERP_CUPO_EXCEDIDO` o `BASE`), las fallas seguidas, y
  el estado del incidente y de sus avisos. No guarda una fila por corrida ni
  ningún dato de negocio. Es aditiva: no toca ninguna tabla existente. Volver
  a la imagen anterior es seguro (el código viejo no la mira; la tabla queda).
- Entra con el paso 3 del DEPLOY. El vigía se instala DESPUÉS de desplegar la
  imagen que trae la ruta (abajo, "Vigía de la sincronización").

### Tanda 6D: la cabecera con el commit

Y desde la Tanda 6E, en el teléfono: abrir ☰ ("Tu sesión") y mirar la línea
"Versión" al pie del panel. Tiene que decir los primeros 7 caracteres del SHA
desplegado (`echo "${OBJETIVO:0:7}"`). Si dice otros, ese teléfono sigue con la
página anterior: volver a primer plano o abrir un chat la hace recargar.

Toda respuesta de las rutas propias trae `X-Azul-Chat-Commit` con el commit de
la imagen: con ella, una página abierta durante el despliegue recarga en su
próxima consulta, aunque la persona no salga del chat. No hay nada que
configurar. En el POST, comprobar que la cabecera llega desde afuera (nginx y
Cloudflare no la sacan) y que es el commit desplegado:

```sh
curl -s -D - -o /dev/null https://chat.operix.cloud/api/version | grep -i '^x-azul-chat-commit:'   # = OBJETIVO
curl -s -D - -o /dev/null https://chat.operix.cloud/api/chats | grep -i '^x-azul-chat-commit:'   # = OBJETIVO (contesta 401 sin sesión, con la cabecera igual)
```

Si no aparece, el bloque de nginx la está filtrando (`proxy_hide_header`) o
hay una regla de Cloudflare que la saca: se corrige ahí, el repo no la pone en
otro lado.

## La imagen

La publica el workflow **Imagen** (`.github/workflows/imagen.yml`):
- solo después de que la CI terminó en verde sobre un push a `main`, o a mano
  desde `main`;
- la etiqueta es el SHA completo y no hay `latest`;
- la etiqueta OCI `org.opencontainers.image.revision` y el `APP_BUILD_ID` de
  adentro son ese mismo SHA, y el workflow lo verifica.

Las migraciones **no** corren al arrancar: son un paso explícito del despliegue
(`prisma migrate deploy`, con el CLI que trae la imagen en `/opt/prisma-cli`).

**El nombre de una migración nueva tiene que ordenar DESPUÉS de la última.**
Prisma aplica las migraciones en orden alfabético de carpeta. Las de las Tandas
11 a 15 se escribieron el 2026-10-12 con fechas adelantadas
(`20261013120000_…` a `20261016120000_accesos`). Una migración creada con
`prisma migrate dev` antes del 2026-10-16 12:00 UTC recibiría una fecha MENOR:
en producción se aplicaría última (las otras ya están), pero en una base vacía
—la CI, `npm run test:db`, una restauración sobre una base nueva— correría
antes que esas, y si depende de una de sus tablas o columnas falla ahí y no en
producción. Antes de commitear una migración nueva: `ls prisma/migrations | sort | tail -2`
tiene que mostrarla última; si no, se renombra la carpeta con una fecha
posterior (la carpeta todavía no se aplicó en ningún lado).

**Acceso a GHCR desde el VPS.** Si el paquete es privado, el VPS necesita
`docker login ghcr.io` con un token de solo lectura (`read:packages`). Se
configura una vez, fuera de este repo, y no se escribe en ningún archivo del
proyecto.

---

## PRE — antes de desplegar

Todo en el VPS, como el usuario que despliega. `OBJETIVO` es el SHA completo que
se quiere desplegar, y tiene que tener su imagen publicada.

```sh
set -euo pipefail
OBJETIVO=<SHA_COMPLETO>
IMAGEN="ghcr.io/islaemanuel25-glitch/azul-chat:${OBJETIVO}"
cd /srv/produccion/azul-chat
```

1. **SHA objetivo y árbol limpio.**
   ```sh
   git fetch origin
   git checkout --detach "$OBJETIVO"
   test "$(git rev-parse HEAD)" = "$OBJETIVO"
   test -z "$(git status --porcelain)"        # los ignorados no cuentan
   ```
2. **La imagen exacta existe y es de ese commit.**
   ```sh
   docker pull "$IMAGEN"
   docker image inspect "$IMAGEN" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'   # = OBJETIVO
   docker image inspect "$IMAGEN" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^APP_BUILD_ID='  # = OBJETIVO
   docker image inspect "$IMAGEN" --format '{{.Config.User}}'                                               # = node
   docker image inspect "$IMAGEN" --format '{{index .RepoDigests 0}}'                                        # anotar
   ```
3. **El ERP está intacto.** Anotar el estado antes, para compararlo al final.
   ```sh
   docker ps --filter name=erpazul --format '{{.Names}} {{.Status}} {{.Image}}' | tee /tmp/erp-antes.txt
   curl -fsS -o /dev/null -w '%{http_code}\n' https://operix.cloud/
   ```
4. **Backup previo, si Azul Chat ya tiene datos** (`pgdata/` existe y la base corre):
   ```sh
   ops/backup/backup-azul-chat.sh   # imprime la ruta del archivo; si falla, NO seguir
   ```
5. **El puerto 3100 está libre**, o lo tiene el `azul-chat-app` actual:
   ```sh
   ss -ltnp | grep ':3100 ' || echo libre
   ```
6. **Ningún PostgreSQL expuesto.** No puede haber nada escuchando en 5432 fuera
   de 127.0.0.1:
   ```sh
   ss -ltn | grep ':5432 ' || echo "nada en 5432"
   ```

Si algo de esto no da, **no se despliega**.

## DEPLOY

```sh
# La imagen a correr, y la constancia.
printf 'AZUL_CHAT_IMAGE=%s\n' "$IMAGEN" > .env
C="docker compose -f docker-compose.prod.yml"

# 1. La imagen exacta (ya bajada en PRE; `pull` la confirma).
$C pull azul-chat-app

# 2. Primero la base, y esperar a que esté sana.
$C up -d azul-chat-db
until [ "$(docker inspect -f '{{.State.Health.Status}}' azul-chat-db)" = healthy ]; do sleep 2; done

# 3. Las migraciones, a propósito y una vez. Si falla, NO levantar la app.
#    Escrito ENTERO y sin `$C`: es una de las tres formas exactas que la guardia
#    de migraciones del ERP reconoce como de Azul Chat (erpmanual,
#    lib/deploy/proyectoDelComando.mjs). Con `$C` adelante, una sesión de Claude
#    Code del repo del ERP lo frena como ambiguo.
docker compose -f docker-compose.prod.yml run --rm --no-deps azul-chat-app prisma migrate deploy

# 4. La app.
$C up -d azul-chat-app
until [ "$(docker inspect -f '{{.State.Health.Status}}' azul-chat-app)" = healthy ]; do sleep 2; done

# 5. Salud e identidad, desde el host.
curl -fsS http://127.0.0.1:3100/api/salud      # {"ok":true,"servicio":"azul-chat"}
curl -fsS http://127.0.0.1:3100/api/version    # {"servicio":"azul-chat","commit":"<OBJETIVO>"}

# 6. La imagen del contenedor es la que se pidió.
docker inspect azul-chat-app --format '{{.Config.Image}}'                                            # = IMAGEN
docker inspect azul-chat-app --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'  # = OBJETIVO
test "$(curl -fsS http://127.0.0.1:3100/api/version | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')" = "$OBJETIVO"

# 7. Constancia.
printf '%s %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$OBJETIVO" "$(docker image inspect "$IMAGEN" --format '{{index .RepoDigests 0}}')" >> despliegues.log
```

Si `/api/salud` contesta 503, el cuerpo dice qué falló (`configuracion`,
`base`, `esquema` o `migraciones_pendientes`) sin decir por qué. Las causas
habituales son:
- `configuracion`: una variable de `app.env` falta o está mal;
- `base`: `DATABASE_URL` no coincide con `db.env`;
- `esquema`: faltan las tablas de la PRIMERA migración (base vacía, faltó el
  paso 3 en el primer despliegue);
- `migraciones_pendientes` (Tanda 16): a la base le falta la ÚLTIMA migración
  que trae la imagen, o hay una empezada y sin terminar (el paso 3 se salteó o
  falló). El detalle —cuál esperaba la imagen, cuál es la última aplicada y
  cuántas quedaron a medias— no va en la respuesta: va al log del contenedor,
  `docker logs azul-chat-app 2>&1 | grep salud.migraciones_pendientes`.

**Desde la Tanda 16 `/api/salud` mira las migraciones.** La imagen sabe cuál es
su última migración (la última carpeta de `prisma/migrations`, que viaja en la
imagen; se lee una vez al arrancar, no en cada pedido) y la salud exige que
esté aplicada y terminada en `_prisma_migrations`, sin ninguna a medias. El
healthcheck de Docker usa esta misma ruta: un contenedor que arranca con
migraciones pendientes queda **`unhealthy`** (el comando del healthcheck sale
con 1 ante un 503 y, tras 3 fallas seguidas, Docker lo marca así; el comando
está probado en `test/frontera/produccion.test.ts`). El orden del despliegue
no cambia: migrar primero (paso 3) y recrear después (paso 4); con ese orden el
`until ... healthy` del paso 4 termina como siempre. Si se recrea sin migrar, el
`until` no termina: es la señal.

Que la base tenga una migración MÁS NUEVA que la imagen no es falla: es lo que
pasa en un rollback a la imagen anterior sin restaurar la base.

La comprobación a mano sigue sirviendo para verlo con los ojos:

```sh
docker exec azul-chat-db sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL"'
ls prisma/migrations | grep -v '\.toml$' | sort | tail -1     # tiene que ser la misma
```

## NGINX

El bloque de `chat.operix.cloud` ya está en producción, con el registro DNS en
Cloudflare con proxy. El certificado Cloudflare Origin instalado es para
`operix.cloud` y `*.operix.cloud`, así que cubre `chat.operix.cloud`; las rutas
del certificado son **las mismas que usa el bloque del ERP**.

**Pendiente (al 2026-10-12, informado por el dueño): el `location /api/interno/`
de abajo NO está aplicado** —cambiar nginx pide root—. Mientras falte, las
rutas internas siguen protegidas por la app (secreto de 32+ caracteres
comparado en tiempo constante, y 404 a todo lo que no llegue directo por
127.0.0.1), pero un pedido de afuera llega hasta la app. La app reconoce "vino
por nginx" por `X-Real-IP` y por el `Host` público: si el bloque instalado no
pisa `Host` (`proxy_set_header Host $host`), nginx manda por defecto
`Host: 127.0.0.1:3100`, que la app toma por local, y esa segunda barrera
desaparece; queda solo el secreto. Comprobar el bloque instalado sin root:
`grep -rn -A25 'server_name chat.operix.cloud' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null`.

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name chat.operix.cloud;

    ssl_certificate     /ruta/del/origin-cert.pem;   # las del bloque de operix.cloud
    ssl_certificate_key /ruta/del/origin-key.pem;

    # Azul Chat no recibe archivos: el cuerpo más grande es {"codigo":"..."}.
    client_max_body_size 16k;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        # PISAR, no agregar: el cupo de vinculación usa el primer salto de
        # X-Forwarded-For. Con real_ip configurado para Cloudflare
        # (set_real_ip_from <rangos de Cloudflare>; real_ip_header CF-Connecting-IP;),
        # $remote_addr es la IP real del cliente. Sin eso es la de Cloudflare, y el
        # cupo por IP pasa a ser por nodo de Cloudflare (el cupo global sigue).
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        # El Origin llega tal cual: la app lo compara contra AZUL_CHAT_ORIGEN_PUBLICO.
    }

    # Tanda 5A: la ruta del timer NO es pública. La app ya contesta 404 a todo
    # lo que llega por acá (Host público, X-Real-IP), pero se corta también en
    # nginx: desde afuera no tiene que llegar ni a la app.
    location /api/interno/ {
        return 404;
    }
}
server {
    listen 80;
    server_name chat.operix.cloud;
    return 301 https://$host$request_uri;
}
```

`nginx -t` antes de `systemctl reload nginx`. El bloque del ERP no se toca.

## POST — después de desplegar

1. **HTTPS público**:
   ```sh
   curl -fsS https://chat.operix.cloud/api/salud
   curl -fsS https://chat.operix.cloud/api/version   # commit = OBJETIVO
   curl -sI https://chat.operix.cloud/ | grep -i -E '^(HTTP|x-powered-by)'   # 200, sin x-powered-by
   ```
2. **Logs** sin errores, y sin token, código, secreto ni `DATABASE_URL`:
   ```sh
   docker logs --since 10m azul-chat-app
   docker logs --since 10m azul-chat-db
   ```
3. **Reinicios**: `docker inspect -f '{{.RestartCount}}' azul-chat-app azul-chat-db` da `0`.
4. **Aislamiento de redes**:
   ```sh
   docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' azul-chat-app   # azul-chat-interna azul-chat-salida
   docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' azul-chat-db    # azul-chat-interna
   docker network inspect erpazul_default -f '{{range .Containers}}{{.Name}} {{end}}'             # sin azul-chat-*
   docker exec azul-chat-app node -e 'require("dns").lookup("erpazul_db",e=>console.log(e?"no resuelve":"RESUELVE: MAL"))'
   ```
5. **La base no tiene puerto en el host**: `docker port azul-chat-db` no imprime
   nada, y `ss -ltn | grep 5432` no muestra Azul Chat.
6. **El ERP sigue igual**: comparar `docker ps --filter name=erpazul ...` con
   `/tmp/erp-antes.txt` (mismos contenedores, mismas imágenes, sin reinicios) y
   abrir el ERP.
7. **Vinculación real**: en el ERP, menú → «Vincular Azul Chat», generar el código
   y pegarlo en `https://chat.operix.cloud`. Tiene que quedar «Sesión iniciada».
   - Requiere que `AZUL_CHAT_INTEGRACION_SECRET` esté configurado **en el ERP**
     con el mismo valor; hasta entonces el ERP contesta 503 a propósito y la
     vinculación dice «El ERP no respondió».
8. **`mi_alcance`**: con la sesión iniciada, la pantalla muestra el nombre y los
   locales que el ERP autoriza hoy.
9. **`ventas_resumen`**: desde la Tanda 3A tiene ruta (`GET /api/chats/ventas`)
   y pantalla: abrir un local y tocar "Ventas" tiene que mostrar las ventas de
   hoy (quien lo pruebe necesita el permiso "Ventas" en Accesos y
   `reportes.ver` en el ERP).

## ROLLBACK

El rollback **no reconstruye nada**: vuelve a una imagen ya publicada, por SHA.
El SHA anterior está en `despliegues.log`.

```sh
ANTERIOR=<SHA_ANTERIOR>   # de despliegues.log
printf 'AZUL_CHAT_IMAGE=ghcr.io/islaemanuel25-glitch/azul-chat:%s\n' "$ANTERIOR" > .env
git checkout --detach "$ANTERIOR"    # el compose de ese commit
C="docker compose -f docker-compose.prod.yml"
$C up -d azul-chat-app
curl -fsS http://127.0.0.1:3100/api/version   # commit = ANTERIOR
```

**Migraciones.** Prisma solo aplica hacia adelante. Volver a la imagen anterior
es seguro mientras las migraciones nuevas sean compatibles con el código viejo
(por ejemplo, agregar columnas o tablas). Si una migración no lo es:
1. `$C stop azul-chat-app`;
2. restaurar el backup del PRE ("Backups → Restaurar", abajo), con la imagen
   ANTERIOR ya puesta en `.env`: el `migrate deploy` del paso 4 de la
   restauración tiene que correr con la imagen que se va a levantar, no con la
   nueva;
3. levantar la imagen anterior.

**Volver a una imagen anterior a la Tanda 15 abre Azul Chat a todos los
vinculados.** El código viejo no mira `AccesoPersona` (ver "Tanda 15: accesos"):
mientras corra, entra cualquiera que tenga un vínculo, con lo que le dé el ERP.
Si hay personas vinculadas sin acceso, decidir antes de volver atrás.

**`20261011120000_eventos_pedidos_envios_cancelaciones` (Tanda 4B).** Aplicada
sola, sin código nuevo, es compatible con la imagen anterior: solo agrega
valores al enum y CHECKs. Pero en cuanto la imagen de la Tanda 4B ingiere un
`PEDIDO_SOLICITADO`, `TRANSFERENCIA_ENVIADA` o `TRANSFERENCIA_CANCELADA`, la
imagen anterior ya no sabe mostrarlo: los chats de ese local contestarían
`SERVICIO_NO_DISPONIBLE` (no muestra a medias un evento que no puede leer).
Volver a una imagen anterior a la Tanda 4B después de eso es el caso de arriba:
restaurar el backup del PRE.

**`20261011180000_push_suscripcion_y_avisos` (Tanda 5A).** Solo crea dos
tablas (`PushSuscripcion` y `AvisoLocal`) que la imagen anterior no lee:
volver a una imagen anterior es seguro, sin restaurar nada. Mientras corra la
imagen anterior no hay sincronización de fondo (la ruta no existe: el timer
recibe 404 y lo anota en el journal) ni avisos; conviene parar el timer
(`systemctl --user stop azul-chat-sincronizar.timer`) hasta volver a la nueva.

**`20261011200000_consumo_ia` (Tanda 6A).** Solo crea la tabla `ConsumoIa`,
que la imagen anterior no lee: volver atrás es seguro, sin restaurar nada. Sin
la imagen nueva no hay caja de preguntas; el gasto del mes queda guardado y se
retoma al volver.

**`20261012120000_preguntas_guardadas` (Tanda 6C).** Solo crea la tabla
`Pregunta`, que la imagen anterior no lee: volver atrás es seguro, sin
restaurar nada. Con la imagen anterior las preguntas guardadas no se ven (ni
se guardan nuevas); al volver a la nueva reaparecen las que tengan menos de 90
días.

**Primer despliegue.** No hay versión anterior: `$C stop azul-chat-app` (o
`$C down`, que conserva `pgdata/`) y quitar el bloque de nginx. El ERP no se ve
afectado en ningún caso.

## Backups

`ops/backup/backup-azul-chat.sh`:
- saca `pg_dump` del contenedor `azul-chat-db`, comprimido, a
  `/srv/produccion/backups-azul-chat/azul-chat-AAAAMMDD_HHMMSS.sql.gz`;
- **verifica antes de rotar**: el `gzip` íntegro, la marca de fin de `pg_dump` y
  al menos trece `CREATE TABLE` (`TABLAS_MINIMAS`, Tanda 16: los doce `model`
  del schema más `_prisma_migrations`; antes eran cuatro y un dump incompleto
  pasaba). **Al agregar una tabla hay que subir esa constante en el mismo PR**:
  `test/frontera/produccion.test.ts` se pone rojo si no coincide con el schema,
  y `test/db/backup.test.ts` corre el script contra un `pg_dump` real;
- conserva los últimos 30 (`AZUL_CHAT_BACKUP_RETENER`);
- si algo falla, borra el archivo parcial, sale con error y no rota;
- no pisa un backup existente;
- rota solo archivos `azul-chat-*`;
- se niega a escribir en el directorio de backups del ERP o en un `pgdata`;
- lee el usuario y la base adentro del contenedor, sin recibir ni imprimir
  credenciales.

**Los backups quedan en el mismo VPS.** Si se pierde el disco, se pierden la
base y sus 30 copias juntas. Una copia fuera del servidor (junto con la
`AZUL_CHAT_TOKEN_ENCRYPTION_KEY`, guardada aparte, ver "Variables") es lo que
cubre ese caso; hoy no hay ninguna automatizada. Nada del ERP se pierde con
esta base: se pierde lo propio de Azul Chat (vínculos —todos vuelven a
vincular—, accesos, preguntas guardadas, lectura e historial de eventos
guardado).

### El timer diario

Corre una vez por día, a las 04:15 de Argentina, con dos unidades de systemd de
**usuario** (no de sistema) que viven en el repo, en `ops/backup/systemd/`:

- `azul-chat-backup.service`: `Type=oneshot`, ejecuta
  `/srv/produccion/azul-chat/ops/backup/backup-azul-chat.sh` desde el clon, con
  `Nice=10` e `IOSchedulingClass=idle` porque el VPS comparte núcleos con el
  ERP. La salida va al journal.
- `azul-chat-backup.timer`: `OnCalendar=*-*-* 04:15:00
  America/Argentina/Buenos_Aires` y `Persistent=true` (si el VPS estaba apagado
  a esa hora, corre al volver).

Están instaladas desde el 10/10 en `~/.config/systemd/user/` del usuario que
despliega, con **linger** habilitado (`loginctl enable-linger`), así corren
aunque nadie tenga una sesión abierta. `test/frontera/produccion.test.ts` vigila
que las del repo apunten al script y sean diarias.

Ver el estado:

```sh
systemctl --user status azul-chat-backup.timer
systemctl --user list-timers azul-chat-backup.timer   # próxima y última corrida
journalctl --user -u azul-chat-backup -n 50            # salida del último backup
loginctl show-user "$USER" -p Linger                   # tiene que decir Linger=yes
ls -lt /srv/produccion/backups-azul-chat | head -6
```

Reinstalar (por ejemplo, después de cambiar las unidades en el repo y hacer
`git pull` en el clon). Se copian, no se enlazan: lo que corre es lo que está
en `~/.config/systemd/user/`:

```sh
mkdir -p ~/.config/systemd/user
cp /srv/produccion/azul-chat/ops/backup/systemd/azul-chat-backup.service \
   /srv/produccion/azul-chat/ops/backup/systemd/azul-chat-backup.timer \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now azul-chat-backup.timer
systemctl --user list-timers azul-chat-backup.timer
```

Correr un backup ahora, sin esperar al timer:
`systemctl --user start azul-chat-backup.service` (y mirar el journal).

### Restaurar

Son dos procedimientos distintos: **probar** un backup, en una base aparte y
sin tocar la que está en uso, y **restaurar** de verdad, reemplazando la base en
uso. Un backup que nunca se restauró no se sabe si sirve: que `gzip -t` y la
marca de fin den bien dice que el archivo está entero, no que la base vuelva.
La prueba se hace antes de necesitarla —una vez por mes, y SIEMPRE antes de
una restauración real, sobre el mismo archivo—.

**Los backups no incluyen la clave de cifrado.** Sin la misma
`AZUL_CHAT_TOKEN_ENCRYPTION_KEY`, los tokens restaurados no se descifran: la
gente tendrá que volver a vincular. Por eso la clave se guarda aparte.

#### 1. Probar un backup en una base aparte

En el mismo contenedor `azul-chat-db`, en una base con OTRO nombre
(`azulchat_prueba_restauracion`). La app no la ve —su `DATABASE_URL` apunta a
la de siempre— y la base en uso solo se lee, para comparar. No toca nada del
ERP. El dump es chico: se puede correr en cualquier momento.

```sh
set -o pipefail
cd /srv/produccion/azul-chat
F=/srv/produccion/backups-azul-chat/azul-chat-AAAAMMDD_HHMMSS.sql.gz
gzip -t "$F"

# 1. Una base aparte, vacía.
docker exec azul-chat-db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists azulchat_prueba_restauracion && createdb -U "$POSTGRES_USER" azulchat_prueba_restauracion'

# 2. El backup adentro. ON_ERROR_STOP corta en el primer error: tiene que imprimir RESTAURADO.
gzip -dc "$F" | docker exec -i azul-chat-db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d azulchat_prueba_restauracion' > /dev/null && echo RESTAURADO

# 3. Qué trajo, al lado de la base en uso (que solo se lee): migraciones
#    aplicadas, la última, y filas de las tablas que importan. Las del backup
#    son las de ese día: iguales o menores. Un backup anterior a la Tanda 15
#    no tiene AccesoPersona y esa línea da error: es esperado.
CONSULTA='SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT count(*) FROM "Vinculo"; SELECT count(*) FROM "Sesion"; SELECT count(*) FROM "Evento"; SELECT count(*) FROM "AccesoPersona";'
printf '%s\n' "$CONSULTA" | docker exec -i azul-chat-db sh -c 'psql -At -U "$POSTGRES_USER" -d azulchat_prueba_restauracion'
printf '%s\n' "$CONSULTA" | docker exec -i azul-chat-db sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# 4. Borrarla. No queda nada.
docker exec azul-chat-db sh -c 'dropdb -U "$POSTGRES_USER" azulchat_prueba_restauracion'
```

Si el paso 2 no imprime `RESTAURADO`, ese backup no sirve: probar el anterior
y averiguar por qué antes de que haga falta.

#### 2. Restaurar de verdad

Solo con un archivo que ya pasó la prueba de arriba.

```sh
set -o pipefail
cd /srv/produccion/azul-chat
F=/srv/produccion/backups-azul-chat/azul-chat-AAAAMMDD_HHMMSS.sql.gz   # el que se probó
gzip -t "$F"

# 1. Que nada escriba en la base mientras se reemplaza: los timers y la app.
systemctl --user stop azul-chat-sincronizar.timer azul-chat-vigia.timer azul-chat-backup.timer
docker compose -f docker-compose.prod.yml stop azul-chat-app

# 2. Un backup de lo que hay ahora, aunque se vaya a reemplazar: es la vuelta
#    si la restauración sale mal. Si falla porque la base está rota, seguir
#    solo si esa base ya no sirve de todos modos.
ops/backup/backup-azul-chat.sh

# 3. Reemplazar la base.
docker exec azul-chat-db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
gzip -dc "$F" | docker exec -i azul-chat-db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > /dev/null && echo RESTAURADO

# 4. Las migraciones que el backup no tenía. SIEMPRE, también si se cree que no
#    falta ninguna (con la base al día no hace nada). Corre con la imagen de
#    .env, que es la que se va a levantar. Forma exacta, sin $C (ver DEPLOY).
docker compose -f docker-compose.prod.yml run --rm --no-deps azul-chat-app prisma migrate deploy

# 5. Comprobar que la base quedó con TODAS las migraciones del checkout (que
#    está en el SHA de la imagen): las dos líneas tienen que ser iguales.
docker exec azul-chat-db sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL"'
ls prisma/migrations | grep -v '\.toml$' | sort | tail -1

# 6. La app, y comprobar.
docker compose -f docker-compose.prod.yml up -d azul-chat-app
until [ "$(docker inspect -f '{{.State.Health.Status}}' azul-chat-app)" = healthy ]; do sleep 2; done
curl -fsS http://127.0.0.1:3100/api/salud      # {"ok":true,...}

# 7. Los timers otra vez.
systemctl --user start azul-chat-sincronizar.timer azul-chat-vigia.timer azul-chat-backup.timer
```

**Por qué el paso 4 no es opcional.** Un backup sacado ANTES de las últimas
migraciones trae el esquema de ese día, y la imagen que corre espera el de hoy.
Hasta la Tanda 15 `/api/salud` no lo detectaba (miraba solo las tres tablas de
la primera migración) y el contenedor quedaba `healthy` con cada pedido
fallando. Desde la Tanda 16 la salud contesta 503 `migraciones_pendientes` y
el contenedor no llega a `healthy`; el paso 5 sigue mirando la base directo
porque dice CUÁL falta sin ir al log. `migrate deploy` aplica
únicamente las migraciones que el backup no tiene, en orden, y no toca las que
ya están (ejercido el 2026-10-12 contra PostgreSQL 16 local: un backup con 8
migraciones restaurado en una base aparte, y `migrate deploy` aplicó solo
`20261015120000_turno_de_fondo` y `20261016120000_accesos`; una segunda corrida
dijo "No pending migrations to apply"). Es el mismo comando del paso 3 del
DEPLOY. En un rollback (volver a la imagen anterior con
el backup del PRE) se corre con la imagen ANTERIOR ya puesta en `.env`: así no
aplica migraciones que esa imagen no conoce.

**Lo que se pierde al restaurar un backup viejo** es lo que pasó después de
sacarlo, en la base de Azul Chat: sesiones —esos teléfonos vuelven a pedir el
código—, vínculos canjeados después —esas personas vuelven a vincular—,
cambios de Accesos, preguntas guardadas y lo leído. Lo del ERP no se toca. La
sincronización vuelve a traer los eventos desde los cursores del backup, así
que puede repetir avisos push de lo que ya se había avisado en ese rato.

## Sincronización en segundo plano (Tanda 5A)

Con la app cerrada no entraba nada: la ingesta corría solo cuando alguien abría
Azul Chat. Ahora un timer de systemd de **usuario**, en el mismo VPS, llama cada
2 minutos a `POST http://127.0.0.1:3100/api/interno/sincronizar`. Esa ruta:

- contesta **404** (como si no existiera) a todo lo que no sea el timer: sin el
  secreto `AZUL_CHAT_TAREA_SECRET` en la cabecera `x-azul-chat-tarea`, o con lo
  que pone nginx (Host público, `X-Real-IP`, `X-Forwarded-Proto: https`), o por
  GET. Desde afuera no funciona, y nginx además la corta (bloque de arriba);
- por cada persona con el vínculo vigente y una sesión que valga, pide
  `mi_alcance` vivo y corre la ingesta (frecuencia mínima, arriendo, reglas por
  código; `VINCULO_NO_VALIDO` revoca, caído no). Desde la Tanda 5B es lo
  ÚNICO que ingiere: abrir la app ya no trae nada del ERP;
- manda los avisos push de lo nuevo (`docs/EVENTOS.md`, "Avisos push").

Las unidades viven en el repo, en `ops/sincronizar/systemd/`, con el mismo
estilo que las del backup:

- `azul-chat-sincronizar.service`: `Type=oneshot`, ejecuta
  `/srv/produccion/azul-chat/ops/sincronizar/sincronizar-azul-chat.sh`. El
  script lee el secreto de `~/.config/azul-chat/tarea.secreto` (se niega si no
  es 600), se lo pasa a curl por la entrada estándar (no aparece en `ps`) y
  escribe en el journal solo el código HTTP y las cuentas de la corrida.
- `azul-chat-sincronizar.timer`: `OnBootSec=2min`, `OnUnitActiveSec=2min`.

**El cupo del ERP, con números (Tanda 5B; corregido en la Tanda 12).** El
ERP admite hoy **120 consultas por persona y 240 por aplicación**, en una
ventana FIJA de 60 s que arranca con la primera consulta contada; los rechazos
no cuentan (erpmanual, `lib/integraciones/azul-chat/limitador.js`,
`MAX_POR_USUARIO` y `MAX_POR_APLICACION`, leído sobre `955cdd9`). Eran 30 y
120 cuando se escribió esta cuenta, y el ERP los subió después del incidente
del 11/10. La app abierta y esta corrida usan el mismo token: comparten las
120.

Azul Chat **no cambió su presupuesto**: `CUPO_ERP_POR_PERSONA` sigue en 30 en
`src/server/chats/sincronizacion.ts`, así que la cuenta de abajo, hecha sobre
30, queda del lado seguro con cuatro veces de margen. Subirlo es una decisión
aparte, con su prueba en `test/db/cupo.test.ts`.

- **El incidente del 11/10.** Abrir la app costaba 22 a 27 consultas (una
  `mi_alcance` por pedido más la ingesta de cada local y capacidad); la corrida,
  21 (1 `mi_alcance` + 5 locales × 4 capacidades). 12:20:26 se abrió la app;
  12:21:10 corrió el timer: 8 bien y 13 rechazadas; 12:21:12-25 la persona tocó
  Reintentar 10 veces: 10 rechazadas. 49 rechazos, los mismos en Chat y en el
  ERP, y la pantalla "ERP Azul no responde". Mitigación de ese día: el timer
  instalado pasó a 5 minutos.
- **Lo que cuesta la app ahora.** Ningún pedido ingiere. La lista, un local,
  una página anterior, General, marcar leído y "Actualizar": 1 consulta cada
  uno (`mi_alcance`). Ventas: 2. Una navegación intensa de un minuto —abrir la
  lista, 5 locales, General, Ventas y Actualizar ×3— son **12**.
- **Lo que cuesta la corrida ahora.** Como mucho **18 por persona**
  (`PRESUPUESTO_FONDO_POR_PERSONA` = 30 − 12): `mi_alcance` más una página por
  cada (local, capacidad) que no se sincronizó en los últimos 30 s, hasta
  llegar a 18. Sin tope serían `1 + 4·N` (21 con 5 locales), y 21 + 12 = 33
  pasa de 30: por eso el tope. Con él, en cualquier orden, corrida + app ≤ 30
  dentro de la ventana; lo prueba `test/db/cupo.test.ts` con el cupo real
  copiado al ERP de mentira (fondo antes, después y en el medio de la
  navegación: cero 429; y la contraprueba, el fondo de antes, da 3).
- **Lo que no entra en una corrida** queda para la siguiente, que empieza por
  ahí (sin anotar error). Con 5 locales entran 17 de las 20 capacidades por
  corrida: cada una se trae al menos cada 2 corridas (4 min). Hasta **8
  locales** por persona eso sigue valiendo (34 ≥ 32) y nadie ve "Actualización
  demorada" por esto; con 9 o más, alguna capacidad tardaría 3 corridas y
  aparecería el aviso: habría que revisar esta cuenta antes.
- **Si igual el ERP dice LIMITE_EXCEDIDO** (la persona tocó mucho más que
  eso), la corrida se corta ahí, deja `LIMITE_EXCEDIDO` en lo que faltaba y
  contesta 200 con `cortadaPorCupo: true`; la siguiente empieza por eso. La app
  muestra "Muchas consultas seguidas al ERP. Probá de nuevo en un minuto." con
  Reintentar deshabilitado 20 s.
- **El cupo por aplicación (240)** lo cubre desde la Tanda 14 un tope por
  corrida: el fondo gasta como mucho 120 en total, todas las personas juntas,
  y deja 120 para las apps abiertas. Si no entran todas, las que faltan van
  primero en la corrida siguiente. Hasta cuántas personas entra, y con qué
  demora, está en `docs/CHATS.md`, "Varias personas".

**Por qué cada 2 minutos.** Con 2 minutos entre corridas, dos nunca caen en la
misma ventana de 60 s, que es lo que hace valer el tope de 18. Y el código usa
ese mismo periodo para decir "Actualización demorada" (más de 3 corridas sin
sincronizar = 6 min; `PERIODO_SINCRONIZACION_MS`, que
`test/frontera/produccion.test.ts` exige igual al `OnUnitActiveSec` del timer).
Más seguido, dos corridas podrían sumar en una ventana; más espaciado solo
demora los avisos.

**Al desplegar esta versión, volver el timer de 5 a 2 minutos.** La mitigación
del 11/10 cambió solo la unidad instalada; el repo dice 2. Copiar la unidad del
repo de nuevo y recargar:

```sh
cp /srv/produccion/azul-chat/ops/sincronizar/systemd/azul-chat-sincronizar.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart azul-chat-sincronizar.timer
systemctl --user cat azul-chat-sincronizar.timer | grep OnUnitActiveSec   # OnUnitActiveSec=2min
```

Instalar (después del despliegue que trae la ruta, y con el secreto ya
generado, ver "Variables"):

```sh
mkdir -p ~/.config/systemd/user
cp /srv/produccion/azul-chat/ops/sincronizar/systemd/azul-chat-sincronizar.service \
   /srv/produccion/azul-chat/ops/sincronizar/systemd/azul-chat-sincronizar.timer \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start azul-chat-sincronizar.service      # una corrida ahora
journalctl --user -u azul-chat-sincronizar -n 5            # HTTP 200 {"estado":"OK",...}
systemctl --user enable --now azul-chat-sincronizar.timer
systemctl --user list-timers azul-chat-sincronizar.timer
```

Comprobar que desde afuera no anda (los dos dan 404):

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://chat.operix.cloud/api/interno/sincronizar
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3100/api/interno/sincronizar
```

Pararla (por ejemplo, para un rollback): `systemctl --user disable --now
azul-chat-sincronizar.timer`. La app sigue igual; solo deja de sincronizar sola.

## Vigía de la sincronización (Tanda 12)

Si las corridas de `azul-chat-sincronizar` fallan (ERP caído, cupo, error
interno) o dejan de ocurrir (timer parado), antes nadie se enteraba. Ahora:

- **Cada corrida anota su salud** en la tabla `SaludSincronizacion` (una sola
  fila): la hora del último éxito, la de la última falla con su motivo corto, y
  las fallas seguidas. Una corrida es falla si el ERP cortó por cupo
  (`ERP_CUPO_EXCEDIDO`), si fallaron TODAS las personas que se intentaron
  (`ERP_NO_DISPONIBLE`) o si falló la base de Azul Chat (`BASE`). Una corrida
  sin nadie a quien sincronizar es un éxito: corrió.
- **Un segundo timer, `azul-chat-vigia`, cada 5 minutos**, llama a
  `POST http://127.0.0.1:3100/api/interno/vigia`. Está protegida EXACTAMENTE
  como sincronizar: el mismo secreto `AZUL_CHAT_TAREA_SECRET`, la misma
  comparación en tiempo constante, el mismo 404 vacío para todo lo demás
  (navegador, nginx, GET). No llama al ERP.
- **Hay incidente** si el último éxito tiene más de 10 minutos, o si hay 3 o
  más fallas seguidas. Con la base recién migrada (ninguna corrida anotada), no
  hay incidente hasta 10 minutos después de que el vigía la ve por primera vez.
- **Avisos**: UN push al abrirse ("Azul Chat no se está actualizando desde las
  HH:MM." y el motivo en palabras simples) y UN push al cerrarse ("Azul Chat
  volvió a actualizarse."), solo a las personas de `AZUL_CHAT_AVISOS_SISTEMA`.
  El de recuperación va solo a quien recibió el de apertura. No se repiten cada
  5 minutos ni con un reinicio: el estado del incidente y a quién se avisó
  quedan en la base, y se anotan ANTES de mandar (si el envío falla, no se
  reintenta). Tocar el aviso abre la pantalla principal.
- **Horario de silencio**: se respeta, el de cada persona. Si el incidente se
  abre dentro del silencio, el aviso sale en la primera vuelta del vigía
  después del silencio, y solo si sigue abierto; si se cerró antes, no sale
  ninguno de los dos.
- Un error del push nunca es un 500: queda en el log y el vigía contesta 200.

Las unidades viven en `ops/vigia/systemd/`, con el mismo estilo que las de
sincronizar:

- `azul-chat-vigia.service`: `Type=oneshot`, ejecuta
  `/srv/produccion/azul-chat/ops/vigia/vigia-azul-chat.sh`, que lee el secreto
  de `~/.config/azul-chat/tarea.secreto` (el MISMO archivo; se niega si no es
  600), se lo pasa a curl por la entrada estándar y escribe en el journal solo
  el código HTTP y la respuesta (`incidente` y cuentas).
- `azul-chat-vigia.timer`: `OnBootSec=5min`, `OnUnitActiveSec=5min`.

Instalar (después del despliegue que trae la ruta y la migración):

```sh
cd /srv/produccion/azul-chat
# 1. A quién avisar: los IDs de persona del ERP, sin comillas. Una sola línea.
grep -c '^AZUL_CHAT_AVISOS_SISTEMA=' app.env          # si da 1, editarla en vez de agregar
printf 'AZUL_CHAT_AVISOS_SISTEMA=%s\n' '<ids, p. ej. 9>' >> app.env
docker compose -f docker-compose.prod.yml up -d azul-chat-app   # para que la lea

# 2. Las unidades.
cp ops/vigia/systemd/azul-chat-vigia.service ops/vigia/systemd/azul-chat-vigia.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start azul-chat-vigia.service      # una vuelta ahora
journalctl --user -u azul-chat-vigia -n 5            # HTTP 200 {"estado":"OK","incidente":"SIN_INCIDENTE",...}
systemctl --user enable --now azul-chat-vigia.timer
systemctl --user list-timers azul-chat-vigia.timer
```

Comprobar que desde afuera no anda (los dos dan 404):

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://chat.operix.cloud/api/interno/vigia
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3100/api/interno/vigia
```

**Probarlo a mano**, con una persona de la lista con las notificaciones
activadas en su teléfono y fuera de su horario de silencio:

```sh
systemctl --user stop azul-chat-sincronizar.timer    # simula el timer parado
# esperar más de 10 minutos; el vigía corre solo cada 5, o forzarlo:
systemctl --user start azul-chat-vigia.service
journalctl --user -u azul-chat-vigia -n 3            # "incidente":"ABIERTO","avisosApertura":1
# llega el push "Azul Chat no se está actualizando desde las HH:MM. ..."
systemctl --user start azul-chat-vigia.service
journalctl --user -u azul-chat-vigia -n 3            # "incidente":"SIGUE", sin avisos nuevos
systemctl --user start azul-chat-sincronizar.timer   # vuelve; corre a los 2 minutos
systemctl --user start azul-chat-sincronizar.service # o ya
systemctl --user start azul-chat-vigia.service
journalctl --user -u azul-chat-vigia -n 3            # "incidente":"CERRADO","avisosRecuperacion":1
```

Si no llega nada, el log de la app dice por qué, sin datos: `docker logs
azul-chat-app 2>&1 | grep tarea.vigia | tail -3` muestra `sinEnvio`
(`SIN_DESTINATARIOS`, `DESTINATARIOS_INVALIDOS`, `PUSH_NO_CONFIGURADO`), o
`enSilencio`, o `enviados` / `fallidos`. Una persona sin teléfono suscripto
cuenta como avisada: se le intentó y no hay a dónde mandarle.

Pararlo: `systemctl --user disable --now azul-chat-vigia.timer`. Nada más
depende de él.
