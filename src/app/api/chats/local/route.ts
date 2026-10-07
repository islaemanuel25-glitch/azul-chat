// GET /api/chats/local?localId=…&cursor=… — el historial de un local que la
// persona puede ver hoy (src/server/chats/manejadores.ts). No marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarLocal } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarLocal(request, dependenciasDeProduccion());
}
