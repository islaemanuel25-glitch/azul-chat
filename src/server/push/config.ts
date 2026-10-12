// src/server/push/config.ts
//
// LAS CLAVES VAPID DE LAS NOTIFICACIONES PUSH (Tanda 5A). Solo servidor.
//
//   · AZUL_CHAT_VAPID_PUBLICA: clave pública P-256 sin comprimir (65 bytes, la
//     primera 0x04), en base64url sin relleno. No es secreta: el navegador la
//     necesita para suscribirse, y se le entrega por GET /api/push/clave, NUNCA
//     por una variable NEXT_PUBLIC_.
//   · AZUL_CHAT_VAPID_PRIVADA: la privada de esa pareja (32 bytes, base64url).
//     Firma cada envío ante el servicio de push. Se lee SOLO acá y queda en una
//     clausura: no hay propiedad que un log pueda imprimir.
//   · AZUL_CHAT_VAPID_CONTACTO: el contacto que el servicio de push ve en la
//     firma: `mailto:alguien@dominio`.
//
// Fail closed: si falta una, está mal formada, la privada no es la de esa
// pública, o la privada es igual a otro secreto de Azul Chat, no hay push. El
// resto de Azul Chat sigue andando.

import "server-only";

import { createECDH } from "node:crypto";

import webpush from "web-push";

import type { Entorno } from "../erp/config.ts";
import { esElSecretoDeIntegracion } from "../erp/config.ts";
import { esLaClaveDelToken } from "../seguridad/cifradoToken.ts";

export const VARIABLE_VAPID_PUBLICA = "AZUL_CHAT_VAPID_PUBLICA";
export const VARIABLE_VAPID_PRIVADA = "AZUL_CHAT_VAPID_PRIVADA";
export const VARIABLE_VAPID_CONTACTO = "AZUL_CHAT_VAPID_CONTACTO";

/**
 * La urgencia de TODOS los push (RFC 8030 §5.3), avisos de eventos y del
 * sistema. Cada push muestra una notificación visible, que es el uso de
 * "high". Con "normal", Android en reposo los retenía y entregaba tarde y
 * desordenados (prueba real del 12/10: la apertura llegó ~20 minutos tarde).
 */
export const URGENCIA_PUSH = "high";

const PUBLICA = /^[A-Za-z0-9_-]{87}$/;
const PRIVADA = /^[A-Za-z0-9_-]{43}$/;
const CONTACTO = /^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type MotivoConfigPush =
  | "VAPID_AUSENTE"
  | "VAPID_PUBLICA_MAL_FORMADA"
  | "VAPID_PRIVADA_MAL_FORMADA"
  | "VAPID_PAREJA_INVALIDA"
  | "VAPID_CONTACTO_INVALIDO"
  | "VAPID_PRIVADA_COMPARTIDA";

/** Lo que el servicio de push necesita para un envío: la URL, las cabeceras y el cuerpo ya cifrado. */
export type EnvioArmado = { readonly endpoint: string; readonly headers: Readonly<Record<string, string>>; readonly cuerpo: Buffer };

export type SuscripcionDestino = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };

export type ConfigPush = {
  /** La clave pública VAPID, para el navegador. */
  readonly clavePublica: string;
  /**
   * Cifra `contenido` para esa suscripción (RFC 8291, aes128gcm) y firma con
   * VAPID (RFC 8292). La privada no sale de la clausura.
   */
  armar(destino: SuscripcionDestino, contenido: string, opciones: { readonly ttlSegundos: number }): EnvioArmado;
};

export function leerConfigPush(entorno: Entorno = process.env): { ok: true; config: ConfigPush } | { ok: false; motivo: MotivoConfigPush } {
  const publica = entorno[VARIABLE_VAPID_PUBLICA];
  const privada = entorno[VARIABLE_VAPID_PRIVADA];
  const contacto = entorno[VARIABLE_VAPID_CONTACTO];
  if (!publica || !privada || !contacto) return { ok: false, motivo: "VAPID_AUSENTE" };
  if (!PUBLICA.test(publica) || Buffer.from(publica, "base64url")[0] !== 0x04) return { ok: false, motivo: "VAPID_PUBLICA_MAL_FORMADA" };
  if (!PRIVADA.test(privada)) return { ok: false, motivo: "VAPID_PRIVADA_MAL_FORMADA" };
  if (!CONTACTO.test(contacto)) return { ok: false, motivo: "VAPID_CONTACTO_INVALIDO" };
  if (esElSecretoDeIntegracion(privada, entorno) || esLaClaveDelToken(privada, entorno)) return { ok: false, motivo: "VAPID_PRIVADA_COMPARTIDA" };
  // La pública tiene que ser la de ESTA privada: si no, el servicio de push rechaza cada envío.
  let derivada: string;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privada, "base64url"));
    derivada = ecdh.getPublicKey().toString("base64url");
  } catch {
    return { ok: false, motivo: "VAPID_PRIVADA_MAL_FORMADA" };
  }
  if (derivada !== publica) return { ok: false, motivo: "VAPID_PAREJA_INVALIDA" };

  const vapidDetails = { subject: contacto, publicKey: publica, privateKey: privada };
  return {
    ok: true,
    config: Object.freeze({
      clavePublica: publica,
      armar(destino: SuscripcionDestino, contenido: string, { ttlSegundos }: { readonly ttlSegundos: number }): EnvioArmado {
        const d = webpush.generateRequestDetails(
          { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
          contenido,
          // Urgency high (Tanda 13): cada push muestra una notificación visible, y
          // con "normal" Android los retenía en reposo ~20 minutos.
          { vapidDetails, TTL: ttlSegundos, contentEncoding: "aes128gcm", urgency: URGENCIA_PUSH },
        );
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(d.headers)) headers[k] = String(v);
        return { endpoint: d.endpoint, headers, cuerpo: Buffer.from(d.body as Buffer) };
      },
    }),
  };
}

/** ¿Ese valor es la privada VAPID? Para que el secreto de la tarea se niegue a ser la misma, sin leerla en otro archivo. */
export function esLaPrivadaVapid(valor: string, entorno: Entorno = process.env): boolean {
  const privada = entorno[VARIABLE_VAPID_PRIVADA];
  return Boolean(privada) && privada === valor;
}
