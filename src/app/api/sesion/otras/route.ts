// DELETE /api/sesion/otras — cerrar las otras sesiones de la persona (menos la
// de este navegador) y borrar sus suscripciones push. Con sesión y Origin
// (src/server/sesion/configuracion.ts). Tanda 11.
//
// Solo delega. Solo se exporta DELETE; el resto lo contesta Next con 405.

import { manejarCerrarOtras } from "../../../../server/sesion/configuracion.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function DELETE(request: Request) {
  return manejarCerrarOtras(request, dependenciasDeProduccion());
}
