// POST /api/chats/leido — marcar leído, explícito (src/server/chats/manejadores.ts).
//
// Solo delega. Solo se exporta POST; el resto lo contesta Next con 405.

import { manejarLeido } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return manejarLeido(request, dependenciasDeProduccion());
}
