// src/server/erp/ventasResumen.ts
//
// LA SOLICITUD DE `ventas_resumen`: SE CONSTRUYE ACÁ Y EN NINGÚN OTRO LADO.
//
// Recibe la entrada como `unknown` porque va a venir de afuera (una ruta, un
// mensaje del chat) y la valida contra la forma exacta del ERP
// (erpmanual: lib/integraciones/azul-chat/atender.js y ventasResumen.js):
//
//   {
//     "capacidad":  "ventas_resumen",
//     "delegacion": { "usuarioId": 12, "vinculo": "vin1_…" },
//     "alcance":    { "grupoId": 1, "localId": 3 },
//     "parametros": { "periodo": { "tipo": "hoy" } }
//   }
//
// Una clave de más en cualquier nivel se rechaza, igual que en el ERP. El
// objeto de salida se arma de cero con las claves en orden fijo, así que nada
// de la entrada se copia sin pasar por una validación.
//
// ── LO QUE SE VALIDA ACÁ Y LO QUE NO ───────────────────────────────────────
//
// Solo FORMA: enteros positivos, fechas de calendario reales, desde ≤ hasta y
// a lo sumo 31 días. Eso es aritmética de calendario, no regla comercial, y
// rechazarlo acá ahorra una llamada que el ERP rechazaría igual.
//
// NO se valida "el rango termina en el futuro": depende de qué día es HOY EN
// ARGENTINA, y esa cuenta es del ERP. Tampoco se valida la forma del código de
// vínculo más allá de ser un texto: si el ERP cambia el formato, no hay que
// cambiar Azul Chat. Si el ERP decide que algo está mal, lo dice con su código.

import "server-only";

import type { Periodo } from "../../shared/erp/contrato.ts";

export const CAPACIDAD_VENTAS_RESUMEN = "ventas_resumen";

/** El rango más largo que acepta el ERP, contando los dos extremos. */
export const MAX_DIAS_RANGO = 31;

/** Un vínculo real mide 48 caracteres; esto solo frena basura enorme. */
const MAX_LARGO_VINCULO = 256;

export type CuerpoVentasResumen = {
  readonly capacidad: typeof CAPACIDAD_VENTAS_RESUMEN;
  readonly delegacion: { readonly usuarioId: number; readonly vinculo: string };
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly parametros: { readonly periodo: Periodo };
};

/** Lo que el resto de Azul Chat le pasa al cliente. Sin `capacidad`: la pone el cliente. */
export type EntradaVentasResumen = {
  readonly delegacion: { readonly usuarioId: number; readonly vinculo: string };
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly periodo: Periodo;
};

export type RechazoEntrada = {
  readonly ok: false;
  readonly codigo: "SOLICITUD_INVALIDA" | "PERIODO_INVALIDO" | "PERIODO_DEMASIADO_LARGO";
  /** Para el desarrollador y los tests. No se loguea si puede contener datos de la persona. */
  readonly detalle: string;
};

export type ResultadoEntrada = { readonly ok: true; readonly cuerpo: CuerpoVentasResumen } | RechazoEntrada;

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const esObjetoPlano = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const soloEstas = (obj: Record<string, unknown>, claves: readonly string[]): boolean =>
  Object.keys(obj).every((k) => claves.includes(k));

const tieneTodas = (obj: Record<string, unknown>, claves: readonly string[]): boolean =>
  claves.every((k) => Object.prototype.hasOwnProperty.call(obj, k));

const esEnteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

const invalida = (detalle: string): RechazoEntrada => ({ ok: false, codigo: "SOLICITUD_INVALIDA", detalle });
const periodoInvalido = (detalle: string): RechazoEntrada => ({ ok: false, codigo: "PERIODO_INVALIDO", detalle });

/** ¿Es una fecha de calendario real? "2026-02-30" no lo es. Misma regla que el ERP. */
function esFechaReal(texto: unknown): texto is string {
  if (typeof texto !== "string" || !SOLO_FECHA.test(texto)) return false;
  const d = new Date(`${texto}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/** Días entre dos fechas, contando los dos extremos. Misma cuenta que el ERP. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00.000Z`) - Date.parse(`${desde}T12:00:00.000Z`)) / UN_DIA_MS) + 1;
}

function validarPeriodo(periodo: unknown): { ok: true; periodo: Periodo } | RechazoEntrada {
  if (!esObjetoPlano(periodo)) return periodoInvalido("Falta el período: hoy, ayer o rango.");
  const { tipo } = periodo;
  if (tipo === "hoy" || tipo === "ayer") {
    if (!soloEstas(periodo, ["tipo"])) return periodoInvalido(`El período ${tipo} no acepta más datos que tipo.`);
    return { ok: true, periodo: { tipo } };
  }
  if (tipo !== "rango") return periodoInvalido("El período tiene que ser hoy, ayer o rango.");
  if (!soloEstas(periodo, ["tipo", "desde", "hasta"])) {
    return periodoInvalido("El período rango no acepta más datos que tipo, desde y hasta.");
  }
  const { desde, hasta } = periodo;
  if (!esFechaReal(desde) || !esFechaReal(hasta)) {
    return periodoInvalido("El rango necesita desde y hasta como fechas YYYY-MM-DD reales.");
  }
  if (desde > hasta) return periodoInvalido("El rango empieza después de terminar.");
  if (diasEntre(desde, hasta) > MAX_DIAS_RANGO) {
    return { ok: false, codigo: "PERIODO_DEMASIADO_LARGO", detalle: `El rango no puede pasar de ${MAX_DIAS_RANGO} días.` };
  }
  return { ok: true, periodo: { tipo: "rango", desde, hasta } };
}

/**
 * Valida la entrada y arma el cuerpo exacto que se firma y se manda.
 */
export function construirCuerpoVentasResumen(entrada: unknown): ResultadoEntrada {
  if (!esObjetoPlano(entrada)) return invalida("La entrada tiene que ser un objeto.");
  const CLAVES = ["delegacion", "alcance", "periodo"] as const;
  if (!soloEstas(entrada, CLAVES) || !tieneTodas(entrada, CLAVES)) {
    return invalida("La entrada lleva exactamente delegacion, alcance y periodo.");
  }

  const { delegacion, alcance } = entrada;
  if (!esObjetoPlano(delegacion) || !soloEstas(delegacion, ["usuarioId", "vinculo"])) {
    return invalida("La delegación solo acepta usuarioId y vinculo.");
  }
  if (!esEnteroPositivo(delegacion.usuarioId)) return invalida("usuarioId tiene que ser un entero positivo.");
  const { vinculo } = delegacion;
  if (typeof vinculo !== "string" || vinculo.length === 0 || vinculo.length > MAX_LARGO_VINCULO) {
    return invalida("vinculo tiene que ser un texto no vacío.");
  }

  if (!esObjetoPlano(alcance) || !soloEstas(alcance, ["grupoId", "localId"])) {
    return invalida("El alcance solo acepta grupoId y localId.");
  }
  if (!esEnteroPositivo(alcance.grupoId)) return invalida("grupoId tiene que ser un entero positivo.");
  if (!esEnteroPositivo(alcance.localId)) return invalida("localId tiene que ser un entero positivo.");

  const periodo = validarPeriodo(entrada.periodo);
  if (!periodo.ok) return periodo;

  return {
    ok: true,
    cuerpo: {
      capacidad: CAPACIDAD_VENTAS_RESUMEN,
      delegacion: { usuarioId: delegacion.usuarioId, vinculo },
      alcance: { grupoId: alcance.grupoId, localId: alcance.localId },
      parametros: { periodo: periodo.periodo },
    },
  };
}
