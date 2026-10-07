// src/server/eventos/ingesta.ts
//
// LA INGESTA DE TRANSFERENCIA_RECIBIDA DE UN LOCAL: TRAER, VALIDAR Y GUARDAR
// UNA VEZ.
//
// `sincronizarTransferenciasLocal` NO decide si alguien puede ver ese local:
// recibe el local ya autorizado (eso lo decide la capa de arriba con
// `mi_alcance` vivo) y una función que llama al ERP con la delegación de quien
// pregunta. El ERP vuelve a autorizar esa llamada igual.
//
// ── UNA PÁGINA, UN CICLO ───────────────────────────────────────────────────
//
//   1. ARRIENDO: un UPDATE atómico sobre la fila del cursor que solo prospera
//      si está libre o vencido (arrendadoHasta = ahora + 30 s, arrendadoPor =
//      un id de esta ejecución). Si no prospera, otro está sincronizando: no se
//      llama al ERP. Sin Redis y sin transacción abierta durante la llamada.
//   2. Se lee el cursor y se llama al ERP con él, tal cual lo devolvió.
//   3. La página se valida entera contra lo pedido (pagina.ts). Si falla, no
//      se guarda nada y el cursor no se mueve.
//   4. UNA transacción: se bloquea la fila del cursor y se comprueba que el
//      arriendo SIGA SIENDO PROPIO; si no, rollback. Se insertan los eventos
//      ignorando los que ya existen (unique instalación + clave externa), se
//      guarda el `siguiente` del ERP como cursor, se marca el backfill si
//      corresponde, se limpia el error anterior y se libera el arriendo.
//
// Un fallo (del ERP, de la página o local) libera el arriendo, deja el cursor
// donde estaba y anota el CÓDIGO en el cursor. Nunca un mensaje. Y no se
// reintenta: reintentar lo decide la persona (CLAUDE.md).
//
// ── HISTÓRICO ──────────────────────────────────────────────────────────────
//
// Sin cursor, el ERP devuelve la historia desde el evento más viejo. Mientras
// `backfillCompletoEn` sea null, todo lo que se ingiere es `historico`, aunque
// la historia lleve varias visitas. La primera página con `hayMas: false` lo
// completa. Lo que entra después ya no es histórico, y lo histórico no cambia.

import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  CAPACIDAD_TRANSFERENCIAS_EVENTOS,
  esCursorTransferencias,
  type CursorTransferencias,
  type DatosTransferenciasEventos,
  type FalloErp,
  type FalloLocal,
  type ResultadoConsulta,
} from "../../shared/erp/contrato.ts";
import type { EntradaTransferenciasEventos } from "../erp/transferenciasEventos.ts";
import { validarPagina, type MotivoPaginaInvalida } from "./pagina.ts";
import { aFilaEvento } from "./transferenciaRecibida.ts";

/** Lo que dura un arriendo. Más que el timeout del cliente ERP (10 s): una llamada colgada no lo pierde. */
export const DURACION_ARRIENDO_MS = 30_000;
/** Por página, lo máximo que acepta el ERP. */
export const LIMITE_POR_PAGINA = 100;
/** Páginas por sincronización: una historia larga se completa en varias visitas, sin gastar el cupo del ERP de una vez. */
export const MAX_PAGINAS_POR_SINCRONIZACION = 3;

export type ConsultarPagina = (entrada: EntradaTransferenciasEventos) => Promise<ResultadoConsulta<DatosTransferenciasEventos>>;

