// src/server/buscar/buscar.ts
//
// BUSCAR EN EL HISTORIAL (Tanda 10). Solo servidor.
//
// Busca en la base PROPIA, nunca en el ERP: los eventos guardados de los
// locales que la autorización viva dejó ver (chats/autorizacion.ts; de cada
// local, solo sus tipos visibles) y las preguntas guardadas de la persona, con
// la misma regla de visibilidad que el historial (preguntas/guardadas.ts).
// Quién puede ver qué no se decide acá: llega decidido.
//
// Los resultados son UNA secuencia en el orden del historial —del más nuevo al
// más viejo, a igual instante la pregunta primero— paginada por la misma
// función que la conversación (chats/historial.ts, `paginaDeHistorial`), con
// el mismo cursor: la posición del último resultado de la página. El cursor no
// lleva el texto ni el filtro; la pantalla los vuelve a mandar iguales.
//
// ── CÓMO SE BUSCA EN UN EVENTO ─────────────────────────────────────────────
//
// Un número va contra `erpReferenciaId`: es el número de la transferencia o
// del pedido que muestra el título, en los cuatro tipos (historial.ts,
// aEventoPublico). Un texto, sin mayúsculas ni acentos, contra lo que se ve:
//
//   · el título sin el número (textos.ts, ROTULO_DE_TIPO): si el texto está en
//     "transferencia recibida", entran las recepciones; si solo está en
//     "transferencia recibida con diferencias", las que tienen diferencias;
//   · el nombre del origen y, en una recepción, el del destino. La base no
//     sabe comparar sin acentos sin una extensión, así que primero se leen los
//     nombres distintos de esos locales (son pocos), se comparan acá, y la
//     consulta pide los que coinciden por igualdad.

import "server-only";

import type { Prisma, PrismaClient, TipoEvento } from "@prisma/client";

import {
  coincideTexto,
  filtroConPreguntas,
  normalizar,
  RESULTADOS_POR_PAGINA,
  TIPOS_DE_FILTRO,
  type Busqueda,
  type FiltroBusqueda,
  type ResultadoBusqueda,
} from "../../shared/chats/buscar.ts";
import { CON_DIFERENCIAS, ROTULO_DE_TIPO } from "../../shared/chats/textos.ts";
import { antes, eventosVisibles, paginaDeHistorial, type LocalVisible, type PosicionHistorial } from "../chats/historial.ts";
import { preguntasQueCoinciden, type AlcanceDeHoy, type PreguntaEncontrada } from "../preguntas/guardadas.ts";

type Db = Pick<PrismaClient, "evento" | "pregunta" | "$queryRaw">;

/** Un local donde se busca: lo que la persona ve de él hoy y su nombre de hoy. */
export type LocalDeBusqueda = LocalVisible & { readonly nombre: string };

/** Lo que se le pide a la base, ya autorizado. */
export type PedidoDeBusqueda = {
  readonly instalacionId: string;
  readonly vinculoId: string;
  /** Un Local: ese solo. General: todos los autorizados hoy. */
  readonly locales: readonly LocalDeBusqueda[];
  /** En qué chats se buscan preguntas guardadas: el Local, o General y todos los locales. */
  readonly chatsDePreguntas: readonly (number | null)[];
  readonly hoy: AlcanceDeHoy;
  readonly ahora: Date;
  readonly busqueda: Busqueda;
  readonly filtro: FiltroBusqueda;
  readonly desde: PosicionHistorial | null;
};

/** Los tipos cuyo título (sin el número) contiene el texto, y si el texto pide además "con diferencias". */
function tiposPorTitulo(normalizado: string): { tipos: TipoEvento[]; conDiferencias: boolean } {
  const tipos = (Object.keys(ROTULO_DE_TIPO) as TipoEvento[]).filter((t) => normalizar(`${ROTULO_DE_TIPO[t].que} ${ROTULO_DE_TIPO[t].accion}`).includes(normalizado));
  const r = ROTULO_DE_TIPO.TRANSFERENCIA_RECIBIDA;
  const conDiferencias = !tipos.includes("TRANSFERENCIA_RECIBIDA") && normalizar(`${r.que} ${r.accion} ${CON_DIFERENCIAS}`).includes(normalizado);
  return { tipos, conDiferencias };
}

/** Los nombres de origen y destino de los eventos de esos locales, distintos. */
async function nombresDeLocales(db: Db, instalacionId: string, localIds: readonly number[]): Promise<string[]> {
  if (localIds.length === 0) return [];
  const filas = await db.$queryRaw<{ n: string }[]>`
    SELECT DISTINCT n FROM (
      SELECT "payload" #>> '{origen,nombre}' AS n FROM "Evento" WHERE "instalacionId" = ${instalacionId} AND "erpLocalId" = ANY(${[...localIds]}::int[])
      UNION
      SELECT "payload" #>> '{destino,nombre}' AS n FROM "Evento" WHERE "instalacionId" = ${instalacionId} AND "erpLocalId" = ANY(${[...localIds]}::int[])
    ) t
    WHERE n IS NOT NULL`;
  return filas.map((f) => f.n);
}

