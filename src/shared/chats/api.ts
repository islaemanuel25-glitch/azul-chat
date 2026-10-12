// src/shared/chats/api.ts
//
// LO QUE LAS RUTAS DE CHATS LE CONTESTAN AL NAVEGADOR. Es lo único de los
// chats que la interfaz puede importar.
//
// Nunca lleva el token, la delegación, ids internos de la base (vínculo,
// sesión, cursor de ingesta), la clave del ERP, el cursor del ERP ni
// permisos. Los ids de evento son la secuencia de Azul Chat, como texto.
//
// ── DOS FALLAS QUE NO SON LA MISMA ─────────────────────────────────────────
//
//   · De AUTORIZACIÓN: no se pudo comprobar con el ERP, ahora, qué puede ver
//     la persona (`mi_alcance` caído o rechazado). Fallo cerrado (P1): no se
//     muestra historial, ni de la base. Estados `ERP_NO_DISPONIBLE`,
//     `NO_AUTORIZADO`, `SIN_SESION`.
//     `ERP_CUPO_EXCEDIDO` es un caso de estos con su propio texto: el ERP
//     contestó, pero se le pidió mucho seguido (Tanda 5B).
//   · De SINCRONIZACIÓN de un local: la autorización SÍ se comprobó, pero lo
//     guardado de ese local no está al día (la sincronización de fondo no lo
//     pudo traer). Ese local se muestra con lo que ya estaba guardado y
//     `sincronizacion: "DEMORADA"`. Es seguro: la persona está autorizada ahora
//     para ese local.

import type { PreguntaGuardada } from "./preguntas.ts";

/**
 * Qué tan al día está lo guardado de un local, según los cursores que dejó la
 * sincronización de fondo (Tanda 5B: el pedido del navegador no trae nada).
 */
export type EstadoSincronizacion =
  /** Todas sus capacidades se sincronizaron bien en las últimas 3 corridas del timer, y la última no falló. */
  | "AL_DIA"
  /** Alguna capacidad nunca se sincronizó, quedó con un error, o lleva más de 3 corridas sin sincronizar. */
  | "DEMORADA";

/** Lo común a todo evento, como lo ve la interfaz. */
type BaseEventoPublico = {
  /** El id de Azul Chat (secuencia de ingesta), como texto: es un BigInt. */
  readonly id: string;
  /** Cuándo pasó en el ERP (la fecha del hecho de cada tipo), ISO con milisegundos. */
  readonly fecha: string;
  /**
   * Entró con el backfill de su capacidad: es historia y NUNCA cuenta como no
   * leído, aunque su id sea mayor que lo leído (Tanda 4B: la historia de una
   * capacidad nueva entra después que lo nuevo de otra). Solo el booleano.
   */
  readonly historico: boolean;
};

/** Una transferencia que RECIBIÓ el local. */
export type EventoTransferenciaRecibidaPublico = BaseEventoPublico & {
  readonly tipo: "TRANSFERENCIA_RECIBIDA";
  readonly transferenciaId: number;
  readonly origen: { readonly id: number; readonly nombre: string; readonly esDeposito: boolean };
  readonly destino: { readonly id: number; readonly nombre: string };
  readonly tieneDiferencias: boolean;
  readonly lineasConDiferencia: number;
};

/** Un pedido que SOLICITÓ el local, a `origen` (Tanda 4B). `lineas`: las que tenía cuando se conoció. */
export type EventoPedidoSolicitadoPublico = BaseEventoPublico & {
  readonly tipo: "PEDIDO_SOLICITADO";
  readonly pedidoId: number;
  readonly origen: { readonly id: number; readonly nombre: string };
  readonly lineas: number;
};

/** Una transferencia que `origen` le ENVIÓ al local (Tanda 4B). */
export type EventoTransferenciaEnviadaPublico = BaseEventoPublico & {
  readonly tipo: "TRANSFERENCIA_ENVIADA";
  readonly transferenciaId: number;
  readonly origen: { readonly id: number; readonly nombre: string };
  readonly lineas: number;
};

/** Una transferencia de `origen` al local que se CANCELÓ (Tanda 4B). */
export type EventoTransferenciaCanceladaPublico = BaseEventoPublico & {
  readonly tipo: "TRANSFERENCIA_CANCELADA";
  readonly transferenciaId: number;
  readonly origen: { readonly id: number; readonly nombre: string };
};

