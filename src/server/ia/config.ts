// src/server/ia/config.ts
//
// LA CONFIGURACIÓN DE LA IA QUE INTERPRETA PREGUNTAS (Tanda 6A). Solo servidor.
//
//   · AZUL_CHAT_GEMINI_API_KEY: la clave de Google Gemini. Es la MISMA que usa
//     el ERP (su GEMINI_API_KEY); el despliegue la copia al app.env de Azul
//     Chat sin imprimirla (docs/DEPLOY.md). Se lee SOLO acá y queda en una
//     clausura: no sale a una respuesta, a un log ni al navegador. Sin ella, o
//     con una que no tiene forma de clave, no hay preguntas: la caja no se
//     muestra (fallo cerrado, sin error).
//   · AZUL_CHAT_IA_TOPE_USD: cuánto se puede gastar por mes calendario de
//     Argentina, en dólares (por defecto 5). Un valor mal escrito NO cae al
//     defecto: deja la IA apagada, porque un tope que no es el que se quiso
//     poner no es un tope.
//
// La clave no puede ser igual a ningún otro secreto de Azul Chat: si alguien
// pegó el secreto de la integración en la variable de la IA, se lo mandaría a
// Google en cada pregunta.

import "server-only";

import { esElSecretoDeIntegracion, type Entorno } from "../erp/config.ts";
import { esLaPrivadaVapid } from "../push/config.ts";
import { esLaClaveDelToken } from "../seguridad/cifradoToken.ts";

export const VARIABLE_CLAVE_IA = "AZUL_CHAT_GEMINI_API_KEY";
export const VARIABLE_TOPE_IA = "AZUL_CHAT_IA_TOPE_USD";
/** El tope por defecto, en dólares por mes. */
export const TOPE_POR_DEFECTO_USD = 5;
/** Un tope más alto que esto es un error de tipeo, no una decisión. */
const TOPE_MAXIMO_USD = 1000;

/** Una clave de API: caracteres imprimibles sin espacios, de un largo razonable. */
const FORMA_CLAVE = /^[A-Za-z0-9_-]{20,200}$/;
/** Dólares con hasta 2 decimales, sin signo ni exponente. */
const FORMA_TOPE = /^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,2})?$/;

export type MotivoConfigIa = "CLAVE_AUSENTE" | "CLAVE_INVALIDA" | "CLAVE_COMPARTIDA" | "TOPE_INVALIDO";

export type ConfigIa = {
  /** El tope del mes en millonésimas de dólar: entero, para comparar sin coma flotante. */
  readonly topeMicroUsd: bigint;
  /** Las cabeceras de autenticación para Google. La clave no sale de esta clausura de otra forma. */
  readonly cabecerasDeAutenticacion: () => Record<string, string>;
};

/** "5" → 5_000_000n; "7.5" → 7_500_000n. */
function aMicroUsd(texto: string): bigint {
  const [entero, decimales = ""] = texto.split(".");
  return BigInt(entero!) * 1_000_000n + BigInt((decimales + "00").slice(0, 2)) * 10_000n;
}

export function leerConfigIa(entorno: Entorno = process.env): { ok: true; config: ConfigIa } | { ok: false; motivo: MotivoConfigIa } {
  const clave = entorno[VARIABLE_CLAVE_IA];
  if (!clave) return { ok: false, motivo: "CLAVE_AUSENTE" };
  if (!FORMA_CLAVE.test(clave)) return { ok: false, motivo: "CLAVE_INVALIDA" };
  if (esElSecretoDeIntegracion(clave, entorno) || esLaClaveDelToken(clave, entorno) || esLaPrivadaVapid(clave, entorno)) {
    return { ok: false, motivo: "CLAVE_COMPARTIDA" };
  }
  const topeCrudo = entorno[VARIABLE_TOPE_IA];
  let topeMicroUsd = BigInt(TOPE_POR_DEFECTO_USD) * 1_000_000n;
  if (topeCrudo !== undefined && topeCrudo !== "") {
    if (!FORMA_TOPE.test(topeCrudo)) return { ok: false, motivo: "TOPE_INVALIDO" };
    topeMicroUsd = aMicroUsd(topeCrudo);
    if (topeMicroUsd <= 0n || topeMicroUsd > BigInt(TOPE_MAXIMO_USD) * 1_000_000n) return { ok: false, motivo: "TOPE_INVALIDO" };
  }
  return {
    ok: true,
    config: Object.freeze({ topeMicroUsd, cabecerasDeAutenticacion: () => ({ "x-goog-api-key": clave }) }),
  };
}
