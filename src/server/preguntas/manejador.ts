// src/server/preguntas/manejador.ts
//
// POST /api/chats/preguntar — UNA PREGUNTA EN LENGUAJE NATURAL (Tanda 6A).
// La ruta de src/app solo delega acá.
//
// El camino, en este orden:
//
//   1. forma: Origin propio, cuerpo `{ pregunta (1–300 caracteres), localId? }`
//      exacto. Sin IA configurada, IA_NO_DISPONIBLE antes de gastar nada;
//   2. autorización viva: sesión → `mi_alcance` (UNA consulta al ERP). Si se
//      pregunta desde un Local, ese local tiene que estar hoy;
//   3. tope: se reserva el peor caso de una pregunta en ConsumoIa. Si no
//      entra, SALDO_AGOTADO y la IA no se llama (ia/consumo.ts);
//   4. la IA SOLO INTERPRETA: recibe la pregunta, la fecha de hoy, el local
//      actual y los nombres de los locales de hoy, y elige una intención del
//      catálogo (intencion.ts). Se ajusta el consumo al uso real;
//   5. el código valida la intención contra lo autorizado HOY (cada local con
//      su capacidad, período de calendario de hasta 31 días). Lo que no cierra
//      es NO_ENTIENDO, con ejemplos fijos;
//   6. el código contesta con datos de verdad:
//        · ventas de un local: 1 `ventas_resumen` (ventasResumenDeSesion);
//        · ventas de todos: 1 por cada local con `ventas_resumen`, sumadas por
//          el código. Si alguno falla se dice cuál y NO hay total;
//        · eventos: la base propia, de los locales autorizados hoy con esa
//          capacidad, historia incluida, por día de Argentina. Cantidad y los
//          primeros 10.
//
// CUPO DEL ERP: una pregunta gasta 1 (`mi_alcance`) + 1 por local consultado
// en ventas (como mucho 1 + la cantidad de locales con `ventas_resumen`);
// eventos, solo la primera. Sin reintentos de nada: ni del ERP ni de la IA.
//
// Nada se guarda: ni la pregunta ni la respuesta. No marca leído.

import "server-only";

import type { FallaChats } from "../../shared/chats/api.ts";
import {
  EJEMPLOS_DE_PREGUNTAS,
  MAX_LARGO_PREGUNTA,
  type PeriodoPregunta,
  type RespuestaPregunta,
  type VentasDeUnLocal,
} from "../../shared/chats/preguntas.ts";
import type { Periodo, ResultadoConsulta } from "../../shared/erp/contrato.ts";
import { aEventoPublico, SELECT_PUBLICO } from "../chats/historial.ts";
import { falla, fallaDeDelegacion, fallaDeRechazo } from "../chats/manejadores.ts";
import { conAutorizacionViva } from "../chats/autorizacion.ts";
import { esFalloDeCupo } from "../chats/sincronizacion.ts";
import { leerObjetoJson } from "../http/cuerpo.ts";
import { origenPermitido } from "../http/origen.ts";
import { json } from "../http/respuestas.ts";
import { ajustarPregunta, reservarPregunta } from "../ia/consumo.ts";
import { consultarIa } from "../ia/gemini.ts";
import { costoMicroUsd, reservaPorPregunta } from "../ia/tarifa.ts";
import type { ResultadoDelegado } from "../sesion/delegacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import { ventasResumenDeSesion } from "../ventas/ventasResumen.ts";
import {
  esquemaDeIntencion,
  EVENTO_DE_PREGUNTA,
  hoyEnArgentina,
  instruccionesDeIntencion,
  limitesEnUtc,
  mesEnArgentina,
  validarIntencion,
  type Intencion,
  type LocalesDeHoy,
} from "./intencion.ts";
import { sumarVentas, ventasDeUnLocal } from "./ventas.ts";

