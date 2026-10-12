// src/server/chats/manejadores.ts
//
// LAS DIEZ RUTAS DE CHATS. Las de src/app solo delegan acá.
//
//   GET  /api/chats                          la lista: General y cada local autorizado
//   GET  /api/chats/local?localId=&cursor=   el historial de un local
//   GET  /api/chats/general?cursor=          el historial de todos los locales autorizados
//   POST /api/chats/leido                    marcar leído, explícito
//   GET  /api/chats/ventas?localId=          las ventas de hoy de un local (Tanda 3A)
//   GET  /api/chats/caja?localId=            las cajas de hoy de un local, por turno (Tanda 7B)
//   GET  /api/chats/stock?localId=           los productos bajo mínimo de un local (Tanda 8B)
//   GET  /api/chats/pendientes?localId=      lo pendiente de un local: pedidos sin enviar y cajas a revisar (Tanda 9B)
//   GET  /api/chats/pendientes/general       lo mismo, de cada local con alguna de esas dos fuentes (Tanda 9B)
//   GET  /api/chats/buscar?texto=&filtro=&(localId= | general=1)&cursor=
//                                            buscar en el historial guardado (Tanda 10)
//
// Las cuatro primeras: sesión → `mi_alcance` vivo, UNA vez → locales con al
// menos una capacidad de eventos, y de cada uno los tipos de esas capacidades
// (Tanda 4B) → recién ahí la base, filtrada por local Y tipo. La base no
// autoriza nada.
// Ventas: sesión → `mi_alcance` vivo → local con `ventas_resumen` → el ERP;
// no toca Evento ni LecturaLocal.
//
// Los GET NO ingieren (Tanda 5B): lo trae solo la sincronización de fondo
// (interno/sincronizar.ts). Cada pedido del navegador le cuesta al cupo del ERP
// UNA consulta, `mi_alcance` —ventas, dos—, y lee la base propia. El estado
// "Actualización demorada" de cada local sale de los cursores que dejó el fondo
// (chats/sincronizacion.ts, estadoDeLocales). Los GET crean la línea de base de
// lectura la primera vez que la persona ve un local —sobre lo que ya está en la
// base—, pero NUNCA marcan leído: marcar es solo POST /api/chats/leido. El local va por
// query (`?localId=`) y no por segmento de ruta: la frontera de rutas no admite
// segmentos dinámicos en src/app (test/frontera/rutas.test.ts).

import "server-only";

import type {
  EventoGeneral,
  FallaChats,
  LocalDeChats,
  RespuestaChats,
  RespuestaGeneral,
  RespuestaLeido,
  RespuestaCaja,
  RespuestaLocal,
  RespuestaPendientes,
  RespuestaPendientesGeneral,
  RespuestaStock,
  RespuestaVentas,
} from "../../shared/chats/api.ts";
import type { DatosVentasResumen, ResultadoConsulta } from "../../shared/erp/contrato.ts";
import { cajasPublicas, cajasResumenDeSesion } from "../caja/cajasResumen.ts";
import { contarNoLeidos, avanzarLectura, inicializarLectura, leerLectura } from "../eventos/lectura.ts";
import { leerObjetoJson } from "../http/cuerpo.ts";
import { origenPermitido } from "../http/origen.ts";
import { json } from "../http/respuestas.ts";
import { cookieBorrada } from "../sesion/cookie.ts";
import type { ResultadoDelegado } from "../sesion/delegacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import { ventasResumenDeSesion } from "../ventas/ventasResumen.ts";
import { bajoMinimoPublico, esSinMinimo, sinMinimoPublico, stockConsultaDeSesion } from "../stock/stockConsulta.ts";
import { conAutorizacionViva, tiposVisibles, type Autorizacion, type LocalAutorizado, type LocalDeEventos, type LocalDePendientes } from "./autorizacion.ts";
import { ordenDeGeneral, pendientesDeLocales } from "../pendientes/pendientes.ts";
import {
  decodificarCursor,
  leerIdEvento,
  masReciente,
  paginaDeHistorial,
  ultimoEventoDe,
  type LocalVisible,
  type PosicionHistorial,
} from "./historial.ts";
import { fuenteDePreguntas } from "../preguntas/guardadas.ts";
import { buscarEnHistorial } from "../buscar/buscar.ts";
import { FILTROS_BUSQUEDA, leerTextoDeBusqueda, type RespuestaBuscar } from "../../shared/chats/buscar.ts";
import { esFalloDeCupo, estadoDeLocales, type LocalSincronizado } from "./sincronizacion.ts";

