# Azul Chat en producción — runbook

Procedimiento para desplegar Azul Chat en el mismo VPS que ERP Azul, **completamente
separado del ERP**. Nada de este documento se ejecutó todavía: es el procedimiento
futuro. Cada paso dice qué se comprueba y qué hacer si no da.

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

## La imagen

La publica el workflow **Imagen** (`.github/workflows/imagen.yml`):
- solo después de que la CI terminó en verde sobre un push a `main`, o a mano
  desde `main`;
- la etiqueta es el SHA completo y no hay `latest`;
- la etiqueta OCI `org.opencontainers.image.revision` y el `APP_BUILD_ID` de
  adentro son ese mismo SHA, y el workflow lo verifica.

Las migraciones **no** corren al arrancar: son un paso explícito del despliegue
(`prisma migrate deploy`, con el CLI que trae la imagen en `/opt/prisma-cli`).

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
$C run --rm --no-deps azul-chat-app prisma migrate deploy

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

Si `/api/salud` contesta 503, el cuerpo dice qué falló (`configuracion`, `base`
o `esquema`) sin decir por qué. Las causas habituales son:
- `configuracion`: una variable de `app.env` falta o está mal;
- `base`: `DATABASE_URL` no coincide con `db.env`;
- `esquema`: faltó el paso 3.

## NGINX (futuro, no se configura en esta etapa)

El certificado Cloudflare Origin instalado es para `operix.cloud` y
`*.operix.cloud`, así que cubre `chat.operix.cloud`. Las rutas del certificado
son **las mismas que usa el bloque del ERP**; se copian de ahí. Falta el registro
DNS `chat.operix.cloud` en Cloudflare, con proxy, que se crea aparte.

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
9. **`ventas_resumen`**: hoy es un servicio interno **sin ruta ni pantalla**, así
   que no hay forma de ejercerlo desde producción sin agregar una. Queda sin
   verificar en producción hasta que exista la pantalla que lo use.

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
2. restaurar el backup del PRE (ver abajo);
3. levantar la imagen anterior.

**Primer despliegue.** No hay versión anterior: `$C stop azul-chat-app` (o
`$C down`, que conserva `pgdata/`) y quitar el bloque de nginx. El ERP no se ve
afectado en ningún caso.

## Backups

`ops/backup/backup-azul-chat.sh`:
- saca `pg_dump` del contenedor `azul-chat-db`, comprimido, a
  `/srv/produccion/backups-azul-chat/azul-chat-AAAAMMDD_HHMMSS.sql.gz`;
- **verifica antes de rotar**: el `gzip` íntegro, la marca de fin de `pg_dump` y
  las cuatro tablas;
- conserva los últimos 30 (`AZUL_CHAT_BACKUP_RETENER`);
- si algo falla, borra el archivo parcial, sale con error y no rota;
- no pisa un backup existente;
- rota solo archivos `azul-chat-*`;
- se niega a escribir en el directorio de backups del ERP o en un `pgdata`;
- lee el usuario y la base adentro del contenedor, sin recibir ni imprimir
  credenciales.

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

En una base nueva, nunca encima de la que está en uso sin un backup previo:

```sh
F=/srv/produccion/backups-azul-chat/azul-chat-AAAAMMDD_HHMMSS.sql.gz
gzip -t "$F"
docker compose -f docker-compose.prod.yml stop azul-chat-app
docker exec azul-chat-db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
gzip -dc "$F" | docker exec -i azul-chat-db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml up -d azul-chat-app
```

**Los backups no incluyen la clave de cifrado.** Sin la misma
`AZUL_CHAT_TOKEN_ENCRYPTION_KEY`, los tokens restaurados no se descifran: la
gente tendrá que volver a vincular. Por eso la clave se guarda aparte.
