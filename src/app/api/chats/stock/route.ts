// GET /api/chats/stock?localId=… — los productos bajo mínimo de un local que la
// persona puede ver hoy con `stock_consulta` (src/server/chats/manejadores.ts,
// Tanda 8B). No guarda nada y no marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarStock } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarStock(request, dependenciasDeProduccion());
}