/** Un evento, como lo ve la interfaz: uno de los cuatro tipos. */
export type EventoPublico =
  | EventoTransferenciaRecibidaPublico
  | EventoPedidoSolicitadoPublico
  | EventoTransferenciaEnviadaPublico
  | EventoTransferenciaCanceladaPublico;

/** Un evento de General: además, el local al que pertenece, con su nombre de HOY. */
export type EventoGeneral = EventoPublico & { readonly local: { readonly localId: number; readonly nombre: string } };

export type LocalDeChats = {
  readonly localId: number;
  /** El nombre de HOY, de `mi_alcance`. */
  readonly nombre: string;
  readonly esDeposito: boolean;
  readonly ultimoEvento: EventoPublico | null;
  readonly noLeidos: number;
  readonly sincronizacion: EstadoSincronizacion;
};

/** Las fallas comunes a todas las rutas de chats. */
export type FallaChats =
  /** Sin cookie, o una que no vale. `motivo` solo si el ERP invalidó el vínculo. */
  | { readonly estado: "SIN_SESION"; readonly motivo?: "VINCULO_INVALIDO" }
  /** El ERP dice que la persona no puede (inactiva), o el local pedido no está entre los que puede ver hoy. Genérico: no dice si el local existe. */
  | { readonly estado: "NO_AUTORIZADO" }
  /** No se pudo comprobar la autorización con el ERP. Fallo cerrado: sin historial. */
  | { readonly estado: "ERP_NO_DISPONIBLE" }
  /** El ERP rechazó la consulta por cupo (LIMITE_EXCEDIDO): muchas seguidas. Fallo cerrado igual: sin historial. */
  | { readonly estado: "ERP_CUPO_EXCEDIDO" }
  /** Azul Chat mismo no está configurado o su base no responde. */
  | { readonly estado: "SERVICIO_NO_DISPONIBLE" }
  /** La solicitud no tiene la forma esperada. */
  | { readonly estado: "SOLICITUD_INVALIDA" }
  /** POST desde un origen que no es Azul Chat. */
  | { readonly estado: "ORIGEN_NO_PERMITIDO" };

/** GET /api/chats */
export type RespuestaChats =
  | {
      readonly estado: "OK";
      readonly usuario: { readonly nombre: string };
      /** General es una proyección: no es un local ni se guarda. */
      readonly general: { readonly noLeidos: number; readonly ultimoEvento: EventoGeneral | null };
      readonly locales: readonly LocalDeChats[];
    }
  | FallaChats;

/** GET /api/chats/local?localId=…&cursor=… */
export type RespuestaLocal =
  | {
      readonly estado: "OK";
      /**
       * `ventas`: el `mi_alcance` de ESTA solicitud anuncia `ventas_resumen` en
       * este local. Es un anuncio para mostrar el botón, no una autorización:
       * GET /api/chats/ventas lo vuelve a decidir con el ERP.
       */
      readonly local: {
        readonly localId: number;
        readonly nombre: string;
        readonly esDeposito: boolean;
        readonly ventas: boolean;
        /** Tanda 7B: lo mismo para `cajas_resumen` y el chip "Caja". GET /api/chats/caja lo vuelve a decidir. */
        readonly caja: boolean;
        /** Tanda 8B: lo mismo para `stock_consulta` y el chip "Stock". GET /api/chats/stock lo vuelve a decidir. */
        readonly stock: boolean;
        /**
         * Tanda 9B: el local anuncia `pedidos_pendientes` o `cajas_resumen`:
         * el chip "Pendientes". GET /api/chats/pendientes lo vuelve a decidir.
         */
        readonly pendientes: boolean;
      };
      readonly sincronizacion: EstadoSincronizacion;
      /**
       * Tanda 6A: hay preguntas en lenguaje natural (la IA está configurada).
       * Sin ellas, la caja de preguntas no se muestra. No autoriza nada:
       * POST /api/chats/preguntar lo vuelve a decidir.
       */
      readonly preguntas: boolean;
      readonly noLeidos: number;
      /** Hasta qué evento leyó la persona (id como texto). */
      readonly leidoHasta: string;
      /** Del más reciente al más antiguo. */
      readonly eventos: readonly EventoPublico[];
      /**
       * Tanda 6C: las preguntas guardadas de esta persona en este Local que
       * caen en la misma página, intercaladas por hora con los eventos (ver
       * docs/CHATS.md, "Paginación"). Del más reciente al más antiguo.
       */
      readonly guardadas: readonly PreguntaGuardada[];
      /** Opaco: se manda tal cual como `cursor` para la página siguiente. Null: no hay más. */
      readonly siguiente: string | null;
    }
  | FallaChats;