/** El cuerpo: 300 caracteres de hasta 4 bytes, más las claves. */
const MAX_BYTES_PREGUNTA = 2 * 1024;
/** Cuántos eventos se listan; del resto se dice cuántos hay. */
export const EVENTOS_EN_RESPUESTA = 10;
const LOCAL_ID = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** El cuerpo, exactamente `{ pregunta, localId? }`, con una pregunta de 1 a 300 caracteres que no es solo espacio. */
export function leerPedidoPregunta(cuerpo: Record<string, unknown> | null): { pregunta: string; localId: number | null } | null {
  if (!cuerpo) return null;
  const claves = Object.keys(cuerpo);
  if (!claves.includes("pregunta") || !claves.every((k) => k === "pregunta" || k === "localId")) return null;
  const { pregunta, localId } = cuerpo;
  if (typeof pregunta !== "string") return null;
  const limpia = pregunta.trim();
  if (limpia.length === 0 || [...pregunta].length > MAX_LARGO_PREGUNTA) return null;
  if (localId !== undefined && !LOCAL_ID(localId)) return null;
  return { pregunta: limpia, localId: localId ?? null };
}

const contestar = (r: RespuestaPregunta, status = 200) => json(r, { status });
const noEntiendo = () => contestar({ estado: "NO_ENTIENDO", ejemplos: EJEMPLOS_DE_PREGUNTAS });

/** Lo que la autorización viva deja para el resto de la pregunta. */
type Trabajo = { readonly tipo: "OK"; readonly locales: LocalesDeHoy; readonly instalacionId: string };

export async function manejarPreguntar(request: Request, deps: DependenciasSesion): Promise<Response> {
  // 1. Forma.
  if (!deps.config.ok || !deps.db) return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  if (!origenPermitido(request.headers, deps.config.config.origenPublico)) return falla({ estado: "ORIGEN_NO_PERMITIDO" }, request, deps);
  const pedido = leerPedidoPregunta(await leerObjetoJson(request, MAX_BYTES_PREGUNTA));
  if (!pedido) return falla({ estado: "SOLICITUD_INVALIDA" }, request, deps);
  if (!deps.ia?.ok) return contestar({ estado: "IA_NO_DISPONIBLE" }, 503);
  const ia = deps.ia.config;
  const db = deps.db;

  // 2. Autorización viva: una `mi_alcance`.
  let autorizacion: ResultadoDelegado<Trabajo>;
  try {
    autorizacion = await conAutorizacionViva(request.headers, deps, async (a): Promise<ResultadoConsulta<Trabajo>> => ({
      ok: true,
      requestId: "",
      datos: {
        tipo: "OK",
        instalacionId: a.contexto.config.instalacionId,
        locales: {
          eventos: a.autorizados.map((l) => ({ localId: l.localId, nombre: l.nombre, capacidades: l.capacidades })),
          ventas: a.conVentas.map((l) => ({ localId: l.localId, grupoId: l.grupoId, nombre: l.nombre })),
        },
      },
    }));
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  }
  if (autorizacion.tipo !== "OK") return falla(fallaDeDelegacion(autorizacion), request, deps);
  const { locales, instalacionId } = autorizacion.datos;
  const nombres = [...new Set([...locales.eventos.map((l) => l.nombre), ...locales.ventas.map((l) => l.nombre)])];
  let localActual: string | null = null;
  if (pedido.localId !== null) {
    const actual = [...locales.eventos, ...locales.ventas].find((l) => l.localId === pedido.localId);
    if (!actual) return falla({ estado: "NO_AUTORIZADO" }, request, deps);
    localActual = actual.nombre;
  }

  // 3. El tope, reservado antes de llamar.
  const ahora = new Date(deps.ahora());
  const mes = mesEnArgentina(ahora);
  const reserva = reservaPorPregunta(ahora);
  try {
    if (!(await reservarPregunta(db, mes, reserva, ia.topeMicroUsd))) return contestar({ estado: "SALDO_AGOTADO" });
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  }

  // 4. La IA interpreta. Solo la pregunta, la fecha, el local actual y los nombres.
  const hoy = hoyEnArgentina(ahora);
  const inicio = deps.ahora();
  const r = await consultarIa(instruccionesDeIntencion({ pregunta: pedido.pregunta, hoy, localActual, nombres }), esquemaDeIntencion(nombres), {
    config: ia,
    ...(deps.transporteIa ? { transporte: deps.transporteIa } : {}),
  });
  const costo = r.uso ? costoMicroUsd(r.uso.tokensEntrada, r.uso.tokensSalida, ahora) : null;
  try {
    // Sin uso conocido (Google no contestó), la reserva queda entera: no se sabe qué cobró.
    if (r.uso && costo !== null) await ajustarPregunta(db, mes, r.uso, costo - reserva);
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
  }

  const intencion: Intencion = r.ok ? validarIntencion(r.salida, hoy, locales) : { tipo: "NO_ENTIENDO" };
  deps.registrar({
    evento: "ia.pregunta",
    resultado: r.ok ? intencion.tipo : r.motivo === "NO_DISPONIBLE" ? r.codigo : "NO_ENTIENDO",
    duracionMs: Math.max(0, deps.ahora() - inicio),
    tokensEntrada: r.uso?.tokensEntrada ?? null,
    tokensSalida: r.uso?.tokensSalida ?? null,
    costoMicroUsd: costo === null ? null : Number(costo),
  });
  if (!r.ok && r.motivo === "NO_DISPONIBLE") return contestar({ estado: "IA_NO_DISPONIBLE" }, 503);

  // 5 y 6. El código valida y contesta.
  try {
    switch (intencion.tipo) {
      case "NO_ENTIENDO":
        return noEntiendo();
      case "EVENTOS":
        return contestar(await eventosDePregunta(db, instalacionId, intencion));
      case "VENTAS": {
        const v = await ventasDePregunta(request.headers, deps, intencion);
        return "falla" in v ? falla(v.falla, request, deps) : v.respuesta.estado === "NO_ENTIENDO" ? noEntiendo() : contestar(v.respuesta);
      }
    }
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return falla({ estado: "SERVICIO_NO_DISPONIBLE" }, request, deps);
  }
}

