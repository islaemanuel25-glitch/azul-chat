// POST /api/chats/preguntar — una pregunta en lenguaje natural (Tanda 6A,
// src/server/preguntas/manejador.ts).
//
// Solo delega. Solo se exporta POST; el resto lo contesta Next con 405.

import { manejarPreguntar } from "../../../../server/preguntas/manejador.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return manejarPreguntar(request, dependenciasDeProduccion());
}
