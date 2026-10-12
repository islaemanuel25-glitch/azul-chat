// src/server/preguntas/guardadas.ts
//
// LAS PREGUNTAS GUARDADAS CON SU RESPUESTA (Tanda 6C). Solo servidor.
//
// Pedido del dueño: "una vez que salgo y vuelvo a entrar no queda guardado".
// Cada pregunta contestada se guarda con EXACTAMENTE la respuesta que vio la
// pantalla, por persona (vínculo) y por chat (el Local donde se preguntó, o
// General). Es una foto: al volver a verla no se recalcula nada, y la pantalla
// muestra cuándo se preguntó.
//
// ── MOSTRAR NO ES LO MISMO QUE GUARDAR ─────────────────────────────────────
//
// Una pregunta guardada trae datos de locales: ventas, eventos. Para MOSTRARLA
// hoy, cada local del que trae datos tiene que seguir anunciado hoy por
// `mi_alcance`, con la capacidad de esos datos (`requisitos`, que se escriben
// al guardar). Si alguno ya no está, la pregunta no se muestra: fallo cerrado,
// como los eventos. Un requisito ilegible también la oculta.
//
// No cuentan como no leídos, no disparan push y no marcan leído: nada de eso
// mira esta tabla. Se borran a los 90 días en la corrida de fondo
// (`borrarPreguntasVencidas`), y mientras tanto la lectura ya no las muestra.

import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { ESTADOS_GUARDADOS, type PreguntaGuardada, type RespuestaGuardada, type RespuestaPregunta } from "../../shared/chats/preguntas.ts";
import type { PosicionHistorial } from "../chats/historial.ts";
import { CAPACIDAD_VENTAS_RESUMEN } from "../erp/ventasResumen.ts";
import { CAPACIDAD_CAJAS_RESUMEN } from "../erp/cajasResumen.ts";
import { CAPACIDAD_STOCK_CONSULTA } from "../erp/stockConsulta.ts";
import { EVENTO_DE_PREGUNTA, type Intencion } from "./intencion.ts";

/**
 * La forma del `resultado` que se guarda. Cambiarla es subir este número y
 * saber leer los dos. Tanda 7B: la 2 agrega los estados CAJA y VENTAS_TURNO;
 * los de la 1 no cambiaron, así que una fila de la 1 se sigue leyendo igual.
 * Tanda 8B: la 3 agrega STOCK, y tampoco cambia los de antes.
 */
export const VERSION_RESULTADO = 3;
/** Las versiones que se saben leer. */
export const VERSIONES_LEGIBLES: readonly number[] = Object.freeze([1, 2, 3]);
/** Los estados que existían en la versión 1: una fila v1 con otro estado no se muestra. */
const ESTADOS_V1: readonly string[] = ["VENTAS", "EVENTOS", "NO_ENTIENDO", "SALDO_AGOTADO", "IA_NO_DISPONIBLE", "ERP_NO_DISPONIBLE", "ERP_CUPO_EXCEDIDO"];
/** Los de la versión 2: los de la 1, CAJA y VENTAS_TURNO. Una fila v2 con STOCK no se muestra. */
const ESTADOS_V2: readonly string[] = [...ESTADOS_V1, "CAJA", "VENTAS_TURNO"];
/** Cuántos días se guarda una pregunta. */
export const DIAS_DE_RETENCION = 90;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, "pregunta">;

/** De qué local y con qué capacidad trae datos una respuesta. */
export type Requisito = { readonly localId: number; readonly capacidad: string };

/** Lo que la persona puede ver hoy, como lo dice `mi_alcance` (chats/autorizacion.ts). */
export type AlcanceDeHoy = {
  readonly autorizados: readonly { readonly localId: number; readonly capacidades: readonly string[] }[];
  readonly conVentas: readonly { readonly localId: number }[];
  /** Tanda 7B: los locales con `cajas_resumen` hoy. */
  readonly conCaja: readonly { readonly localId: number }[];
  /** Tanda 8B: los locales con `stock_consulta` hoy. */
  readonly conStock: readonly { readonly localId: number }[];
};