/** Un local con las capacidades que siguen en esta respuesta → qué se puede leer de él. */
const visible = (l: LocalDeEventos): LocalVisible => ({ localId: l.localId, tipos: tiposVisibles(l.capacidades) });

/** Marcas por POST: más que los locales que tiene cualquier negocio. */
export const MAX_MARCAS = 50;
const MAX_BYTES_LEIDO = 8 * 1024;
const LOCAL_ID = /^[1-9][0-9]{0,9}$/;

const STATUS: Record<FallaChats["estado"], number> = {
  SIN_SESION: 401,
  NO_AUTORIZADO: 403,
  ORIGEN_NO_PERMITIDO: 403,
  SOLICITUD_INVALIDA: 400,
  ERP_NO_DISPONIBLE: 503,
  ERP_CUPO_EXCEDIDO: 429,
  SERVICIO_NO_DISPONIBLE: 503,
};

export function falla(f: FallaChats, request: Request, deps: DependenciasSesion): Response {
  // Si el navegador trae una cookie que ya no vale, se le borra, como en GET /api/sesion.
  const borrar = f.estado === "SIN_SESION" && !!request.headers.get("cookie");
  const produccion = deps.config.ok ? deps.config.config.produccion : true;
  return json(f, { status: STATUS[f.estado], cookie: borrar ? cookieBorrada({ produccion }) : null });
}

