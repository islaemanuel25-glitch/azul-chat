# Azul Chat

Aplicación móvil de conversaciones operativas, **independiente de ERP Azul**.

ERP Azul es la fuente de verdad de usuarios, permisos, locales, ventas, caja,
stock y finanzas. Azul Chat no se conecta a su base: todo dato del ERP pasa por
la API controlada `POST /api/integraciones/azul-chat/consultar`, firmada con
HMAC. En V1 esa integración es **solo lectura**.

## Arquitectura

```
Navegador / app móvil  →  backend de Azul Chat  →(HMAC)→  API del ERP
```

Nunca el navegador directo al ERP. El secreto compartido vive solo en el
servidor de Azul Chat.

- `src/app/` — Next.js App Router: pantallas y rutas `api/` del backend propio.
- `src/components/` — componentes de interfaz. **No pueden importar `src/server`.**
- `src/shared/` — tipos y validaciones que puede usar la interfaz (el contrato
  de respuesta del ERP). Sin secretos ni red.
- `src/server/` — solo servidor. Cada archivo importa `server-only`.
  - `erp/config.ts` — lee `ERP_BASE_URL` y `AZUL_CHAT_INTEGRACION_SECRET`; fail closed.
  - `erp/firma.ts` — firma HMAC-SHA256 del contrato del ERP.
  - `erp/ventasResumen.ts` — valida la entrada y arma el cuerpo exacto.
  - `erp/cliente.ts` — el cliente: una ruta, una capacidad, timeout, sin reintentos.
  - `log.ts` — registro técnico con tipo cerrado.
- `test/` — `node:test`, con un ERP de mentira en un puerto local.
- `scripts/verificar-bundle-cliente.mjs` — compila con un secreto canario y lo
  busca en todo lo que baja al navegador.

## Variables de entorno

Ver `.env.example`. Copiarlo a `.env.local` (ignorado por git).

- `ERP_BASE_URL` — origen del ERP (https; http solo contra localhost).
- `AZUL_CHAT_INTEGRACION_SECRET` — mínimo 32 caracteres, distinto del
  `AUTH_SECRET` del ERP. Sin él, el cliente ERP no hace ninguna llamada.

Ninguna lleva `NEXT_PUBLIC_`. No hay respaldo a `AUTH_SECRET` ni a otro secreto.

## Firma

```
firma = hex(HMAC_SHA256(secreto, "v1\n" + "azul-chat" + "\n" + marca + "\n" + cuerpo))
```

sobre bytes UTF-8, con `marca` = Unix timestamp en segundos y `cuerpo` =
`JSON.stringify(objeto)` — el mismo string que se manda. Cabeceras:
`content-type: application/json`, `x-erp-integracion-aplicacion: azul-chat`,
`x-erp-integracion-marca`, `x-erp-integracion-firma`.

## Comandos

- `npm run dev` — servidor de desarrollo.
- `npm run build` / `npm start` — compilación y servidor de producción.
- `npm run typecheck` — TypeScript estricto.
- `npm run lint` — ESLint (config de Next + regla de frontera).
- `npm test` — tests (Node ≥ 22.18, sin dependencias extra).
- `npm run check` — typecheck + lint + tests.
- `npm run verificar:bundle` — build con secreto canario y búsqueda en el bundle.
