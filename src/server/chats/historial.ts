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

export type PosicionHistorial = { readonly fecha: Date; readonly id: bigint };

/** Un id de evento que llega del navegador, como texto: entero positivo que entra en un BIGINT. */
export function leerIdEvento(v: unknown): bigint | null {
  if (typeof v !== "string" || !ID_EVENTO.test(v)) return null;
  const n = BigInt(v);
  return n <= MAX_BIGINT ? n : null;
}

export function codificarCursor(p: PosicionHistorial): string {
  return Buffer.from(JSON.stringify({ f: p.fecha.toISOString(), i: p.id.toString() }), "utf8").toString("base64url");
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
  if (Object.keys(o).length !== 2 || !esInstanteIso(o.f)) return null;
  const id = leerIdEvento(o.i);
  if (id === null) return null;
  return { fecha: new Date(o.f as string), id };
}

const SELECT_PUBLICO = { id: true, tipo: true, erpLocalId: true, erpReferenciaId: true, fechaOperacion: true, payload: true, historico: true } as const;
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
 * Una página del historial de esos locales (ya autorizados), del más reciente
 * al más antiguo, estrictamente después de `desde` en ese orden. De cada local,
 * solo los tipos que la persona puede ver hoy.
 */
export async function paginaDeHistorial(
  db: Db,
  instalacionId: string,
  locales: readonly LocalVisible[],
  desde: PosicionHistorial | null,
  porPagina = EVENTOS_POR_PAGINA,
): Promise<{ filas: { readonly evento: EventoPublico; readonly erpLocalId: number }[]; siguiente: string | null }> {
  const permitidos = visibles(locales);
  if (permitidos.length === 0) return { filas: [], siguiente: null };
  const filas = await db.evento.findMany({
    where: {
      instalacionId,
      AND: [
        { OR: permitidos },
        ...(desde ? [{ OR: [{ fechaOperacion: { lt: desde.fecha } }, { fechaOperacion: desde.fecha, id: { lt: desde.id } }] }] : []),
      ],
    },
    orderBy: [{ fechaOperacion: "desc" }, { id: "desc" }],
    take: porPagina + 1,
    select: SELECT_PUBLICO,
  });
  const pagina = filas.slice(0, porPagina);
  const ultima = pagina.at(-1);
  return {
    filas: pagina.map((f) => ({ evento: aEventoPublico(f), erpLocalId: f.erpLocalId })),
    siguiente: filas.length > porPagina && ultima ? codificarCursor({ fecha: ultima.fechaOperacion, id: ultima.id }) : null,
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
