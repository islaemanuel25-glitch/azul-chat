// src/server/push/suscripcion.ts
//
// LA SUSCRIPCIÓN QUE MANDA EL NAVEGADOR, VALIDADA ANTES DE GUARDARLA (Tanda 5A).
//
// El cuerpo es lo que da `PushSubscription.toJSON()`:
//
//   { "endpoint": "https://fcm.googleapis.com/fcm/send/…",
//     "expirationTime": null,
//     "keys": { "p256dh": "<65 bytes base64url>", "auth": "<16 bytes base64url>" } }
//
// ── POR QUÉ UNA LISTA CERRADA DE SERVICIOS ─────────────────────────────────
//
// El servidor de Azul Chat le hace un POST al `endpoint` de cada suscripción.
// Si aceptara cualquier URL, quien tenga una sesión podría hacer que el
// servidor le pegue a un host interno o a uno propio. Por eso el endpoint
// tiene que ser https, sin usuario ni puerto, y de un servicio de push de los
// navegadores conocidos: el de Chrome/Android (FCM), el de Firefox, el de
// Safari y el de Edge. Un navegador que use otro no puede suscribirse.

import "server-only";

/** Los hosts de los servicios de push de los navegadores. Exactos, salvo Windows (un host por región). */
const HOSTS_EXACTOS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
const SUFIJOS = [".notify.windows.com"];

const P256DH = /^[A-Za-z0-9_-]{87}$/;
const AUTH = /^[A-Za-z0-9_-]{22}$/;
const MAX_ENDPOINT = 2048;

export type SuscripcionValida = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };

const esObjetoPlano = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const soloEstas = (o: Record<string, unknown>, claves: readonly string[]) => Object.keys(o).every((k) => claves.includes(k));

/** ¿Es un endpoint de un servicio de push conocido? https, sin credenciales, sin puerto, host de la lista. */
export function endpointPermitido(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.href !== endpoint) return false;
  const host = u.hostname.toLowerCase();
  return HOSTS_EXACTOS.has(host) || SUFIJOS.some((s) => host.endsWith(s) && host.length > s.length);
}

/** El cuerpo de POST /api/push/suscribir, o null si no tiene exactamente la forma. */
export function leerSuscripcion(cuerpo: Record<string, unknown> | null): SuscripcionValida | null {
  if (!cuerpo || !soloEstas(cuerpo, ["endpoint", "expirationTime", "keys"])) return null;
  const { endpoint, expirationTime, keys } = cuerpo;
  if (!endpointPermitido(endpoint)) return null;
  // `expirationTime` lo manda el navegador (casi siempre null). No se usa: el servicio de push dice cuándo venció (404/410).
  if (expirationTime !== undefined && expirationTime !== null && !(typeof expirationTime === "number" && Number.isFinite(expirationTime))) return null;
  if (!esObjetoPlano(keys) || Object.keys(keys).length !== 2) return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== "string" || !P256DH.test(p256dh) || Buffer.from(p256dh, "base64url")[0] !== 0x04) return null;
  if (typeof auth !== "string" || !AUTH.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/** El cuerpo de DELETE /api/push/suscribir: exactamente `{ endpoint }`. */
export function leerBaja(cuerpo: Record<string, unknown> | null): string | null {
  if (!cuerpo || Object.keys(cuerpo).length !== 1 || !endpointPermitido(cuerpo.endpoint)) return null;
  return cuerpo.endpoint;
}
