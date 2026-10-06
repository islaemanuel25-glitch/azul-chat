# Azul Chat

Aplicación móvil de conversaciones operativas, **independiente de ERP Azul**.

ERP Azul es la fuente de verdad de usuarios, permisos, locales, ventas, caja,
stock y finanzas. Azul Chat no se conecta a su base: todo dato del ERP pasa por
dos rutas firmadas con HMAC, `POST /api/integraciones/azul-chat/vinculo/canjear`
y `POST /api/integraciones/azul-chat/consultar`. En V1 esa integración es
**solo lectura**.

El contrato es el del ERP desplegado en `8920516` (erpmanual), copiado de su
código y no de memoria. Los fixtures de `test/fixtures/erp-8920516.json` salen
de ejecutar ese código.

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
  `salud`, `sesion` (GET, DELETE) y `sesion/vincular` (POST). No hay proxy
  genérico.
- `src/components/` — interfaz. **No pueden importar `src/server`.**
- `src/shared/` — tipos y validaciones que puede usar la interfaz. Sin secretos ni red.
- `src/server/` — solo servidor. Cada archivo importa `server-only`.
  - `erp/` — configuración, firma, constructores de cuerpo (`canje`,
    `miAlcance`, `ventasResumen`) y el cliente firmado, sin reintentos.
  - `seguridad/cifradoToken.ts` — AES-256-GCM del token.
  - `http/` — Origin, cupo, lectura del cuerpo y respuestas.
  - `sesion/` — cookie, repositorio, vincular, estado, cerrar y el paso de la
    sesión al token (`delegacion.ts`).
  - `ventas/ventasResumen.ts` — "ventas" desde una sesión. Servicio interno:
    ninguna ruta lo expone todavía.
  - `configuracion.ts`, `db.ts`, `log.ts`.
- `prisma/` — esquema y migraciones de la base propia: `Instalacion`,
  `Vinculo`, `Sesion`. Nada de conversaciones, mensajes, eventos ni auditoría.
- `test/` — `node:test`. `test/db/` usa una base descartable y un ERP de
  mentira con estado; ningún test llama al ERP real.
- `scripts/verificar-bundle-cliente.mjs` — compila con secretos canario y los
  busca en todo lo que baja al navegador.

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
- `npm audit` informa `deepmerge-ts` vía el CLI `prisma` 6 (solo herramienta de
  desarrollo y migración, no se carga en el servidor).

## Comandos

- `npm run dev` — servidor de desarrollo.
- `npm run build` / `npm start` — compilación y servidor de producción.
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