// ── Eventos: la base propia ─────────────────────────────────────────────────

/**
 * Los eventos de ese tipo, de esos locales (autorizados hoy con la capacidad),
 * entre el inicio del día `desde` y el fin del día `hasta` de Argentina, por
 * `fechaOperacion`. La historia cuenta: es historia válida para contestar.
 */
export async function eventosDePregunta(
  db: NonNullable<DependenciasSesion["db"]>,
  instalacionId: string,
  intencion: Extract<Intencion, { tipo: "EVENTOS" }>,
): Promise<RespuestaPregunta> {
  const { tipo, conDiferencias } = EVENTO_DE_PREGUNTA[intencion.tipoEvento];
  const { desde, hasta } = limitesEnUtc(intencion.periodo);
  const nombre = new Map(intencion.locales.map((l) => [l.localId, l.nombre]));
  const where = {
    instalacionId,
    erpLocalId: { in: intencion.locales.map((l) => l.localId) },
    tipo,
    fechaOperacion: { gte: desde, lt: hasta },
    ...(conDiferencias ? { payload: { path: ["tieneDiferencias"], equals: true } } : {}),
  };
  const [cantidad, filas] = await Promise.all([
    db.evento.count({ where }),
    db.evento.findMany({ where, orderBy: [{ fechaOperacion: "desc" }, { id: "desc" }], take: EVENTOS_EN_RESPUESTA, select: SELECT_PUBLICO }),
  ]);
  const local = intencion.todos ? null : intencion.locales[0]!;
  return {
    estado: "EVENTOS",
    tipo: intencion.tipoEvento,
    local: local ? { localId: local.localId, nombre: local.nombre } : null,
    periodo: intencion.periodo,
    noSeparaPor: intencion.noSeparaPor,
    cantidad,
    eventos: filas.map((f) => ({ ...aEventoPublico(f), local: { localId: f.erpLocalId, nombre: nombre.get(f.erpLocalId)! } })),
    restantes: Math.max(0, cantidad - filas.length),
  };
}

