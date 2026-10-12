// GET /api/chats/pendientes/general — lo pendiente de cada local que la persona
// puede ver hoy con `pedidos_pendientes` o `cajas_resumen`; los que no tienen
// nada, al final (src/server/chats/manejadores.ts, Tanda 9B). Sin parámetros.
// No guarda nada y no marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarPendientesGeneral } from "../../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarPendientesGeneral(request, dependenciasDeProduccion());
}