/** GET /api/chats/general?cursor=… */
export type RespuestaGeneral =
  | {
      readonly estado: "OK";
      readonly noLeidos: number;
      readonly eventos: readonly EventoGeneral[];
      /** Tanda 6C: las preguntas guardadas en General (ver RespuestaLocal). */
      readonly guardadas: readonly PreguntaGuardada[];
      readonly siguiente: string | null;
      /** Tanda 6A: hay preguntas en lenguaje natural (ver RespuestaLocal). */
      readonly preguntas: boolean;
      /** Los locales autorizados cuyo estado es DEMORADA (mismo criterio que la lista). */
      readonly localesDemorados: readonly number[];
      /** Tanda 9B: algún local anuncia `pedidos_pendientes` o `cajas_resumen`: el chip "Pendientes" de General. */
      readonly pendientes: boolean;
    }
  | FallaChats;

/** POST /api/chats/leido — el cuerpo. */
export type PedidoLeido = { readonly marcas: readonly { readonly localId: number; readonly hastaEventoId: string }[] };

/** POST /api/chats/leido — la respuesta. */
export type RespuestaLeido =
  | {
      readonly estado: "OK";
      readonly lecturas: readonly { readonly localId: number; readonly leidoHasta: string; readonly noLeidos: number }[];
    }
  | FallaChats;

/**
 * GET /api/chats/ventas?localId=… — las ventas de HOY de un local, como las
 * calcula el ERP en esta solicitud. Nada se guarda. Los montos son el decimal
 * en texto del ERP, tal cual: la interfaz los formatea sin pasar por number.
 */
export type RespuestaVentas =
  | {
      readonly estado: "OK";
      /** El nombre de HOY, de `mi_alcance`: el mismo que el encabezado del chat. */
      readonly local: { readonly id: number; readonly nombre: string };
      /** Días de calendario "AAAA-MM-DD" en la zona del ERP. Hoy: desde = hasta. */
      readonly periodo: { readonly desde: string; readonly hasta: string };
      readonly cantidadVentas: number;
      readonly totalVendido: string;
      readonly mediosDePago: readonly { readonly medio: string; readonly etiqueta: string; readonly total: string; readonly cantidadPagos: number }[];
      /** Avisos del ERP para mostrar tal cual (p. ej. que el día todavía no terminó). */
      readonly advertencias: readonly { readonly codigo: string; readonly mensaje: string }[];
    }
  | FallaChats;

// ── Las cajas de un día (Tanda 7B) ─────────────────────────────────────────
//
// Lo que `cajas_resumen` del ERP contestó, copiado campo por campo. Montos en
// el decimal en texto del ERP. Las diferencias son de CADA caja: el turno no
// lleva una (no se compensan entre operadores). La verificación de Tesorería
// es aparte y no toca la diferencia de caja.

/** Un medio de pago de una caja o de un turno. `cobrado`: false en el fiado. */
export type MedioDeCajaPublico = {
  readonly medio: string;
  readonly etiqueta: string;
  readonly total: string;
  readonly cantidadPagos: number;
  readonly cobrado: boolean;
};

export type RetiroPublico = {
  readonly tipo: "RETIRO_RECAUDACION" | "RETIRO_CIERRE" | "PAGO_PROVEEDOR" | "PAGO_GASTO" | "RETIRO_MANUAL";
  readonly monto: string;
  readonly motivo: string | null;
  /** A quién o adónde fue. null: el ERP no lo registra (no se inventa). */
  readonly aQuien: string | null;
  readonly recibidoPor: string | null;
  readonly hora: string | null;
  readonly registradoPor: string | null;
};

