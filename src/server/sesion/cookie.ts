// src/server/sesion/cookie.ts
//
// LA COOKIE DE SESIÓN Y SU IDENTIFICADOR.
//
// La cookie lleva SOLO un identificador opaco: 32 bytes de `randomBytes` en
// base64url. No lleva el usuario, ni el vínculo, ni el token, ni nada firmado
// que haya que verificar: es una llave para buscar una fila. En la base se
// guarda su SHA-256, así que una copia de la base no sirve para entrar.
//
// Atributos: HttpOnly (el JavaScript de la página no la ve), SameSite=Lax,
// Path=/, Max-Age igual a la vida de la sesión, y Secure en producción. Nada
// de localStorage ni sessionStorage: la sesión no existe para el JavaScript.

import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const NOMBRE_COOKIE = "azulchat_sesion";

/** Cuánto vive una sesión desde que se crea. No se renueva sola. */
export const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;

const FORMATO_ID = /^[A-Za-z0-9_-]{43}$/;

export function generarIdSesion(): string {
  return randomBytes(32).toString("base64url");
}

/** Lo único que se guarda del identificador. */
export function hashIdSesion(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex");
}

/** El identificador de la cookie, si tiene la forma de uno. No dice si existe. */
export function leerIdDeCookie(headers: Headers): string | null {
  const cabecera = headers.get("cookie");
  if (!cabecera) return null;
  for (const parte of cabecera.split(";")) {
    const i = parte.indexOf("=");
    if (i === -1) continue;
    if (parte.slice(0, i).trim() !== NOMBRE_COOKIE) continue;
    const valor = parte.slice(i + 1).trim();
    return FORMATO_ID.test(valor) ? valor : null;
  }
  return null;
}

export function cookieDeSesion(id: string, { produccion }: { produccion: boolean }): string {
  const maxAge = Math.floor(DURACION_SESION_MS / 1000);
  return [`${NOMBRE_COOKIE}=${id}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax", ...(produccion ? ["Secure"] : [])].join("; ");
}

/** La que borra la cookie en el navegador. */
export function cookieBorrada({ produccion }: { produccion: boolean }): string {
  return [`${NOMBRE_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax", ...(produccion ? ["Secure"] : [])].join("; ");
}
