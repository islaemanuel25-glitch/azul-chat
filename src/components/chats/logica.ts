// LO QUE DECIDEN LAS PANTALLAS DE CHATS, SIN REACT.
//
// Qué filas tiene la lista, en qué orden se ve una conversación, cómo se juntan
// las páginas, si se puede marcar leído y qué se hace con cada falla. Las
// pantallas solo llaman a esto y dibujan; los tests (test/ui/) lo ejercen sin
// navegador.
//
// Los ids de evento son BigInt en la base y viajan como TEXTO: acá se comparan
// con BigInt y no se convierten nunca a Number.

import type {
  EstadoSincronizacion,
  EventoGeneral,
  EventoPublico,
  LocalDeChats,
  RespuestaCaja,
  RespuestaChats,
  RespuestaPendientes,
  RespuestaPendientesGeneral,
  RespuestaStock,
  RespuestaVentas,
} from "../../shared/chats/api.ts";
import type { FallaCliente, RespuestaDePregunta, Resultado } from "./clienteChats.ts";
import type { PreguntaGuardada } from "../../shared/chats/preguntas.ts";

// ── La lista ────────────────────────────────────────────────────────────────

export type Filtro = "TODOS" | "NO_LEIDOS";

export type FilaDeChats =
  | { readonly tipo: "GENERAL"; readonly noLeidos: number; readonly ultimoEvento: EventoGeneral | null }
  | { readonly tipo: "LOCAL"; readonly local: LocalDeChats };

/** General primero, después los locales que devolvió la API, en su orden. Con "No leídos", solo los que tienen. */
export function filasDeChats(r: Extract<RespuestaChats, { estado: "OK" }>, filtro: Filtro): FilaDeChats[] {
  const general: FilaDeChats = { tipo: "GENERAL", noLeidos: r.general.noLeidos, ultimoEvento: r.general.ultimoEvento };
  const locales = r.locales.map((local): FilaDeChats => ({ tipo: "LOCAL", local }));
  const filas = [general, ...locales];
  if (filtro === "TODOS") return filas;
  return filas.filter((f) => (f.tipo === "GENERAL" ? f.noLeidos : f.local.noLeidos) > 0);
}

// ── Una conversación ────────────────────────────────────────────────────────

const compararIds = (a: string, b: string) => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Para leer como chat: del más antiguo (arriba) al más reciente (abajo), por fecha y, a igual fecha, por id. */
export function ordenCronologico<E extends EventoPublico>(eventos: readonly E[]): E[] {
  return [...eventos].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : compararIds(a.id, b.id)));
}

/** Las páginas anteriores se agregan a las que ya están, sin repetir un evento. El orden es el de la API. */
export function unirPaginas<E extends EventoPublico>(actuales: readonly E[], anteriores: readonly E[]): E[] {
  const vistos = new Set(actuales.map((e) => e.id));
  return [...actuales, ...anteriores.filter((e) => !vistos.has(e.id))];
}

/** Tanda 6C: las preguntas guardadas de las páginas anteriores, sin repetir una. */
export function unirGuardadas(actuales: readonly PreguntaGuardada[], anteriores: readonly PreguntaGuardada[]): PreguntaGuardada[] {
  const vistas = new Set(actuales.map((p) => p.id));
  return [...actuales, ...anteriores.filter((p) => !vistas.has(p.id))];
}

/**
 * Tanda 6C: los elementos de una conversación en el orden del chat (del más
 * antiguo arriba al más reciente abajo): eventos por fecha y preguntas
 * guardadas por cuándo se preguntaron. A igual instante, el evento arriba y la
 * pregunta abajo; entre dos del mismo tipo, por id. Es el orden del servidor
 * (chats/historial.ts) dado vuelta.
 */
export type ElementoDeConversacion<E extends EventoPublico> =
  | { readonly tipo: "EVENTO"; readonly fecha: string; readonly evento: E }
  | { readonly tipo: "PREGUNTA"; readonly fecha: string; readonly guardada: PreguntaGuardada };