export type IngresoPublico = { readonly monto: string; readonly motivo: string | null; readonly hora: string | null; readonly registradoPor: string | null };

export type CajaPublica = {
  readonly id: number;
  readonly etiqueta: string;
  /** El nombre que el ERP muestra; null si la caja no tiene operador. */
  readonly operador: string | null;
  readonly apertura: string;
  readonly cierre: string | null;
  readonly estado: "ABIERTA" | "CORRECTA" | "CON_DIFERENCIA" | "SIN_CONTEO" | "ANULADA";
  readonly montoInicial: string | null;
  readonly cantidadVentas: number;
  readonly totalVendido: string;
  readonly ventasEfectivo: string;
  readonly ventasPorMedio: readonly MedioDeCajaPublico[];
  readonly ventasNoCobradas: readonly MedioDeCajaPublico[];
  readonly retiros: readonly RetiroPublico[];
  readonly ingresos: readonly IngresoPublico[];
  readonly efectivoEsperado: string | null;
  readonly efectivoContado: string | null;
  readonly diferencia: { readonly monto: string; readonly tipo: "FALTA" | "SOBRA" | "NINGUNA" } | null;
  readonly efectivoRetiradoCierre: string | null;
  readonly fondoDejadoCierre: string | null;
  readonly verificacionTesoreria: "VERIFICADA" | "FALTA_VERIFICAR" | "NO_APLICA";
};

/** Los totales de un turno: las ventas de sus cajas, sumadas por el ERP. Sin diferencia ni contado. */
export type TotalesDeTurnoPublico = {
  readonly cantidadVentas: number;
  readonly totalVendido: string;
  readonly ventasEfectivo: string;
  readonly ventasPorMedio: readonly MedioDeCajaPublico[];
  readonly ventasNoCobradas: readonly MedioDeCajaPublico[];
};

export type TurnoDeCajas = {
  /** id null: "Sin turno asignado" (cajas anteriores a los turnos operativos). */
  readonly turno: { readonly id: number | null; readonly nombre: string };
  readonly sinTurnoAsignado: boolean;
  readonly totales: TotalesDeTurnoPublico;
  readonly cajas: readonly CajaPublica[];
};

/** Las cajas de un local en un día, por turno operativo, con "Sin turno asignado" al final. */
export type CajasDelDia = {
  readonly local: { readonly id: number; readonly nombre: string };
  /** El día argentino, "AAAA-MM-DD". */
  readonly fecha: string;
  readonly turnos: readonly TurnoDeCajas[];
  readonly advertencias: readonly { readonly codigo: string; readonly mensaje: string }[];
};

/**
 * GET /api/chats/caja?localId=… — las cajas de HOY de un local, como las
 * calcula el ERP en esta solicitud. Nada se guarda.
 */
export type RespuestaCaja = ({ readonly estado: "OK" } & CajasDelDia) | FallaChats;

// ── El stock de un local (Tanda 8B) ────────────────────────────────────────
//
// Lo que `stock_consulta` del ERP contestó, copiado campo por campo. La
// cantidad es la existencia con tres decimales; `equivalencia` es el texto que
// muestra la pantalla de stock del ERP ("30 uds", "2 bultos + 6 uds"). El
// mínimo y "bajo mínimo" van juntos: los dos null si no hay mínimo ajustado.

export type ProductoDeStockPublico = {
  readonly productoId: number;
  readonly nombre: string;
  readonly codigo: string | null;
  readonly cantidad: string;
  readonly unidad: string;
  readonly equivalencia: string;
  readonly stockMinimo: string | null;
  readonly bajoMinimo: boolean | null;
};

/**
 * Los productos bajo mínimo de un local. `sinMinimo`: el local no tiene
 * ningún producto con el mínimo ajustado (STOCK_MINIMO_NO_DISPONIBLE del
 * ERP), que no es una falla: se dice así.
 */
export type BajoMinimoDelLocal =
  | {
      readonly local: { readonly id: number; readonly nombre: string };
      readonly sinMinimo: false;
      readonly total: number;
      readonly hayMas: boolean;
      readonly productos: readonly ProductoDeStockPublico[];
    }
  | { readonly local: { readonly id: number; readonly nombre: string }; readonly sinMinimo: true };

