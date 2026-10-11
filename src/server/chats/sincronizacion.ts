// src/server/chats/sincronizacion.ts
//
// TRAER LO NUEVO DE LOS LOCALES AUTORIZADOS, Y DECIR QUÉ TAN FRESCO ESTÁ LO
// GUARDADO.
//
// ── QUIÉN TRAE (Tanda 5B) ──────────────────────────────────────────────────
//
// SOLO la sincronización de fondo (interno/sincronizar.ts, un timer cada 2
// minutos). Los pedidos del navegador ya NO ingieren: leen la base propia y
// piden `mi_alcance` una vez, para autorizar. Antes cada pantalla gastaba 22 a
// 27 consultas del cupo del ERP (30 por persona por minuto) y chocaba con la
// corrida de fondo (21): el 11/10 eso dejó a una persona con "ERP Azul no
// responde" (docs/CHATS.md, docs/DEPLOY.md).
//
// ── DOS CACHÉS QUE NO SON LO MISMO ─────────────────────────────────────────
//
//   · AUTORIZACIÓN: no hay caché. `mi_alcance` se pide en CADA solicitud
//     (autorizacion.ts), y en cada corrida de fondo por cada persona.
//   · INGESTA: frecuencia mínima por CursorIngesta de cada (local, capacidad).
//     Si esa capacidad de ese local se sincronizó bien hace menos de 30 s, no
//     se vuelve a pedir al ERP: lo trajo otra persona en esta misma corrida.
//     Es seguro porque solo decide QUÉ tan fresco está lo guardado, nunca
//     QUIÉN puede verlo.
//
// En cada local se ingieren SOLO las capacidades de eventos que `mi_alcance`
// le anuncia hoy, de a una, en el orden del catálogo, con la ingesta de
// siempre: arriendo, hasta 3 páginas de 100, cursor y backfill.
//
// ── QUÉ SE HACE CON CADA RESULTADO ─────────────────────────────────────────
//
//   · sincronizó, estaba fresco u otra ejecución lo está sincronizando: al día;
//   · el ERP dijo VINCULO_NO_VALIDO: se corta TODO y se devuelve ese fallo,
//     para que el flujo de siempre invalide el vínculo;
//   · el ERP dijo LIMITE_EXCEDIDO (el cupo): se corta TODO, sin gastar una
//     consulta más. Las capacidades que faltaban, de este local y de los que
//     seguían, quedan con ese código en su cursor, y la próxima corrida empieza
//     por ellas (`ordenDeSincronizacion`): ningún local queda siempre último;
//   · el ERP dijo NO_AUTORIZADO para esa capacidad en ese local (cambió entre
//     `mi_alcance` y esta llamada): esa capacidad SALE de esta corrida, y con
//     ella sus tipos de evento (los avisos no la miran). Si no le queda
//     ninguna, el local entero sale;
//   · cualquier otra falla (ERP caído, lento, contrato, contradicción, base):
//     la capacidad queda como está, con el código en su cursor, y el local se
//     marca DEMORADA. Las otras capacidades del local, y los otros locales,
//     siguen.
//
// ── EL PRESUPUESTO DEL FONDO: LA APP NO COMPITE (Tanda 5B) ────────────────
//
// El cupo del ERP es de 30 consultas por persona en una ventana fija de 60 s,
// y la cuentan juntas la app abierta y la corrida de fondo (las dos usan el
// token de la persona). Una navegación intensa en un minuto —abrir la lista,
// 5 locales, General, Ventas (2) y Actualizar ×3— son 12 consultas. Si el
// fondo gastara sus 21 (1 + 4 × 5 locales) en ese mismo minuto, serían 33: el
// choque del 11/10 otra vez, ahora con la app en 1 consulta por pantalla.
//
// Por eso el fondo gasta como mucho `PRESUPUESTO_FONDO_POR_PERSONA` (18 =
// 30 − 12) consultas por persona y por corrida, contando `mi_alcance` y cada
// página. Las corridas están a 2 minutos: nunca caen dos en la misma ventana.
// En cualquier orden, fondo + app ≤ 30. Lo que no entra queda para la
// corrida siguiente, sin anotar error (no falló nada): el orden empieza por lo
// más atrasado, así que cada capacidad se trae al menos cada dos corridas
// mientras la persona tenga hasta 8 locales con las 4 capacidades.
//
// ── EL ORDEN DE UNA CORRIDA ────────────────────────────────────────────────
//
// Primero los locales PENDIENTES: alguna capacidad anunciada sin cursor, sin
// una sincronización buena todavía, o con LIMITE_EXCEDIDO de la corrida
// anterior. Después el resto. Dentro de cada grupo, por la sincronización
// buena más vieja de sus capacidades, y a igual, en el orden de `mi_alcance`.
// Si en la corrida anterior entró todo, el orden es el mismo que el de ella;
// si algo quedó afuera, eso va primero: ningún local queda siempre último.
//
// ── QUÉ TAN FRESCO ESTÁ LO GUARDADO (lo que ve el navegador) ───────────────
//
// `estadoDeLocales` lo lee de los cursores que dejó el fondo, sin llamar al
// ERP: un local está DEMORADA si alguna de sus capacidades anunciadas hoy no
// tiene cursor, nunca se sincronizó, quedó con un error, o se sincronizó por
// última vez hace más de `ANTIGUEDAD_MAXIMA_SINCRONIZACION_MS`.