export function elementosEnOrden<E extends EventoPublico>(eventos: readonly E[], guardadas: readonly PreguntaGuardada[]): ElementoDeConversacion<E>[] {
  const todos: ElementoDeConversacion<E>[] = [
    ...eventos.map((e) => ({ tipo: "EVENTO" as const, fecha: e.fecha, evento: e })),
    ...guardadas.map((g) => ({ tipo: "PREGUNTA" as const, fecha: g.creadaEn, guardada: g })),
  ];
  const instante = (x: ElementoDeConversacion<E>) => Date.parse(x.fecha);
  const id = (x: ElementoDeConversacion<E>) => (x.tipo === "EVENTO" ? x.evento.id : x.guardada.id);
  return todos.sort((a, b) => {
    if (instante(a) !== instante(b)) return instante(a) - instante(b);
    if (a.tipo !== b.tipo) return a.tipo === "EVENTO" ? -1 : 1;
    return compararIds(id(a), id(b));
  });
}

/** El mayor Evento.id de esos eventos, o null. */
export function mayorId(eventos: readonly EventoPublico[]): string | null {
  let mayor: string | null = null;
  for (const e of eventos) if (mayor === null || compararIds(e.id, mayor) > 0) mayor = e.id;
  return mayor;
}

export type Marca = { readonly localId: number; readonly hastaEventoId: string };

/**
 * Qué hacer con la lectura de un Local, según lo que ESTA respuesta permite
 * demostrar. La lectura del servidor es una marca de agua: marcar hasta un id
 * deja leídos todos los ids menores de ese local. Por eso solo se marca cuando
 * todos los no leídos que informó la respuesta están a la vista:
 *
 *   · `nuevosMostrados` = eventos mostrados NO HISTÓRICOS con Evento.id >
 *     leidoHasta, comparados como BigInt (nunca la cantidad total de eventos:
 *     en pantalla puede haber historia ya leída, o historia sin leer);
 *   · si son menos que `noLeidos`, quedan no leídos sin cargar: NO se marca y
 *     la pantalla avisa que hay más;
 *   · si alcanzan, se marca hasta el mayor de ellos.
 *
 * Es la MISMA regla que cuenta el servidor (eventos/lectura.ts): no histórico
 * y id mayor que lo leído, de los tipos visibles (la API solo devuelve esos).
 * Por qué hace falta mirar `historico` (Tanda 4B): cada capacidad tiene su
 * propio backfill, y la historia de una capacidad nueva se ingiere DESPUÉS que
 * lo nuevo de otra, con ids mayores. Sin mirar `historico`, cien pedidos viejos
 * con ids altos contarían como "nuevos mostrados" y se marcaría leído antes de
 * que los no leídos reales estuvieran a la vista.
 *
 * Por qué alcanzar el número basta: el servidor cuenta exactamente los no
 * históricos con id > leidoHasta, y la conversación muestra esos mismos
 * eventos (la API no manda tipos que la persona no ve). Si hay N mostrados que
 * cumplen la regla y el servidor contó N, son todos: marcar hasta el mayor no
 * deja ninguno no leído sin ver. `noLeidos` y `leidoHasta` son los de la
 * respuesta que abrió la conversación: lo que llegue después tiene ids
 * mayores, no está a la vista y no queda cubierto. test/db/chats.test.ts lo
 * ejerce contra el servidor.
 */
export type DecisionDeLectura =
  /** No hay nada sin leer en esta respuesta (o ya se marcó). */
  | { readonly tipo: "NADA" }
  /** Hay no leídos que todavía no están cargados: no se marca. */
  | { readonly tipo: "FALTAN"; readonly nuevosMostrados: number; readonly noLeidos: number }
  | { readonly tipo: "MARCAR"; readonly marca: Marca };

