// POST /api/interno/sincronizar — la sincronización en segundo plano y los
// avisos push (src/server/interno/sincronizar.ts). Tanda 5A.
//
// NO es del navegador: la llama el timer de systemd del VPS por 127.0.0.1, con
// su secreto. Sin eso contesta 404. Se exporta también GET, que contesta 404
// siempre: así un GET no recibe el 405 de Next, que diría que la ruta existe.
//
// Solo delega.

import { dependenciasDeTareaProduccion, manejarSincronizar } from "../../../../server/interno/sincronizar.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return manejarSincronizar(request, dependenciasDeTareaProduccion());
}

export function GET(request: Request) {
  return manejarSincronizar(request, dependenciasDeTareaProduccion());
}
