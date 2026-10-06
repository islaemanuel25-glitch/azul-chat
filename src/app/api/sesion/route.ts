// GET /api/sesion    — el estado de la sesión de este dispositivo (src/server/sesion/estado.ts).
// DELETE /api/sesion — cerrar la sesión de este dispositivo (src/server/sesion/cerrar.ts).
//
// Solo delegan: la lógica vive en src/server y se prueba allá con dependencias
// inyectadas. Solo se exportan GET y DELETE; el resto lo contesta Next con 405.

import { manejarCerrar } from "../../../server/sesion/cerrar.ts";
import { dependenciasDeProduccion } from "../../../server/sesion/dependencias.ts";
import { manejarEstado } from "../../../server/sesion/estado.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarEstado(request, dependenciasDeProduccion());
}

export function DELETE(request: Request) {
  return manejarCerrar(request, dependenciasDeProduccion());
}
