# Azul Chat

Aplicación móvil de conversaciones operativas, **independiente de ERP Azul**.

ERP Azul es la fuente de verdad de usuarios, permisos, locales, ventas, caja,
stock y finanzas. Azul Chat no se conecta a su base: todo dato del ERP pasa por
dos rutas firmadas con HMAC, `POST /api/integraciones/azul-chat/vinculo/canjear`
y `POST /api/integraciones/azul-chat/consultar`. En V1 esa integración es
**solo lectura**.

El contrato es el del ERP desplegado, copiado de su código y no de memoria. Los
fixtures salen de ejecutar ese código: `test/fixtures/erp-8920516.json` (canje,
`mi_alcance`, errores), `test/fixtures/erp-25172fe.json` (`transferencias_eventos`
y las capacidades por local de `mi_alcance`), este regenerable con
`scripts/generar-fixture-erp.mjs`, y `test/fixtures/erp-76b9a71.json`
(`pedidos_eventos`, `envios_eventos` y `cancelaciones_eventos`, Tanda 4B),
copia sin tocar del fixture que generó el ERP en ese commit. Los eventos del
ERP —recepciones, pedidos solicitados, envíos y cancelaciones—, su ingesta y la
lectura están en `docs/EVENTOS.md`.

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
  chats: `chats`, `chats/local`, `chats/general`, `chats/ventas`, desde la Tanda 7B `chats/caja` y desde la
  8B `chats/stock` (GET), desde la 9B `chats/pendientes` y `chats/pendientes/general` (GET),
  desde la 10 `chats/buscar` (GET),
  `chats/leido` (POST) y, desde la Tanda 6A, `chats/preguntar` (POST),
  descritos en `docs/CHATS.md`; desde la Tanda 5A,
  `push/clave` (GET) y `push/suscribir` (POST, DELETE), y
  `interno/sincronizar`, que NO es del navegador (solo el timer del VPS, por
  127.0.0.1 y con su secreto; a todo lo demás, 404). No hay proxy genérico.
  - `GET /api/salud` — healthcheck: 200 si la configuración es válida, la base
    contesta y está migrada. No llama al ERP ni escribe.
  - `GET /api/version` — el SHA del commit con que se construyó la imagen
    (`APP_BUILD_ID`), con `no-store`. Desde la Tanda 6C la página `/` se arma
    en cada pedido y trae ese mismo commit, que es la referencia de la recarga
    por versión (`docs/INTERFAZ.md`).
- `src/components/` — interfaz. **No pueden importar `src/server`.**
  - `chats/` — la app móvil (Tanda 2C): la lista de chats, un Local, General y
    sus estados, el botón "Ventas" de un Local (Tanda 3A), el botón "Caja" y
    la tarjeta de cajas por turno (`Cajas.tsx`, Tanda 7B), el botón "Stock" y
    las tarjetas de bajo mínimo y de productos (`Stock.tsx`, Tanda 8B), el botón
    "Pendientes" en un Local y en General y su tarjeta (`Pendientes.tsx`, Tanda
    9B: pedidos sin enviar y cajas a revisar, con pills IMPORTANTE / NORMAL) y la recarga al
    cambiar de versión (`version.ts`, Tanda 3B) y las preguntas en lenguaje
    natural (`Preguntas.tsx`, Tanda 6A) y, desde la Tanda 10, la pantalla Buscar
    (`Buscar.tsx`: la lupa del encabezado de un Local o de General), con un único cliente HTTP
    (`clienteChats.ts`) para las rutas de chats y `/api/version`.
    Descrita en `docs/INTERFAZ.md`.
  - `sesion/PanelSesion.tsx` — vincular, ver la sesión y cerrarla, y desde la
    Tanda 5A la fila "Notificaciones" (`push/`).
  - `shell/ShellMovil.tsx` — el marco: encabezado fijo, volver y acciones.