export function decidirLecturaLocal<E extends EventoPublico>(estado: EstadoConversacion<E, InfoLocal>): DecisionDeLectura {
  if (estado.fase !== "LISTA" || estado.info.noLeidos <= 0) return { tipo: "NADA" };
  const leido = BigInt(estado.info.leidoHasta);
  const nuevos = estado.eventos.filter((e) => !e.historico && BigInt(e.id) > leido);
  if (nuevos.length < estado.info.noLeidos) return { tipo: "FALTAN", nuevosMostrados: nuevos.length, noLeidos: estado.info.noLeidos };
  return { tipo: "MARCAR", marca: { localId: estado.info.localId, hastaEventoId: mayorId(nuevos)! } };
}

// ── El estado de una conversación (Local o General) ─────────────────────────

/** Lo que cada pantalla agrega a su estado: el Local, su nombre y su lectura; General, los locales demorados. */
export type InfoLocal = {
  readonly tipo: "LOCAL";
  readonly localId: number;
  readonly nombre: string;
  readonly sincronizacion: EstadoSincronizacion;
  readonly leidoHasta: string;
  readonly noLeidos: number;
  /** El ERP anuncia `ventas_resumen` en este local, en esta respuesta: hay barra con "Ventas" (Tanda 3A). */
  readonly ventas: boolean;
  /** Tanda 7B: lo mismo con `cajas_resumen` y el chip "Caja". */
  readonly caja: boolean;
  /** Tanda 8B: lo mismo con `stock_consulta` y el chip "Stock". */
  readonly stock: boolean;
  /** Tanda 9B: anuncia `pedidos_pendientes` o `cajas_resumen`: el chip "Pendientes". */
  readonly pendientes: boolean;
  /** Hay preguntas en lenguaje natural (Tanda 6A): la caja se muestra. */
  readonly preguntas: boolean;
};
/**
 * General no lleva lectura: en la Tanda 2C no marca leído (docs/INTERFAZ.md). Tanda 6A: sí preguntas.
 * Tanda 9B: `pendientes`, algún local anuncia alguna de las dos fuentes: el chip "Pendientes".
 */
export type InfoGeneral = { readonly tipo: "GENERAL"; readonly localesDemorados: readonly number[]; readonly preguntas: boolean; readonly pendientes: boolean };

export type EstadoConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral> =
  | { readonly fase: "CARGANDO" }
  /** Sin historial detrás: la falla reemplaza la vista. */
  | { readonly fase: "FALLA"; readonly falla: FallaCliente }
  | {
      readonly fase: "LISTA";
      /** En el orden de la API: del más reciente al más antiguo. */
      readonly eventos: readonly E[];
      /** Tanda 6C: las preguntas guardadas que trajeron las mismas páginas. */
      readonly guardadas: readonly PreguntaGuardada[];
      readonly siguiente: string | null;
      readonly anteriores: "QUIETO" | "CARGANDO" | "SIN_RED";
      readonly info: I;
    };

export type AccionConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral> =
  | { readonly tipo: "CARGANDO" }
  | { readonly tipo: "CARGADA"; readonly eventos: readonly E[]; readonly guardadas?: readonly PreguntaGuardada[]; readonly siguiente: string | null; readonly info: I }
  | { readonly tipo: "PIDIENDO_ANTERIORES" }
  | { readonly tipo: "ANTERIORES"; readonly eventos: readonly E[]; readonly guardadas?: readonly PreguntaGuardada[]; readonly siguiente: string | null }
  | { readonly tipo: "FALLA"; readonly falla: FallaCliente }
  /** POST leído salió bien: la lectura y los no leídos que dice el servidor. Solo para un Local. */
  | { readonly tipo: "LEIDO"; readonly localId: number; readonly leidoHasta: string; readonly noLeidos: number };

