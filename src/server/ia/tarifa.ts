// src/server/ia/tarifa.ts
//
// EL MODELO DE IA Y LO QUE CUESTA (Tanda 6A).
//
// ── EL MODELO ES EL DEL ERP ────────────────────────────────────────────────
//
// `gemini-3.6-flash`: el lector de comprobantes del ERP de todos los días
// (erpmanual lib/compras-proveedor/comprobante/lector/gemini.js,
// MODELO_POR_DEFECTO), medido allá contra la API real el 2026-08-11. Mismo
// modelo, misma clave, mismo endpoint (v1beta, generateContent) y el mismo
// techo de razonamiento "low" que el ERP verificó en la documentación de
// Google el 2026-10-10. Fijado, no un alias `latest`: un alias cambia de
// modelo abajo sin que nadie lo decida.
//
// ── LA TARIFA, COPIADA DE LA PÁGINA DE PRECIOS ─────────────────────────────
//
// https://ai.google.dev/gemini-api/docs/pricing, "Last updated 2026-10-09
// UTC", consultada el 2026-10-11. Nivel pago, estándar, por millón de tokens:
//
//   gemini-3.6-flash   entrada (texto)   US$ 0,75 hasta el 2026-12-31; 1,50 desde el 2027-01-01
//                      salida (con razonamiento) US$ 3,75 hasta el 2026-12-31; 7,50 desde el 2027-01-01
//
// Los tokens de razonamiento se cobran como salida. El ERP no le pone precio
// a los tokens (guarda costo 0); acá sí, porque el tope mensual es en
// dólares. Es una ESTIMACIÓN con la tarifa publicada: lo que factura Google
// manda. Si la tarifa cambia, se agrega un tramo con su fecha.

import "server-only";

export const MODELO_IA = "gemini-3.6-flash";
/** El techo de razonamiento verificado por el ERP para este modelo. */
export const NIVEL_DE_RAZONAMIENTO = "low";

/** Un tramo de la tarifa: desde qué día (UTC, inclusive) vale, en millonésimas de dólar por token. */
type Tramo = { readonly desde: string; readonly entradaMicroUsdPorToken: number; readonly salidaMicroUsdPorToken: number };

/**
 * US$ por millón de tokens = millonésimas de dólar por token. Ordenados por
 * fecha. Fuente y fecha arriba.
 */
export const TARIFA: readonly Tramo[] = Object.freeze([
  { desde: "2026-01-01", entradaMicroUsdPorToken: 0.75, salidaMicroUsdPorToken: 3.75 },
  { desde: "2027-01-01", entradaMicroUsdPorToken: 1.5, salidaMicroUsdPorToken: 7.5 },
]);

/** El tramo vigente ese día. */
export function tramoVigente(ahora: Date): Tramo {
  const dia = ahora.toISOString().slice(0, 10);
  let vigente = TARIFA[0]!;
  for (const t of TARIFA) if (t.desde <= dia) vigente = t;
  return vigente;
}

/** Lo que cuestan esos tokens ese día, en millonésimas de dólar, redondeado hacia arriba. */
export function costoMicroUsd(tokensEntrada: number, tokensSalida: number, ahora: Date): bigint {
  const t = tramoVigente(ahora);
  // En centésimas de millonésima, para no arrastrar coma flotante: 0,75 → 75.
  const centesimas = BigInt(tokensEntrada) * BigInt(Math.round(t.entradaMicroUsdPorToken * 100)) + BigInt(tokensSalida) * BigInt(Math.round(t.salidaMicroUsdPorToken * 100));
  return (centesimas + 99n) / 100n;
}

/**
 * Los techos de una pregunta, para reservar antes de llamar. La salida la
 * limita `maxOutputTokens` (razonamiento incluido). La entrada la acotan la
 * pregunta (300 caracteres), las instrucciones y los nombres de los locales
 * (como mucho 50 de hasta 80 caracteres): muy por debajo de esto.
 */
export const MAX_TOKENS_SALIDA = 2048;
export const MAX_TOKENS_ENTRADA_ESTIMADO = 4000;

/** Lo que se reserva antes de cada pregunta: el peor caso de esa tarifa. */
export function reservaPorPregunta(ahora: Date): bigint {
  return costoMicroUsd(MAX_TOKENS_ENTRADA_ESTIMADO, MAX_TOKENS_SALIDA, ahora);
}
