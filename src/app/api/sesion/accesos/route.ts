// GET y PUT /api/sesion/accesos — la sección "Accesos" del administrador:
// quién entra a Azul Chat y a qué. Solo para administradores
// (src/server/sesion/accesos.ts); PUT con sesión y Origin. Tanda 15.
//
// Solo delega. El resto lo contesta Next con 405.

import { manejarAccesos, manejarGuardarAccesos } from "../../../../server/sesion/accesos.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarAccesos(request, dependenciasDeProduccion());
}

export function PUT(request: Request) {
  return manejarGuardarAccesos(request, dependenciasDeProduccion());
}
