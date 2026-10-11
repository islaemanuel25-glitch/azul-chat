// src/server/eventos/pedidosEnviosCancelaciones.ts
//
// PEDIDO_SOLICITADO, TRANSFERENCIA_ENVIADA Y TRANSFERENCIA_CANCELADA (Tanda 4B):
// DE EVENTO DEL ERP A FILA DE `Evento`, Y SUS PAYLOADS V1.
//
// Ninguno de los tres trae destino: el local del evento es el de la RESPUESTA
// del ERP (el que se pidió, comprobado por pagina.ts). Por eso `aFila` recibe
// el local además del evento.
//
//   PEDIDO_SOLICITADO       erpLocalId = el local que pidió
//                           erpReferenciaId = pedidoId, fechaOperacion = fechaSolicitud
//                           payload v1 = { origen: { id, nombre }, lineas }
//   TRANSFERENCIA_ENVIADA   erpLocalId = el local destino
//                           erpReferenciaId = transferenciaId, fechaOperacion = fechaEnvio
//                           payload v1 = { origen: { id, nombre }, lineas, pedidoId }
//   TRANSFERENCIA_CANCELADA erpLocalId = el local destino
//                           erpReferenciaId = transferenciaId, fechaOperacion = fechaCancelacion
//                           payload v1 = { origen: { id, nombre }, pedidoId }
//
// Cada payload se arma de cero con esos campos: un campo de más que mande el
// ERP no se guarda. Nada de permisos, roles, alcance, capacidades, token,
// sesión ni filas del ERP.
//
// ── CUÁNDO DOS FOTOS DE LA MISMA CLAVE CUENTAN LO MISMO ────────────────────
//
// `mismoPayload…` decide, campo por campo, si una clave repetida es un
// duplicado (IGUAL) o una foto distinta (CONTENIDO_DIFERENTE, que se anota en
// el diagnóstico del cursor). Para PEDIDO_SOLICITADO, `lineas` NO entra en la
// comparación: el ERP la cuenta al leer y el depósito puede ajustar un pedido
// mientras está Solicitado, así que otra cantidad con la misma clave es lo
// ESPERADO, no una anomalía. Se conserva la primera foto, como siempre.

import "server-only";

import { TipoEvento } from "@prisma/client";

import type { EventoPedidoSolicitado, EventoTransferenciaCancelada, EventoTransferenciaEnviada } from "../../shared/erp/contrato.ts";
import type { FilaEvento } from "./transferenciaRecibida.ts";

export const PAYLOAD_VERSION_PEDIDO_SOLICITADO = 1;
export const PAYLOAD_VERSION_TRANSFERENCIA_ENVIADA = 1;
export const PAYLOAD_VERSION_TRANSFERENCIA_CANCELADA = 1;

type Origen = { readonly id: number; readonly nombre: string };

export type PayloadPedidoSolicitadoV1 = { readonly origen: Origen; readonly lineas: number };
export type PayloadTransferenciaEnviadaV1 = { readonly origen: Origen; readonly lineas: number; readonly pedidoId: number | null };
export type PayloadTransferenciaCanceladaV1 = { readonly origen: Origen; readonly pedidoId: number | null };

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const soloClaves = (o: Record<string, unknown>, claves: readonly string[]) =>
  Object.keys(o).length === claves.length && claves.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const esEnteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const esEnteroNoNegativo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const esOrigen = (v: unknown): v is Origen =>
  esObjeto(v) && soloClaves(v, ["id", "nombre"]) && esEnteroPositivo(v.id) && typeof v.nombre === "string";
const esIdOpcional = (v: unknown): v is number | null => v === null || esEnteroPositivo(v);

/** Los guardianes de cada payload v1: exactamente esos campos, con esos tipos. Sirven para escribir y para leer. */
export function esPayloadPedidoSolicitadoV1(v: unknown): v is PayloadPedidoSolicitadoV1 {
  return esObjeto(v) && soloClaves(v, ["origen", "lineas"]) && esOrigen(v.origen) && esEnteroNoNegativo(v.lineas);
}
export function esPayloadTransferenciaEnviadaV1(v: unknown): v is PayloadTransferenciaEnviadaV1 {
  return (
    esObjeto(v) && soloClaves(v, ["origen", "lineas", "pedidoId"]) && esOrigen(v.origen) && esEnteroNoNegativo(v.lineas) && esIdOpcional(v.pedidoId)
  );
}
export function esPayloadTransferenciaCanceladaV1(v: unknown): v is PayloadTransferenciaCanceladaV1 {
  return esObjeto(v) && soloClaves(v, ["origen", "pedidoId"]) && esOrigen(v.origen) && esIdOpcional(v.pedidoId);
}

