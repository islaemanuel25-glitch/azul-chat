// src/server/eventos/ingesta.ts
//
// LA INGESTA DE UNA CAPACIDAD DE EVENTOS EN UN LOCAL: TRAER, VALIDAR Y GUARDAR
// UNA VEZ.
//
// Desde la Tanda 4B es UNA maquinaria para las cuatro capacidades
// (`sincronizarEventosLocal`, con la definición de capacidades.ts). Un cursor
// por (local, capacidad). `sincronizarTransferenciasLocal` es la de siempre,
// con la definición de `transferencias_eventos`; test/db/huellaTransferencias
// fija que se ingiera exactamente igual que antes de generalizar.
//
// `sincronizarEventosLocal` NO decide si alguien puede ver ese local:
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
//      arriendo SIGA SIENDO PROPIO; si no, rollback. Se guardan los eventos
//      con `guardarEventos`: una clave que ya estaba se compara con lo
//      guardado. Si cuenta la misma verdad, es un duplicado; si cambia su
//      IDENTIDAD (tipo, local, referencia, fecha), la página entera se deshace
//      (EVENTO_CONTRADICTORIO); si solo cambia la FOTO, se conserva la primera
//      y se anota en el diagnóstico de contenido. Después se guarda el
//      `siguiente` del ERP como cursor, se marca el backfill si corresponde, se
//      limpia el error anterior y se libera el arriendo.
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
  cursorDe,
  esCursorDe,
  type CursorTransferencias,
  type DatosEventos,
  type DatosTransferenciasEventos,
  type FalloErp,
  type FalloLocal,
  type ResultadoConsulta,
} from "../../shared/erp/contrato.ts";
import type { EntradaEventos } from "../erp/eventos.ts";
import { INGESTA_TRANSFERENCIAS, type DefinicionIngesta } from "./capacidades.ts";
import { validarPaginaDe, type MotivoPaginaInvalida } from "./pagina.ts";
import { clasificarRepetido } from "./repetido.ts";
import type { FilaEvento } from "./transferenciaRecibida.ts";

/** Lo que dura un arriendo. Más que el timeout del cliente ERP (10 s): una llamada colgada no lo pierde. */
export const DURACION_ARRIENDO_MS = 30_000;
/** Por página, lo máximo que acepta el ERP. */
export const LIMITE_POR_PAGINA = 100;
/** Páginas por sincronización: una historia larga se completa en varias visitas, sin gastar el cupo del ERP de una vez. */
export const MAX_PAGINAS_POR_SINCRONIZACION = 3;

/** Una página de una capacidad, con la delegación de quien pregunta. */
export type ConsultarPaginaDe<D, C> = (entrada: EntradaEventos<C>) => Promise<ResultadoConsulta<D>>;
/** La de `transferencias_eventos`. */
export type ConsultarPagina = ConsultarPaginaDe<DatosTransferenciasEventos, CursorTransferencias>;

export type ResultadoSincronizacion =
  /** Se guardó al menos una página. `hayMas`: el ERP tiene más, para la próxima visita. */
  | {
      readonly tipo: "SINCRONIZADO";
      readonly paginas: number;
      readonly eventosNuevos: number;
      /** Claves ya guardadas que volvieron con otro contenido: se conservó la primera foto. */
      readonly contenidoDiferente: number;
      readonly hayMas: boolean;
      readonly backfillCompleto: boolean;
    }
  /** Una clave ya guardada volvió con otra identidad: la página no se guardó y el cursor no se movió. */
  | { readonly tipo: "EVENTO_CONTRADICTORIO"; readonly claveExterna: string; readonly paginas: number; readonly eventosNuevos: number }
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

export type EntradaSincronizacionDe<D, C> = {
  readonly db: PrismaClient;
  readonly instalacionId: string;
  /** El local YA AUTORIZADO por la capa de arriba, con el grupo que el ERP acepta. */
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  /** Llama al ERP con la delegación de quien pregunta. */
  readonly consultar: ConsultarPaginaDe<D, C>;
  readonly ahora: () => number;
  /** Un id único por ejecución, para el arriendo. */
  readonly generarId: () => string;
  readonly limitePorPagina?: number;
  readonly maxPaginas?: number;
};

export type EntradaSincronizacion = EntradaSincronizacionDe<DatosTransferenciasEventos, CursorTransferencias>;

class ArriendoPerdido extends Error {}

/** Una clave ya guardada volvió con otra identidad: la página no se guarda. */
export class EventoContradictorio extends Error {
  readonly claveExterna: string;
  constructor(claveExterna: string) {
    super("EVENTO_CONTRADICTORIO");
    this.claveExterna = claveExterna;
  }
}

type Tx = Pick<PrismaClient, "evento">;