/** Lo que tiene que cumplir un evento para coincidir con la búsqueda, o null si ninguno puede. */
async function filtroDeEventos(db: Db, p: PedidoDeBusqueda): Promise<Prisma.EventoWhereInput | null> {
  if (p.busqueda.tipo === "NUMERO") return p.busqueda.n === null ? null : { erpReferenciaId: p.busqueda.n };
  const q = p.busqueda.normalizado;
  const { tipos, conDiferencias } = tiposPorTitulo(q);
  const nombres = (await nombresDeLocales(db, p.instalacionId, p.locales.map((l) => l.localId))).filter((n) => normalizar(n).includes(q));
  const o: Prisma.EventoWhereInput[] = [
    ...(tipos.length > 0 ? [{ tipo: { in: tipos } }] : []),
    ...(conDiferencias ? [{ tipo: "TRANSFERENCIA_RECIBIDA" as const, payload: { path: ["tieneDiferencias"], equals: true } }] : []),
    ...nombres.flatMap((n) => [{ payload: { path: ["origen", "nombre"], equals: n } }, { payload: { path: ["destino", "nombre"], equals: n } }]),
  ];
  return o.length > 0 ? { OR: o } : null;
}

/**
 * Una página de resultados y el total. De cada local, los tipos visibles HOY
 * que además entran en el filtro; las preguntas, solo con "Todos" y
 * "Preguntas".
 */
export async function buscarEnHistorial(db: Db, p: PedidoDeBusqueda): Promise<{ total: number; resultados: ResultadoBusqueda[]; siguiente: string | null }> {
  const delFiltro = TIPOS_DE_FILTRO[p.filtro];
  const locales: LocalVisible[] = p.locales.map((l) => ({ localId: l.localId, tipos: l.tipos.filter((t) => delFiltro.includes(t)) }));
  const filtro = delFiltro.length > 0 ? await filtroDeEventos(db, p) : null;
  const dondeEventos = filtro ? eventosVisibles(p.instalacionId, locales, filtro) : null;

  const preguntas: PreguntaEncontrada[] = filtroConPreguntas(p.filtro)
    ? await preguntasQueCoinciden(db, { vinculoId: p.vinculoId, chats: p.chatsDePreguntas, hoy: p.hoy, ahora: p.ahora, coincide: (t) => coincideTexto(p.busqueda, t) })
    : [];
  // Las preguntas ya están todas, en orden: la página toma las que siguen al cursor.
  const fuente = async (desde: PosicionHistorial | null, limite: number) =>
    preguntas
      .filter((x) => !desde || antes(desde, { fecha: x.fecha, id: x.id, pregunta: true }))
      .slice(0, limite)
      .map((x) => ({ fecha: x.fecha, id: x.id, pregunta: x }));

  // Sin eventos posibles, la página se arma solo con preguntas: ningún local, ninguna consulta de eventos.
  const pagina = await paginaDeHistorial(db, p.instalacionId, dondeEventos ? locales : [], p.desde, RESULTADOS_POR_PAGINA, fuente, filtro ?? undefined);
  const total = (dondeEventos ? await db.evento.count({ where: dondeEventos }) : 0) + preguntas.length;

  const nombre = new Map(p.locales.map((l) => [l.localId, l.nombre]));
  type ConPosicion = { readonly pos: PosicionHistorial; readonly resultado: ResultadoBusqueda };
  const juntos: ConPosicion[] = [
    ...pagina.filas.map((f) => ({
      pos: { fecha: new Date(f.evento.fecha), id: BigInt(f.evento.id) },
      resultado: { tipo: "EVENTO" as const, evento: f.evento, local: { localId: f.erpLocalId, nombre: nombre.get(f.erpLocalId)! } },
    })),
    ...pagina.preguntas.map((x) => ({
      pos: { fecha: x.fecha, id: x.id, pregunta: true as const },
      resultado: {
        tipo: "PREGUNTA" as const,
        guardada: x.pregunta,
        local: x.erpLocalId === null ? null : { localId: x.erpLocalId, nombre: nombre.get(x.erpLocalId) ?? "" },
      },
    })),
  ].sort((a, b) => (antes(a.pos, b.pos) ? -1 : 1));
  return { total, resultados: juntos.map((j) => j.resultado), siguiente: pagina.siguiente };
}
