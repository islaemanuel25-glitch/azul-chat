// GET /api/push/clave — la clave pública VAPID, para que el navegador se
// suscriba (src/server/push/manejadores.ts). Tanda 5A. No es secreta y no va
// por NEXT_PUBLIC_: la entrega esta ruta.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { dependenciasDePushProduccion, manejarClave } from "../../../../server/push/manejadores.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarClave(request, dependenciasDePushProduccion());
}