/**
 * GUARDA LOS EVENTOS DE UNA PÁGINA, DENTRO DE LA TRANSACCIÓN DE LA PÁGINA.
 *
 * 1. Inserta los que no existen. `INSERT … ON CONFLICT DO NOTHING`: si otra
 *    transacción está insertando la misma clave, PostgreSQL espera a que
 *    termine; el índice único es la defensa final y no hay ventana entre
 *    "consulto" e "inserto".
 * 2. Relee TODAS las claves de la página —las recién insertadas y las que ya
 *    estaban— y compara cada una con lo que llegó (`clasificarRepetido`).
 *    Ignorar el duplicado no decide nada: decide la comparación.
 * 3. Una identidad contradictoria lanza `EventoContradictorio`, y la
 *    transacción entera se deshace: ni un evento de la página queda.
 *
 * Devuelve cuántos se crearon y las claves cuyo contenido difiere de la foto
 * guardada (que no se toca).
 */
export async function guardarEventos(
  tx: Tx,
  instalacionId: string,
  nuevas: readonly FilaEvento[],
  historico: boolean,
): Promise<{ creados: number; contenidoDiferente: string[] }> {
  if (nuevas.length === 0) return { creados: 0, contenidoDiferente: [] };
  const creados = await tx.evento.createMany({
    data: nuevas.map((n) => ({ ...n, payload: n.payload as unknown as Prisma.InputJsonObject, instalacionId, historico })),
    skipDuplicates: true,
  });
  const guardadas = await tx.evento.findMany({
    where: { instalacionId, claveExterna: { in: nuevas.map((n) => n.claveExterna) } },
    select: { claveExterna: true, tipo: true, erpLocalId: true, erpReferenciaId: true, fechaOperacion: true, payloadVersion: true, payload: true },
  });
  const porClave = new Map(guardadas.map((g) => [g.claveExterna, g]));
  const contenidoDiferente: string[] = [];
  for (const n of nuevas) {
    const g = porClave.get(n.claveExterna);
    // Recién insertada o ya existente, tiene que estar: si no, algo la borró en el medio.
    if (!g) throw new Error("evento ausente después de insertar");
    const c = clasificarRepetido(g, n);
    if (c === "IDENTIDAD_CONTRADICTORIA") throw new EventoContradictorio(n.claveExterna);
    if (c === "CONTENIDO_DIFERENTE") contenidoDiferente.push(n.claveExterna);
  }
  return { creados: creados.count, contenidoDiferente };
}

type Ciclo =
  | { tipo: "PAGINA"; eventosNuevos: number; contenidoDiferente: number; hayMas: boolean; backfillCompleto: boolean }
  | Exclude<ResultadoSincronizacion, { tipo: "SINCRONIZADO" }>;

/** La de siempre: `transferencias_eventos` → TRANSFERENCIA_RECIBIDA. */
export function sincronizarTransferenciasLocal(entrada: EntradaSincronizacion): Promise<ResultadoSincronizacion> {
  return sincronizarEventosLocal(INGESTA_TRANSFERENCIAS, entrada);
}

/** Una capacidad de eventos en un local: hasta `maxPaginas` páginas, cada una su propia transacción. */
export async function sincronizarEventosLocal<K extends string, E, C>(
  definicion: DefinicionIngesta<K, E, C>,
  entrada: EntradaSincronizacionDe<DatosEventos<K, E, C>, C>,
): Promise<ResultadoSincronizacion> {
  const maxPaginas = entrada.maxPaginas ?? MAX_PAGINAS_POR_SINCRONIZACION;
  let paginas = 0;
  let eventosNuevos = 0;
  let contenidoDiferente = 0;
  let ultimo: Extract<Ciclo, { tipo: "PAGINA" }> | null = null;
  while (paginas < maxPaginas) {
    const c = await unaPagina(definicion, entrada);
    if (c.tipo !== "PAGINA") {
      // Lo guardado en páginas anteriores queda: cada página es su propia transacción.
      return { ...c, paginas, eventosNuevos };
    }
    paginas += 1;
    eventosNuevos += c.eventosNuevos;
    contenidoDiferente += c.contenidoDiferente;
    ultimo = c;
    if (!c.hayMas) break;
  }
  return {
    tipo: "SINCRONIZADO",
    paginas,
    eventosNuevos,
    contenidoDiferente,
    hayMas: ultimo?.hayMas ?? false,
    backfillCompleto: ultimo?.backfillCompleto ?? false,
  };
}

