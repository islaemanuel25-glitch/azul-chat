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
//   · De SINCRONIZACIÓN de un local: la autorización SÍ se comprobó, pero traer
//     lo nuevo de ese local falló. Ese local se muestra con lo que ya estaba
//     guardado y `sincronizacion: "DEMORADA"`. Es seguro: la persona está
//     autorizada ahora para ese local.

/** Un local dentro de los chats: sincronizado ahora (o hace menos de 30 s), o con lo ya guardado. */
export type EstadoSincronizacion =
  /** Lo guardado está al día según la frecuencia de ingesta (sincronizado ahora, hace poco, o lo está haciendo otra solicitud). */
  | "AL_DIA"
  /** Traer lo nuevo falló en esta solicitud: se muestra lo que ya estaba guardado. */
  | "DEMORADA";

/** Un evento, como lo ve la interfaz. Hoy, solo TRANSFERENCIA_RECIBIDA. */
export type EventoPublico = {
  /** El id de Azul Chat (secuencia de ingesta), como texto: es un BigInt. */
  readonly id: string;
  readonly tipo: "TRANSFERENCIA_RECIBIDA";
  /** Cuándo pasó en el ERP (fecha de recepción), ISO con milisegundos. */
  readonly fecha: string;
  readonly transferenciaId: number;
  readonly origen: { readonly id: number; readonly nombre: string; readonly esDeposito: boolean };
  readonly destino: { readonly id: number; readonly nombre: string };
  readonly tieneDiferencias: boolean;
  readonly lineasConDiferencia: number;
};

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
      readonly local: { readonly localId: number; readonly nombre: string; readonly esDeposito: boolean };
      readonly sincronizacion: EstadoSincronizacion;
      readonly noLeidos: number;
      /** Hasta qué evento leyó la persona (id como texto). */
      readonly leidoHasta: string;
      /** Del más reciente al más antiguo. */
      readonly eventos: readonly EventoPublico[];
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
      readonly siguiente: string | null;
      /** Los locales autorizados cuyo intento de traer lo nuevo falló en esta solicitud. */
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

/** Las rutas, para la interfaz. */
export const RUTAS_CHATS = Object.freeze({
  chats: "/api/chats",
  local: "/api/chats/local",
  general: "/api/chats/general",
  leido: "/api/chats/leido",
});