// ── Ventas: el ERP, local por local ─────────────────────────────────────────

const aPeriodoErp = (p: PeriodoPregunta): Periodo => (p.tipo === "rango" ? { tipo: "rango", desde: p.desde, hasta: p.hasta } : { tipo: p.tipo });

/** El ERP rechazó el período (forma o futuro): es una pregunta que no se puede contestar así. */
const CODIGOS_DE_PERIODO = new Set(["PERIODO_INVALIDO", "PERIODO_DEMASIADO_LARGO", "SOLICITUD_INVALIDA"]);

type ResultadoVentas = { readonly respuesta: RespuestaPregunta } | { readonly falla: FallaChats };

/**
 * Una `ventas_resumen` por local, de a una, sin reintentos. Un local:
 * cualquier falla es la falla de la pregunta. Todos: la primera que falla por
 * cupo corta las que faltan (no se sigue gastando), y si alguno falla se dice
 * cuál y no hay total.
 */
export async function ventasDePregunta(headers: Headers, deps: DependenciasSesion, intencion: Extract<Intencion, { tipo: "VENTAS" }>): Promise<ResultadoVentas> {
  const periodo = aPeriodoErp(intencion.periodo);
  const bien: VentasDeUnLocal[] = [];
  const fallidos: { id: number; nombre: string }[] = [];
  let primeraFalla: FallaChats | null = null;
  let periodoDelErp: PeriodoPregunta | null = null;

  for (const [i, l] of intencion.locales.entries()) {
    const r = await ventasResumenDeSesion(headers, { alcance: { grupoId: l.grupoId, localId: l.localId }, periodo }, deps);
    if (r.tipo === "SIN_SESION" || r.tipo === "SERVICIO_NO_DISPONIBLE") return { falla: fallaDeDelegacion(r) };
    if (r.tipo === "RECHAZO_ERP" && CODIGOS_DE_PERIODO.has(r.resultado.codigo)) return { respuesta: { estado: "NO_ENTIENDO", ejemplos: EJEMPLOS_DE_PREGUNTAS } };
    const v = r.tipo === "OK" ? ventasDeUnLocal(r.datos, { localId: l.localId, grupoId: l.grupoId, periodo }) : null;
    if (r.tipo === "OK" && v) {
      bien.push(v);
      periodoDelErp ??= { tipo: intencion.periodo.tipo, desde: r.datos.periodo.desde, hasta: r.datos.periodo.hasta };
      continue;
    }
    // NO_AUTORIZADO del ERP a ventas de un local que mi_alcance anunció: como en GET /api/chats/ventas, no disponible.
    const f: FallaChats = r.tipo === "RECHAZO_ERP" && esFalloDeCupo(r.resultado) ? fallaDeRechazo(r.resultado) : { estado: "ERP_NO_DISPONIBLE" };
    primeraFalla ??= f;
    if (!intencion.todos) return { falla: f };
    fallidos.push({ id: l.localId, nombre: l.nombre });
    if (f.estado === "ERP_CUPO_EXCEDIDO") {
      for (const resto of intencion.locales.slice(i + 1)) fallidos.push({ id: resto.localId, nombre: resto.nombre });
      break;
    }
  }

  if (bien.length === 0) return { falla: primeraFalla ?? { estado: "ERP_NO_DISPONIBLE" } };
  const periodoFinal = periodoDelErp ?? intencion.periodo;
  if (!intencion.todos) return { respuesta: { estado: "VENTAS", alcance: "LOCAL", periodo: periodoFinal, ventas: bien[0]!, noSeparaPor: intencion.noSeparaPor } };
  return {
    respuesta: {
      estado: "VENTAS",
      alcance: "TODOS",
      periodo: periodoFinal,
      noSeparaPor: intencion.noSeparaPor,
      total: fallidos.length === 0 ? sumarVentas(bien) : null,
      locales: bien,
      fallidos,
    },
  };
}