import "server-only";

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  CAPACIDAD_CANCELACIONES_EVENTOS,
  CAPACIDAD_ENVIOS_EVENTOS,
  CAPACIDAD_PEDIDOS_EVENTOS,
  CAPACIDAD_TRANSFERENCIAS_EVENTOS,
  type CapacidadEventos,
  type FalloErp,
  type FalloLocal,
  type ResultadoConsulta,
} from "../../shared/erp/contrato.ts";
import type { EstadoSincronizacion } from "../../shared/chats/api.ts";
import { INGESTA_CANCELACIONES, INGESTA_ENVIOS, INGESTA_PEDIDOS } from "../eventos/capacidades.ts";
import { MAX_PAGINAS_POR_SINCRONIZACION, sincronizarEventosLocal, sincronizarTransferenciasLocal, type ResultadoSincronizacion } from "../eventos/ingesta.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import type { Autorizacion, LocalDeEventos } from "./autorizacion.ts";

/** Por debajo de esto, una capacidad de un local sincronizada no se vuelve a pedir al ERP. Frecuencia de INGESTA, no de autorización. */
export const FRECUENCIA_MINIMA_INGESTA_MS = 30_000;

/**
 * Cada cuánto corre la sincronización de fondo: el `OnUnitActiveSec` de
 * ops/sincronizar/systemd/azul-chat-sincronizar.timer. Lo fija
 * test/frontera/produccion.test.ts: si se cambia uno, se cambia el otro.
 */
export const PERIODO_SINCRONIZACION_MS = 2 * 60_000;

/** Corridas del timer sin sincronizar que se toleran antes de avisar "Actualización demorada". */
export const CORRIDAS_TOLERADAS = 3;

/**
 * Lo guardado de una capacidad se considera viejo si su última sincronización
 * buena fue hace más que esto: 3 corridas del timer (con 2 min, 6 min). Una
 * corrida que se saltea (cortada por cupo, el ERP lento) no alcanza para
 * avisar; tres seguidas, sí.
 */
export const ANTIGUEDAD_MAXIMA_SINCRONIZACION_MS = CORRIDAS_TOLERADAS * PERIODO_SINCRONIZACION_MS;

/** El código del ERP que dice que se acabó el cupo. Lo único que corta una corrida. */
export const CODIGO_CUPO = "LIMITE_EXCEDIDO";

/** El cupo del ERP por persona en 60 s: erpmanual lib/integraciones/azul-chat/limitador.js, MAX_POR_USUARIO. */
export const CUPO_ERP_POR_PERSONA = 30;

/**
 * Lo que se le deja a la app abierta dentro de esa ventana: una navegación
 * intensa de un minuto (lista, 5 locales, General, Ventas = 2, Actualizar ×3).
 * Cada pedido del navegador cuesta 1 consulta (`mi_alcance`), Ventas 2.
 */
export const RESERVA_PARA_LA_APP = 12;

/** Consultas al ERP que una corrida de fondo gasta como mucho por persona, `mi_alcance` incluida. */
export const PRESUPUESTO_FONDO_POR_PERSONA = CUPO_ERP_POR_PERSONA - RESERVA_PARA_LA_APP;