export function reducirConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral>(
  estado: EstadoConversacion<E, I>,
  accion: AccionConversacion<E, I>,
): EstadoConversacion<E, I> {
  switch (accion.tipo) {
    case "CARGANDO":
      return { fase: "CARGANDO" };
    case "CARGADA":
      return { fase: "LISTA", eventos: accion.eventos, guardadas: accion.guardadas ?? [], siguiente: accion.siguiente, anteriores: "QUIETO", info: accion.info };
    case "PIDIENDO_ANTERIORES":
      return estado.fase === "LISTA" ? { ...estado, anteriores: "CARGANDO" } : estado;
    case "ANTERIORES":
      if (estado.fase !== "LISTA") return estado;
      return {
        ...estado,
        eventos: unirPaginas(estado.eventos, accion.eventos),
        guardadas: unirGuardadas(estado.guardadas, accion.guardadas ?? []),
        siguiente: accion.siguiente,
        anteriores: "QUIETO",
      };
    case "FALLA":
      if (accion.falla.estado === "CANCELADA") return estado;
      // Que no haya red al pedir páginas anteriores no dice nada del acceso:
      // lo que ya se ve sigue. Cualquier respuesta de la API que no sea buena
      // —sobre todo ERP_NO_DISPONIBLE— reemplaza la vista entera (P1).
      if (accion.falla.estado === "RED" && estado.fase === "LISTA" && estado.anteriores === "CARGANDO") return { ...estado, anteriores: "SIN_RED" };
      return { fase: "FALLA", falla: accion.falla };
    case "LEIDO":
      if (estado.fase !== "LISTA" || estado.info.tipo !== "LOCAL" || estado.info.localId !== accion.localId) return estado;
      return { ...estado, info: { ...estado.info, leidoHasta: accion.leidoHasta, noLeidos: accion.noLeidos } };
  }
}

// ── Qué hacer con una falla ─────────────────────────────────────────────────

export type DestinoDeFalla =
  /** Volver al flujo de sesión (vincular). */
  | "SESION"
  /** P1: el ERP no respondió. Sin historial. */
  | "ERP_NO_DISPONIBLE"
  /** P1 también, pero el ERP SÍ contestó: se le pidió mucho seguido (LIMITE_EXCEDIDO). Su propio texto y Reintentar en espera. */
  | "CUPO_ERP"
  /** Este local no está entre los que la persona puede ver hoy (o no existe: no se distingue). */
  | "NO_AUTORIZADO"
  | "SIN_RED"
  | "NO_DISPONIBLE"
  | "IGNORAR";

export function destinoDeFalla(f: FallaCliente): DestinoDeFalla {
  switch (f.estado) {
    case "SIN_SESION":
      return "SESION";
    case "ERP_NO_DISPONIBLE":
      return "ERP_NO_DISPONIBLE";
    case "ERP_CUPO_EXCEDIDO":
      return "CUPO_ERP";
    case "NO_AUTORIZADO":
    case "SOLICITUD_INVALIDA":
      return "NO_AUTORIZADO";
    case "RED":
      return "SIN_RED";
    case "CANCELADA":
      return "IGNORAR";
    case "SERVICIO_NO_DISPONIBLE":
    case "ORIGEN_NO_PERMITIDO":
      return "NO_DISPONIBLE";
  }
}

// ── El cupo del ERP (Tanda 5B) ──────────────────────────────────────────────
//
// Después de un rechazo por cupo, "Reintentar" (y lo que pide lo mismo) queda
// deshabilitado este tiempo: tocarlo diez veces seguidas era lo que el 11/10
// mantuvo lleno el cupo. Es un límite a la persona, no un reintento
// automático: pasado el tiempo, el botón vuelve y pedir sigue siendo un toque.

export const ESPERA_TRAS_CUPO_MS = 20_000;

/** Hasta cuándo queda en espera "Reintentar" después de esta falla, o null si no es de cupo. */
export function esperaTrasFalla(f: FallaCliente, ahora: number): number | null {
  return f.estado === "ERP_CUPO_EXCEDIDO" ? ahora + ESPERA_TRAS_CUPO_MS : null;
}

