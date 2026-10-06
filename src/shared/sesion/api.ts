// src/shared/sesion/api.ts
//
// LO QUE LAS RUTAS DE SESIÓN LE CONTESTAN AL NAVEGADOR. Es lo único de la
// sesión que la interfaz puede importar.
//
// Nunca lleva el token de delegación, el código de canje, el identificador de
// la cookie, ids internos de la base ni secretos. La identidad y los locales
// salen de `mi_alcance` en el momento: no son una autorización guardada.

import type { AlcanceErp, LocalEnAlcance } from "../erp/contrato.ts";

/** GET /api/sesion. Siempre 200: el estado está en el cuerpo. */
export type EstadoSesion =
  /** No hay sesión (o venció, o se cerró). `motivo` solo si el ERP invalidó el vínculo. */
  | { readonly estado: "SIN_SESION"; readonly motivo?: "VINCULO_INVALIDO" }
  | {
      readonly estado: "VINCULADO";
      readonly usuario: { readonly nombre: string };
      readonly alcance: AlcanceErp;
      readonly locales: readonly LocalEnAlcance[];
    }
  /** Hay sesión, pero el ERP dice que hoy la persona no está autorizada (p. ej. inactiva). */
  | { readonly estado: "NO_AUTORIZADO" }
  /** Hay sesión, pero el ERP no contestó (caído, lento, sin configurar). La sesión NO se toca. */
  | { readonly estado: "ERP_NO_DISPONIBLE" }
  /** Azul Chat mismo no está configurado o su base no responde. */
  | { readonly estado: "SERVICIO_NO_DISPONIBLE" };

/** Los códigos con que fallan POST /api/sesion/vincular y DELETE /api/sesion. */
export const CODIGOS_ERROR_SESION = Object.freeze([
  "SOLICITUD_INVALIDA",
  /** El código no tiene la forma, o el ERP dijo que no sirve (vencido, usado, revocado…). */
  "CODIGO_NO_VALIDO",
  "ORIGEN_NO_PERMITIDO",
  "LIMITE_EXCEDIDO",
  /** El ERP no contestó. Si fue un timeout, el código puede haberse gastado: generá otro. */
  "ERP_NO_DISPONIBLE",
  "SERVICIO_NO_DISPONIBLE",
  /** El ERP canjeó el código pero Azul Chat no pudo guardar la sesión. El código ya no sirve. */
  "VINCULACION_NO_COMPLETADA",
] as const);

export type CodigoErrorSesion = (typeof CODIGOS_ERROR_SESION)[number];

export type RespuestaVincular = { readonly ok: true } | { readonly ok: false; readonly codigo: CodigoErrorSesion; readonly mensaje: string };

export type RespuestaCerrar = { readonly ok: true } | { readonly ok: false; readonly codigo: CodigoErrorSesion; readonly mensaje: string };
