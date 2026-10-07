// GET /api/chats/general?cursor=… — el historial de todos los locales que la
// persona puede ver hoy, como proyección (src/server/chats/manejadores.ts).
// No marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarGeneral } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarGeneral(request, dependenciasDeProduccion());
}