export type ResultadoSincronizacion =
  /** Se guardó al menos una página. `hayMas`: el ERP tiene más, para la próxima visita. */
  | { readonly tipo: "SINCRONIZADO"; readonly paginas: number; readonly eventosNuevos: number; readonly hayMas: boolean; readonly backfillCompleto: boolean }
  /** Otra ejecución tiene el arriendo: no se llamó al ERP. */
  | { readonly tipo: "OCUPADO"; readonly paginas: number; readonly eventosNuevos: number }
  /** El ERP (o el cliente) contestó un fallo. `fallo` es el resultado tal cual, para el flujo de invalidación del vínculo. */
  | { readonly tipo: "FALLO_ERP"; readonly fallo: FalloErp | FalloLocal; readonly paginas: number; readonly eventosNuevos: number }
  /** La página no cumplió el contrato: no se guardó nada de ella. */
  | { readonly tipo: "RESPUESTA_INVALIDA"; readonly motivo: MotivoPaginaInvalida | "CURSOR_GUARDADO_INVALIDO"; readonly paginas: number; readonly eventosNuevos: number }
  /** Otra ejecución tomó el arriendo vencido antes de que esta guardara: no se avanzó nada. */
  | { readonly tipo: "ARRIENDO_PERDIDO"; readonly paginas: number; readonly eventosNuevos: number }
  /** La base de Azul Chat falló. Sin mensaje: puede llevar cualquier cosa. */
  | { readonly tipo: "FALLA_LOCAL"; readonly paginas: number; readonly eventosNuevos: number };

export type EntradaSincronizacion = {
  readonly db: PrismaClient;
  readonly instalacionId: string;
  /** El local YA AUTORIZADO por la capa de arriba, con el grupo que el ERP acepta. */
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  /** Llama al ERP con la delegación de quien pregunta. */
  readonly consultar: ConsultarPagina;
  readonly ahora: () => number;
  /** Un id único por ejecución, para el arriendo. */
  readonly generarId: () => string;
  readonly limitePorPagina?: number;
  readonly maxPaginas?: number;
};

class ArriendoPerdido extends Error {}

type Ciclo =
  | { tipo: "PAGINA"; eventosNuevos: number; hayMas: boolean; backfillCompleto: boolean }
  | Exclude<ResultadoSincronizacion, { tipo: "SINCRONIZADO" }>;

export async function sincronizarTransferenciasLocal(entrada: EntradaSincronizacion): Promise<ResultadoSincronizacion> {
  const maxPaginas = entrada.maxPaginas ?? MAX_PAGINAS_POR_SINCRONIZACION;
  let paginas = 0;
  let eventosNuevos = 0;
  let ultimo: Extract<Ciclo, { tipo: "PAGINA" }> | null = null;
  while (paginas < maxPaginas) {
    const c = await unaPagina(entrada);
    if (c.tipo !== "PAGINA") {
      // Lo guardado en páginas anteriores queda: cada página es su propia transacción.
      return { ...c, paginas, eventosNuevos };
    }
    paginas += 1;
    eventosNuevos += c.eventosNuevos;
    ultimo = c;
    if (!c.hayMas) break;
  }
  return {
    tipo: "SINCRONIZADO",
    paginas,
    eventosNuevos,
    hayMas: ultimo?.hayMas ?? false,
    backfillCompleto: ultimo?.backfillCompleto ?? false,
  };
}