/** ¿Este fallo es el cupo del ERP? Por código, nunca por texto. */
export function esFalloDeCupo(r: ResultadoConsulta<unknown>): boolean {
  return !r.ok && r.origen === "erp" && r.codigo === CODIGO_CUPO;
}

/** Un local con su estado, como lo ve el navegador (desde los cursores). */
export type LocalSincronizado = LocalDeEventos & { readonly sincronizacion: EstadoSincronizacion };

/**
 * Un local en una corrida de fondo: con las capacidades que el ERP no negó.
 * PENDIENTE: la corrida no llegó a él (presupuesto o cupo); va primero en la
 * siguiente.
 */
export type LocalDeLaCorrida = LocalDeEventos & { readonly corrida: "AL_DIA" | "DEMORADA" | "PENDIENTE" };

export type ResultadoDeSincronizar =
  /**
   * `cortadaPorCupo`: el ERP dijo LIMITE_EXCEDIDO y no se le pidió nada más.
   * `gastadas`: consultas al ERP de esta corrida para esta persona (sin `mi_alcance`).
   * `locales`: todos los autorizados, con lo que pasó con cada uno.
   */
  | { readonly ok: true; readonly locales: readonly LocalDeLaCorrida[]; readonly cortadaPorCupo: boolean; readonly gastadas: number }
  /** El ERP rechazó el token: hay que invalidar el vínculo. */
  | { readonly ok: false; readonly fallo: FalloErp | FalloLocal };

type DbCursores = Pick<PrismaClient, "cursorIngesta">;

type FilaCursor = {
  readonly erpLocalId: number;
  readonly capacidad: string;
  readonly ultimaSincronizacionEn: Date | null;
  readonly ultimoErrorCodigo: string | null;
};

/** Los cursores de esos locales, en una consulta. */
async function cursoresDe(db: DbCursores, instalacionId: string, localIds: readonly number[]): Promise<FilaCursor[]> {
  if (localIds.length === 0) return [];
  return db.cursorIngesta.findMany({
    where: { instalacionId, erpLocalId: { in: [...localIds] } },
    select: { erpLocalId: true, capacidad: true, ultimaSincronizacionEn: true, ultimoErrorCodigo: true },
  });
}

const clave = (localId: number, capacidad: string) => `${localId}:${capacidad}`;

/**
 * El estado de cada local para el navegador, SOLO desde los cursores que dejó
 * la sincronización de fondo. No llama al ERP y no decide quién ve qué: recibe
 * los locales ya autorizados, con las capacidades que `mi_alcance` les anuncia
 * hoy, y mira solo esas.
 */
export async function estadoDeLocales(
  db: DbCursores,
  instalacionId: string,
  locales: readonly LocalDeEventos[],
  ahora: number,
): Promise<Map<number, EstadoSincronizacion>> {
  const porClave = new Map((await cursoresDe(db, instalacionId, locales.map((l) => l.localId))).map((c) => [clave(c.erpLocalId, c.capacidad), c]));
  const salida = new Map<number, EstadoSincronizacion>();
  for (const l of locales) {
    const demorada = l.capacidades.some((capacidad) => {
      const c = porClave.get(clave(l.localId, capacidad));
      if (!c || c.ultimoErrorCodigo !== null || !c.ultimaSincronizacionEn) return true;
      return ahora - c.ultimaSincronizacionEn.getTime() > ANTIGUEDAD_MAXIMA_SINCRONIZACION_MS;
    });
    salida.set(l.localId, demorada ? "DEMORADA" : "AL_DIA");
  }
  return salida;
}

/**
 * El orden de una corrida (ver arriba): pendientes primero, después el resto;
 * dentro de cada grupo, por la sincronización buena más vieja, y a igual, en
 * el orden de `mi_alcance`. Estable: `sort` de JS lo es.
 */