/** Lo que encontró el buscador del ERP en un local: hasta 10, y `hayMas`. */
export type ProductosDelLocal = {
  readonly local: { readonly id: number; readonly nombre: string };
  readonly texto: string;
  readonly productos: readonly ProductoDeStockPublico[];
  readonly hayMas: boolean;
};

/**
 * GET /api/chats/stock?localId=… — los productos bajo mínimo de un local, como
 * los calcula el ERP en esta solicitud. Nada se guarda.
 */
export type RespuestaStock = ({ readonly estado: "OK" } & BajoMinimoDelLocal) | FallaChats;

// ── Pendientes de un local (Tanda 9B) ───────────────────────────────────────
//
// Dos fuentes del ERP, copiadas campo por campo: los pedidos que el local pidió
// y siguen sin enviar (`pedidos_pendientes`) y, de `cajas_resumen` de hoy y de
// ayer, las cajas con diferencia o sin verificar en Tesorería. La etiqueta y el
// orden los pone src/shared/chats/pendientes.ts con reglas fijas del dueño:
// ningún número se calcula.

/** IMPORTANTE: pedido de más de 24 h, o caja con faltante. El resto, NORMAL. */
export type EtiquetaPendiente = "IMPORTANTE" | "NORMAL";

export type PendientePedido = {
  readonly tipo: "PEDIDO";
  readonly etiqueta: EtiquetaPendiente;
  readonly pedidoId: number;
  readonly solicitadoAt: string | null;
  readonly origen: { readonly id: number; readonly nombre: string };
  readonly lineas: number;
  /** Horas completas al consultar, como las dio el ERP. */
  readonly antiguedadHoras: number | null;
};

/** Por qué una caja está pendiente: la diferencia (FALTA o SOBRA) o, sin diferencia, que falta verificarla. */
export type MotivoCajaPendiente = "FALTA" | "SOBRA" | "FALTA_VERIFICAR";

export type PendienteCaja = {
  readonly tipo: "CAJA";
  readonly etiqueta: EtiquetaPendiente;
  readonly cajaId: number;
  readonly operador: string | null;
  /** El nombre de la caja que da el ERP ("Caja de Bruno"), para cuando no hay operador. */
  readonly nombreCaja: string;
  /** El nombre del turno operativo, o "Sin turno asignado". */
  readonly turno: string;
  readonly dia: "hoy" | "ayer";
  readonly apertura: string;
  readonly motivo: MotivoCajaPendiente;
  /** El monto de la diferencia (decimal en texto del ERP); null si el motivo es FALTA_VERIFICAR. */
  readonly monto: string | null;
};

export type Pendiente = PendientePedido | PendienteCaja;

/** Las consultas de las que salen los pendientes. */
export type FuentePendientes = "PEDIDOS" | "CAJAS_HOY" | "CAJAS_AYER";

/**
 * Lo pendiente de un local. `faltaron`: las fuentes que se consultaron y no
 * contestaron (la lista puede estar incompleta, y se dice). Una fuente que el
 * local no anuncia no se consulta y no está acá.
 */
export type PendientesDelLocal = {
  readonly local: { readonly id: number; readonly nombre: string };
  readonly pendientes: readonly Pendiente[];
  readonly faltaron: readonly FuentePendientes[];
};

/** GET /api/chats/pendientes?localId=… — nada se guarda. */
export type RespuestaPendientes = ({ readonly estado: "OK" } & PendientesDelLocal) | FallaChats;

/** GET /api/chats/pendientes/general — un bloque por local; los que no tienen nada, al final. */
export type RespuestaPendientesGeneral = { readonly estado: "OK"; readonly locales: readonly PendientesDelLocal[] } | FallaChats;

/** Las rutas, para la interfaz. */
export const RUTAS_CHATS = Object.freeze({
  chats: "/api/chats",
  local: "/api/chats/local",
  general: "/api/chats/general",
  leido: "/api/chats/leido",
  ventas: "/api/chats/ventas",
  caja: "/api/chats/caja",
  stock: "/api/chats/stock",
  pendientes: "/api/chats/pendientes",
  pendientesGeneral: "/api/chats/pendientes/general",
  preguntar: "/api/chats/preguntar",
  buscar: "/api/chats/buscar",
});