// ── Ventas de hoy (Tanda 3A) ────────────────────────────────────────────────
//
// Una consulta por toque: nada se guarda, nada se refresca solo. Tocar "Ventas"
// otra vez descarta lo que había y pregunta de nuevo; una falla deja la tarjeta
// de error, y reintentar es otro toque. Salir del chat descarta todo (el estado
// vive en la pantalla del Local).

export type EstadoVentas =
  | { readonly fase: "QUIETO" }
  | { readonly fase: "CARGANDO" }
  | { readonly fase: "LISTA"; readonly ventas: Extract<RespuestaVentas, { estado: "OK" }> }
  /** `cupo`: el ERP la rechazó por cupo (Tanda 5B), con su propio texto. */
  | { readonly fase: "FALLA"; readonly cupo: boolean };

export type AccionVentas =
  | { readonly tipo: "PEDIR" }
  | { readonly tipo: "RESPUESTA"; readonly resultado: Resultado<Extract<RespuestaVentas, { estado: "OK" }>> };

/** Qué se ve después de pedir o de recibir. Una respuesta sin pedido en curso no cambia nada. */
export function reducirVentas(estado: EstadoVentas, accion: AccionVentas): EstadoVentas {
  if (accion.tipo === "PEDIR") return { fase: "CARGANDO" };
  if (estado.fase !== "CARGANDO") return estado;
  const r = accion.resultado;
  if (r.ok) return { fase: "LISTA", ventas: r.datos };
  return trasFallaDeConsulta(r.falla);
}

/** Una falla de una consulta de un toque (ventas, caja, stock). Cancelada: la pantalla se fue o se volvió a pedir; no se muestra. */
function trasFallaDeConsulta(f: FallaCliente): { readonly fase: "QUIETO" } | { readonly fase: "FALLA"; readonly cupo: boolean } {
  if (f.estado === "CANCELADA") return { fase: "QUIETO" };
  return { fase: "FALLA", cupo: f.estado === "ERP_CUPO_EXCEDIDO" };
}

// ── Cajas de hoy (Tanda 7B) ─────────────────────────────────────────────────
//
// Igual que Ventas: una consulta por toque del chip "Caja", nada se guarda,
// nada se refresca solo, reintentar es otro toque.

export type EstadoCaja =
  | { readonly fase: "QUIETO" }
  | { readonly fase: "CARGANDO" }
  | { readonly fase: "LISTA"; readonly cajas: Extract<RespuestaCaja, { estado: "OK" }> }
  | { readonly fase: "FALLA"; readonly cupo: boolean };

export type AccionCaja = { readonly tipo: "PEDIR" } | { readonly tipo: "RESPUESTA"; readonly resultado: Resultado<Extract<RespuestaCaja, { estado: "OK" }>> };

export function reducirCaja(estado: EstadoCaja, accion: AccionCaja): EstadoCaja {
  if (accion.tipo === "PEDIR") return { fase: "CARGANDO" };
  if (estado.fase !== "CARGANDO") return estado;
  const r = accion.resultado;
  if (r.ok) return { fase: "LISTA", cajas: r.datos };
  return trasFallaDeConsulta(r.falla);
}

// ── Stock bajo mínimo (Tanda 8B) ────────────────────────────────────────────
//
// Igual que Ventas y Caja: una consulta por toque del chip "Stock", nada se
// guarda, nada se refresca solo, reintentar es otro toque. "Sin mínimo" no es
// una falla: viene como LISTA con `sinMinimo`.

export type EstadoStock =
  | { readonly fase: "QUIETO" }
  | { readonly fase: "CARGANDO" }
  | { readonly fase: "LISTA"; readonly stock: Extract<RespuestaStock, { estado: "OK" }> }
  | { readonly fase: "FALLA"; readonly cupo: boolean };

