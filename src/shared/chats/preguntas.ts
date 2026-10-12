// src/shared/chats/preguntas.ts
//
// LAS PREGUNTAS EN LENGUAJE NATURAL (Tanda 6A): lo que el navegador manda y lo
// que POST /api/chats/preguntar le contesta. Es lo único de las preguntas que
// la interfaz puede importar.
//
// La IA SOLO INTERPRETA: elige una intención de un catálogo cerrado. Todo lo
// que se muestra lo arma el código con datos del ERP (ventas) o de la base
// propia (eventos): ni un texto ni un número de la respuesta sale del modelo.

import type { BajoMinimoDelLocal, CajasDelDia, EventoGeneral, FallaChats, PendientesDelLocal, ProductosDelLocal, TotalesDeTurnoPublico } from "./api.ts";

/** Lo que manda el navegador. `localId`: desde qué Local se pregunta (sin él, desde General). */
export type PedidoPregunta = { readonly pregunta: string; readonly localId?: number };

/** El largo máximo de una pregunta, en caracteres. */
export const MAX_LARGO_PREGUNTA = 300;

/** Los tipos de eventos por los que se puede preguntar, en el orden en que se ofrecen. */
export const TIPOS_DE_EVENTO_PREGUNTA = ["recibidas", "recibidas_con_diferencias", "enviadas", "pedidos", "cancelaciones"] as const;
export type TipoEventoPregunta = (typeof TIPOS_DE_EVENTO_PREGUNTA)[number];

/**
 * Tanda 6B: lo que una pregunta puede pedir y el sistema TODAVÍA NO SABE
 * SEPARAR (ventas_resumen del ERP no filtra por turno, ni por hora, ni por
 * vendedor…). La IA marca cuáles pidió la pregunta; el código contesta igual
 * con el período completo y la interfaz lo DICE con un aviso fijo. Nunca se
 * muestra un total como si respondiera algo que no responde.
 */
export const RESTRICCIONES_NO_SOPORTADAS = ["turno", "hora", "vendedor", "producto", "categoria", "medio_de_pago", "cliente"] as const;
export type RestriccionNoSoportada = (typeof RESTRICCIONES_NO_SOPORTADAS)[number];

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
  | {
      readonly estado: "VENTAS";
      readonly alcance: "LOCAL";
      readonly periodo: PeriodoPregunta;
      readonly ventas: VentasDeUnLocal;
      /** Tanda 6B: lo que la pregunta pidió y la respuesta NO separa. Vacío: nada. La interfaz lo avisa. */
      readonly noSeparaPor: readonly RestriccionNoSoportada[];
    }
  /**
   * Ventas de todos los locales con `ventas_resumen` hoy. `total` es null si
   * alguno falló: un total parcial no se muestra como si fuera completo.
   * `fallidos` dice cuáles.
   */
  | {
      readonly estado: "VENTAS";
      readonly alcance: "TODOS";
      readonly periodo: PeriodoPregunta;
      readonly noSeparaPor: readonly RestriccionNoSoportada[];
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
      readonly noSeparaPor: readonly RestriccionNoSoportada[];
      readonly cantidad: number;
      readonly eventos: readonly EventoGeneral[];
      readonly restantes: number;
    }
  /**
   * Tanda 7B: las cajas de un día de UN local, por turno operativo, como las
   * dio el ERP. Con `turnoPedido`, solo ese turno; si no se encontró
   * (`turnoNoEncontrado`), todos los del día y la interfaz lo avisa.
   */
  | {
      readonly estado: "CAJA";
      readonly alcance: "LOCAL";
      readonly periodo: PeriodoPregunta;
      readonly turnoPedido: string | null;
      readonly turnoNoEncontrado: boolean;
      readonly cajas: CajasDelDia;
    }
  /** Tanda 7B: las cajas de cada local con `cajas_resumen`. Sin sumas: cada caja es de su local. `fallidos`: los que no se pudieron consultar. */
  | {
      readonly estado: "CAJA";
      readonly alcance: "TODOS";
      readonly periodo: PeriodoPregunta;
      readonly turnoPedido: string | null;
      readonly turnoNoEncontrado: boolean;
      readonly locales: readonly CajasDelDia[];
      readonly fallidos: readonly { readonly id: number; readonly nombre: string }[];
    }
  /**
   * Tanda 7B: ventas de UN turno de un local, de `cajas_resumen`: `cajas`
   * trae solo ese turno (sus totales por medio y sus cajas) o, si no se
   * encontró, todos los del día.
   */
  | {
      readonly estado: "VENTAS_TURNO";
      readonly alcance: "LOCAL";
      readonly periodo: PeriodoPregunta;
      readonly turnoPedido: string;
      readonly turnoNoEncontrado: boolean;
      readonly noSeparaPor: readonly RestriccionNoSoportada[];
      readonly cajas: CajasDelDia;
    }
  /**
   * Tanda 7B: ventas de ese turno en todos los locales con `cajas_resumen`.
   * `total`: la suma por código de los turnos encontrados, null si algún local
   * falló (no hay total parcial) o si no se encontró en ninguno. Cada local
   * trae solo ese turno (vacío si no lo tuvo) o, si no se encontró en ninguno,
   * todos los del día.
   */
  | {
      readonly estado: "VENTAS_TURNO";
      readonly alcance: "TODOS";
      readonly periodo: PeriodoPregunta;
      readonly turnoPedido: string;
      readonly turnoNoEncontrado: boolean;
      readonly noSeparaPor: readonly RestriccionNoSoportada[];
      readonly total: TotalesDeTurnoPublico | null;
      readonly locales: readonly CajasDelDia[];
      readonly fallidos: readonly { readonly id: number; readonly nombre: string }[];
    }
  /**
   * Tanda 8B: el stock de UN local, como lo dio el ERP: lo que encontró su
   * buscador para el texto de la pregunta (hasta 10 y `hayMas`).
   */
  | {
      readonly estado: "STOCK";
      readonly modo: "producto";
      readonly alcance: "LOCAL";
      readonly texto: string;
      readonly resultado: ProductosDelLocal;
    }
  /** Tanda 8B: el mismo texto en cada local con `stock_consulta`. `fallidos`: los que no se pudieron consultar. */
  | {
      readonly estado: "STOCK";
      readonly modo: "producto";
      readonly alcance: "TODOS";
      readonly texto: string;
      readonly locales: readonly ProductosDelLocal[];
      readonly fallidos: readonly { readonly id: number; readonly nombre: string }[];
    }
  /** Tanda 8B: los productos bajo mínimo de UN local (o que no tiene mínimo cargado). */
  | {
      readonly estado: "STOCK";
      readonly modo: "bajo_minimo";
      readonly alcance: "LOCAL";
      readonly resultado: BajoMinimoDelLocal;
    }
  /** Tanda 8B: bajo mínimo en cada local con `stock_consulta`, cada uno con su total. Sin sumas. */
  | {
      readonly estado: "STOCK";
      readonly modo: "bajo_minimo";
      readonly alcance: "TODOS";
      readonly locales: readonly BajoMinimoDelLocal[];
      readonly fallidos: readonly { readonly id: number; readonly nombre: string }[];
    }
  /** Tanda 9B: lo pendiente de UN local (pedidos sin enviar y cajas a revisar), con la fuente que faltó si faltó alguna. */
  | {
      readonly estado: "PENDIENTES";
      readonly alcance: "LOCAL";
      readonly resultado: PendientesDelLocal;
    }
  /** Tanda 9B: lo mismo de cada local con alguna de las dos fuentes; los que no tienen nada, al final. */
  | {
      readonly estado: "PENDIENTES";
      readonly alcance: "TODOS";
      readonly locales: readonly PendientesDelLocal[];
    }
  /** No se entendió, o lo entendido no se puede contestar. Con ejemplos de lo que sí. */
  | { readonly estado: "NO_ENTIENDO"; readonly ejemplos: readonly string[] }
  /** Se alcanzó el tope de gasto del mes: no se llamó a la IA. */
  | { readonly estado: "SALDO_AGOTADO" }
  /** La IA no contestó, o no está configurada. */
  | { readonly estado: "IA_NO_DISPONIBLE" }
  | FallaChats;

