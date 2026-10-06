// src/server/http/cuerpo.ts
//
// El cuerpo JSON de una solicitud del navegador, con tope de bytes mientras se
// lee y tipo de contenido cerrado. Lo que no es un objeto JSON de a lo sumo
// `max` bytes no se interpreta.

import "server-only";

export async function leerObjetoJson(request: Request, max: number): Promise<Record<string, unknown> | null> {
  const tipo = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (tipo !== "application/json") return null;
  if (!request.body) return null;
  const lector = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lector.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  try {
    const datos: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(partes)));
    return datos !== null && typeof datos === "object" && !Array.isArray(datos) ? (datos as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
