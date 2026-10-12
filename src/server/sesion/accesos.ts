// src/server/sesion/accesos.ts
//
// GET y PUT /api/sesion/accesos: LA SECCIÓN "ACCESOS" DEL ADMINISTRADOR (Tanda 15).
//
// Solo para administradores (AZUL_CHAT_ADMINISTRADORES, accesos/accesos.ts):
// a cualquier otra persona, 403 SIN_ACCESO, haga lo que haga con el pedido.
// Como la configuración (Tanda 11): sesión, y Origin en la que escribe; sobre
// la sesión de la solicitud, sin pedirle nada al ERP.
//
//   · GET: las personas que alguna vez se vincularon en esta instalación, con
//     su nombre (el último que dio el ERP, o "Persona <id>"), cuándo se
//     vincularon por última vez, si administran y sus seis permisos. Los
//     administradores, con todo prendido.
//   · PUT: los seis permisos de UNA persona, enteros, cada vez (como el
//     horario de silencio). Una persona que administra —también uno mismo— no
//     se toca: ES_ADMINISTRADOR. Un id que nunca se vinculó, tampoco:
//     PERSONA_DESCONOCIDA. Queda quién y cuándo lo cambió. Rige desde el
//     pedido siguiente de esa persona: no se cierra ninguna sesión.

import "server-only";

import {
  esPedidoAccesos,
  NINGUN_PERMISO,
  PERMISOS,
  TODOS_LOS_PERMISOS,
  type FallaAccesos,
  type PersonaConAcceso,
  type Permisos,
  type RespuestaAccesos,
  type RespuestaGuardarAccesos,
} from "../../shared/sesion/accesos.ts";
import { esAdministrador } from "../accesos/accesos.ts";
import { accesoDelContexto } from "../chats/autorizacion.ts";
import { leerObjetoJson } from "../http/cuerpo.ts";
import { origenPermitido } from "../http/origen.ts";
import { json } from "../http/respuestas.ts";
import { sesionDeLaSolicitud, type Contexto } from "./delegacion.ts";
import type { DependenciasSesion } from "./dependencias.ts";

const MAX_BYTES_ACCESOS = 512;

const STATUS: Record<FallaAccesos["estado"], number> = {
  SIN_SESION: 401,
  SIN_ACCESO: 403,
  ORIGEN_NO_PERMITIDO: 403,
  SOLICITUD_INVALIDA: 400,
  ES_ADMINISTRADOR: 409,
  PERSONA_DESCONOCIDA: 404,
  SERVICIO_NO_DISPONIBLE: 503,
};
const responder = <R extends { estado: string }>(r: R) => json(r, { status: r.estado === "OK" ? 200 : STATUS[r.estado as FallaAccesos["estado"]] });

/** La sesión vigente de un ADMINISTRADOR, o la falla. `conOrigen`: la que escribe. */
async function deAdministrador(request: Request, deps: DependenciasSesion, conOrigen: boolean): Promise<{ ok: true; contexto: Contexto } | { ok: false; falla: FallaAccesos }> {
  if (!deps.config.ok) return { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } };
  if (conOrigen && !origenPermitido(request.headers, deps.config.config.origenPublico)) return { ok: false, falla: { estado: "ORIGEN_NO_PERMITIDO" } };
  const leida = await sesionDeLaSolicitud(request.headers, deps);
  if (leida.tipo === "SIN_SESION") return { ok: false, falla: { estado: "SIN_SESION" } };
  if (leida.tipo === "SERVICIO_NO_DISPONIBLE") return { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } };
  // Lo decide la variable del servidor y la sesión, nada que mande el navegador.
  const acceso = await accesoDelContexto(leida.contexto, deps);
  if (!acceso.administrador) return { ok: false, falla: { estado: "SIN_ACCESO" } };
  return { ok: true, contexto: leida.contexto };
}

/** Una falla de la base: SERVICIO_NO_DISPONIBLE, sin mensaje. */
async function conBase<R extends { estado: string }>(deps: DependenciasSesion, trabajo: () => Promise<R>): Promise<Response> {
  try {
    return responder(await trabajo());
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return responder<FallaAccesos>({ estado: "SERVICIO_NO_DISPONIBLE" });
  }
}