/** El resultado de la autorización viva → la falla pública. P1: sin `mi_alcance`, sin historial. */
export function fallaDeDelegacion<T>(r: Exclude<ResultadoDelegado<T>, { tipo: "OK" }>): FallaChats {
  switch (r.tipo) {
    case "SIN_SESION":
      return r.vinculoInvalidado ? { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" } : { estado: "SIN_SESION" };
    case "RECHAZO_ERP":
      return fallaDeRechazo(r.resultado);
    case "SERVICIO_NO_DISPONIBLE":
      return { estado: "SERVICIO_NO_DISPONIBLE" };
  }
}

/**
 * Un rechazo del ERP que no invalida el vínculo → la falla pública, por código.
 * El cupo (LIMITE_EXCEDIDO) tiene la suya: no es que el ERP no responda, es
 * que se le pidió mucho seguido, y la interfaz lo dice así (Tanda 5B).
 */
export function fallaDeRechazo(r: Extract<ResultadoConsulta<unknown>, { ok: false }>): FallaChats {
  if (r.origen === "erp" && r.codigo === "NO_AUTORIZADO") return { estado: "NO_AUTORIZADO" };
  if (esFalloDeCupo(r)) return { estado: "ERP_CUPO_EXCEDIDO" };
  return { estado: "ERP_NO_DISPONIBLE" };
}

/** Lo que devuelve el trabajo autorizado: la respuesta, o "este local no", que no es un rechazo del ERP. */
type Trabajo<R> = { readonly tipo: "OK"; readonly respuesta: R } | { readonly tipo: "NO_AUTORIZADO" };
const ok = <R>(respuesta: R): ResultadoConsulta<Trabajo<R>> => ({ ok: true, datos: { tipo: "OK", respuesta }, requestId: "" });
const localNoAutorizado = <R>(): ResultadoConsulta<Trabajo<R>> => ({ ok: true, datos: { tipo: "NO_AUTORIZADO" }, requestId: "" });

/** Corre el trabajo con la autorización viva y contesta. Una falla de la base es SERVICIO_NO_DISPONIBLE, sin mensaje. */
async function responder<R>(
  request: Request,
  deps: DependenciasSesion,
  trabajo: (a: Autorizacion) => Promise<ResultadoConsulta<Trabajo<R>>>,
): Promise<Response> {
  let r: ResultadoDelegado<Trabajo<R>>;
  try {
    r = await conAutorizacionViva(request.headers, deps, trabajo);
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  }
  if (r.tipo !== "OK") return falla(fallaDeDelegacion(r), request, deps);
  if (r.datos.tipo === "NO_AUTORIZADO") return falla({ estado: "NO_AUTORIZADO" }, request, deps);
  return json(r.datos.respuesta);
}

/** Los parámetros de la URL, exactamente esos: una clave de más o repetida es una solicitud inválida. */
function parametros(request: Request, permitidas: readonly string[]): Map<string, string> | null {
  const sp = new URL(request.url).searchParams;
  const vistos = new Map<string, string>();
  for (const [k, v] of sp) {
    if (!permitidas.includes(k) || vistos.has(k)) return null;
    vistos.set(k, v);
  }
  return vistos;
}

/**
 * Lo que el navegador ve de esos locales, SIN llamar al ERP: su estado según
 * los cursores que dejó la sincronización de fondo, y la línea de base de
 * lectura si es la primera vez que la persona los ve. La línea de base se fija
 * sobre lo que YA está en la base: lo que el fondo traiga después tiene ids
 * mayores y, si no es historia, cuenta como nuevo.
 */
async function prepararLocales(deps: DependenciasSesion, a: Autorizacion, locales: readonly LocalDeEventos[]): Promise<LocalSincronizado[]> {
  const { db, config, sesion } = a.contexto;
  const estados = await estadoDeLocales(db, config.instalacionId, locales, deps.ahora());
  for (const l of locales) await inicializarLectura(db, sesion.vinculo.id, l.localId);
  return locales.map((l) => ({ ...l, sincronizacion: estados.get(l.localId) ?? "DEMORADA" }));
}

// ── GET /api/chats ──────────────────────────────────────────────────────────

export function manejarChats(request: Request, deps: DependenciasSesion): Promise<Response> {
  if (parametros(request, []) === null) return Promise.resolve(falla({ estado: "SOLICITUD_INVALIDA" }, request, deps));
  return responder<RespuestaChats>(request, deps, async (a) => {
    const preparados = await prepararLocales(deps, a, a.autorizados);
    const { db, config, sesion } = a.contexto;
    const locales: LocalDeChats[] = [];
    for (const l of preparados) {
      locales.push({
        localId: l.localId,
        nombre: l.nombre,
        esDeposito: l.esDeposito,
        ultimoEvento: await ultimoEventoDe(db, config.instalacionId, visible(l)),
        noLeidos: await contarNoLeidos(db, sesion.vinculo.id, l.localId, tiposVisibles(l.capacidades)),
        sincronizacion: l.sincronizacion,
      });
    }
    locales.sort(ordenDeChats);
    let ultimoGeneral: EventoGeneral | null = null;
    for (const l of locales) {
      if (l.ultimoEvento && (!ultimoGeneral || masReciente(l.ultimoEvento, ultimoGeneral))) {
        ultimoGeneral = { ...l.ultimoEvento, local: { localId: l.localId, nombre: l.nombre } };
      }
    }
    return ok<RespuestaChats>({
      estado: "OK",
      usuario: a.usuario,
      general: { noLeidos: locales.reduce((n, l) => n + l.noLeidos, 0), ultimoEvento: ultimoGeneral },
      locales,
    });
  });
}

/** Por el último evento, del más reciente al más antiguo; sin eventos, al final; empate por nombre y por id. */
export function ordenDeChats(a: LocalDeChats, b: LocalDeChats): number {
  if (a.ultimoEvento && b.ultimoEvento) {
    if (a.ultimoEvento.fecha !== b.ultimoEvento.fecha || a.ultimoEvento.id !== b.ultimoEvento.id) {
      return masReciente(a.ultimoEvento, b.ultimoEvento) ? -1 : 1;
    }
  } else if (a.ultimoEvento || b.ultimoEvento) {
    return a.ultimoEvento ? -1 : 1;
  }
  return a.nombre.localeCompare(b.nombre, "es") || a.localId - b.localId;
}

// ── GET /api/chats/local ────────────────────────────────────────────────────

export function manejarLocal(request: Request, deps: DependenciasSesion): Promise<Response> {
  const p = parametros(request, ["localId", "cursor"]);
  const crudo = p?.get("localId");
  const cursorCrudo = p?.get("cursor");
  const desde: PosicionHistorial | null = cursorCrudo === undefined ? null : decodificarCursor(cursorCrudo);
  if (!p || !crudo || !LOCAL_ID.test(crudo) || (cursorCrudo !== undefined && !desde)) {
    return Promise.resolve(falla({ estado: "SOLICITUD_INVALIDA" }, request, deps));
  }
  const localId = Number(crudo);
  return responder<RespuestaLocal>(request, deps, async (a) => {
    const autorizado = a.autorizados.find((l) => l.localId === localId);
    if (!autorizado) return localNoAutorizado();
    const [local] = await prepararLocales(deps, a, [autorizado]);
    if (!local) return localNoAutorizado();
    const { db, config, sesion } = a.contexto;
    // Tanda 6C: las preguntas guardadas en este Local, intercaladas por hora (preguntas/guardadas.ts).
    const preguntas = fuenteDePreguntas(db, { vinculoId: sesion.vinculo.id, erpLocalId: localId, hoy: a, ahora: new Date(deps.ahora()) });
    const pagina = await paginaDeHistorial(db, config.instalacionId, [visible(local)], desde, undefined, preguntas);
    return ok<RespuestaLocal>({
      estado: "OK",
      local: {
        localId,
        nombre: local.nombre,
        esDeposito: local.esDeposito,
        ventas: a.conVentas.some((l) => l.localId === localId),
        caja: a.conCaja.some((l) => l.localId === localId),
        stock: a.conStock.some((l) => l.localId === localId),
        pendientes: a.conPendientes.some((l) => l.localId === localId),
      },
      sincronizacion: local.sincronizacion,
      preguntas: deps.ia?.ok === true,
      noLeidos: await contarNoLeidos(db, sesion.vinculo.id, localId, tiposVisibles(local.capacidades)),
      leidoHasta: ((await leerLectura(db, sesion.vinculo.id, localId)) ?? 0n).toString(),
      eventos: pagina.filas.map((f) => f.evento),
      guardadas: pagina.preguntas,
      siguiente: pagina.siguiente,
    });
  });
}

// ── GET /api/chats/general ──────────────────────────────────────────────────

export function manejarGeneral(request: Request, deps: DependenciasSesion): Promise<Response> {
  const p = parametros(request, ["cursor"]);
  const cursorCrudo = p?.get("cursor");
  const desde: PosicionHistorial | null = cursorCrudo === undefined ? null : decodificarCursor(cursorCrudo);
  if (!p || (cursorCrudo !== undefined && !desde)) return Promise.resolve(falla({ estado: "SOLICITUD_INVALIDA" }, request, deps));
  return responder<RespuestaGeneral>(request, deps, async (a) => {
    const preparados = await prepararLocales(deps, a, a.autorizados);
    const { db, config, sesion } = a.contexto;
    const porId = new Map<number, LocalSincronizado>(preparados.map((l) => [l.localId, l]));
    // General es una proyección: la misma tabla de eventos, filtrada por los locales autorizados de AHORA.
    const preguntas = fuenteDePreguntas(db, { vinculoId: sesion.vinculo.id, erpLocalId: null, hoy: a, ahora: new Date(deps.ahora()) });
    const pagina = await paginaDeHistorial(db, config.instalacionId, preparados.map(visible), desde, undefined, preguntas);
    let noLeidos = 0;
    for (const l of preparados) noLeidos += await contarNoLeidos(db, sesion.vinculo.id, l.localId, tiposVisibles(l.capacidades));
    return ok<RespuestaGeneral>({
      estado: "OK",
      noLeidos,
      eventos: pagina.filas.map((f) => ({ ...f.evento, local: { localId: f.erpLocalId, nombre: porId.get(f.erpLocalId)!.nombre } })),
      guardadas: pagina.preguntas,
      siguiente: pagina.siguiente,
      preguntas: deps.ia?.ok === true,
      localesDemorados: preparados.filter((l) => l.sincronizacion === "DEMORADA").map((l) => l.localId),
      pendientes: a.conPendientes.length > 0,
    });
  });
}

// ── POST /api/chats/leido ───────────────────────────────────────────────────

type Marca = { readonly localId: number; readonly hasta: bigint };

/** El cuerpo, exactamente `{ marcas: [{ localId, hastaEventoId }] }`: 1 a 50 marcas, sin locales repetidos. */
export function leerMarcas(cuerpo: Record<string, unknown> | null): Marca[] | null {
  if (!cuerpo || Object.keys(cuerpo).length !== 1 || !Array.isArray(cuerpo.marcas)) return null;
  const marcas = cuerpo.marcas as unknown[];
  if (marcas.length === 0 || marcas.length > MAX_MARCAS) return null;
  const salida: Marca[] = [];
  for (const m of marcas) {
    if (m === null || typeof m !== "object" || Array.isArray(m)) return null;
    const o = m as Record<string, unknown>;
    if (Object.keys(o).length !== 2) return null;
    const { localId } = o;
    if (typeof localId !== "number" || !Number.isSafeInteger(localId) || localId <= 0) return null;
    const hasta = leerIdEvento(o.hastaEventoId);
    if (hasta === null || salida.some((x) => x.localId === localId)) return null;
    salida.push({ localId, hasta });
  }
  return salida;
}

export async function manejarLeido(request: Request, deps: DependenciasSesion): Promise<Response> {
  if (!deps.config.ok) return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  if (!origenPermitido(request.headers, deps.config.config.origenPublico)) return falla({ estado: "ORIGEN_NO_PERMITIDO" }, request, deps);
  const marcas = leerMarcas(await leerObjetoJson(request, MAX_BYTES_LEIDO));
  if (!marcas) return falla({ estado: "SOLICITUD_INVALIDA" }, request, deps);
  return responder<RespuestaLeido>(request, deps, async (a) => {
    // TODOS los locales tienen que estar autorizados ahora; si uno no, no se marca ninguno.
    const locales = marcas.map((m) => a.autorizados.find((l) => l.localId === m.localId));
    if (!locales.every((l) => l !== undefined)) return localNoAutorizado();
    const { db, sesion } = a.contexto;
    const lecturas = await db.$transaction(async (tx) => {
      const salida: { localId: number; leidoHasta: string; noLeidos: number }[] = [];
      for (const [i, m] of marcas.entries()) {
        // Se recorta al mayor Evento.id DE ESE LOCAL y nunca retrocede (eventos/lectura.ts).
        const leido = await avanzarLectura(tx, sesion.vinculo.id, m.localId, m.hasta);
        const noLeidos = await contarNoLeidos(tx, sesion.vinculo.id, m.localId, tiposVisibles(locales[i]!.capacidades));
        salida.push({ localId: m.localId, leidoHasta: leido.toString(), noLeidos });
      }
      return salida;
    });
    return ok<RespuestaLeido>({ estado: "OK", lecturas });
  });
}

// ── GET /api/chats/ventas ───────────────────────────────────────────────────
//
// Las ventas de HOY de un local (Tanda 3A). Dos pasos, sin reintentos:
//
//   1. autorización viva: el local tiene que estar en el `mi_alcance` de ahora
//      y anunciar `ventas_resumen`. Si no, NO_AUTORIZADO, igual que chats/local.
//      El `grupoId` sale de ahí, nunca del navegador;
//   2. `ventasResumenDeSesion` con período "hoy". El ERP vuelve a decidir.
//      VINCULO_NO_VALIDO revoca (lo hace conDelegacion); cualquier otro
//      rechazo —caído, lento, NO_AUTORIZADO, respuesta ilegible— es
//      ERP_NO_DISPONIBLE y la sesión queda como está.
//
// Nada se guarda. Los números son los del ERP, copiados campo por campo; si la
// respuesta no es del local y del período pedidos, no se muestra nada.

/** Lo que el ERP contestó → lo que ve el navegador, o null si no es lo que se pidió. */
export function ventasPublicas(d: DatosVentasResumen, local: LocalAutorizado): Extract<RespuestaVentas, { estado: "OK" }> | null {
  if (d.local.id !== local.localId || d.grupoId !== local.grupoId || d.periodo.tipo !== "hoy") return null;
  return {
    estado: "OK",
    local: { id: local.localId, nombre: local.nombre },
    periodo: { desde: d.periodo.desde, hasta: d.periodo.hasta },
    cantidadVentas: d.cantidadVentas,
    totalVendido: d.totalVendido,
    mediosDePago: d.mediosDePago.map((m) => ({ medio: m.medio, etiqueta: m.etiqueta, total: m.total, cantidadPagos: m.cantidadPagos })),
    advertencias: d.advertencias.map((a) => ({ codigo: a.codigo, mensaje: a.mensaje })),
  };
}

/**
 * Las rutas que consultan UN local "hoy" (ventas, Tanda 3A; caja, Tanda 7B;
 * stock, Tanda 8B) hacen lo mismo con distinta capacidad: autorización viva (el
 * local en `mi_alcance` CON la capacidad, `grupoId` de ahí), una consulta al
 * ERP, y la copia de lo contestado si es lo pedido. Escrito una vez.
 * `deRechazo` (stock): un rechazo del ERP que es una respuesta y no una falla,
 * reconocido por su código; los demás siguen siendo fallas.
 */
async function consultarLocalHoy<D, R>(
  request: Request,
  deps: DependenciasSesion,
  locales: (a: Autorizacion) => readonly LocalAutorizado[],
  consultar: (local: LocalAutorizado) => Promise<ResultadoDelegado<D>>,
  publicar: (d: D, local: LocalAutorizado) => R | null,
  deRechazo?: (r: ResultadoConsulta<D>, local: LocalAutorizado) => R | null,
): Promise<Response> {
  const p = parametros(request, ["localId"]);
  const crudo = p?.get("localId");
  if (!p || !crudo || !LOCAL_ID.test(crudo)) return falla({ estado: "SOLICITUD_INVALIDA" }, request, deps);
  const localId = Number(crudo);

  let autorizacion: ResultadoDelegado<Trabajo<LocalAutorizado>>;
  try {
    autorizacion = await conAutorizacionViva(request.headers, deps, async (a) => {
      const local = locales(a).find((l) => l.localId === localId);
      return local ? ok(local) : localNoAutorizado();
    });
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  }
  if (autorizacion.tipo !== "OK") return falla(fallaDeDelegacion(autorizacion), request, deps);
  if (autorizacion.datos.tipo === "NO_AUTORIZADO") return falla({ estado: "NO_AUTORIZADO" }, request, deps);
  const local = autorizacion.datos.respuesta;

  let r: ResultadoDelegado<D>;
  try {
    r = await consultar(local);
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  }
  switch (r.tipo) {
    case "SIN_SESION":
      return falla(r.vinculoInvalidado ? { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" } : { estado: "SIN_SESION" }, request, deps);
    case "SERVICIO_NO_DISPONIBLE":
      return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
    case "RECHAZO_ERP": {
      const comoRespuesta = deRechazo?.(r.resultado, local);
      if (comoRespuesta) return json(comoRespuesta);
      // Por código, no por texto: ninguno de estos dice algo del vínculo, así que la sesión sigue.
      // NO_AUTORIZADO acá también es ERP_NO_DISPONIBLE (el local ya se autorizó con mi_alcance); el cupo, el suyo.
      return falla(esFalloDeCupo(r.resultado) ? { estado: "ERP_CUPO_EXCEDIDO" } : { estado: "ERP_NO_DISPONIBLE" }, request, deps);
    }
    case "OK": {
      const publica = publicar(r.datos, local);
      return publica ? json(publica) : falla({ estado: "ERP_NO_DISPONIBLE" }, request, deps);
    }
  }
}

export function manejarVentas(request: Request, deps: DependenciasSesion): Promise<Response> {
  return consultarLocalHoy(
    request,
    deps,
    (a) => a.conVentas,
    (local) => ventasResumenDeSesion(request.headers, { alcance: { grupoId: local.grupoId, localId: local.localId }, periodo: { tipo: "hoy" } }, deps),
    ventasPublicas,
  );
}

// ── GET /api/chats/caja ─────────────────────────────────────────────────────
//
// Las cajas de HOY de un local (Tanda 7B), por turno operativo. El mismo
// camino que ventas, con `cajas_resumen`: el local tiene que anunciarla en el
// `mi_alcance` de ahora. Cupo: 1 `mi_alcance` + 1 `cajas_resumen`. Nada se
// guarda. TURNO_OPERATIVO_INVALIDO no puede venir (no se pide turno); si viene,
// como cualquier otro rechazo, es ERP_NO_DISPONIBLE.

export function manejarCaja(request: Request, deps: DependenciasSesion): Promise<Response> {
  return consultarLocalHoy(
    request,
    deps,
    (a) => a.conCaja,
    (local) => cajasResumenDeSesion(request.headers, { alcance: { grupoId: local.grupoId, localId: local.localId }, periodo: { tipo: "hoy" } }, deps),
    (d, local): RespuestaCaja | null => {
      const c = cajasPublicas(d, { localId: local.localId, grupoId: local.grupoId, periodo: { tipo: "hoy" } });
      // El nombre de HOY, de `mi_alcance`: el mismo del encabezado del chat.
      return c ? { estado: "OK", ...c, local: { id: local.localId, nombre: local.nombre } } : null;
    },
  );
}

// ── GET /api/chats/stock ────────────────────────────────────────────────────
//
// Los productos bajo mínimo de un local (Tanda 8B), como los calcula el ERP. El
// mismo camino que ventas y caja, con `stock_consulta` en modo `bajo_minimo`:
// el local tiene que anunciarla en el `mi_alcance` de ahora. Cupo: 1
// `mi_alcance` + 1 `stock_consulta`. Nada se guarda. STOCK_MINIMO_NO_DISPONIBLE
// —el local no tiene ningún mínimo ajustado— es una respuesta (`sinMinimo`),
// no una falla.

export function manejarStock(request: Request, deps: DependenciasSesion): Promise<Response> {
  const pedido = (local: LocalAutorizado) => ({ localId: local.localId, grupoId: local.grupoId, nombre: local.nombre });
  return consultarLocalHoy(
    request,
    deps,
    (a) => a.conStock,
    (local) => stockConsultaDeSesion(request.headers, { alcance: { grupoId: local.grupoId, localId: local.localId }, parametros: { modo: "bajo_minimo" } }, deps),
    (d, local): RespuestaStock | null => {
      const b = bajoMinimoPublico(d, pedido(local));
      return b ? { estado: "OK", ...b } : null;
    },
    (r, local): RespuestaStock | null => (esSinMinimo(r) ? { estado: "OK", ...sinMinimoPublico(pedido(local)) } : null),
  );
}

// ── GET /api/chats/pendientes y /api/chats/pendientes/general ──────────────
//
// Lo pendiente (Tanda 9B): los pedidos que el local pidió y siguen sin enviar
// (`pedidos_pendientes`) y las cajas de hoy y de ayer con diferencia o sin
// verificar (`cajas_resumen`). Primero la autorización viva —el local, o los
// locales, que anuncian alguna de las dos en el `mi_alcance` de ahora, con el
// `grupoId` de ahí—; después, por local, solo las fuentes que anuncia
// (pendientes/pendientes.ts). Una fuente que falla no tira las otras: la
// respuesta dice cuál faltó. Nada se guarda y no se toca la lectura.
//
// Dos rutas y no un `?localId=todos`: cada una con sus parámetros exactos, como
// el resto. El local va por query; General no lleva ninguno.
//
// Cupo: 1 `mi_alcance` + hasta 3 por local (pedidos, cajas de hoy, cajas de
// ayer). General: 1 + 3 por local con alguna de las dos.

/** La autorización viva y los locales de "Pendientes" de ahora, o la falla. */
async function localesDePendientesAhora(
  request: Request,
  deps: DependenciasSesion,
  elegir: (a: Autorizacion) => readonly LocalDePendientes[] | null,
): Promise<{ ok: true; locales: readonly LocalDePendientes[] } | { ok: false; respuesta: Response }> {
  let autorizacion: ResultadoDelegado<Trabajo<readonly LocalDePendientes[]>>;
  try {
    autorizacion = await conAutorizacionViva(request.headers, deps, async (a) => {
      const elegidos = elegir(a);
      return elegidos ? ok(elegidos) : localNoAutorizado();
    });
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return { ok: false, respuesta: falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps) };
  }
  if (autorizacion.tipo !== "OK") return { ok: false, respuesta: falla(fallaDeDelegacion(autorizacion), request, deps) };
  if (autorizacion.datos.tipo === "NO_AUTORIZADO") return { ok: false, respuesta: falla({ estado: "NO_AUTORIZADO" }, request, deps) };
  return { ok: true, locales: autorizacion.datos.respuesta };
}

export async function manejarPendientes(request: Request, deps: DependenciasSesion): Promise<Response> {
  const p = parametros(request, ["localId"]);
  const crudo = p?.get("localId");
  if (!p || !crudo || !LOCAL_ID.test(crudo)) return falla({ estado: "SOLICITUD_INVALIDA" }, request, deps);
  const localId = Number(crudo);
  const elegidos = await localesDePendientesAhora(request, deps, (a) => {
    const l = a.conPendientes.find((x) => x.localId === localId);
    return l ? [l] : null;
  });
  if (!elegidos.ok) return elegidos.respuesta;
  const r = await pendientesDeLocales(request.headers, deps, elegidos.locales);
  if (r.tipo === "FALLA") return falla(r.falla, request, deps);
  return json({ estado: "OK", ...r.locales[0]! } satisfies RespuestaPendientes);
}

// ── GET /api/chats/buscar ───────────────────────────────────────────────────
//
// Buscar en el historial (Tanda 10): eventos guardados y preguntas guardadas
// de la persona, en la base propia (buscar/buscar.ts). Del ERP, solo
// `mi_alcance`: es la autorización viva de siempre, y sin ella no se busca
// (fallo cerrado, como el historial). En un Local, ese local tiene que estar
// hoy entre los de los chats; en General, todos los de hoy. Las preguntas: en
// un Local, las de ese Local; en General, las de General y las de cada local
// de hoy. No marca leído y no guarda nada. Cupo: 1.
//
// Parámetros exactos: `texto` (1 a 60), `filtro` (todos | transferencias |
// pedidos | preguntas), `localId=N` o `general=1` (uno de los dos) y `cursor`
// opcional, el `siguiente` de la página anterior con el mismo texto y filtro.

export function manejarBuscar(request: Request, deps: DependenciasSesion): Promise<Response> {
  const p = parametros(request, ["texto", "filtro", "localId", "general", "cursor"]);
  const busqueda = p?.has("texto") ? leerTextoDeBusqueda(p.get("texto")!) : null;
  const filtro = FILTROS_BUSQUEDA.find((f) => f === p?.get("filtro"));
  const crudo = p?.get("localId");
  const general = p?.get("general");
  const cursorCrudo = p?.get("cursor");
  const desde: PosicionHistorial | null = cursorCrudo === undefined ? null : decodificarCursor(cursorCrudo);
  const ambitoValido = crudo !== undefined ? general === undefined && LOCAL_ID.test(crudo) : general === "1";
  if (!p || !busqueda || !filtro || !ambitoValido || (cursorCrudo !== undefined && !desde)) {
    return Promise.resolve(falla({ estado: "SOLICITUD_INVALIDA" }, request, deps));
  }
  const localId = crudo === undefined ? null : Number(crudo);
  return responder<RespuestaBuscar>(request, deps, async (a) => {
    const elegidos = localId === null ? a.autorizados : a.autorizados.filter((l) => l.localId === localId);
    if (localId !== null && elegidos.length === 0) return localNoAutorizado();
    const { db, config, sesion } = a.contexto;
    const r = await buscarEnHistorial(db, {
      instalacionId: config.instalacionId,
      vinculoId: sesion.vinculo.id,
      locales: elegidos.map((l) => ({ ...visible(l), nombre: l.nombre })),
      chatsDePreguntas: localId === null ? [null, ...elegidos.map((l) => l.localId)] : [localId],
      hoy: a,
      ahora: new Date(deps.ahora()),
      busqueda,
      filtro,
      desde,
    });
    return ok<RespuestaBuscar>({ estado: "OK", ...r });
  });
}

export async function manejarPendientesGeneral(request: Request, deps: DependenciasSesion): Promise<Response> {
  if (parametros(request, []) === null) return falla({ estado: "SOLICITUD_INVALIDA" }, request, deps);
  const elegidos = await localesDePendientesAhora(request, deps, (a) => (a.conPendientes.length > 0 ? a.conPendientes : null));
  if (!elegidos.ok) return elegidos.respuesta;
  const r = await pendientesDeLocales(request.headers, deps, elegidos.locales);
  if (r.tipo === "FALLA") return falla(r.falla, request, deps);
  return json({ estado: "OK", locales: ordenDeGeneral(r.locales) } satisfies RespuestaPendientesGeneral);
}
