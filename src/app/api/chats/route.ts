// GET /api/chats — la lista de chats: General y cada local que la persona puede
// ver hoy (src/server/chats/manejadores.ts).
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarChats } from "../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarChats(request, dependenciasDeProduccion());
}