export function ordenDeSincronizacion<L extends LocalDeEventos>(locales: readonly L[], cursores: readonly FilaCursor[]): L[] {
  const porClave = new Map(cursores.map((c) => [clave(c.erpLocalId, c.capacidad), c]));
  const datos = new Map(
    locales.map((l) => {
      let pendiente = false;
      let masVieja = Number.POSITIVE_INFINITY;
      for (const capacidad of l.capacidades) {
        const c = porClave.get(clave(l.localId, capacidad));
        if (!c || !c.ultimaSincronizacionEn || c.ultimoErrorCodigo === CODIGO_CUPO) pendiente = true;
        const t = c?.ultimaSincronizacionEn?.getTime() ?? Number.NEGATIVE_INFINITY;
        if (t < masVieja) masVieja = t;
      }
      return [l.localId, { pendiente, masVieja }] as const;
    }),
  );
  return [...locales].sort((a, b) => {
    const x = datos.get(a.localId)!;
    const y = datos.get(b.localId)!;
    if (x.pendiente !== y.pendiente) return x.pendiente ? -1 : 1;
    if (x.masVieja !== y.masVieja) return x.masVieja < y.masVieja ? -1 : 1;
    return 0;
  });
}

/** ¿Esta capacidad de este local se sincronizó bien hace menos de la frecuencia mínima? */
async function estaFresco(deps: DependenciasSesion, a: Autorizacion, localId: number, capacidad: CapacidadEventos): Promise<boolean> {
  const cursor = await a.contexto.db.cursorIngesta.findUnique({
    where: {
      instalacionId_erpLocalId_capacidad: {
        instalacionId: a.contexto.config.instalacionId,
        erpLocalId: localId,
        capacidad,
      },
    },
    select: { ultimaSincronizacionEn: true },
  });
  const ultima = cursor?.ultimaSincronizacionEn;
  return !!ultima && deps.ahora() - ultima.getTime() < FRECUENCIA_MINIMA_INGESTA_MS;
}

/** Una capacidad de un local, con la ingesta común y el método del cliente ERP de esa capacidad. */
function sincronizarCapacidad(
  deps: DependenciasSesion,
  a: Autorizacion,
  local: LocalDeEventos,
  capacidad: CapacidadEventos,
  generarId: () => string,
  maxPaginas: number,
  contar: () => void,
): Promise<ResultadoSincronizacion> {
  const base = {
    db: a.contexto.db,
    instalacionId: a.contexto.config.instalacionId,
    alcance: { grupoId: local.grupoId, localId: local.localId },
    ahora: deps.ahora,
    generarId,
    maxPaginas,
  };
  // Cada página es una consulta al ERP: se cuenta al pedirla.
  const contada =
    <E, R>(f: (token: string, entrada: E) => Promise<R>) =>
    (entrada: E): Promise<R> => {
      contar();
      return f(a.token, entrada);
    };
  switch (capacidad) {
    case CAPACIDAD_TRANSFERENCIAS_EVENTOS:
      return sincronizarTransferenciasLocal({ ...base, consultar: contada(deps.erp.transferenciasEventos) });
    case CAPACIDAD_PEDIDOS_EVENTOS:
      return sincronizarEventosLocal(INGESTA_PEDIDOS, { ...base, consultar: contada(deps.erp.pedidosEventos) });
    case CAPACIDAD_ENVIOS_EVENTOS:
      return sincronizarEventosLocal(INGESTA_ENVIOS, { ...base, consultar: contada(deps.erp.enviosEventos) });
    case CAPACIDAD_CANCELACIONES_EVENTOS:
      return sincronizarEventosLocal(INGESTA_CANCELACIONES, { ...base, consultar: contada(deps.erp.cancelacionesEventos) });
  }
}

const codigoErp = (r: ResultadoSincronizacion): string | null => (r.tipo === "FALLO_ERP" && r.fallo.origen === "erp" ? r.fallo.codigo : null);

/**
 * Deja LIMITE_EXCEDIDO en los cursores que la corrida no llegó a procesar, para
 * que la siguiente empiece por ellos. Crea el cursor si no existía (sin
 * página: `cursor` null, como lo crearía la ingesta). No toca el arriendo ni
 * la posición: solo anota el código, que un éxito limpia.
 */
export async function anotarPendientesPorCupo(
  db: DbCursores,
  instalacionId: string,
  pendientes: readonly { readonly localId: number; readonly capacidad: CapacidadEventos }[],
  ahora: Date,
): Promise<void> {
  if (pendientes.length === 0) return;
  await db.cursorIngesta.createMany({
    data: pendientes.map((p) => ({ instalacionId, erpLocalId: p.localId, capacidad: p.capacidad })),
    skipDuplicates: true,
  });
  await db.cursorIngesta.updateMany({
    where: { instalacionId, OR: pendientes.map((p) => ({ erpLocalId: p.localId, capacidad: p.capacidad })) },
    data: { ultimoErrorCodigo: CODIGO_CUPO, ultimoErrorEn: ahora },
  });
}

