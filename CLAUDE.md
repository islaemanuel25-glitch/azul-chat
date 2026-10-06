# Azul Chat — instrucciones para Claude Code

Azul Chat es independiente de ERP Azul (repo `erpmanual`). Desde este repo:

- **No** se conecta a la base ni a Prisma del ERP. Todo dato del ERP pasa por
  `POST /api/integraciones/azul-chat/consultar` y
  `POST /api/integraciones/azul-chat/vinculo/canjear`, desde
  `src/server/erp/cliente.ts`. La base de Azul Chat es otra y es suya.
- **No** se duplican reglas de negocio del ERP. Azul Chat arma la solicitud y
  presenta la respuesta; el ERP calcula y autoriza. Solo se valida FORMA. Lo
  que devuelve `mi_alcance` (rol, locales, grupo) no se guarda como autoridad:
  se pide cada vez.
- El secreto `AZUL_CHAT_INTEGRACION_SECRET`, la clave
  `AZUL_CHAT_TOKEN_ENCRYPTION_KEY` y `DATABASE_URL` viven solo en `src/server`.
  Nada de `NEXT_PUBLIC_`, nada de respaldo a otro secreto, nada en logs. La
  clave de cifrado nunca es el secreto de la integración.
- El token de delegación se guarda cifrado y no sale del servidor. El código
  de canje no se guarda, no se loguea, no va en una URL y no se devuelve.
- El navegador manda solo el código. La identidad (usuarioId, vinculoId) la
  dice el ERP al canjear, nunca el navegador.
- No hay proxy genérico: cada ruta de `src/app/api` es una acción concreta y
  está declarada en `test/frontera/rutas.test.ts`.
- `src/components` y `src/shared` no importan `src/server` (lo frena ESLint y
  `test/frontera/`). Todo archivo de `src/server` importa `server-only`.
- La lógica decide por **códigos** de error del ERP, nunca por sus textos.
  `VINCULO_NO_VALIDO` revoca; caído, lento o `NO_AUTORIZADO` no.
- Sin reintentos automáticos de consultas ni de canjes: reintentar lo decide la
  persona. No se finge atomicidad entre la base del ERP y la de Azul Chat.
- El contrato del ERP se copia del código del ERP, no de memoria. Los fixtures
  de respuesta salen de ejecutar la función real del ERP (ver
  `test/ayuda/servidorErp.ts` y `test/fixtures/erp-8920516.json`).
- Ningún test llama al ERP real ni toca una base que no sea descartable
  (`test/ayuda/baseDescartable.ts`, servidor local). Ningún candado se afloja
  para que pase: un candado nuevo lleva su contraprueba.
- Una migración nueva se valida desde una base vacía (`npm run test:db`) y sin
  deriva contra `schema.prisma`.
- Producción (`docs/DEPLOY.md`): Azul Chat no se conecta a ninguna red,
  volumen ni base del ERP; la base no publica puerto; la app solo en
  127.0.0.1:3100; `app.env` y `db.env` separados; imagen por SHA completo,
  nunca `latest`; las migraciones son un paso explícito, nunca al arrancar.
  Lo vigila `test/frontera/produccion.test.ts`. Desde una sesión de
  desarrollo no se despliega ni se toca el VPS.
- Documentación y comentarios en español. Commits en español con prefijo
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Se stagea por ruta,
  nunca `git add -A`.
