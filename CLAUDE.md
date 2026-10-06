# Azul Chat — instrucciones para Claude Code

Azul Chat es independiente de ERP Azul (repo `erpmanual`). Desde este repo:

- **No** se conecta a la base ni a Prisma del ERP. Todo dato del ERP pasa por
  `POST /api/integraciones/azul-chat/consultar`, desde `src/server/erp/cliente.ts`.
- **No** se duplican reglas de negocio del ERP. Azul Chat arma la solicitud y
  presenta la respuesta; el ERP calcula. Solo se valida FORMA.
- El secreto `AZUL_CHAT_INTEGRACION_SECRET` vive solo en `src/server`. Nada de
  `NEXT_PUBLIC_`, nada de respaldo a otro secreto, nada en logs.
- `src/components` y `src/shared` no importan `src/server` (lo frena ESLint y
  `test/frontera/`). Todo archivo de `src/server` importa `server-only`.
- La lógica decide por **códigos** de error del ERP, nunca por sus textos.
- Sin reintentos automáticos de consultas: reintentar lo decide la persona.
- El contrato del ERP se copia del código del ERP, no de memoria. Los fixtures
  de respuesta salen de ejecutar la función real del ERP (ver
  `test/ayuda/servidorErp.ts`).
- Ningún test llama al ERP real. Ningún candado se afloja para que pase: un
  candado nuevo lleva su contraprueba.
- Documentación y comentarios en español. Commits en español con prefijo
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Se stagea por ruta,
  nunca `git add -A`.
