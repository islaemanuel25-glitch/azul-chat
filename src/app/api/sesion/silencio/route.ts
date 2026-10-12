// PUT /api/sesion/silencio — guardar el horario de silencio de la persona. Con
// sesión y Origin (src/server/sesion/configuracion.ts). Tanda 11.
//
// Solo delega. Solo se exporta PUT; el resto lo contesta Next con 405.

import { manejarSilencio } from "../../../../server/sesion/configuracion.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function PUT(request: Request) {
  return manejarSilencio(request, dependenciasDeProduccion());
}
