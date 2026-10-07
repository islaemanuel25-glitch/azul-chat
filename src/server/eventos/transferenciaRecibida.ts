// src/server/eventos/transferenciaRecibida.ts
//
// TRANSFERENCIA_RECIBIDA: DE EVENTO DEL ERP A FILA DE `Evento`, Y SU PAYLOAD V1.
//
// Lo que se indexa va en columnas; lo que solo se muestra va en el payload:
//
//   tipo            = TRANSFERENCIA_RECIBIDA
//   claveExterna    = eventoId del ERP, tal cual
//   erpLocalId      = destino.id (el local que RECIBIÓ)
//   erpReferenciaId = transferenciaId
//   fechaOperacion  = fechaRecepcion
//   payload (v1)    = { origen: { id, nombre, esDeposito }, destino: { id, nombre },
//                       tieneDiferencias, lineasConDiferencia }
//
// El payload se arma de cero con esos campos: un campo de más que mande el ERP
// no se guarda. Nada de permisos, roles, alcance, capacidades, token, sesión
// ni filas del ERP.

import "server-only";

import { TipoEvento } from "@prisma/client";

import type { EventoTransferenciaRecibida } from "../../shared/erp/contrato.ts";

export const PAYLOAD_VERSION_TRANSFERENCIA_RECIBIDA = 1;

export type PayloadTransferenciaRecibidaV1 = {
  readonly origen: { readonly id: number; readonly nombre: string; readonly esDeposito: boolean };
  readonly destino: { readonly id: number; readonly nombre: string };
  readonly tieneDiferencias: boolean;
  readonly lineasConDiferencia: number;
};

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const soloClaves = (o: Record<string, unknown>, claves: readonly string[]) =>
  Object.keys(o).length === claves.length && claves.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const esEnteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** El guardián del payload v1: exactamente esos campos, con esos tipos. Sirve para escribir y para leer. */
export function esPayloadTransferenciaRecibidaV1(v: unknown): v is PayloadTransferenciaRecibidaV1 {
  if (!esObjeto(v) || !soloClaves(v, ["origen", "destino", "tieneDiferencias", "lineasConDiferencia"])) return false;
  const { origen, destino } = v;
  if (!esObjeto(origen) || !soloClaves(origen, ["id", "nombre", "esDeposito"])) return false;
  if (!esEnteroPositivo(origen.id) || typeof origen.nombre !== "string" || typeof origen.esDeposito !== "boolean") return false;
  if (!esObjeto(destino) || !soloClaves(destino, ["id", "nombre"])) return false;
  if (!esEnteroPositivo(destino.id) || typeof destino.nombre !== "string") return false;
  return (
    typeof v.tieneDiferencias === "boolean" &&
    typeof v.lineasConDiferencia === "number" &&
    Number.isSafeInteger(v.lineasConDiferencia) &&
    v.lineasConDiferencia >= 0
  );
}

/** Los datos de la fila, sin instalación ni marca de histórico (los pone la ingesta). */
export type FilaEvento = {
  readonly tipo: TipoEvento;
  readonly claveExterna: string;
  readonly erpLocalId: number;
  readonly erpReferenciaId: number;
  readonly fechaOperacion: Date;
  readonly payloadVersion: number;
  readonly payload: PayloadTransferenciaRecibidaV1;
};

/** Un evento ya validado por el contrato → la fila. Revienta si el payload no da v1: no se guarda algo a medias. */
export function aFilaEvento(e: EventoTransferenciaRecibida): FilaEvento {
  const payload: PayloadTransferenciaRecibidaV1 = {
    origen: { id: e.origen.id, nombre: e.origen.nombre, esDeposito: e.origen.esDeposito },
    destino: { id: e.destino.id, nombre: e.destino.nombre },
    tieneDiferencias: e.tieneDiferencias,
    lineasConDiferencia: e.lineasConDiferencia,
  };
  if (!esPayloadTransferenciaRecibidaV1(payload)) throw new Error("payload de TRANSFERENCIA_RECIBIDA inválido");
  return {
    tipo: TipoEvento.TRANSFERENCIA_RECIBIDA,
    claveExterna: e.eventoId,
    erpLocalId: e.destino.id,
    erpReferenciaId: e.transferenciaId,
    fechaOperacion: new Date(e.fechaRecepcion),
    payloadVersion: PAYLOAD_VERSION_TRANSFERENCIA_RECIBIDA,
    payload,
  };
}
