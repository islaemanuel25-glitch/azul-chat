// LO QUE DECIDEN LAS PANTALLAS DE CHATS, SIN REACT.
//
// Qué filas tiene la lista, en qué orden se ve una conversación, cómo se juntan
// las páginas, si se puede marcar leído y qué se hace con cada falla. Las
// pantallas solo llaman a esto y dibujan; los tests (test/ui/) lo ejercen sin
// navegador.
//
// Los ids de evento son BigInt en la base y viajan como TEXTO: acá se comparan
// con BigInt y no se convierten nunca a Number.

import type { EstadoSincronizacion, EventoGeneral, EventoPublico, LocalDeChats, RespuestaChats, RespuestaVentas } from "../../shared/chats/api.ts";
import type { FallaCliente, Resultado } from "./clienteChats.ts";

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
};
/** General no lleva lectura: en la Tanda 2C no marca leído (docs/INTERFAZ.md). */
export type InfoGeneral = { readonly tipo: "GENERAL"; readonly localesDemorados: readonly number[] };

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
  | { readonly fase: "FALLA" };

export type AccionVentas =
  | { readonly tipo: "PEDIR" }
  | { readonly tipo: "RESPUESTA"; readonly resultado: Resultado<Extract<RespuestaVentas, { estado: "OK" }>> };

/** Qué se ve después de pedir o de recibir. Una respuesta sin pedido en curso no cambia nada. */
export function reducirVentas(estado: EstadoVentas, accion: AccionVentas): EstadoVentas {
  if (accion.tipo === "PEDIR") return { fase: "CARGANDO" };
  if (estado.fase !== "CARGANDO") return estado;
  const r = accion.resultado;
  if (r.ok) return { fase: "LISTA", ventas: r.datos };
  // Cancelada: la pantalla se fue o se volvió a pedir; no es una falla que mostrar.
  if (r.falla.estado === "CANCELADA") return { fase: "QUIETO" };
  return { fase: "FALLA" };
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
