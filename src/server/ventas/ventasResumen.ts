// src/server/ventas/ventasResumen.ts
//
// "VENTAS DE HOY" DESDE UNA SESIÓN. Servicio interno: lo usa solo
// GET /api/chats/ventas (src/server/chats/manejadores.ts, Tanda 3A), que antes
// comprueba el local con `mi_alcance` vivo y fija el período en "hoy".
//
// La persona sale de la sesión (su vínculo y su token, descifrado acá en el
// servidor). Quien llama elige solo QUÉ local y QUÉ período: el ERP decide si
// esa persona puede verlo hoy, aunque `mi_alcance` lo haya listado.
//
// El cuerpo que viaja lleva `delegacion: { token }` y nada del usuario. Sin
// reintentos: si falla, se devuelve el fallo y la persona decide.

import "server-only";

import type { DatosVentasResumen } from "../../shared/erp/contrato.ts";
import { conDelegacion, type ResultadoDelegado } from "../sesion/delegacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";

/**
 * @param headers las de la solicitud del navegador: de ahí sale la cookie de sesión.
 * @param entrada `{ alcance: { grupoId, localId }, periodo }`, validada por el constructor del cuerpo.
 */
export function ventasResumenDeSesion(
  headers: Headers,
  entrada: unknown,
  deps: DependenciasSesion,
): Promise<ResultadoDelegado<DatosVentasResumen>> {
  return conDelegacion(headers, deps, (token) => deps.erp.ventasResumen(token, entrada));
}
