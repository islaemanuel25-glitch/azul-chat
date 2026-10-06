// src/server/sesion/cerrar.ts
//
// DELETE /api/sesion — CERRAR LA SESIÓN DE ESTE DISPOSITIVO.
//
// Revoca SOLO la sesión de la cookie que vino y borra la cookie. Las sesiones
// de otros dispositivos de la misma persona siguen, y el vínculo con el ERP
// también: desvincular a Azul Chat es otra operación, y se hace desde el ERP.
//
// Exige Origin exacto, como crear una sesión: un sitio ajeno no puede cerrarle
// la sesión a nadie. Sin cookie, o con una que ya no vale, contesta ok igual:
// el resultado que se pidió —este dispositivo sin sesión— ya se cumple.

import "server-only";

import type { RespuestaCerrar } from "../../shared/sesion/api.ts";
import { origenPermitido } from "../http/origen.ts";
import { json } from "../http/respuestas.ts";
import { cookieBorrada, leerIdDeCookie } from "./cookie.ts";
import type { DependenciasSesion } from "./dependencias.ts";
import { revocarSesion } from "./repositorio.ts";
import { respuestaDeError } from "./vincular.ts";

export async function manejarCerrar(request: Request, deps: DependenciasSesion): Promise<Response> {
  if (!deps.config.ok) return respuestaDeError("SERVICIO_NO_DISPONIBLE");
  const { config } = deps.config;
  if (!origenPermitido(request.headers, config.origenPublico)) return respuestaDeError("ORIGEN_NO_PERMITIDO");

  const id = leerIdDeCookie(request.headers);
  if (id) {
    if (!deps.db) return respuestaDeError("SERVICIO_NO_DISPONIBLE");
    try {
      await revocarSesion(deps.db, id, new Date(deps.ahora()));
    } catch {
      deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
      return respuestaDeError("SERVICIO_NO_DISPONIBLE");
    }
  }
  const cuerpo: RespuestaCerrar = { ok: true };
  return json(cuerpo, { cookie: cookieBorrada({ produccion: config.produccion }) });
}
