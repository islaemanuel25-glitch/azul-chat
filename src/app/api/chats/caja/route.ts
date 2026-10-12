// GET /api/chats/caja?localId=… — las cajas de hoy de un local, por turno
// operativo, que la persona puede ver hoy con `cajas_resumen`
// (src/server/chats/manejadores.ts, Tanda 7B). No guarda nada y no marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarCaja } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarCaja(request, dependenciasDeProduccion());
}
