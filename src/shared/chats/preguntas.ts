// src/shared/chats/preguntas.ts
//
// LAS PREGUNTAS EN LENGUAJE NATURAL (Tanda 6A): lo que el navegador manda y lo
// que POST /api/chats/preguntar le contesta. Es lo único de las preguntas que
// la interfaz puede importar.
//
// La IA SOLO INTERPRETA: elige una intención de un catálogo cerrado. Todo lo
// que se muestra lo arma el código con datos del ERP (ventas) o de la base
// propia (eventos): ni un texto ni un número de la respuesta sale del modelo.

import type { EventoGeneral, FallaChats } from "./api.ts";

/** Lo que manda el navegador. `localId`: desde qué Local se pregunta (sin él, desde General). */
export type PedidoPregunta = { readonly pregunta: string; readonly localId?: number };

/** El largo máximo de una pregunta, en caracteres. */
export const MAX_LARGO_PREGUNTA = 300;

/** Los tipos de eventos por los que se puede preguntar, en el orden en que se ofrecen. */
export const TIPOS_DE_EVENTO_PREGUNTA = ["recibidas", "recibidas_con_diferencias", "enviadas", "pedidos", "cancelaciones"] as const;
export type TipoEventoPregunta = (typeof TIPOS_DE_EVENTO_PREGUNTA)[number];

/** Un período ya resuelto a días de calendario de Argentina ("AAAA-MM-DD"). Hoy: desde = hasta. */
export type PeriodoPregunta = { readonly tipo: "hoy" | "ayer" | "rango"; readonly desde: string; readonly hasta: string };

/** Ventas de un local en un período, como las dio el ERP (montos en el decimal en texto del ERP). */
export type VentasDeUnLocal = {
  readonly local: { readonly id: number; readonly nombre: string };
  readonly cantidadVentas: number;
  readonly totalVendido: string;
  readonly mediosDePago: readonly { readonly medio: string; readonly etiqueta: string; readonly total: string; readonly cantidadPagos: number }[];
  readonly advertencias: readonly { readonly codigo: string; readonly mensaje: string }[];
};

/** La suma de varios locales, hecha por el código (centavo por centavo), nunca por la IA. */
export type TotalVentas = {
  readonly cantidadVentas: number;
  readonly totalVendido: string;
  readonly mediosDePago: readonly { readonly medio: string; readonly etiqueta: string; readonly total: string; readonly cantidadPagos: number }[];
};

export type RespuestaPregunta =
  /** Ventas de UN local. */
  | { readonly estado: "VENTAS"; readonly alcance: "LOCAL"; readonly periodo: PeriodoPregunta; readonly ventas: VentasDeUnLocal }
  /**
   * Ventas de todos los locales con `ventas_resumen` hoy. `total` es null si
   * alguno falló: un total parcial no se muestra como si fuera completo.
   * `fallidos` dice cuáles.
   */
  | {
      readonly estado: "VENTAS";
      readonly alcance: "TODOS";
      readonly periodo: PeriodoPregunta;
      readonly total: TotalVentas | null;
      readonly locales: readonly VentasDeUnLocal[];
      readonly fallidos: readonly { readonly id: number; readonly nombre: string }[];
    }
  /** Eventos guardados: cuántos y los primeros 10 (del más reciente al más antiguo). `restantes`: cuántos más hay. */
  | {
      readonly estado: "EVENTOS";
      readonly tipo: TipoEventoPregunta;
      /** null: todos los locales autorizados con esa capacidad. */
      readonly local: { readonly localId: number; readonly nombre: string } | null;
      readonly periodo: PeriodoPregunta;
      readonly cantidad: number;
      readonly eventos: readonly EventoGeneral[];
      readonly restantes: number;
    }
  /** No se entendió, o lo entendido no se puede contestar. Con ejemplos de lo que sí. */
  | { readonly estado: "NO_ENTIENDO"; readonly ejemplos: readonly string[] }
  /** Se alcanzó el tope de gasto del mes: no se llamó a la IA. */
  | { readonly estado: "SALDO_AGOTADO" }
  /** La IA no contestó, o no está configurada. */
  | { readonly estado: "IA_NO_DISPONIBLE" }
  | FallaChats;

/** Lo que sí se puede preguntar. Fijo: no lo escribe la IA. */
export const EJEMPLOS_DE_PREGUNTAS: readonly string[] = Object.freeze([
  "¿Cuánto vendió hoy?",
  "¿Cuánto vendieron todos los locales ayer?",
  "¿Qué transferencias llegaron con diferencias esta semana?",
  "¿Qué pedidos se hicieron ayer?",
]);
