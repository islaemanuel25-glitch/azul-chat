// GET /api/version — el commit con el que se construyó la imagen que corre
// (src/server/version.ts). Sin autenticación: el SHA del repo no es un secreto
// y es lo que el runbook de despliegue compara.

import { json } from "../../../server/http/respuestas.ts";
import { leerVersion } from "../../../server/version.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return json(leerVersion());
}
