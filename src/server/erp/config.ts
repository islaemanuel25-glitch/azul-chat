// src/server/erp/config.ts
//
// LA CONFIGURACIÓN DEL CLIENTE ERP, Y CUÁNDO NO ALCANZA PARA HABLAR CON EL ERP.
//
// Lee exactamente dos variables: `ERP_BASE_URL` y `AZUL_CHAT_INTEGRACION_SECRET`.
// No hay default para ninguna. Si alguna falta o es débil, el cliente queda
// APAGADO (fail closed) y lo dice con un motivo; nunca sigue con otro valor.
//
// ── LO QUE NO SE LEE, A PROPÓSITO ──────────────────────────────────────────
//
// `AUTH_SECRET`, `NEXTAUTH_SECRET` ni ningún otro secreto se usa como respaldo.
// Las mismas tres reglas que aplica el ERP del otro lado
// (erpmanual: lib/integraciones/azul-chat/autenticacionAplicacion.js):
//
//   · sin secreto, apagado;
//   · con menos de 32 caracteres, apagado;
//   · igual a `AUTH_SECRET` (si en este proceso existe), apagado: el secreto de
//     la integración no puede ser el de las sesiones.
//
// ── EL SECRETO NO QUEDA EN UNA PROPIEDAD ───────────────────────────────────
//
// La configuración válida no expone el secreto: expone una función `firmar`
// que lo tiene en su clausura. Un `console.log(config)` o un `JSON.stringify`
// accidental no lo pueden imprimir, porque no hay propiedad que imprimir.

import "server-only";

import { firmarSolicitud } from "./firma.ts";

export const VARIABLE_BASE_URL = "ERP_BASE_URL";
export const VARIABLE_SECRETO = "AZUL_CHAT_INTEGRACION_SECRET";

/** El mismo mínimo que exige el ERP. Con menos, el HMAC es adivinable. */
export const LARGO_MINIMO_SECRETO = 32;

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type MotivoConfigInvalida =
  | "BASE_URL_AUSENTE"
  | "BASE_URL_INVALIDA"
  | "SECRETO_AUSENTE"
  | "SECRETO_CORTO"
  | "SECRETO_COMPARTIDO";

export type Firmante = (args: { aplicacion: string; marca: string; cuerpo: string }) => string;

export type ConfigErp = {
  /** Origen del ERP, p. ej. `https://erp.ejemplo`. Sin ruta. */
  readonly origen: string;
  readonly firmar: Firmante;
};

export type ResultadoConfig = { ok: true; config: ConfigErp } | { ok: false; motivo: MotivoConfigInvalida };

export type Entorno = Readonly<Record<string, string | undefined>>;

/**
 * El origen del ERP, o `null` si la URL no es aceptable.
 *
 * Se exige un ORIGEN y nada más: sin ruta, query, fragmento ni credenciales.
 * La ruta la pone el cliente y es una sola; dejar que la variable traiga una
 * ruta sería dejar que la configuración elija a qué endpoint se le manda la
 * firma.
 */
export function origenAceptable(valor: string): string | null {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/") return null;
  if (url.protocol === "https:") return url.origin;
  // http solo contra la propia máquina: desarrollo y el servidor de prueba de
  // los tests. Contra cualquier otro host, la firma y el vínculo viajarían en
  // claro.
  if (url.protocol === "http:" && HOSTS_LOCALES.has(url.hostname)) return url.origin;
  return null;
}

/**
 * Lee y valida la configuración. Pura respecto de `entorno`.
 *
 * @param entorno por defecto `process.env`; los tests pasan el suyo.
 */
export function leerConfigErp(entorno: Entorno = process.env): ResultadoConfig {
  const baseUrl = entorno[VARIABLE_BASE_URL];
  if (!baseUrl) return { ok: false, motivo: "BASE_URL_AUSENTE" };
  const origen = origenAceptable(baseUrl);
  if (!origen) return { ok: false, motivo: "BASE_URL_INVALIDA" };

  const secreto = entorno[VARIABLE_SECRETO];
  if (!secreto) return { ok: false, motivo: "SECRETO_AUSENTE" };
  if (secreto.length < LARGO_MINIMO_SECRETO) return { ok: false, motivo: "SECRETO_CORTO" };
  const authSecret = entorno.AUTH_SECRET;
  if (authSecret && authSecret === secreto) return { ok: false, motivo: "SECRETO_COMPARTIDO" };

  const firmar: Firmante = ({ aplicacion, marca, cuerpo }) => firmarSolicitud({ secreto, aplicacion, marca, cuerpo });
  return { ok: true, config: Object.freeze({ origen, firmar }) };
}

/**
 * ¿Ese valor es el secreto de la integración? Para que otro secreto —la clave
 * de cifrado del token— pueda negarse a ser el mismo sin leer esta variable en
 * otro archivo: el secreto HMAC se lee solo acá.
 */
export function esElSecretoDeIntegracion(valor: string, entorno: Entorno = process.env): boolean {
  const secreto = entorno[VARIABLE_SECRETO];
  return Boolean(secreto) && secreto === valor;
}
