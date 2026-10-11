// src/server/interno/tarea.ts
//
// EL SECRETO DE LA TAREA DE SINCRONIZACIÓN Y LA PUERTA DE LA RUTA INTERNA
// (Tanda 5A). Solo servidor.
//
// POST /api/interno/sincronizar NO es del navegador: la llama un timer de
// systemd en el mismo VPS, por 127.0.0.1:3100, con un secreto propio en una
// cabecera. Tres condiciones, todas, o la respuesta es un 404 igual al de una
// ruta que no existe:
//
//   1. el secreto: AZUL_CHAT_TAREA_SECRET, de 32 caracteres o más, distinto
//      del secreto de la integración, de la clave del token y de la privada
//      VAPID. Se compara en tiempo constante (sobre sus SHA-256, que tienen
//      siempre el mismo largo). Sin la variable, la ruta no existe;
//   2. nada de lo que pone nginx: el bloque de chat.operix.cloud reenvía con
//      `Host` público, `X-Real-IP` y `X-Forwarded-Proto: https`. Una solicitud
//      con `X-Real-IP` o `Forwarded`, con `Host` o `X-Forwarded-Host` que no
//      sea la propia máquina, o con `X-Forwarded-Proto` distinto de http, no
//      vino del timer;
//   3. el Host es la propia máquina (127.0.0.1, localhost o [::1]).
//
// Lo que NO sirve como señal, comprobado con el servidor de Next compilado:
// Next AGREGA por su cuenta `x-forwarded-for` (la IP del socket),
// `x-forwarded-host`, `x-forwarded-port` y `x-forwarded-proto` a toda
// solicitud que no los trae, también al curl local del timer. Por eso no se
// exige su ausencia: se exige que digan "esta máquina, por http".
//
// El secreto se lee SOLO acá y queda en una clausura.

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { esElSecretoDeIntegracion, type Entorno } from "../erp/config.ts";
import { esLaPrivadaVapid } from "../push/config.ts";
import { esLaClaveDelToken } from "../seguridad/cifradoToken.ts";

export const VARIABLE_SECRETO_TAREA = "AZUL_CHAT_TAREA_SECRET";
/** La cabecera donde el timer manda el secreto. */
export const CABECERA_SECRETO_TAREA = "x-azul-chat-tarea";
export const LARGO_MINIMO_SECRETO_TAREA = 32;

/** Lo que pone nginx y nunca pone ni Next ni el timer. */
const CABECERAS_DE_PROXY = ["x-real-ip", "forwarded"];
const HOST_LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

/** ¿Llegó directo por la propia máquina? Ver el punto 2 de arriba. */
function llegoDirecto(headers: Headers): boolean {
  if (CABECERAS_DE_PROXY.some((c) => headers.has(c))) return false;
  if (!HOST_LOCAL.test(headers.get("host") ?? "")) return false;
  const reenviadoHost = headers.get("x-forwarded-host");
  if (reenviadoHost !== null && !HOST_LOCAL.test(reenviadoHost)) return false;
  const protocolo = headers.get("x-forwarded-proto");
  if (protocolo !== null && !/^http$/.test(protocolo)) return false;
  return true;
}

export type MotivoSecretoTarea = "SECRETO_TAREA_AUSENTE" | "SECRETO_TAREA_CORTO" | "SECRETO_TAREA_COMPARTIDO";

export type PuertaTarea = {
  /** ¿Esta solicitud es del timer? Secreto, sin reenvío y Host local. */
  admite(headers: Headers): boolean;
};

const huella = (v: string) => createHash("sha256").update(v, "utf8").digest();

export function leerPuertaTarea(entorno: Entorno = process.env): { ok: true; puerta: PuertaTarea } | { ok: false; motivo: MotivoSecretoTarea } {
  const secreto = entorno[VARIABLE_SECRETO_TAREA];
  if (!secreto) return { ok: false, motivo: "SECRETO_TAREA_AUSENTE" };
  if (secreto.length < LARGO_MINIMO_SECRETO_TAREA) return { ok: false, motivo: "SECRETO_TAREA_CORTO" };
  if (esElSecretoDeIntegracion(secreto, entorno) || esLaClaveDelToken(secreto, entorno) || esLaPrivadaVapid(secreto, entorno)) {
    return { ok: false, motivo: "SECRETO_TAREA_COMPARTIDO" };
  }
  const esperado = huella(secreto);
  return {
    ok: true,
    puerta: Object.freeze({
      admite(headers: Headers): boolean {
        if (!llegoDirecto(headers)) return false;
        const recibido = headers.get(CABECERA_SECRETO_TAREA);
        if (recibido === null) return false;
        return timingSafeEqual(huella(recibido), esperado);
      },
    }),
  };
}
