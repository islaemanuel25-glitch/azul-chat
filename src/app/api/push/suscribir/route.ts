// POST /api/push/suscribir — guardar la suscripción push de este dispositivo.
// DELETE /api/push/suscribir — borrarla. Con sesión y Origin, como vincular y
// cerrar (src/server/push/manejadores.ts). Tanda 5A.
//
// Solo delega.

import { dependenciasDePushProduccion, manejarBaja, manejarSuscribir } from "../../../../server/push/manejadores.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return manejarSuscribir(request, dependenciasDePushProduccion());
}

export function DELETE(request: Request) {
  return manejarBaja(request, dependenciasDePushProduccion());
}
