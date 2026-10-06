// src/server/sesion/delegacion.ts
//
// DE LA COOKIE AL TOKEN, Y DEL RECHAZO DEL ERP A LA INVALIDACIÓN LOCAL.
//
// Toda llamada al ERP en nombre de una persona pasa por acá: se lee la sesión,
// se descifra el token en memoria, se llama, y se interpreta el resultado. El
// token claro no sale de esta función: ni a la respuesta, ni a un log.
//
// ── REVOCADO NO ES LO MISMO QUE CAÍDO ──────────────────────────────────────
//
//   · VINCULO_NO_VALIDO del ERP: el token ya no vale (la persona revocó,
//     alguien la desvinculó, o generó otro código). El vínculo local se
//     invalida y TODAS sus sesiones se revocan.
//   · Cualquier otra cosa —timeout, ERP inalcanzable, 503, cupo, error al
//     calcular, respuesta ilegible— NO dice nada del token. La sesión se deja
//     como está: un ERP caído no desvincula a nadie.
//   · NO_AUTORIZADO tampoco revoca: la persona existe y el vínculo vale, pero
//     hoy no puede (inactiva, sin permiso, fuera de alcance). Puede cambiar
//     mañana sin volver a vincularse.

import "server-only";

import type { ResultadoConsulta } from "../../shared/erp/contrato.ts";
import type { ConfigAzulChat } from "../configuracion.ts";
import type { Db } from "../db.ts";
import { leerIdDeCookie } from "./cookie.ts";
import type { DependenciasSesion } from "./dependencias.ts";
import { invalidarVinculo, leerSesionVigente, type SesionVigente } from "./repositorio.ts";

export type ResultadoDelegado<T> =
  | { readonly tipo: "OK"; readonly datos: T }
  /** Sin cookie, o con una que no vale. `vinculoInvalidado`: el ERP acaba de rechazar el token. */
  | { readonly tipo: "SIN_SESION"; readonly vinculoInvalidado: boolean }
  /** El ERP contestó con un rechazo que NO invalida el vínculo (incluye NO_AUTORIZADO). */
  | { readonly tipo: "RECHAZO_ERP"; readonly resultado: Extract<ResultadoConsulta<T>, { ok: false }> }
  /** Azul Chat mismo no puede: configuración, base o clave de cifrado. */
  | { readonly tipo: "SERVICIO_NO_DISPONIBLE" };

type Contexto = { config: ConfigAzulChat; db: Db; sesion: SesionVigente };

/** La sesión de la solicitud, ya validada. */
export async function sesionDeLaSolicitud(
  headers: Headers,
  deps: DependenciasSesion,
): Promise<{ tipo: "OK"; contexto: Contexto } | { tipo: "SIN_SESION" } | { tipo: "SERVICIO_NO_DISPONIBLE" }> {
  const id = leerIdDeCookie(headers);
  if (!id) return { tipo: "SIN_SESION" };
  if (!deps.config.ok || !deps.db) {
    deps.registrar({ evento: "sesion.falla_local", etapa: "configuracion" });
    return { tipo: "SERVICIO_NO_DISPONIBLE" };
  }
  let sesion: SesionVigente | null;
  try {
    sesion = await leerSesionVigente(deps.db, id, deps.config.config.instalacionId, new Date(deps.ahora()));
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return { tipo: "SERVICIO_NO_DISPONIBLE" };
  }
  if (!sesion) return { tipo: "SIN_SESION" };
  return { tipo: "OK", contexto: { config: deps.config.config, db: deps.db, sesion } };
}

/**
 * Llama al ERP con el token de la sesión de la solicitud.
 *
 * @param llamar recibe el token CLARO; lo usa para una llamada y lo suelta.
 */
export async function conDelegacion<T>(
  headers: Headers,
  deps: DependenciasSesion,
  llamar: (token: string) => Promise<ResultadoConsulta<T>>,
): Promise<ResultadoDelegado<T>> {
  const leida = await sesionDeLaSolicitud(headers, deps);
  if (leida.tipo === "SIN_SESION") return { tipo: "SIN_SESION", vinculoInvalidado: false };
  if (leida.tipo === "SERVICIO_NO_DISPONIBLE") return leida;
  const { config, db, sesion } = leida.contexto;

  const token = config.cifrador.descifrar(sesion.vinculo.tokenCifrado, {
    instalacionId: config.instalacionId,
    erpUsuarioId: sesion.vinculo.erpUsuarioId,
    erpVinculoId: sesion.vinculo.erpVinculoId,
  });
  if (token === null) {
    // Otra clave o una fila manipulada. No es un rechazo del ERP: no se invalida nada.
    deps.registrar({ evento: "sesion.falla_local", etapa: "descifrado" });
    return { tipo: "SERVICIO_NO_DISPONIBLE" };
  }

  const resultado = await llamar(token);
  if (resultado.ok) return { tipo: "OK", datos: resultado.datos };

  if (resultado.origen === "erp" && resultado.codigo === "VINCULO_NO_VALIDO") {
    try {
      const revocadas = await invalidarVinculo(db, sesion.vinculo.id, sesion.vinculo.erpVinculoId, new Date(deps.ahora()));
      if (revocadas !== null) deps.registrar({ evento: "vinculo.invalidado", vinculoId: sesion.vinculo.id, sesionesRevocadas: revocadas });
    } catch {
      deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    }
    return { tipo: "SIN_SESION", vinculoInvalidado: true };
  }
  return { tipo: "RECHAZO_ERP", resultado };
}