const esGuardable = (r: RespuestaPregunta): r is RespuestaGuardada => (ESTADOS_GUARDADOS as readonly string[]).includes(r.estado);

/**
 * Los requisitos de una respuesta: cada local CONSULTADO para contestarla
 * (también los que fallaron: la respuesta los nombra), con la capacidad. Sin
 * datos de locales (no entendí, saldo, IA caída), ninguno.
 */
export function requisitosDe(intencion: Intencion | null, respuesta: RespuestaGuardada): Requisito[] {
  if (!intencion || intencion.tipo === "NO_ENTIENDO") return [];
  if (respuesta.estado === "NO_ENTIENDO" || respuesta.estado === "SALDO_AGOTADO" || respuesta.estado === "IA_NO_DISPONIBLE") return [];
  // Tanda 7B: caja y ventas de un turno salen de `cajas_resumen`; para mostrarlas hoy hace falta esa capacidad.
  // Tanda 8B: stock, de `stock_consulta`.
  if (intencion.tipo === "STOCK") return intencion.locales.map((l) => ({ localId: l.localId, capacidad: CAPACIDAD_STOCK_CONSULTA }));
  if (intencion.tipo === "CAJA") return intencion.locales.map((l) => ({ localId: l.localId, capacidad: CAPACIDAD_CAJAS_RESUMEN }));
  if (intencion.tipo === "VENTAS") {
    if (intencion.porTurno) return intencion.porTurno.locales.map((l) => ({ localId: l.localId, capacidad: CAPACIDAD_CAJAS_RESUMEN }));
    return intencion.locales.map((l) => ({ localId: l.localId, capacidad: CAPACIDAD_VENTAS_RESUMEN }));
  }
  const { capacidad } = EVENTO_DE_PREGUNTA[intencion.tipoEvento];
  return intencion.locales.map((l) => ({ localId: l.localId, capacidad }));
}

/** ¿Todos los requisitos siguen anunciados hoy? Una lista ilegible es que no. */
export function cumpleRequisitos(requisitos: unknown, hoy: AlcanceDeHoy): boolean {
  if (!Array.isArray(requisitos)) return false;
  return requisitos.every((r: unknown) => {
    if (r === null || typeof r !== "object") return false;
    const { localId, capacidad } = r as Record<string, unknown>;
    if (typeof localId !== "number" || typeof capacidad !== "string") return false;
    if (capacidad === CAPACIDAD_VENTAS_RESUMEN) return hoy.conVentas.some((l) => l.localId === localId);
    if (capacidad === CAPACIDAD_CAJAS_RESUMEN) return hoy.conCaja.some((l) => l.localId === localId);
    if (capacidad === CAPACIDAD_STOCK_CONSULTA) return hoy.conStock.some((l) => l.localId === localId);
    return hoy.autorizados.some((l) => l.localId === localId && l.capacidades.includes(capacidad));
  });
}

/**
 * Guarda la pregunta con su respuesta, si es de las que se guardan. Devuelve
 * el id, o null si no se guardó. `creadaEn` lo pone quien llama (el reloj de
 * las dependencias), no la base.
 */
