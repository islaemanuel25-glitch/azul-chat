// src/server/sesion/configuracion.ts
//
// LA CONFIGURACIÓN DEL PANEL ☰ (Tanda 11). Las rutas de src/app solo delegan.
//
//   GET    /api/sesion/configuracion  el horario de silencio, el saldo de IA del mes y los dispositivos
//   PUT    /api/sesion/silencio       guardar el horario de silencio
//   DELETE /api/sesion/otras          cerrar las OTRAS sesiones de la persona y borrar sus avisos push
//
// Ninguna llama al ERP: es configuración de Azul Chat, de la persona (el
// vínculo de la sesión de la solicitud), nunca de un id que mande el
// navegador. Las dos que escriben exigen Origin exacto, como vincular y
// cerrar: un sitio ajeno no puede callarle los avisos ni cerrarle sesiones a
// nadie. GET no lo exige: el navegador no manda Origin en un GET del mismo
// sitio, y leer no cambia nada.

import "server-only";

import {
  esHorarioSilencio,
  type Dispositivo,
  type FallaConfiguracion,
  type HorarioSilencio,
  type RespuestaCerrarOtras,
  type RespuestaConfiguracion,
  type RespuestaSilencio,
  type SaldoIa,
} from "../../shared/sesion/configuracion.ts";
import { leerObjetoJson } from "../http/cuerpo.ts";
import { origenPermitido } from "../http/origen.ts";
import { json } from "../http/respuestas.ts";
import { reservaPorPregunta } from "../ia/tarifa.ts";
import { mesEnArgentina } from "../preguntas/intencion.ts";
import { sesionDeLaSolicitud, type Contexto } from "./delegacion.ts";
import type { DependenciasSesion } from "./dependencias.ts";
import type { AccesoDePersona } from "../accesos/accesos.ts";
import { accesoDelContexto } from "../chats/autorizacion.ts";

const MAX_BYTES_SILENCIO = 256;

const STATUS: Record<FallaConfiguracion["estado"], number> = {
  SIN_SESION: 401,
  SIN_ACCESO: 403,
  ORIGEN_NO_PERMITIDO: 403,
  SOLICITUD_INVALIDA: 400,
  SERVICIO_NO_DISPONIBLE: 503,
};
const responder = <R extends { estado: string }>(r: R) => json(r, { status: r.estado === "OK" ? 200 : STATUS[r.estado as FallaConfiguracion["estado"]] });

/** La sesión vigente, o la falla. `conOrigen`: las que escriben. */
async function contexto(
  request: Request,
  deps: DependenciasSesion,
  conOrigen: boolean,
): Promise<{ ok: true; contexto: Contexto; acceso: AccesoDePersona } | { ok: false; falla: FallaConfiguracion }> {
  if (!deps.config.ok) return { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } };
  if (conOrigen && !origenPermitido(request.headers, deps.config.config.origenPublico)) return { ok: false, falla: { estado: "ORIGEN_NO_PERMITIDO" } };
  const leida = await sesionDeLaSolicitud(request.headers, deps);
  if (leida.tipo === "SIN_SESION") return { ok: false, falla: { estado: "SIN_SESION" } };
  if (leida.tipo === "SERVICIO_NO_DISPONIBLE") return { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } };
  // Tanda 15: la configuración propia es parte de "entrar".
  let acceso: AccesoDePersona;
  try {
    acceso = await accesoDelContexto(leida.contexto, deps);
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } };
  }
  if (!acceso.permisos.entrar) return { ok: false, falla: { estado: "SIN_ACCESO" } };
  return { ok: true, contexto: leida.contexto, acceso };
}

/** Una falla de la base: SERVICIO_NO_DISPONIBLE, sin mensaje. */
async function conBase<R extends { estado: string }>(deps: DependenciasSesion, trabajo: () => Promise<R>): Promise<Response> {
  try {
    return responder(await trabajo());
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return responder<FallaConfiguracion>({ estado: "SERVICIO_NO_DISPONIBLE" });
  }
}

/** El primer día del mes siguiente a "AAAA-MM". */
export function primeroDelMesSiguiente(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
}

/** Millonésimas de dólar → centavos, para arriba. */
const aCentavos = (microUsd: bigint) => Number((microUsd + 9_999n) / 10_000n);

/** El primer instante del mes "AAAA-MM" en Argentina (UTC−3, sin horario de verano). */
export function inicioDelMesEnArgentina(mes: string): Date {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m - 1, 1, 3));
}

/**
 * El saldo de IA del mes de Argentina, de ConsumoIa. "Agotado" es exactamente
 * lo que decide reservarPregunta (ia/consumo.ts): que la reserva de una
 * pregunta más ya no entre en el tope.
 *
 * Tanda 14: el gasto y el tope son de TODO el negocio (un solo ConsumoIa por
 * mes, para todas las personas). Las preguntas son las de esta persona: las
 * suyas guardadas desde el 1 del mes. Las de los demás no se cuentan acá.
 */
