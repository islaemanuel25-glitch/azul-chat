// src/server/erp/transferenciasEventos.ts
//
// LA SOLICITUD DE `transferencias_eventos`: SE CONSTRUYE ACÁ Y EN NINGÚN OTRO LADO.
//
// Forma exacta del ERP desplegado (erpmanual 25172fe,
// lib/integraciones/azul-chat/atender.js, capacidades.js y transferenciasEventos.js):
//
//   {
//     "capacidad":  "transferencias_eventos",
//     "delegacion": { "token": "del1_…" },
//     "alcance":    { "grupoId": 1, "localId": 3 },
//     "parametros": { "desde": { "fechaRecepcion": "…Z", "transferenciaId": 181 }, "limite": 100 }
//   }
//
// Los dos parámetros son opcionales y no hay otros: el ERP rechaza una clave de
// más. `desde` se manda EXACTAMENTE como el ERP lo devolvió en `siguiente`; acá
// no se arma un cursor ni se usa el reloj de Azul Chat para fabricar uno.
//
// Solo se valida FORMA, la misma que valida el ERP, para no gastar una llamada
// que el ERP rechazaría igual. Que el local esté en el alcance, y que la
// persona tenga `transferencias.ver`, lo decide el ERP en cada pregunta.

import "server-only";

import { CAPACIDAD_TRANSFERENCIAS_EVENTOS, esCursorTransferencias, type CursorTransferencias } from "../../shared/erp/contrato.ts";
import { esTokenDelegacion } from "./credenciales.ts";

/** Lo que acepta el ERP por página. */
export const LIMITE_MAXIMO = 100;

export type CuerpoTransferenciasEventos = {
  readonly capacidad: typeof CAPACIDAD_TRANSFERENCIAS_EVENTOS;
  readonly delegacion: { readonly token: string };
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly parametros: { readonly desde?: CursorTransferencias; readonly limite?: number };
};

/** Lo que el resto de Azul Chat le pasa al cliente: qué local, desde dónde y cuántos. */
export type EntradaTransferenciasEventos = {
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly desde?: CursorTransferencias | null;
  readonly limite?: number;
};

const esObjetoPlano = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const soloEstas = (obj: Record<string, unknown>, claves: readonly string[]): boolean => Object.keys(obj).every((k) => claves.includes(k));
const esEnteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * Valida la entrada y arma el cuerpo exacto que se firma y se manda. `null` si
 * la entrada no tiene la forma: el cliente lo traduce a SOLICITUD_INVALIDA.
 *
 * El orden de las claves es fijo, y el de `parametros` es el del ERP: `desde`
 * y después `limite`.
 */
export function construirCuerpoTransferenciasEventos(token: string, entrada: unknown): CuerpoTransferenciasEventos | null {
  if (!esTokenDelegacion(token) || !esObjetoPlano(entrada)) return null;
  if (!soloEstas(entrada, ["alcance", "desde", "limite"])) return null;
  const { alcance, desde, limite } = entrada;
  if (!esObjetoPlano(alcance) || !soloEstas(alcance, ["grupoId", "localId"])) return null;
  if (!esEnteroPositivo(alcance.grupoId) || !esEnteroPositivo(alcance.localId)) return null;
  if (desde !== undefined && desde !== null && !esCursorTransferencias(desde)) return null;
  if (limite !== undefined && (!esEnteroPositivo(limite) || limite > LIMITE_MAXIMO)) return null;

  const parametros: { desde?: CursorTransferencias; limite?: number } = {};
  if (desde) parametros.desde = { fechaRecepcion: desde.fechaRecepcion, transferenciaId: desde.transferenciaId };
  if (limite !== undefined) parametros.limite = limite;
  return {
    capacidad: CAPACIDAD_TRANSFERENCIAS_EVENTOS,
    delegacion: { token },
    alcance: { grupoId: alcance.grupoId, localId: alcance.localId },
    parametros,
  };
}
