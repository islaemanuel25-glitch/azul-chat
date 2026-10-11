// src/server/ia/gemini.ts
//
// LA ÚNICA LLAMADA A LA IA (Tanda 6A). Solo servidor.
//
// Un destino fijo —el `generateContent` de `gemini-3.6-flash` en
// generativelanguage.googleapis.com— y nada más: no recibe URL, modelo ni
// cabeceras de quien lo usa. Lo que viaja es lo que arma
// `instruccionesDeIntencion` (la pregunta, la fecha de hoy, el local actual y
// los NOMBRES de los locales) y el esquema de la salida. Ningún dato de
// negocio: ni ventas, ni eventos, ni ids, ni quién pregunta.
//
// Igual que el lector del ERP (erpmanual lib/compras-proveedor/comprobante/
// lector/gemini.js), del que se copian el modelo, el endpoint, la cabecera de
// la clave y la forma del pedido:
//
//   · salida estructurada (`responseMimeType` + `responseSchema`), nunca texto
//     libre, y temperatura 0;
//   · techo de razonamiento "low" (`thinkingConfig.thinkingLevel`);
//   · una respuesta que no terminó (`finishReason` distinto de STOP) no se lee;
//   · todas las partes de texto que no son razonamiento, no solo la primera;
//   · el uso de tokens sale de `usageMetadata`: entrada `promptTokenCount`,
//     salida `candidatesTokenCount` + `thoughtsTokenCount`.
//
// Sin reintentos: si la IA no contesta, la persona decide si vuelve a
// preguntar. Sin seguir redirecciones: la clave no viaja a otro lado.

import "server-only";

import type { ConfigIa } from "./config.ts";
import { MAX_TOKENS_SALIDA, NIVEL_DE_RAZONAMIENTO } from "./tarifa.ts";

/** El único destino. Lleva el modelo de tarifa.ts (MODELO_IA): lo fija test/db/preguntas.test.ts. */
export const ENDPOINT_IA = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";
/** Más que lo que tarda una clasificación corta; menos que la paciencia de quien espera en el teléfono. */
export const ESPERA_IA_MS = 20_000;

export type UsoIa = { readonly tokensEntrada: number; readonly tokensSalida: number };

export type ResultadoIa =
  /** La IA contestó y terminó. `salida` es el JSON que devolvió, sin validar todavía. */
  | { readonly ok: true; readonly salida: unknown; readonly uso: UsoIa }
  /** Contestó pero no sirve (cortada, sin JSON): es una pregunta que no se entendió. Con su uso, que se cobra igual. */
  | { readonly ok: false; readonly motivo: "SALIDA_INVALIDA"; readonly uso: UsoIa }
  /** No contestó: caída, cuota de Google, timeout, red. `uso` null: no se sabe qué se cobró. */
  | { readonly ok: false; readonly motivo: "NO_DISPONIBLE"; readonly codigo: string; readonly uso: UsoIa | null };

export type DependenciasIa = {
  readonly config: ConfigIa;
  /** El `fetch` hacia Google. En los tests, uno de mentira; nunca la API real. */
  readonly transporte?: typeof globalThis.fetch;
};

const entero = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

function usoDe(json: unknown): UsoIa | null {
  const u = (json as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!u || typeof u !== "object") return null;
  return { tokensEntrada: entero(u.promptTokenCount), tokensSalida: entero(u.candidatesTokenCount) + entero(u.thoughtsTokenCount) };
}

/** Pregunta a la IA con esas instrucciones y ese esquema. */
export async function consultarIa(instrucciones: string, esquema: object, deps: DependenciasIa): Promise<ResultadoIa> {
  const cuerpo = {
    contents: [{ role: "user", parts: [{ text: instrucciones }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: esquema,
      temperature: 0,
      maxOutputTokens: MAX_TOKENS_SALIDA,
      thinkingConfig: { thinkingLevel: NIVEL_DE_RAZONAMIENTO },
    },
  };
  const hacerFetch = deps.transporte ?? globalThis.fetch;
  let respuesta: Response;
  try {
    respuesta = await hacerFetch(ENDPOINT_IA, {
      method: "POST",
      headers: { "content-type": "application/json", ...deps.config.cabecerasDeAutenticacion() },
      body: JSON.stringify(cuerpo),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(ESPERA_IA_MS),
    });
  } catch (e) {
    const tiempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, motivo: "NO_DISPONIBLE", codigo: tiempo ? "TIEMPO_AGOTADO" : "INALCANZABLE", uso: null };
  }
  let json: unknown;
  try {
    json = await respuesta.json();
  } catch {
    return { ok: false, motivo: "NO_DISPONIBLE", codigo: respuesta.ok ? "RESPUESTA_ILEGIBLE" : `HTTP_${respuesta.status}`, uso: null };
  }
  // Un error de Google (cuota, sin saldo, caído, clave mala): no se distingue para afuera; el código queda en el log.
  if (!respuesta.ok) return { ok: false, motivo: "NO_DISPONIBLE", codigo: `HTTP_${respuesta.status}`, uso: usoDe(json) };
  const uso = usoDe(json) ?? { tokensEntrada: 0, tokensSalida: 0 };
  const candidato = (json as { candidates?: { finishReason?: unknown; content?: { parts?: unknown } }[] } | null)?.candidates?.[0];
  if (candidato?.finishReason !== "STOP") return { ok: false, motivo: "SALIDA_INVALIDA", uso };
  const partes = Array.isArray(candidato.content?.parts) ? (candidato.content.parts as { text?: unknown; thought?: unknown }[]) : [];
  const texto = partes
    .filter((p) => typeof p?.text === "string" && p.thought !== true)
    .map((p) => p.text as string)
    .join("");
  try {
    return { ok: true, salida: JSON.parse(texto), uso };
  } catch {
    return { ok: false, motivo: "SALIDA_INVALIDA", uso };
  }
}