async function saldoIa(c: Contexto, deps: DependenciasSesion, ahora: Date): Promise<SaldoIa | null> {
  if (deps.ia?.ok !== true) return null;
  const tope = deps.ia.config.topeMicroUsd;
  const mes = mesEnArgentina(ahora);
  const fila = await c.db.consumoIa.findUnique({ where: { mes }, select: { costoMicroUsd: true } });
  const gastado = fila?.costoMicroUsd ?? 0n;
  const propias = await c.db.pregunta.count({ where: { vinculoId: c.sesion.vinculo.id, creadaEn: { gte: inicioDelMesEnArgentina(mes) } } });
  return {
    gastadoCentavos: aCentavos(gastado),
    topeCentavos: aCentavos(tope),
    preguntasPropias: propias,
    agotado: gastado + reservaPorPregunta(ahora) > tope,
    reiniciaEl: primeroDelMesSiguiente(mes),
  };
}

// ── GET /api/sesion/configuracion ───────────────────────────────────────────

export async function manejarConfiguracion(request: Request, deps: DependenciasSesion): Promise<Response> {
  if (new URL(request.url).search !== "") return responder<FallaConfiguracion>({ estado: "SOLICITUD_INVALIDA" });
  const c = await contexto(request, deps, false);
  if (!c.ok) return responder(c.falla);
  const { db, sesion } = c.contexto;
  const ahora = new Date(deps.ahora());
  return conBase(deps, async (): Promise<RespuestaConfiguracion> => {
    const v = await db.vinculo.findUniqueOrThrow({
      where: { id: sesion.vinculo.id },
      select: { silencioActivo: true, silencioDesde: true, silencioHasta: true },
    });
    const sesiones = await db.sesion.findMany({
      where: { vinculoId: sesion.vinculo.id, revocadaEn: null, expiraEn: { gt: ahora } },
      orderBy: [{ creadaEn: "desc" }, { id: "asc" }],
      select: { id: true, creadaEn: true },
    });
    const dispositivos: Dispositivo[] = sesiones
      .map((s) => ({ creadaEn: s.creadaEn.toISOString(), esEste: s.id === sesion.sesionId }))
      .sort((a, b) => Number(b.esEste) - Number(a.esEste));
    return {
      estado: "OK",
      silencio: { activo: v.silencioActivo, desde: v.silencioDesde, hasta: v.silencioHasta },
      // Tanda 15: el saldo de IA, solo a quien tiene el permiso "ia".
      ia: c.acceso.permisos.ia ? await saldoIa(c.contexto, deps, ahora) : null,
      administrador: c.acceso.administrador,
      dispositivos,
    };
  });
}

// ── PUT /api/sesion/silencio ────────────────────────────────────────────────

export async function manejarSilencio(request: Request, deps: DependenciasSesion): Promise<Response> {
  const c = await contexto(request, deps, true);
  if (!c.ok) return responder(c.falla);
  const cuerpo = await leerObjetoJson(request, MAX_BYTES_SILENCIO);
  if (!esHorarioSilencio(cuerpo)) return responder<FallaConfiguracion>({ estado: "SOLICITUD_INVALIDA" });
  const h: HorarioSilencio = { activo: cuerpo.activo, desde: cuerpo.desde, hasta: cuerpo.hasta };
  return conBase(deps, async (): Promise<RespuestaSilencio> => {
    await c.contexto.db.vinculo.update({
      where: { id: c.contexto.sesion.vinculo.id },
      data: { silencioActivo: h.activo, silencioDesde: h.desde, silencioHasta: h.hasta },
    });
    return { estado: "OK", silencio: h };
  });
}

// ── DELETE /api/sesion/otras ────────────────────────────────────────────────

/**
 * Cierra todas las sesiones vigentes de la persona MENOS la de esta solicitud,
 * y borra las suscripciones push de esas sesiones: un teléfono que ya no tiene
 * sesión no recibe avisos. En una transacción. Esta sesión y su suscripción
 * siguen como están; el vínculo con el ERP también.
 */
export async function manejarCerrarOtras(request: Request, deps: DependenciasSesion): Promise<Response> {
  const c = await contexto(request, deps, true);
  if (!c.ok) return responder(c.falla);
  if (new URL(request.url).search !== "") return responder<FallaConfiguracion>({ estado: "SOLICITUD_INVALIDA" });
  const { db, sesion } = c.contexto;
  const ahora = new Date(deps.ahora());
  return conBase(deps, async (): Promise<RespuestaCerrarOtras> => {
    const cerradas = await db.$transaction(async (tx) => {
      const otras = await tx.sesion.findMany({
        where: { vinculoId: sesion.vinculo.id, revocadaEn: null, expiraEn: { gt: ahora }, id: { not: sesion.sesionId } },
        select: { id: true },
      });
      const ids = otras.map((s) => s.id);
      if (ids.length === 0) return 0;
      await tx.pushSuscripcion.deleteMany({ where: { sesionId: { in: ids } } });
      const r = await tx.sesion.updateMany({ where: { id: { in: ids }, revocadaEn: null }, data: { revocadaEn: ahora } });
      return r.count;
    });
    return { estado: "OK", cerradas };
  });
}