export async function guardarPregunta(
  db: Db,
  p: {
    readonly vinculoId: string;
    readonly erpLocalId: number | null;
    readonly texto: string;
    readonly creadaEn: Date;
    readonly respuesta: RespuestaPregunta;
    readonly intencion: Intencion | null;
  },
): Promise<bigint | null> {
  if (!esGuardable(p.respuesta)) return null;
  const fila = await db.pregunta.create({
    data: {
      vinculoId: p.vinculoId,
      erpLocalId: p.erpLocalId,
      texto: p.texto,
      creadaEn: p.creadaEn,
      resultadoVersion: VERSION_RESULTADO,
      resultado: p.respuesta as unknown as Prisma.InputJsonValue,
      requisitos: requisitosDe(p.intencion, p.respuesta) as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return fila.id;
}

/** Una fila → lo que ve la pantalla, o null si no se puede leer (no se muestra a medias). */
function aPreguntaGuardada(f: { id: bigint; texto: string; creadaEn: Date; resultadoVersion: number; resultado: Prisma.JsonValue }): PreguntaGuardada | null {
  if (!VERSIONES_LEGIBLES.includes(f.resultadoVersion)) return null;
  const r = f.resultado;
  if (r === null || typeof r !== "object" || Array.isArray(r)) return null;
  const estados: readonly unknown[] = f.resultadoVersion === 1 ? ESTADOS_V1 : f.resultadoVersion === 2 ? ESTADOS_V2 : ESTADOS_GUARDADOS;
  if (!estados.includes((r as Record<string, unknown>).estado)) return null;
  return { id: f.id.toString(), pregunta: f.texto, creadaEn: f.creadaEn.toISOString(), respuesta: r as unknown as RespuestaGuardada };
}

/** Desde cuándo una pregunta todavía se guarda. */
export const limiteDeRetencion = (ahora: Date) => new Date(ahora.getTime() - DIAS_DE_RETENCION * UN_DIA_MS);

/**
 * Las preguntas guardadas de esta persona en este chat (`erpLocalId`, o null
 * para General) que hoy se pueden mostrar, estrictamente después de `desde` en
 * el orden del historial (chats/historial.ts), a lo sumo `limite`. Las que no
 * cumplen sus requisitos se saltean y se sigue buscando: que se oculten no
 * corta la paginación.
 */
export function fuenteDePreguntas(
  db: Db,
  q: { readonly vinculoId: string; readonly erpLocalId: number | null; readonly hoy: AlcanceDeHoy; readonly ahora: Date },
) {
  return async (desde: PosicionHistorial | null, limite: number) => {
    const salida: { fecha: Date; id: bigint; pregunta: PreguntaGuardada }[] = [];
    let cursor = desde;
    for (;;) {
      // Si `desde` es un evento, las preguntas de su mismo instante van ANTES que él: ya se mostraron.
      const despues: Prisma.PreguntaWhereInput[] = cursor
        ? cursor.pregunta
          ? [{ OR: [{ creadaEn: { lt: cursor.fecha } }, { creadaEn: cursor.fecha, id: { lt: cursor.id } }] }]
          : [{ creadaEn: { lt: cursor.fecha } }]
        : [];
      const filas = await db.pregunta.findMany({
        where: { vinculoId: q.vinculoId, erpLocalId: q.erpLocalId, AND: [{ creadaEn: { gte: limiteDeRetencion(q.ahora) } }, ...despues] },
        orderBy: [{ creadaEn: "desc" }, { id: "desc" }],
        take: limite,
        select: { id: true, texto: true, creadaEn: true, resultadoVersion: true, resultado: true, requisitos: true },
      });
      for (const f of filas) {
        if (!cumpleRequisitos(f.requisitos, q.hoy)) continue;
        const p = aPreguntaGuardada(f);
        if (p) salida.push({ fecha: f.creadaEn, id: f.id, pregunta: p });
        if (salida.length === limite) return salida;
      }
      const ultima = filas.at(-1);
      if (filas.length < limite || !ultima) return salida;
      cursor = { fecha: ultima.creadaEn, id: ultima.id, pregunta: true };
    }
  };
}

/** La retención: borra las preguntas de más de 90 días. Solo esta tabla. Devuelve cuántas. */
export async function borrarPreguntasVencidas(db: Db, ahora: Date): Promise<number> {
  const r = await db.pregunta.deleteMany({ where: { creadaEn: { lt: limiteDeRetencion(ahora) } } });
  return r.count;
}
