// src/server/push/manejadores.ts
//
// LAS TRES RUTAS DE PUSH DEL NAVEGADOR (Tanda 5A). Las de src/app solo delegan.
//
//   GET    /api/push/clave       la clave pública VAPID (no es secreta)
//   POST   /api/push/suscribir   guardar la suscripción de este dispositivo
//   DELETE /api/push/suscribir   borrarla (desactivar las notificaciones acá)
//
// Suscribir y dar de baja son como vincular y cerrar: sesión obligatoria y
// Origin exacto. La suscripción se cuelga de la SESIÓN de la solicitud (y por
// ella del vínculo), nunca de un id que mande el navegador. Guardarla no
// autoriza nada: qué se avisa lo decide, en cada corrida, `mi_alcance` vivo.
//
// Ninguna de las tres llama al ERP.

import "server-only";

import type { RespuestaClavePush, RespuestaSuscripcionPush } from "../../shared/push/api.ts";
import { leerObjetoJson } from "../http/cuerpo.ts";
import { origenPermitido } from "../http/origen.ts";
import { json } from "../http/respuestas.ts";
import { sesionDeLaSolicitud } from "../sesion/delegacion.ts";
import { dependenciasDeProduccion, type DependenciasSesion } from "../sesion/dependencias.ts";
import { leerConfigPush, type ConfigPush } from "./config.ts";
import { leerBaja, leerSuscripcion } from "./suscripcion.ts";

/** Una suscripción mide unos 500 bytes. */
const MAX_BYTES_SUSCRIPCION = 4 * 1024;

export type DependenciasPush = DependenciasSesion & { readonly push: { ok: true; config: ConfigPush } | { ok: false } };

export function dependenciasDePushProduccion(): DependenciasPush {
  const push = leerConfigPush();
  return { ...dependenciasDeProduccion(), push: push.ok ? push : { ok: false } };
}

const STATUS: Record<Exclude<RespuestaSuscripcionPush["estado"], "OK">, number> = {
  SIN_SESION: 401,
  ORIGEN_NO_PERMITIDO: 403,
  SOLICITUD_INVALIDA: 400,
  NO_DISPONIBLE: 503,
};
const responder = (r: RespuestaSuscripcionPush) => json(r, { status: r.estado === "OK" ? 200 : STATUS[r.estado] });

// ── GET /api/push/clave ─────────────────────────────────────────────────────

export function manejarClave(_request: Request, deps: DependenciasPush): Response {
  const r: RespuestaClavePush = deps.push.ok ? { estado: "OK", clave: deps.push.config.clavePublica } : { estado: "NO_DISPONIBLE" };
  return json(r, { status: r.estado === "OK" ? 200 : 503 });
}

// ── POST y DELETE /api/push/suscribir ───────────────────────────────────────

/** Lo común: Origin, push configurado y sesión vigente. */
async function preparar(request: Request, deps: DependenciasPush) {
  if (!deps.config.ok) return { falla: { estado: "NO_DISPONIBLE" } as const };
  if (!origenPermitido(request.headers, deps.config.config.origenPublico)) return { falla: { estado: "ORIGEN_NO_PERMITIDO" } as const };
  if (!deps.push.ok) return { falla: { estado: "NO_DISPONIBLE" } as const };
  const cuerpo = await leerObjetoJson(request, MAX_BYTES_SUSCRIPCION);
  return { cuerpo };
}

export async function manejarSuscribir(request: Request, deps: DependenciasPush): Promise<Response> {
  const p = await preparar(request, deps);
  if ("falla" in p) return responder(p.falla);
  const suscripcion = leerSuscripcion(p.cuerpo);
  if (!suscripcion) return responder({ estado: "SOLICITUD_INVALIDA" });
  const leida = await sesionDeLaSolicitud(request.headers, deps);
  if (leida.tipo === "SIN_SESION") return responder({ estado: "SIN_SESION" });
  if (leida.tipo === "SERVICIO_NO_DISPONIBLE") return responder({ estado: "NO_DISPONIBLE" });
  const { db, sesion } = leida.contexto;
  const ahora = new Date(deps.ahora());
  try {
    // El mismo endpoint es el mismo dispositivo: si ya estaba (de otra sesión,
    // o de antes de volver a vincular), pasa a esta sesión con las claves nuevas.
    await db.pushSuscripcion.upsert({
      where: { endpoint: suscripcion.endpoint },
      create: { ...suscripcion, vinculoId: sesion.vinculo.id, sesionId: sesion.sesionId, creadaEn: ahora },
      update: {
        p256dh: suscripcion.p256dh,
        auth: suscripcion.auth,
        vinculoId: sesion.vinculo.id,
        sesionId: sesion.sesionId,
        creadaEn: ahora,
        ultimoErrorEn: null,
        ultimoErrorCodigo: null,
      },
    });
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return responder({ estado: "NO_DISPONIBLE" });
  }
  return responder({ estado: "OK" });
}

export async function manejarBaja(request: Request, deps: DependenciasPush): Promise<Response> {
  const p = await preparar(request, deps);
  if ("falla" in p) return responder(p.falla);
  const endpoint = leerBaja(p.cuerpo);
  if (!endpoint) return responder({ estado: "SOLICITUD_INVALIDA" });
  const leida = await sesionDeLaSolicitud(request.headers, deps);
  if (leida.tipo === "SIN_SESION") return responder({ estado: "SIN_SESION" });
  if (leida.tipo === "SERVICIO_NO_DISPONIBLE") return responder({ estado: "NO_DISPONIBLE" });
  try {
    // Solo una de ESTA persona: un endpoint ajeno no se puede borrar desde acá. Si ya no estaba, es lo mismo.
    await leida.contexto.db.pushSuscripcion.deleteMany({ where: { endpoint, vinculoId: leida.contexto.sesion.vinculo.id } });
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return responder({ estado: "NO_DISPONIBLE" });
  }
  return responder({ estado: "OK" });
}