/**
 * Sincroniza, de a uno, los locales autorizados, y en cada uno sus
 * capacidades anunciadas, en el orden de `ordenDeSincronizacion`, gastando a
 * lo sumo `presupuesto` consultas al ERP (páginas). Devuelve todos los
 * locales con lo que pasó con cada uno; si el ERP dijo LIMITE_EXCEDIDO, corta
 * ahí.
 */
export async function sincronizarAutorizados(
  deps: DependenciasSesion,
  a: Autorizacion,
  locales: readonly LocalDeEventos[],
  presupuesto: number,
  generarId: () => string = randomUUID,
): Promise<ResultadoDeSincronizar> {
  const { db, config } = a.contexto;
  const previos = await cursoresDe(db, config.instalacionId, locales.map((l) => l.localId));
  const orden = ordenDeSincronizacion(locales, previos);
  const inicio = deps.ahora();
  const frescoAlEmpezar = new Set(
    previos
      .filter((c) => c.ultimoErrorCodigo === null && c.ultimaSincronizacionEn && inicio - c.ultimaSincronizacionEn.getTime() < FRECUENCIA_MINIMA_INGESTA_MS)
      .map((c) => clave(c.erpLocalId, c.capacidad)),
  );

  let gastadas = 0;
  const contar = () => {
    gastadas += 1;
  };
  const salida: LocalDeLaCorrida[] = [];
  /** Lo que la corrida no alcanzó: el local entero, con todo lo que `mi_alcance` le anuncia. */
  const pendientesDesde = (i: number): LocalDeLaCorrida[] => orden.slice(i).map((l) => ({ ...l, corrida: "PENDIENTE" as const }));

  for (const [i, local] of orden.entries()) {
    const vigentes: CapacidadEventos[] = [];
    let demorada = false;
    for (const [j, capacidad] of local.capacidades.entries()) {
      if (await estaFresco(deps, a, local.localId, capacidad)) {
        vigentes.push(capacidad);
        continue;
      }
      const restantes = presupuesto - gastadas;
      if (restantes <= 0) {
        // Sin presupuesto: no se llama. No es un error, no se anota nada: la
        // corrida siguiente empieza por lo más atrasado, que es esto.
        salida.push({ ...local, corrida: "PENDIENTE" });
        return { ok: true, locales: [...salida, ...pendientesDesde(i + 1)], cortadaPorCupo: false, gastadas };
      }
      const r = await sincronizarCapacidad(deps, a, local, capacidad, generarId, Math.min(MAX_PAGINAS_POR_SINCRONIZACION, restantes), contar);
      const codigo = codigoErp(r);
      if (codigo === "VINCULO_NO_VALIDO" && r.tipo === "FALLO_ERP") return { ok: false, fallo: r.fallo };
      if (codigo === CODIGO_CUPO) {
        // Esta capacidad ya quedó con el código (la ingesta lo anota). Las que
        // faltaban, de este local y de los siguientes, también: ni una consulta más.
        // Lo que otra persona trajo hace menos de 30 s no está pendiente: no se marca.
        const resto = [
          ...local.capacidades.slice(j + 1).map((c) => ({ localId: local.localId, capacidad: c })),
          ...orden.slice(i + 1).flatMap((l) => l.capacidades.map((c) => ({ localId: l.localId, capacidad: c }))),
        ].filter((p) => !frescoAlEmpezar.has(clave(p.localId, p.capacidad)));
        await anotarPendientesPorCupo(db, config.instalacionId, resto, new Date(deps.ahora()));
        salida.push({ ...local, corrida: "PENDIENTE" });
        return { ok: true, locales: [...salida, ...pendientesDesde(i + 1)], cortadaPorCupo: true, gastadas };
      }
      if (codigo === "NO_AUTORIZADO") continue;
      vigentes.push(capacidad);
      if (r.tipo !== "SINCRONIZADO" && r.tipo !== "OCUPADO") demorada = true;
    }
    if (vigentes.length === 0) continue;
    salida.push({ ...local, capacidades: vigentes, corrida: demorada ? "DEMORADA" : "AL_DIA" });
  }
  return { ok: true, locales: salida, cortadaPorCupo: false, gastadas };
}