const SELECT_PERMISOS = { entrar: true, ventas: true, caja: true, stock: true, pendientes: true, ia: true } as const;

/** Una persona de la lista: los administradores con todo; los demás, su fila, o nada. */
function persona(
  c: Contexto,
  v: { erpUsuarioId: number; erpNombre: string | null; vinculadoEn: Date },
  fila: Permisos | undefined,
): PersonaConAcceso {
  const administrador = esAdministrador(c.config.administradores, v.erpUsuarioId);
  return {
    personaId: v.erpUsuarioId,
    nombre: v.erpNombre ?? `Persona ${v.erpUsuarioId}`,
    vinculadoEn: v.vinculadoEn.toISOString(),
    administrador,
    permisos: administrador ? TODOS_LOS_PERMISOS : (fila ?? NINGUN_PERMISO),
  };
}

// ── GET /api/sesion/accesos ─────────────────────────────────────────────────

export async function manejarAccesos(request: Request, deps: DependenciasSesion): Promise<Response> {
  if (new URL(request.url).search !== "") return responder<FallaAccesos>({ estado: "SOLICITUD_INVALIDA" });
  return conBase(deps, async (): Promise<RespuestaAccesos> => {
    const c = await deAdministrador(request, deps, false);
    if (!c.ok) return c.falla;
    const { db, config } = c.contexto;
    const vinculos = await db.vinculo.findMany({
      where: { instalacionId: config.instalacionId },
      select: { erpUsuarioId: true, erpNombre: true, vinculadoEn: true },
      orderBy: [{ vinculadoEn: "desc" }, { erpUsuarioId: "asc" }],
    });
    const filas = await db.accesoPersona.findMany({
      where: { instalacionId: config.instalacionId, erpUsuarioId: { in: vinculos.map((v) => v.erpUsuarioId) } },
      select: { erpUsuarioId: true, ...SELECT_PERMISOS },
    });
    const porPersona = new Map(filas.map(({ erpUsuarioId, ...p }) => [erpUsuarioId, p]));
    return { estado: "OK", personas: vinculos.map((v) => persona(c.contexto, v, porPersona.get(v.erpUsuarioId))) };
  });
}

// ── PUT /api/sesion/accesos ─────────────────────────────────────────────────

export async function manejarGuardarAccesos(request: Request, deps: DependenciasSesion): Promise<Response> {
  if (new URL(request.url).search !== "") return responder<FallaAccesos>({ estado: "SOLICITUD_INVALIDA" });
  return conBase(deps, async (): Promise<RespuestaGuardarAccesos> => {
    const c = await deAdministrador(request, deps, true);
    if (!c.ok) return c.falla;
    const pedido = await leerObjetoJson(request, MAX_BYTES_ACCESOS);
    if (!esPedidoAccesos(pedido)) return { estado: "SOLICITUD_INVALIDA" };
    const { db, config, sesion } = c.contexto;
    // Nadie se deja afuera a sí mismo, ni a otro administrador: esos accesos los da la variable.
    if (esAdministrador(config.administradores, pedido.personaId)) return { estado: "ES_ADMINISTRADOR" };
    const v = await db.vinculo.findUnique({
      where: { instalacionId_erpUsuarioId: { instalacionId: config.instalacionId, erpUsuarioId: pedido.personaId } },
      select: { erpUsuarioId: true, erpNombre: true, vinculadoEn: true },
    });
    if (!v) return { estado: "PERSONA_DESCONOCIDA" };
    const permisos = Object.fromEntries(PERMISOS.map((p) => [p, pedido[p]])) as unknown as Permisos;
    const cambio = { ...permisos, cambiadoPorErpUsuarioId: sesion.vinculo.erpUsuarioId, cambiadoEn: new Date(deps.ahora()) };
    const guardado = await db.accesoPersona.upsert({
      where: { instalacionId_erpUsuarioId: { instalacionId: config.instalacionId, erpUsuarioId: pedido.personaId } },
      create: { instalacionId: config.instalacionId, erpUsuarioId: pedido.personaId, ...cambio },
      update: cambio,
      select: SELECT_PERMISOS,
    });
    return { estado: "OK", persona: persona(c.contexto, v, guardado) };
  });
}
