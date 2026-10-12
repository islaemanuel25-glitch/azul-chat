// src/server/chats/historial.ts
//
// LEER LOS EVENTOS GUARDADOS DE LOCALES YA AUTORIZADOS, COMO LOS VE LA INTERFAZ.
//
// Ninguna función de acá decide quién puede ver qué: reciben la lista de
// locales que `autorizacion.ts` sacó de `mi_alcance` vivo, cada uno con los
// tipos de evento que la persona puede ver de él (Tanda 4B), y TODAS las
// consultas filtran por esa lista —local Y tipo— y por la instalación. Un
// PEDIDO_SOLICITADO guardado no se le muestra a quien no tiene
// `pedidos_eventos` anunciado en ese local, aunque vea sus transferencias.
//
// ── DOS ÓRDENES, DOS USOS ──────────────────────────────────────────────────
//
//   · Historial (lo que se ve): por `fechaOperacion` descendente —cuándo pasó
//     en el ERP— y, a igual fecha, por `Evento.id` descendente. Es un orden
//     total y estable aunque dos eventos tengan la misma fecha.
//   · Lectura (qué es nuevo): por `Evento.id`, la secuencia de ingesta. Eso
//     vive en eventos/lectura.ts. Un evento con fecha vieja que se conoció
//     tarde aparece en su lugar por fecha y cuenta como nuevo por id.
//
// ── EL CURSOR DEL HISTORIAL ────────────────────────────────────────────────
//
// Como el orden visual es (fecha, id), el cursor es la posición del último
// evento de la página: `{ f: fecha ISO, i: id }`, en JSON y base64url. Se
// valida estricto —exactamente esas dos claves, instante ISO válido, id entero
// positivo— y no lleva local ni instalación: no sirve para salir de los
// locales autorizados, porque la consulta los filtra siempre desde el servidor.
// No es el cursor del ERP, que nunca sale del servidor.
//
// ── TANDA 6C: LAS PREGUNTAS GUARDADAS, EN LA MISMA PÁGINA ───────────────────
//
// Una conversación muestra también las preguntas guardadas de la persona en
// ese chat, intercaladas por hora. Se pagina UNA sola secuencia: eventos por
// `fechaOperacion` y preguntas por `creadaEn`, del más reciente al más
// antiguo; a igual instante va primero la pregunta, y entre dos del mismo
// tipo, el de id mayor. Es un orden total, así que el cursor sigue siendo "la
// posición del último elemento de la página":
//
//   · si el último es un evento, el cursor es EXACTAMENTE el de antes,
//     `{ f, i }`: un cursor viejo (de una página abierta antes del despliegue)
//     sigue valiendo igual;
//   · si es una pregunta, `{ f, i, t: "p" }`.
//
// Cada página pide `porPagina + 1` de cada lado después del cursor, junta las
// dos listas en ese orden y se queda con las primeras `porPagina`: lo que
// sobra vuelve en la página siguiente, así que nada se repite ni se pierde.

import "server-only";

import type { Prisma, PrismaClient, TipoEvento } from "@prisma/client";

import type { EventoPublico } from "../../shared/chats/api.ts";
import { esInstanteIso } from "../../shared/erp/contrato.ts";
import {
  esPayloadPedidoSolicitadoV1,
  esPayloadTransferenciaCanceladaV1,
  esPayloadTransferenciaEnviadaV1,
} from "../eventos/pedidosEnviosCancelaciones.ts";
import { esPayloadTransferenciaRecibidaV1 } from "../eventos/transferenciaRecibida.ts";

/** Eventos por página de historial. */
export const EVENTOS_POR_PAGINA = 30;
/** Un cursor más largo que esto no se intenta leer. */
const MAX_LARGO_CURSOR = 200;
const ID_EVENTO = /^[1-9][0-9]{0,18}$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

/** La posición del último elemento de una página. `pregunta`: es una pregunta guardada (Tanda 6C); si no, un evento. */
export type PosicionHistorial = { readonly fecha: Date; readonly id: bigint; readonly pregunta?: true };

/** Un id de evento que llega del navegador, como texto: entero positivo que entra en un BIGINT. */
export function leerIdEvento(v: unknown): bigint | null {
  if (typeof v !== "string" || !ID_EVENTO.test(v)) return null;
  const n = BigInt(v);
  return n <= MAX_BIGINT ? n : null;
}

export function codificarCursor(p: PosicionHistorial): string {
  const datos = p.pregunta ? { f: p.fecha.toISOString(), i: p.id.toString(), t: "p" } : { f: p.fecha.toISOString(), i: p.id.toString() };
  return Buffer.from(JSON.stringify(datos), "utf8").toString("base64url");
}

