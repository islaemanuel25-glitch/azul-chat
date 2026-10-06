// src/server/http/respuestas.ts
//
// Las respuestas de las rutas propias de Azul Chat: JSON, sin caché, nosniff.
// Llevan identidad, locales o una cookie de sesión: ningún intermediario las guarda.

import "server-only";

export const CABECERAS_BASE = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

export function json(cuerpo: unknown, { status = 200, cookie = null as string | null, extra = {} as Record<string, string> } = {}): Response {
  const headers = new Headers({ ...CABECERAS_BASE, "Content-Type": "application/json; charset=utf-8", ...extra });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(cuerpo), { status, headers });
}