- `src/shared/` — tipos y validaciones que puede usar la interfaz. Sin secretos ni red.
- `src/server/` — solo servidor. Cada archivo importa `server-only`.
  - `erp/` — configuración, firma, constructores de cuerpo (`canje`,
    `miAlcance`, `ventasResumen`, `cajasResumen` (Tanda 7B), `stockConsulta`
    (Tanda 8B), `pedidosPendientes` (Tanda 9B) y, uno común a las cuatro capacidades de
    eventos, `eventos.ts`) y el cliente firmado, sin reintentos.
  - `seguridad/cifradoToken.ts` — AES-256-GCM del token.
  - `http/` — Origin, cupo, lectura del cuerpo y respuestas.
  - `sesion/` — cookie, repositorio, vincular, estado, cerrar y el paso de la
    sesión al token (`delegacion.ts`).
  - `chats/` — autorización viva por capacidad, la sincronización (frecuencia
    mínima, presupuesto del cupo del ERP, orden por lo pendiente) y el estado
    "Actualización demorada" desde los cursores, historial paginado y las diez
    rutas de chats. Desde la Tanda 5B las rutas NO ingieren: una `mi_alcance`
    por pedido y la base propia.
  - `interno/` — la sincronización en segundo plano (Tanda 5A), la única que
    ingiere desde la 5B: la ruta que llama el timer del VPS, con su secreto y
    su puerta (`docs/DEPLOY.md`).
  - `push/` — notificaciones push (Tanda 5A): claves VAPID, suscripciones,
    qué se avisa una sola vez y el envío (`docs/EVENTOS.md`).
  - `eventos/` — ingesta (una maquinaria, una definición por capacidad en
    `capacidades.ts`), eventos guardados de los cuatro tipos y lectura
    (`docs/EVENTOS.md`).
  - `ventas/ventasResumen.ts` — "ventas" desde una sesión. Lo usan
    `GET /api/chats/ventas`, con período fijo "hoy", y las preguntas.
  - `caja/cajasResumen.ts` — "cajas por turno" desde una sesión (Tanda 7B),
    copiadas campo por campo. Lo usan `GET /api/chats/caja` y las preguntas.
  - `stock/stockConsulta.ts` — "bajo mínimo" y la búsqueda de un producto
    desde una sesión (Tanda 8B), copiados campo por campo. Lo usan
    `GET /api/chats/stock` y las preguntas.
  - `pendientes/pendientes.ts` — "Pendientes" de uno o varios locales desde una
    sesión (Tanda 9B): `pedidos_pendientes` y `cajas_resumen` de hoy y de ayer,
    solo lo que cada local anuncia; una fuente que falla no tira las otras y se
    dice cuál faltó. La etiqueta y el orden, en `src/shared/chats/pendientes.ts`.
    Lo usan `GET /api/chats/pendientes`, `GET /api/chats/pendientes/general` y
    las preguntas.
  - `buscar/buscar.ts` — buscar en el historial guardado (Tanda 10): eventos y
    preguntas guardadas de la persona, en la base propia, con la misma
    visibilidad y el mismo cursor que el historial. Del ERP, solo `mi_alcance`.
    Lo usa `GET /api/chats/buscar`.
  - `ia/` — la IA de las preguntas (Tanda 6A): configuración, la llamada a
    Gemini (una sola, por `fetch`, sin SDK), la tarifa con su fecha y el tope de
    gasto del mes.
  - `preguntas/` — la ruta de preguntas: la intención que devuelve la IA, su
    validación y la respuesta que arma el código (ventas del ERP, eventos de la
    base propia). Desde la Tanda 7B, `cajas.ts`: las preguntas de caja y de
    ventas por turno, con el turno elegido por el código sobre los nombres
    que da el ERP. Desde la Tanda 8B, `stock.ts`: las preguntas de stock, con
    el texto del producto tal como lo escribió la persona, que busca el ERP.
    Desde la Tanda 6C, `guardadas.ts`: cada pregunta con su
    respuesta, que vuelve en el historial si hoy todavía se puede ver.
  - `configuracion.ts`, `db.ts`, `log.ts`.
- `prisma/` — esquema y migraciones de la base propia: `Instalacion`,
  `Vinculo`, `Sesion`, `Evento`, `CursorIngesta`, `LecturaLocal`,
  `PushSuscripcion` y `AvisoLocal` (Tanda 5A), `ConsumoIa` (Tanda 6A, el
  gasto en IA por mes) y `Pregunta` (Tanda 6C, las preguntas con su
  respuesta, por persona y chat, 90 días; `docs/CHATS.md`). Nada de
  conversaciones, mensajes ni auditoría: la conversación de un local y General
  se derivan de los eventos.