export type AccionStock = { readonly tipo: "PEDIR" } | { readonly tipo: "RESPUESTA"; readonly resultado: Resultado<Extract<RespuestaStock, { estado: "OK" }>> };

export function reducirStock(estado: EstadoStock, accion: AccionStock): EstadoStock {
  if (accion.tipo === "PEDIR") return { fase: "CARGANDO" };
  if (estado.fase !== "CARGANDO") return estado;
  const r = accion.resultado;
  if (r.ok) return { fase: "LISTA", stock: r.datos };
  return trasFallaDeConsulta(r.falla);
}

// ── Pendientes (Tanda 9B) ───────────────────────────────────────────────────
//
// Igual que Ventas, Caja y Stock: una consulta por toque del chip
// "Pendientes", nada se guarda, nada se refresca solo, reintentar es otro
// toque. En un Local, la tarjeta de ese local; en General, una por local.

export type PendientesListos =
  | { readonly tipo: "LOCAL"; readonly datos: Extract<RespuestaPendientes, { estado: "OK" }> }
  | { readonly tipo: "TODOS"; readonly locales: Extract<RespuestaPendientesGeneral, { estado: "OK" }>["locales"] };

export type EstadoPendientes =
  | { readonly fase: "QUIETO" }
  | { readonly fase: "CARGANDO" }
  | { readonly fase: "LISTA"; readonly pendientes: PendientesListos }
  | { readonly fase: "FALLA"; readonly cupo: boolean };

export type AccionPendientes = { readonly tipo: "PEDIR" } | { readonly tipo: "RESPUESTA"; readonly resultado: Resultado<PendientesListos> };

export function reducirPendientes(estado: EstadoPendientes, accion: AccionPendientes): EstadoPendientes {
  if (accion.tipo === "PEDIR") return { fase: "CARGANDO" };
  if (estado.fase !== "CARGANDO") return estado;
  const r = accion.resultado;
  if (r.ok) return { fase: "LISTA", pendientes: r.datos };
  return trasFallaDeConsulta(r.falla);
}

// ── Preguntas (Tanda 6A) ────────────────────────────────────────────────────
//
// Cada pregunta queda en la conversación como una burbuja propia y, debajo, su
// respuesta. Viven mientras la pantalla está abierta, como la tarjeta de
// Ventas: no se guardan y no marcan leído. Una a la vez: mientras una espera,
// no se manda otra. Reintentar es un toque de la persona y vuelve a mandar la
// MISMA pregunta, en su mismo lugar.

export type EstadoDeUnaPregunta =
  | { readonly fase: "CARGANDO" }
  | { readonly fase: "LISTA"; readonly respuesta: RespuestaDePregunta }
  | { readonly fase: "FALLA"; readonly falla: FallaCliente };

export type IntercambioDePregunta = {
  readonly id: number;
  readonly pregunta: string;
  /** Cuándo se preguntó (ISO), para la hora de la burbuja. */
  readonly cuando: string;
  readonly estado: EstadoDeUnaPregunta;
};

export type AccionPreguntas =
  | { readonly tipo: "PREGUNTAR"; readonly id: number; readonly pregunta: string; readonly cuando: string }
  | { readonly tipo: "REINTENTAR"; readonly id: number }
  | { readonly tipo: "RESPUESTA"; readonly id: number; readonly resultado: Resultado<RespuestaDePregunta> };

/**
 * Tanda 6C: las preguntas de esta pantalla que el historial todavía no trae.
 * Una que ya llegó guardada en una página (por su `guardadaId`) se ve ahí, en
 * su lugar por hora, y no se repite al final.
 */
export function sinLasGuardadas(lista: readonly IntercambioDePregunta[], guardadas: readonly PreguntaGuardada[]): readonly IntercambioDePregunta[] {
  if (guardadas.length === 0) return lista;
  const ids = new Set(guardadas.map((g) => g.id));
  return lista.filter((i) => !(i.estado.fase === "LISTA" && i.estado.respuesta.guardadaId !== undefined && ids.has(i.estado.respuesta.guardadaId)));
}