/** El cursor que manda el navegador, o null si no tiene EXACTAMENTE la forma. */
export function decodificarCursor(texto: unknown): PosicionHistorial | null {
  if (typeof texto !== "string" || texto.length === 0 || texto.length > MAX_LARGO_CURSOR || !/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  let datos: unknown;
  try {
    datos = JSON.parse(Buffer.from(texto, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (datos === null || typeof datos !== "object" || Array.isArray(datos)) return null;
  const o = datos as Record<string, unknown>;
  const claves = Object.keys(o).length;
  // Dos claves: un evento (el cursor de siempre). Tres: una pregunta guardada, con `t: "p"` y nada más.
  if (!(claves === 2 || (claves === 3 && o.t === "p")) || !esInstanteIso(o.f)) return null;
  const id = leerIdEvento(o.i);
  if (id === null) return null;
  return claves === 3 ? { fecha: new Date(o.f as string), id, pregunta: true } : { fecha: new Date(o.f as string), id };
}

export const SELECT_PUBLICO = { id: true, tipo: true, erpLocalId: true, erpReferenciaId: true, fechaOperacion: true, payload: true, historico: true } as const;
type FilaPublica = Prisma.EventoGetPayload<{ select: typeof SELECT_PUBLICO }>;

/** Un evento guardado que no se puede leer no se muestra a medias. */
const ilegible = (): never => {
  throw new Error("evento guardado ilegible");
};

/**
 * Una fila → lo que ve la interfaz. Sin instalación, clave externa, versión ni
 * fecha de ingesta; de `historico`, solo el booleano (para no contar historia
 * como no leída). De cada tipo, solo lo que se muestra.
 */
export function aEventoPublico(f: FilaPublica): EventoPublico {
  const base = { id: f.id.toString(), fecha: f.fechaOperacion.toISOString(), historico: f.historico };
  const p = f.payload;
  switch (f.tipo) {
    case "TRANSFERENCIA_RECIBIDA":
      if (!esPayloadTransferenciaRecibidaV1(p)) return ilegible();
      return {
        ...base,
        tipo: "TRANSFERENCIA_RECIBIDA",
        transferenciaId: f.erpReferenciaId,
        origen: { id: p.origen.id, nombre: p.origen.nombre, esDeposito: p.origen.esDeposito },
        destino: { id: p.destino.id, nombre: p.destino.nombre },
        tieneDiferencias: p.tieneDiferencias,
        lineasConDiferencia: p.lineasConDiferencia,
      };
    case "PEDIDO_SOLICITADO":
      if (!esPayloadPedidoSolicitadoV1(p)) return ilegible();
      return { ...base, tipo: "PEDIDO_SOLICITADO", pedidoId: f.erpReferenciaId, origen: { id: p.origen.id, nombre: p.origen.nombre }, lineas: p.lineas };
    case "TRANSFERENCIA_ENVIADA":
      if (!esPayloadTransferenciaEnviadaV1(p)) return ilegible();
      return {
        ...base,
        tipo: "TRANSFERENCIA_ENVIADA",
        transferenciaId: f.erpReferenciaId,
        origen: { id: p.origen.id, nombre: p.origen.nombre },
        lineas: p.lineas,
      };
    case "TRANSFERENCIA_CANCELADA":
      if (!esPayloadTransferenciaCanceladaV1(p)) return ilegible();
      return { ...base, tipo: "TRANSFERENCIA_CANCELADA", transferenciaId: f.erpReferenciaId, origen: { id: p.origen.id, nombre: p.origen.nombre } };
  }
}

type Db = Pick<PrismaClient, "evento">;

/** Un local autorizado ahora, con los tipos de evento que la persona puede ver de él (autorizacion.ts). */
export type LocalVisible = { readonly localId: number; readonly tipos: readonly TipoEvento[] };

/** El filtro de visibilidad: de cada local, solo sus tipos visibles. */
const visibles = (locales: readonly LocalVisible[]): Prisma.EventoWhereInput[] =>
  locales.filter((l) => l.tipos.length > 0).map((l) => ({ erpLocalId: l.localId, tipo: { in: [...l.tipos] } }));

/**
 * Tanda 6C: las preguntas guardadas de la conversación, ya filtradas por lo que
 * la persona puede ver hoy, estrictamente después de `desde` en el orden del
 * historial, a lo sumo `limite` (preguntas/guardadas.ts).
 */
export type FuenteDePreguntas<P> = (desde: PosicionHistorial | null, limite: number) => Promise<readonly { readonly fecha: Date; readonly id: bigint; readonly pregunta: P }[]>;

/** ¿`a` va antes que `b` en el historial? A igual instante, la pregunta primero; después, el id mayor. */
export function antes(a: PosicionHistorial, b: PosicionHistorial): boolean {
  if (a.fecha.getTime() !== b.fecha.getTime()) return a.fecha > b.fecha;
  if (Boolean(a.pregunta) !== Boolean(b.pregunta)) return Boolean(a.pregunta);
  return a.id > b.id;
}

/** Los eventos estrictamente después de `desde`: si `desde` es una pregunta, todo lo de su mismo instante va después. */
const eventosDespuesDe = (desde: PosicionHistorial): Prisma.EventoWhereInput =>
  desde.pregunta
    ? { fechaOperacion: { lte: desde.fecha } }
    : { OR: [{ fechaOperacion: { lt: desde.fecha } }, { fechaOperacion: desde.fecha, id: { lt: desde.id } }] };

/**
 * Los eventos que la persona puede ver de esos locales (de cada uno, sus tipos
 * visibles), y además `filtro` si viene (Tanda 10: lo que se busca). Null: no
 * puede ver ninguno, y no hace falta preguntarle a la base.
 */
export function eventosVisibles(instalacionId: string, locales: readonly LocalVisible[], filtro?: Prisma.EventoWhereInput): Prisma.EventoWhereInput | null {
  const permitidos = visibles(locales);
  if (permitidos.length === 0) return null;
  return { instalacionId, AND: [{ OR: permitidos }, ...(filtro ? [filtro] : [])] };
}

/**
 * Una página del historial de esos locales (ya autorizados), del más reciente
 * al más antiguo, estrictamente después de `desde` en ese orden. De cada local,
 * solo los tipos que la persona puede ver hoy. Tanda 6C: con `preguntas`, la
 * página intercala las preguntas guardadas por hora (ver arriba). Tanda 10:
 * con `filtro`, solo los eventos que además lo cumplen (la búsqueda).
 */
export async function paginaDeHistorial<P = never>(
  db: Db,
  instalacionId: string,
  locales: readonly LocalVisible[],
  desde: PosicionHistorial | null,
  porPagina = EVENTOS_POR_PAGINA,
  preguntas?: FuenteDePreguntas<P>,
  filtro?: Prisma.EventoWhereInput,
): Promise<{ filas: { readonly evento: EventoPublico; readonly erpLocalId: number }[]; preguntas: P[]; siguiente: string | null }> {
  const permitidos = eventosVisibles(instalacionId, locales, filtro);
  const eventos =
    permitidos === null
      ? []
      : await db.evento.findMany({
          where: { AND: [permitidos, ...(desde ? [eventosDespuesDe(desde)] : [])] },
          orderBy: [{ fechaOperacion: "desc" }, { id: "desc" }],
          take: porPagina + 1,
          select: SELECT_PUBLICO,
        });
  const guardadas = preguntas ? await preguntas(desde, porPagina + 1) : [];

  // Las dos listas ya vienen en el orden del historial: se juntan y se cortan.
  type Elemento = { readonly pos: PosicionHistorial } & ({ readonly evento: (typeof eventos)[number] } | { readonly pregunta: P });
  const todos: Elemento[] = [
    ...eventos.map((f) => ({ pos: { fecha: f.fechaOperacion, id: f.id }, evento: f })),
    ...guardadas.map((g) => ({ pos: { fecha: g.fecha, id: g.id, pregunta: true as const }, pregunta: g.pregunta })),
  ].sort((a, b) => (antes(a.pos, b.pos) ? -1 : 1));
  const pagina = todos.slice(0, porPagina);
  const ultima = pagina.at(-1);
  return {
    filas: pagina.flatMap((e) => ("evento" in e ? [{ evento: aEventoPublico(e.evento), erpLocalId: e.evento.erpLocalId }] : [])),
    preguntas: pagina.flatMap((e) => ("pregunta" in e ? [e.pregunta] : [])),
    siguiente: todos.length > porPagina && ultima ? codificarCursor(ultima.pos) : null,
  };
}

/** El último evento visible de un local (por fecha y, a igual fecha, por id), de sus tipos visibles, o null. */
export async function ultimoEventoDe(db: Db, instalacionId: string, local: LocalVisible): Promise<EventoPublico | null> {
  if (local.tipos.length === 0) return null;
  const f = await db.evento.findFirst({
    where: { instalacionId, erpLocalId: local.localId, tipo: { in: [...local.tipos] } },
    orderBy: [{ fechaOperacion: "desc" }, { id: "desc" }],
    select: SELECT_PUBLICO,
  });
  return f ? aEventoPublico(f) : null;
}

/** ¿`a` va antes que `b` en el historial (más reciente primero)? */
export function masReciente(a: EventoPublico, b: EventoPublico): boolean {
  if (a.fecha !== b.fecha) return a.fecha > b.fecha;
  return BigInt(a.id) > BigInt(b.id);
}
