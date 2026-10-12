// GET /api/push/estado?endpoint=… — ¿el servidor tiene registrada la
// suscripción push de este navegador para esta sesión? Con sesión, sin escribir
// nada (src/server/push/manejadores.ts). Tanda 11.
//
// Solo delega.

import { dependenciasDePushProduccion, manejarEstadoPush } from "../../../../server/push/manejadores.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarEstadoPush(request, dependenciasDePushProduccion());
}
