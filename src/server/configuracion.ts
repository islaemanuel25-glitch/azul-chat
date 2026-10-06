// src/server/configuracion.ts
//
// LA CONFIGURACIÓN PROPIA DE AZUL CHAT para la sesión y el vínculo. Fail
// closed: si falta algo o está mal, no se crea ni se lee ninguna sesión.
//
//   · AZUL_CHAT_INSTALACION_ID: el identificador estable de la instalación del
//     ERP a la que pertenece este despliegue. Minúsculas, números y guiones.
//     Uno por despliegue: Azul Chat no es multi-empresa.
//   · AZUL_CHAT_ORIGEN_PUBLICO: el origen exacto desde el que la gente usa Azul
//     Chat (https://…). Las operaciones que crean o destruyen una sesión
//     exigen que la cabecera Origin sea ESTE valor, no uno reflejado.
//   · AZUL_CHAT_TOKEN_ENCRYPTION_KEY: la clave del cifrado del token
//     (ver seguridad/cifradoToken.ts).
//
// Ninguna lleva NEXT_PUBLIC_. Ninguna se guarda en la base.

import "server-only";

import { origenAceptable, type Entorno } from "./erp/config.ts";
import { crearCifradorToken, leerClaveToken, type CifradorToken, type MotivoClaveInvalida } from "./seguridad/cifradoToken.ts";

export const VARIABLE_INSTALACION = "AZUL_CHAT_INSTALACION_ID";
export const VARIABLE_ORIGEN_PUBLICO = "AZUL_CHAT_ORIGEN_PUBLICO";

const FORMATO_INSTALACION = /^[a-z0-9][a-z0-9-]{2,62}$/;

export type MotivoConfigAzulChat =
  | "INSTALACION_AUSENTE"
  | "INSTALACION_MAL_FORMADA"
  | "ORIGEN_PUBLICO_AUSENTE"
  | "ORIGEN_PUBLICO_INVALIDO"
  | MotivoClaveInvalida;

export type ConfigAzulChat = {
  readonly instalacionId: string;
  readonly origenPublico: string;
  readonly cifrador: CifradorToken;
  /** Con true, la cookie de sesión lleva Secure. */
  readonly produccion: boolean;
};

export function leerConfigAzulChat(
  entorno: Entorno = process.env,
): { ok: true; config: ConfigAzulChat } | { ok: false; motivo: MotivoConfigAzulChat } {
  const instalacionId = entorno[VARIABLE_INSTALACION];
  if (!instalacionId) return { ok: false, motivo: "INSTALACION_AUSENTE" };
  if (!FORMATO_INSTALACION.test(instalacionId)) return { ok: false, motivo: "INSTALACION_MAL_FORMADA" };

  const origenCrudo = entorno[VARIABLE_ORIGEN_PUBLICO];
  if (!origenCrudo) return { ok: false, motivo: "ORIGEN_PUBLICO_AUSENTE" };
  const origenPublico = origenAceptable(origenCrudo);
  if (!origenPublico) return { ok: false, motivo: "ORIGEN_PUBLICO_INVALIDO" };

  const clave = leerClaveToken(entorno);
  if (!clave.ok) return { ok: false, motivo: clave.motivo };

  return {
    ok: true,
    config: Object.freeze({
      instalacionId,
      origenPublico,
      cifrador: crearCifradorToken(clave.clave),
      produccion: entorno.NODE_ENV === "production",
    }),
  };
}
