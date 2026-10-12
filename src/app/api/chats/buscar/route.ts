// GET /api/chats/buscar?texto=…&filtro=…&(localId=… | general=1)[&cursor=…] —
// buscar en el historial guardado de un Local o de General: eventos y preguntas
// guardadas de la persona, en la base propia (src/server/chats/manejadores.ts,
// Tanda 10). Del ERP, solo `mi_alcance`. No guarda nada y no marca leído.
//
// Solo delega. Solo se exporta GET; el resto lo contesta Next con 405.

import { manejarBuscar } from "../../../../server/chats/manejadores.ts";
import { dependenciasDeProduccion } from "../../../../server/sesion/dependencias.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return manejarBuscar(request, dependenciasDeProduccion());
}
