// POST /api/interno/vigia — el vigía de la sincronización de fondo: si se cae,
// un push a las personas de AZUL_CHAT_AVISOS_SISTEMA, y otro cuando vuelve
// (src/server/interno/vigia.ts). Tanda 12.
//
// NO es del navegador: la llama el timer de systemd del VPS por 127.0.0.1, con
// el mismo secreto y la misma puerta que /api/interno/sincronizar. Sin eso
// contesta 404. Se exporta también GET, que contesta 404 siempre: así un GET
// no recibe el 405 de Next, que diría que la ruta existe.
//
// Solo delega.

import { dependenciasDeVigiaProduccion, manejarVigia } from "../../../../server/interno/vigia.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return manejarVigia(request, dependenciasDeVigiaProduccion());
}

export function GET(request: Request) {
  return manejarVigia(request, dependenciasDeVigiaProduccion());
}