- `test/` — `node:test`. `test/db/` usa una base descartable y un ERP de
  mentira con estado; ningún test llama al ERP real. `test/ui/` dibuja los
  componentes con `react-dom/server`, sin navegador (los `.tsx` se cargan con
  `test/ayuda/tsx.mjs`).
- `public/` — el service worker mínimo (solo push y el toque, sin caché) y los
  íconos de la app instalable (Tanda 5A).
- `ops/sincronizar/` — el script y las unidades de systemd del timer de
  sincronización (Tanda 5A).
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
- `ops/backup/systemd/` — el `.service` y el `.timer` de usuario que lo corren
  una vez por día (04:15, Argentina); instalados en el VPS, se reinstalan desde
  acá (`docs/DEPLOY.md`, Backups).
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

Desde la Tanda 5A, opcionales (sin ellas el resto anda igual):

- `AZUL_CHAT_VAPID_PUBLICA`, `AZUL_CHAT_VAPID_PRIVADA`, `AZUL_CHAT_VAPID_CONTACTO`
  — las claves de las notificaciones push y su `mailto:`. La pública se entrega
  al navegador por `GET /api/push/clave`, no por `NEXT_PUBLIC_`.
- `AZUL_CHAT_TAREA_SECRET` — el secreto de la ruta que llama el timer de
  sincronización. Mínimo 32 caracteres y distinto de todos los demás.

Desde la Tanda 6A, opcionales también:

- `AZUL_CHAT_GEMINI_API_KEY` — la clave de Google Gemini, la MISMA que usa el
  ERP. Sin ella no hay caja de preguntas. Distinta de los otros secretos.
- `AZUL_CHAT_IA_TOPE_USD` — el tope de gasto en IA por mes (por defecto 5).

Cómo generarlas (o copiarlas del ERP) en el VPS sin imprimirlas: `docs/DEPLOY.md`.

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

- Los avisos push son "a lo sumo una vez": si el servicio de push no contesta,
  ese aviso se pierde (la novedad sigue en la app). En iPhone, el navegador solo
  entrega push a la app instalada en la pantalla de inicio.
- El cupo del ERP (120 por persona en 60 s desde el 2026-10-11; 30 antes) lo
  comparten la app y la sincronización de fondo. Desde la Tanda 5B la app gasta 1 consulta por
  pantalla (Ventas, Caja y Stock, 2; Buscar, Tanda 10, 1) y el fondo como mucho 18 por persona por corrida: una
  navegación intensa de un minuto (12) entra con la corrida en cualquier orden.
  "Pendientes" (Tanda 9B) es la más cara: 1 + hasta 3 de un local (pedidos,
  cajas de hoy y de ayer) y, en General, 1 + hasta 3 por local con alguna de
  las dos capacidades: con 5 locales, 16, que con el fondo (18) suman 34 de 120.
  Lo nuevo llega a la app solo por el fondo, cada 2 minutos; con 5 locales
  cada capacidad se trae al menos cada 4. Con 9 o más locales por persona, o
  más de 6 personas a la vez (cupo de 120 por aplicación), hay que revisar la
  cuenta (`docs/DEPLOY.md`, "Sincronización en segundo plano").

- Cada pregunta en lenguaje natural (Tanda 6A) gasta del cupo del ERP 1 + N:
  una `mi_alcance` y, si es de ventas, una `ventas_resumen` por local (N = 1
  para un local, o los locales con ventas para "todos"); caja y ventas por
  turno (Tanda 7B), igual con `cajas_resumen`; stock (Tanda 8B), igual con
  `stock_consulta`: 1 + 1 de un local, 1 + los locales con la capacidad de
  "todos"; pendientes (Tanda 9B), como el botón: 1 + hasta 3 por local.
  Eventos, 1. La IA se
  paga aparte, con tope mensual (`AZUL_CHAT_IA_TOPE_USD`); la tarifa y la
  cuenta por pregunta están en `docs/CHATS.md`. La IA solo interpreta la
  pregunta: no recibe ventas, eventos ni ids.

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
