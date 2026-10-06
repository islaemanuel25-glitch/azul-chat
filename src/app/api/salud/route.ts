// GET /api/salud — ¿esta instancia puede atender? (src/server/salud.ts)
//
// 200 si la configuración es válida, la base contesta y está migrada; 503 si
// no, diciendo qué comprobación falló y nunca por qué. No llama al ERP y no
// escribe nada. Es el healthcheck del contenedor y del despliegue.

import { obtenerDb } from "../../../server/db.ts";
import { json } from "../../../server/http/respuestas.ts";
import { comprobarSalud } from "../../../server/salud.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const salud = await comprobarSalud({ db: obtenerDb() });
  return json(salud, { status: salud.ok ? 200 : 503 });
}
