// src/server/http/respuestas.ts
//
// Las respuestas de las rutas propias de Azul Chat: JSON, sin caché, nosniff.
// Llevan identidad, locales o una cookie de sesión: ningún intermediario las guarda.
//
// Tanda 6D: y TODAS llevan `X-Azul-Chat-Commit`, el commit de la imagen que
// contesta (el mismo de GET /api/version). La interfaz lo compara en cada
// respuesta contra el commit de su página: si se desplegó mientras la persona
// seguía adentro de un chat, la próxima respuesta lo dice y la página recarga.
// Sin commit (desarrollo, sin APP_BUILD_ID), la cabecera no va.

import "server-only";

import { CABECERA_COMMIT } from "../../shared/version/cabecera.ts";
import { leerVersion } from "../version.ts";

export const CABECERAS_BASE = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

export function json(cuerpo: unknown, { status = 200, cookie = null as string | null, extra = {} as Record<string, string> } = {}): Response {
  const headers = new Headers({ ...CABECERAS_BASE, "Content-Type": "application/json; charset=utf-8", ...extra });
  const { commit } = leerVersion();
  if (commit) headers.set(CABECERA_COMMIT, commit);
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(cuerpo), { status, headers });
}
