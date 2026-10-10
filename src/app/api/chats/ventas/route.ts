// GET /api/chats/ventas?localId=… — las ventas de hoy de un local que la
// persona puede ver hoy con `ventas_resumen` (src/server/chats/manejadores.ts).
// No guarda nada y no marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarVentas } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarVentas(request, dependenciasDeProduccion());
}
