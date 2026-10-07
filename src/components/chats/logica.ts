// LO QUE DECIDEN LAS PANTALLAS DE CHATS, SIN REACT.
//
// Qué filas tiene la lista, en qué orden se ve una conversación, cómo se juntan
// las páginas, hasta dónde se marca leído y qué se hace con cada falla. Las
// pantallas solo llaman a esto y dibujan; los tests (test/ui/) lo ejercen sin
// navegador.
//
// Los ids de evento son BigInt en la base y viajan como TEXTO: acá se comparan
// con BigInt y no se convierten nunca a Number.

import type { EstadoSincronizacion, EventoGeneral, EventoPublico, LocalDeChats, RespuestaChats } from "../../shared/chats/api.ts";
import type { FallaCliente } from "./clienteChats.ts";

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

/** El mayor Evento.id de esos eventos, o null. */
export function mayorId(eventos: readonly EventoPublico[]): string | null {
  let mayor: string | null = null;
  for (const e of eventos) if (mayor === null || compararIds(e.id, mayor) > 0) mayor = e.id;
  return mayor;
}

export type Marca = { readonly localId: number; readonly hastaEventoId: string };

/**
 * La marca de leído de un Local: hasta el mayor Evento.id que la pantalla
 * MOSTRÓ. Sin eventos mostrados, ninguna. Si ya estaba leído hasta ahí, ninguna
 * (no hace falta pedir nada).
 */
export function marcaDeLocal(localId: number, mostrados: readonly EventoPublico[], leidoHasta: string): Marca | null {
  const hasta = mayorId(mostrados);
  if (hasta === null || compararIds(hasta, leidoHasta) <= 0) return null;
  return { localId, hastaEventoId: hasta };
}

/**
 * Las marcas de General: UNA POR LOCAL, cada una hasta el mayor Evento.id de
 * ESE local entre los mostrados. Nunca un máximo común: los ids son de una
 * sola secuencia y el de un local no dice nada de otro. Un local sin eventos
 * mostrados no se marca.
 */
export function marcasDeGeneral(mostrados: readonly EventoGeneral[]): Marca[] {
  const porLocal = new Map<number, EventoGeneral[]>();
  for (const e of mostrados) porLocal.set(e.local.localId, [...(porLocal.get(e.local.localId) ?? []), e]);
  return [...porLocal.entries()].sort(([a], [b]) => a - b).map(([localId, eventos]) => ({ localId, hastaEventoId: mayorId(eventos)! }));
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
};
export type InfoGeneral = { readonly tipo: "GENERAL"; readonly localesDemorados: readonly number[]; readonly noLeidos: number };

export type EstadoConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral> =
  | { readonly fase: "CARGANDO" }
  /** Sin historial detrás: la falla reemplaza la vista. */
  | { readonly fase: "FALLA"; readonly falla: FallaCliente }
  | {
      readonly fase: "LISTA";
      /** En el orden de la API: del más reciente al más antiguo. */
      readonly eventos: readonly E[];
      readonly siguiente: string | null;
      readonly anteriores: "QUIETO" | "CARGANDO" | "SIN_RED";
      readonly info: I;
    };

export type AccionConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral> =
  | { readonly tipo: "CARGANDO" }
  | { readonly tipo: "CARGADA"; readonly eventos: readonly E[]; readonly siguiente: string | null; readonly info: I }
  | { readonly tipo: "PIDIENDO_ANTERIORES" }
  | { readonly tipo: "ANTERIORES"; readonly eventos: readonly E[]; readonly siguiente: string | null }
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
      return { fase: "LISTA", eventos: accion.eventos, siguiente: accion.siguiente, anteriores: "QUIETO", info: accion.info };
    case "PIDIENDO_ANTERIORES":
      return estado.fase === "LISTA" ? { ...estado, anteriores: "CARGANDO" } : estado;
    case "ANTERIORES":
      if (estado.fase !== "LISTA") return estado;
      return { ...estado, eventos: unirPaginas(estado.eventos, accion.eventos), siguiente: accion.siguiente, anteriores: "QUIETO" };
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

/**
 * Qué marcar AHORA: solo con la conversación ya mostrada (fase LISTA). Cargando,
 * o con una falla en pantalla, nada. Las pantallas lo llaman desde un efecto,
 * que corre después de dibujar.
 */
export function marcasDeEstado<E extends EventoPublico, I extends InfoLocal | InfoGeneral>(
  estado: EstadoConversacion<E, I>,
  calcular: (lista: Extract<EstadoConversacion<E, I>, { fase: "LISTA" }>) => Marca[],
): Marca[] {
  return estado.fase === "LISTA" ? calcular(estado) : [];
}

// ── Qué hacer con una falla ─────────────────────────────────────────────────

export type DestinoDeFalla =
  /** Volver al flujo de sesión (vincular). */
  | "SESION"
  /** P1: el ERP no respondió. Sin historial. */
  | "ERP_NO_DISPONIBLE"
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

// ── Navegación ──────────────────────────────────────────────────────────────

export type Vista = { readonly tipo: "CHATS" } | { readonly tipo: "LOCAL"; readonly localId: number } | { readonly tipo: "GENERAL" };

const LOCAL_ID = /^[1-9][0-9]{0,9}$/;

/** La vista de la URL (`?vista=local&localId=N`, `?vista=general`). Cualquier otra cosa es la lista. */
export function leerVista(busqueda: string): Vista {
  const p = new URLSearchParams(busqueda);
  const vista = p.get("vista");
  if (vista === "general") return { tipo: "GENERAL" };
  const localId = p.get("localId");
  if (vista === "local" && localId !== null && LOCAL_ID.test(localId)) return { tipo: "LOCAL", localId: Number(localId) };
  return { tipo: "CHATS" };
}

export function urlDeVista(v: Vista): string {
  switch (v.tipo) {
    case "CHATS":
      return "/";
    case "GENERAL":
      return "/?vista=general";
    case "LOCAL":
      return `/?vista=local&localId=${v.localId}`;
  }
}