/**
 * Tanda 6C: las respuestas que se GUARDAN con su pregunta: las que contestó
 * la pregunta una vez autorizada la persona. Las fallas de antes (sin sesión,
 * sin acceso, solicitud inválida, servicio caído) no se guardan: no hay a quién
 * ni dónde.
 */
export const ESTADOS_GUARDADOS = [
  "VENTAS",
  "EVENTOS",
  "NO_ENTIENDO",
  "SALDO_AGOTADO",
  "IA_NO_DISPONIBLE",
  "ERP_NO_DISPONIBLE",
  "ERP_CUPO_EXCEDIDO",
  // Tanda 7B, versión 2 del resultado (preguntas/guardadas.ts).
  "CAJA",
  "VENTAS_TURNO",
  // Tanda 8B, versión 3 del resultado.
  "STOCK",
  // Tanda 9B, versión 4 del resultado.
  "PENDIENTES",
] as const;
export type RespuestaGuardada = Extract<RespuestaPregunta, { readonly estado: (typeof ESTADOS_GUARDADOS)[number] }>;

/**
 * Tanda 6C: una pregunta guardada, como la ve el historial. `respuesta` es la
 * foto de ese momento: no se recalcula. `creadaEn`: cuándo se preguntó (ISO).
 */
export type PreguntaGuardada = {
  readonly id: string;
  readonly pregunta: string;
  readonly creadaEn: string;
  readonly respuesta: RespuestaGuardada;
};

/** Lo que sí se puede preguntar. Fijo: no lo escribe la IA. */
export const EJEMPLOS_DE_PREGUNTAS: readonly string[] = Object.freeze([
  "¿Cuánto vendió hoy?",
  "¿Cuánto vendieron todos los locales ayer?",
  "¿Qué transferencias llegaron con diferencias esta semana?",
  "¿Qué pedidos se hicieron ayer?",
  "¿Cómo cerró la caja hoy?",
  "¿Cuánto vendió el turno tarde?",
  "¿Cuánta leche hay?",
  "¿Qué productos están por debajo del mínimo?",
  "¿Qué está pendiente?",
]);