/** ¿Hay una pregunta esperando respuesta? Mientras tanto, no se manda otra. */
export const hayPreguntaEnCurso = (lista: readonly IntercambioDePregunta[]) => lista.some((i) => i.estado.fase === "CARGANDO");

export function reducirPreguntas(lista: readonly IntercambioDePregunta[], accion: AccionPreguntas): readonly IntercambioDePregunta[] {
  switch (accion.tipo) {
    case "PREGUNTAR":
      if (hayPreguntaEnCurso(lista)) return lista;
      return [...lista, { id: accion.id, pregunta: accion.pregunta, cuando: accion.cuando, estado: { fase: "CARGANDO" } }];
    case "REINTENTAR":
      if (hayPreguntaEnCurso(lista)) return lista;
      return lista.map((i) => (i.id === accion.id && i.estado.fase !== "CARGANDO" ? { ...i, estado: { fase: "CARGANDO" } } : i));
    case "RESPUESTA": {
      const r = accion.resultado;
      // Cancelada: la pantalla se fue. No hay nada que mostrar.
      if (!r.ok && r.falla.estado === "CANCELADA") return lista.filter((i) => i.id !== accion.id);
      return lista.map((i) =>
        i.id === accion.id && i.estado.fase === "CARGANDO" ? { ...i, estado: r.ok ? { fase: "LISTA", respuesta: r.datos } : { fase: "FALLA", falla: r.falla } } : i,
      );
    }
  }
}

// ── Navegación ──────────────────────────────────────────────────────────────

/**
 * La vista. Un Local puede llevar el `nombre` que ya se conocía (Tanda 5B): el
 * de la fila de la lista que se tocó, que viaja en la URL. Es SOLO para el
 * título mientras carga o si la carga falla; cuando la API contesta, manda el
 * nombre de la API. No autoriza nada: el local lo decide el servidor.
 */
export type Vista =
  | { readonly tipo: "CHATS" }
  | { readonly tipo: "LOCAL"; readonly localId: number; readonly nombre?: string }
  | { readonly tipo: "GENERAL" };

const LOCAL_ID = /^[1-9][0-9]{0,9}$/;
/** Un nombre de local en la URL: texto corto, sin caracteres de control. Si no, se ignora. */
const MAX_NOMBRE = 80;
const nombreValido = (v: string | null): v is string => v !== null && v.trim().length > 0 && v.length <= MAX_NOMBRE && !/\p{Cc}/u.test(v);

/** La vista de la URL (`?vista=local&localId=N[&nombre=…]`, `?vista=general`). Cualquier otra cosa es la lista. */
export function leerVista(busqueda: string): Vista {
  const p = new URLSearchParams(busqueda);
  const vista = p.get("vista");
  if (vista === "general") return { tipo: "GENERAL" };
  const localId = p.get("localId");
  if (vista === "local" && localId !== null && LOCAL_ID.test(localId)) {
    const nombre = p.get("nombre");
    return nombreValido(nombre) ? { tipo: "LOCAL", localId: Number(localId), nombre: nombre.trim() } : { tipo: "LOCAL", localId: Number(localId) };
  }
  return { tipo: "CHATS" };
}

export function urlDeVista(v: Vista): string {
  switch (v.tipo) {
    case "CHATS":
      return "/";
    case "GENERAL":
      return "/?vista=general";
    case "LOCAL":
      return nombreValido(v.nombre ?? null)
        ? `/?${new URLSearchParams({ vista: "local", localId: String(v.localId), nombre: v.nombre!.trim() }).toString()}`
        : `/?vista=local&localId=${v.localId}`;
  }
}

/** El título de un Local: el de la API si ya contestó; si no, el que ya se conocía; si tampoco, "Chat". */
export function tituloDeLocal(deLaApi: string | null, conocido: string | undefined): string {
  return deLaApi ?? conocido ?? "Chat";
}
