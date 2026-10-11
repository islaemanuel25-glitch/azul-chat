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
      readonly local: { readonly localId: number; readonly nombre: string; readonly esDeposito: boolean; readonly ventas: boolean };
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

/** Las rutas, para la interfaz. */
export const RUTAS_CHATS = Object.freeze({
  chats: "/api/chats",
  local: "/api/chats/local",
  general: "/api/chats/general",
  leido: "/api/chats/leido",
  ventas: "/api/chats/ventas",
  preguntar: "/api/chats/preguntar",
});
