// src/server/erp/canje.ts
//
// EL CANJE: EL CÓDIGO QUE LA PERSONA COPIÓ DEL ERP SE CAMBIA, UNA VEZ, POR UN
// TOKEN DE DELEGACIÓN. Contrato exacto del ERP desplegado (erpmanual 8920516,
// lib/integraciones/vinculos/canje.js y app/api/integraciones/azul-chat/vinculo/canjear):
//
//   POST /api/integraciones/azul-chat/vinculo/canjear
//   cuerpo:  { "codigo": "vin1_…" }                      — exactamente esa clave
//   éxito:   { ok: true, datos: { usuarioId, vinculoId, tokenDelegacion,
//                                 autorizadoEn, canjeadoEn } }
//   rechazo: 403 CODIGO_NO_VALIDO (inexistente, vencido, usado, revocado o de
//            alguien inactivo — indistinguibles), más los de la capa HTTP y la
//            firma, iguales que en `consultar`.
//
// No se manda `usuarioId`: la identidad sale del vínculo que el código
// encuentra en el ERP. El ERP gasta el código en su base ANTES de contestar:
// si la respuesta se pierde, el código ya no sirve y hay que generar otro.

import "server-only";

import { esCodigoCanje, esTokenDelegacion } from "./credenciales.ts";

export type CuerpoCanje = { readonly codigo: string };

/** Lo que devuelve un canje exitoso. Lleva el token: no sale nunca del servidor. */
export type DatosCanje = {
  readonly usuarioId: number;
  readonly vinculoId: number;
  readonly tokenDelegacion: string;
  readonly autorizadoEn: string;
  readonly canjeadoEn: string;
};

export function construirCuerpoCanje(codigo: unknown): CuerpoCanje | null {
  return esCodigoCanje(codigo) ? { codigo } : null;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const esEnteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const esFechaIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);

export function esDatosCanje(v: unknown): v is DatosCanje {
  return (
    esObjeto(v) &&
    esEnteroPositivo(v.usuarioId) &&
    esEnteroPositivo(v.vinculoId) &&
    esTokenDelegacion(v.tokenDelegacion) &&
    esFechaIso(v.autorizadoEn) &&
    esFechaIso(v.canjeadoEn)
  );
}