async function unaPagina<K extends string, E, C>(
  definicion: DefinicionIngesta<K, E, C>,
  e: EntradaSincronizacionDe<DatosEventos<K, E, C>, C>,
): Promise<Ciclo> {
  const { contrato } = definicion;
  const { db, instalacionId } = e;
  const erpLocalId = e.alcance.localId;
  const limite = e.limitePorPagina ?? LIMITE_POR_PAGINA;
  const clave = { instalacionId, erpLocalId, capacidad: contrato.capacidad };
  const yo = e.generarId();

  // 1. El arriendo.
  let fila: { id: string; cursor: Prisma.JsonValue | null };
  let arrendado = false;
  try {
    await db.cursorIngesta.createMany({ data: [clave], skipDuplicates: true });
    const ahora = new Date(e.ahora());
    const tomado = await db.cursorIngesta.updateMany({
      where: { ...clave, OR: [{ arrendadoHasta: null }, { arrendadoHasta: { lt: ahora } }] },
      data: { arrendadoHasta: new Date(ahora.getTime() + DURACION_ARRIENDO_MS), arrendadoPor: yo },
    });
    if (tomado.count !== 1) return { tipo: "OCUPADO", paginas: 0, eventosNuevos: 0 };
    arrendado = true;
    const leida = await db.cursorIngesta.findUnique({
      where: { instalacionId_erpLocalId_capacidad: clave },
      select: { id: true, cursor: true },
    });
    if (!leida) throw new Error("cursor desaparecido");
    fila = leida;
  } catch {
    // Si ya se había tomado el arriendo, se suelta, pero SOLO si sigue siendo
    // propio: el filtro por `arrendadoPor` impide soltar el de otra ejecución.
    // Si ni esto anda, vence solo en 30 s.
    if (arrendado) {
      await db.cursorIngesta
        .updateMany({ where: { ...clave, arrendadoPor: yo }, data: { arrendadoHasta: null, arrendadoPor: null } })
        .catch(() => {});
    }
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
  let desde: C | null = null;
  if (fila.cursor !== null) {
    if (!esCursorDe(contrato, fila.cursor)) {
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
  const pagina = validarPaginaDe(contrato, r.datos, { localId: erpLocalId, desde, limite }, definicion.delLocal);
  if (!pagina.ok) {
    await soltarConError(pagina.codigo);
    return { tipo: "RESPUESTA_INVALIDA", motivo: pagina.motivo, paginas: 0, eventosNuevos: 0 };
  }
  const { datos } = pagina;
  // El local de cada evento es el de la respuesta, que ya se comprobó igual al pedido.
  const nuevas = datos.eventos.map((ev) => definicion.aFila(ev, datos.local.id));

  // 4. Guardar, solo con el arriendo propio.
  try {
    return await db.$transaction(async (tx) => {
      const [actual] = await tx.$queryRaw<{ arrendadoPor: string | null; backfillCompletoEn: Date | null }[]>`
        SELECT "arrendadoPor", "backfillCompletoEn" FROM "CursorIngesta" WHERE "id" = ${fila.id} FOR UPDATE`;
      if (!actual || actual.arrendadoPor !== yo) throw new ArriendoPerdido();
      const historico = actual.backfillCompletoEn === null;
      const { creados, contenidoDiferente } = await guardarEventos(tx, instalacionId, nuevas, historico);
      const completa = historico && !datos.hayMas;
      const ahora = new Date(e.ahora());
      await tx.cursorIngesta.update({
        where: { id: fila.id },
        data: {
          cursor: datos.siguiente === null ? Prisma.DbNull : (cursorDe(contrato, datos.siguiente) as Prisma.InputJsonObject),
          ultimaSincronizacionEn: ahora,
          ...(completa ? { backfillCompletoEn: ahora } : {}),
          // Diagnóstico, no error: la página es válida y se guardó.
          ...(contenidoDiferente.length > 0
            ? { ultimaDiferenciaContenidoClave: contenidoDiferente[contenidoDiferente.length - 1]!, ultimaDiferenciaContenidoEn: ahora }
            : {}),
          arrendadoHasta: null,
          arrendadoPor: null,
          ultimoErrorCodigo: null,
          ultimoErrorEn: null,
        },
      });
      return {
        tipo: "PAGINA" as const,
        eventosNuevos: creados,
        contenidoDiferente: contenidoDiferente.length,
        hayMas: datos.hayMas,
        backfillCompleto: !historico || completa,
      };
    });
  } catch (err) {
    if (err instanceof ArriendoPerdido) return { tipo: "ARRIENDO_PERDIDO", paginas: 0, eventosNuevos: 0 };
    if (err instanceof EventoContradictorio) {
      // El rollback ya deshizo todo: el cursor sigue donde estaba.
      await soltarConError("EVENTO_CONTRADICTORIO");
      return { tipo: "EVENTO_CONTRADICTORIO", claveExterna: err.claveExterna, paginas: 0, eventosNuevos: 0 };
    }
    await soltarConError("FALLA_LOCAL");
    return { tipo: "FALLA_LOCAL", paginas: 0, eventosNuevos: 0 };
  }
}
