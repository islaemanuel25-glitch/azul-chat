// POST /api/sesion/vincular — canjear el código que la persona copió del ERP y
// crear la sesión de este dispositivo (src/server/sesion/vincular.ts).
//
// Solo delega. Solo se exporta POST; el resto lo contesta Next con 405.

import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";
import { manejarVincular } from "../../../../server/sesion/vincular.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return manejarVincular(request, dependenciasDeProduccion());
}