const mismoOrigen = (a: Origen, b: Origen) => a.id === b.id && a.nombre === b.nombre;

/** PEDIDO_SOLICITADO: el origen. `lineas` cambia entre lecturas y eso es esperado (ver arriba). */
export function mismoPayloadPedidoSolicitado(a: PayloadPedidoSolicitadoV1, b: PayloadPedidoSolicitadoV1): boolean {
  return mismoOrigen(a.origen, b.origen);
}
export function mismoPayloadTransferenciaEnviada(a: PayloadTransferenciaEnviadaV1, b: PayloadTransferenciaEnviadaV1): boolean {
  return mismoOrigen(a.origen, b.origen) && a.lineas === b.lineas && a.pedidoId === b.pedidoId;
}
export function mismoPayloadTransferenciaCancelada(a: PayloadTransferenciaCanceladaV1, b: PayloadTransferenciaCanceladaV1): boolean {
  return mismoOrigen(a.origen, b.origen) && a.pedidoId === b.pedidoId;
}

/** Un evento ya validado por el contrato, del local de la respuesta → la fila. Revienta si el payload no da v1. */
export function aFilaPedidoSolicitado(e: EventoPedidoSolicitado, localId: number): FilaEvento<PayloadPedidoSolicitadoV1> {
  const payload: PayloadPedidoSolicitadoV1 = { origen: { id: e.origen.id, nombre: e.origen.nombre }, lineas: e.lineas };
  if (!esPayloadPedidoSolicitadoV1(payload)) throw new Error("payload de PEDIDO_SOLICITADO inválido");
  return {
    tipo: TipoEvento.PEDIDO_SOLICITADO,
    claveExterna: e.eventoId,
    erpLocalId: localId,
    erpReferenciaId: e.pedidoId,
    fechaOperacion: new Date(e.fechaSolicitud),
    payloadVersion: PAYLOAD_VERSION_PEDIDO_SOLICITADO,
    payload,
  };
}

export function aFilaTransferenciaEnviada(e: EventoTransferenciaEnviada, localId: number): FilaEvento<PayloadTransferenciaEnviadaV1> {
  const payload: PayloadTransferenciaEnviadaV1 = { origen: { id: e.origen.id, nombre: e.origen.nombre }, lineas: e.lineas, pedidoId: e.pedidoId };
  if (!esPayloadTransferenciaEnviadaV1(payload)) throw new Error("payload de TRANSFERENCIA_ENVIADA inválido");
  return {
    tipo: TipoEvento.TRANSFERENCIA_ENVIADA,
    claveExterna: e.eventoId,
    erpLocalId: localId,
    erpReferenciaId: e.transferenciaId,
    fechaOperacion: new Date(e.fechaEnvio),
    payloadVersion: PAYLOAD_VERSION_TRANSFERENCIA_ENVIADA,
    payload,
  };
}

export function aFilaTransferenciaCancelada(e: EventoTransferenciaCancelada, localId: number): FilaEvento<PayloadTransferenciaCanceladaV1> {
  const payload: PayloadTransferenciaCanceladaV1 = { origen: { id: e.origen.id, nombre: e.origen.nombre }, pedidoId: e.pedidoId };
  if (!esPayloadTransferenciaCanceladaV1(payload)) throw new Error("payload de TRANSFERENCIA_CANCELADA inválido");
  return {
    tipo: TipoEvento.TRANSFERENCIA_CANCELADA,
    claveExterna: e.eventoId,
    erpLocalId: localId,
    erpReferenciaId: e.transferenciaId,
    fechaOperacion: new Date(e.fechaCancelacion),
    payloadVersion: PAYLOAD_VERSION_TRANSFERENCIA_CANCELADA,
    payload,
  };
}