async function unaPagina(e: EntradaSincronizacion): Promise<Ciclo> {
  const { db, instalacionId } = e;
  const erpLocalId = e.alcance.localId;
  const limite = e.limitePorPagina ?? LIMITE_POR_PAGINA;
  const clave = { instalacionId, erpLocalId, capacidad: CAPACIDAD_TRANSFERENCIAS_EVENTOS };
  const yo = e.generarId();

  // 1. El arriendo.
  let fila: { id: string; cursor: Prisma.JsonValue | null };
  try {
    await db.cursorIngesta.createMany({ data: [clave], skipDuplicates: true });
    const ahora = new Date(e.ahora());
    const tomado = await db.cursorIngesta.updateMany({
      where: { ...clave, OR: [{ arrendadoHasta: null }, { arrendadoHasta: { lt: ahora } }] },
      data: { arrendadoHasta: new Date(ahora.getTime() + DURACION_ARRIENDO_MS), arrendadoPor: yo },
    });
    if (tomado.count !== 1) return { tipo: "OCUPADO", paginas: 0, eventosNuevos: 0 };
    const leida = await db.cursorIngesta.findUnique({
      where: { instalacionId_erpLocalId_capacidad: clave },
      select: { id: true, cursor: true },
    });
    if (!leida) throw new Error("cursor desaparecido");
    fila = leida;
  } catch {
    return { tipo: "FALLA_LOCAL", paginas: 0, eventosNuevos: 0 };
  }

  /** Suelta el arriendo SI sigue siendo propio, y anota el código. El cursor no se toca. */
  const soltarConError = async (codigo: string) => {
    try {
      await db.cursorIngesta.updateMany({
        where: { id: fila.id, arrendadoPor: yo },
        data: { arrendadoHasta: null, arrendadoPor: null, ultimoErrorCodigo: codigo, ultimoErrorEn: new Date(e.ahora()) },
      });
    } catch {
      // Si ni esto se puede, el arriendo vence solo en 30 s.
    }
  };

  // 2. El cursor guardado, tal cual vino del ERP.
  let desde: CursorTransferencias | null = null;
  if (fila.cursor !== null) {
    if (!esCursorTransferencias(fila.cursor)) {
      await soltarConError("RESPUESTA_INVALIDA");
      return { tipo: "RESPUESTA_INVALIDA", motivo: "CURSOR_GUARDADO_INVALIDO", paginas: 0, eventosNuevos: 0 };
    }
    desde = fila.cursor;
  }

  const r = await e.consultar({ alcance: e.alcance, desde, limite });
  if (!r.ok) {
    await soltarConError(r.codigo);
    return { tipo: "FALLO_ERP", fallo: r, paginas: 0, eventosNuevos: 0 };
  }

  // 3. La página, entera.
  const pagina = validarPagina(r.datos, { localId: erpLocalId, desde, limite });
  if (!pagina.ok) {
    await soltarConError(pagina.codigo);
    return { tipo: "RESPUESTA_INVALIDA", motivo: pagina.motivo, paginas: 0, eventosNuevos: 0 };
  }
  const { datos } = pagina;
  const nuevas = datos.eventos.map(aFilaEvento);

  // 4. Guardar, solo con el arriendo propio.
  try {
    return await db.$transaction(async (tx) => {
      const [actual] = await tx.$queryRaw<{ arrendadoPor: string | null; backfillCompletoEn: Date | null }[]>`
        SELECT "arrendadoPor", "backfillCompletoEn" FROM "CursorIngesta" WHERE "id" = ${fila.id} FOR UPDATE`;
      if (!actual || actual.arrendadoPor !== yo) throw new ArriendoPerdido();
      const historico = actual.backfillCompletoEn === null;
      const creados = await tx.evento.createMany({
        data: nuevas.map((n) => ({ ...n, payload: n.payload as unknown as Prisma.InputJsonObject, instalacionId, historico })),
        skipDuplicates: true,
      });
      const completa = historico && !datos.hayMas;
      const ahora = new Date(e.ahora());
      await tx.cursorIngesta.update({
        where: { id: fila.id },
        data: {
          cursor: datos.siguiente === null ? Prisma.DbNull : { fechaRecepcion: datos.siguiente.fechaRecepcion, transferenciaId: datos.siguiente.transferenciaId },
          ultimaSincronizacionEn: ahora,
          ...(completa ? { backfillCompletoEn: ahora } : {}),
          arrendadoHasta: null,
          arrendadoPor: null,
          ultimoErrorCodigo: null,
          ultimoErrorEn: null,
        },
      });
      return { tipo: "PAGINA" as const, eventosNuevos: creados.count, hayMas: datos.hayMas, backfillCompleto: !historico || completa };
    });
  } catch (err) {
    if (err instanceof ArriendoPerdido) return { tipo: "ARRIENDO_PERDIDO", paginas: 0, eventosNuevos: 0 };
    await soltarConError("FALLA_LOCAL");
    return { tipo: "FALLA_LOCAL", paginas: 0, eventosNuevos: 0 };
  }
}
