// GET /api/sesion/configuracion — el horario de silencio, el saldo de IA del mes
// y los dispositivos de la persona (src/server/sesion/configuracion.ts). Tanda 11.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarConfiguracion } from "../../../../server/sesion/configuracion.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarConfiguracion(request, dependenciasDeProduccion());
}
