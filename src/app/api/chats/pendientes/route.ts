// GET /api/chats/pendientes?localId=… — lo pendiente de un local que la persona
// puede ver hoy: pedidos sin enviar (`pedidos_pendientes`) y cajas de hoy y de
// ayer a revisar (`cajas_resumen`) (src/server/chats/manejadores.ts, Tanda 9B).
// No guarda nada y no marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarPendientes } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarPendientes(request, dependenciasDeProduccion());
}
