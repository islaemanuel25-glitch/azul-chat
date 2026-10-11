// src/server/eventos/capacidades.ts
//
// LAS CUATRO CAPACIDADES DE EVENTOS, COMO LAS INGIERE AZUL CHAT (Tanda 4B).
//
// La maquinaria de ingesta (ingesta.ts: arriendo, cursor, backfill, página
// entera o nada, idempotencia por clave) es UNA. Lo que cambia por capacidad
// está acá y en ningún otro lado:
//
//   · el contrato del ERP (nombre, claves del cursor, forma del evento);
//   · si el evento dice de qué local es (solo TRANSFERENCIA_RECIBIDA trae
//     `destino`): se exige que sea el pedido;
//   · cómo se pasa un evento a fila (`aFila`), con el local de la respuesta;
//   · el tipo de Evento que produce.
//
// El cursor de cada (local, capacidad) es una fila propia de CursorIngesta:
// cada capacidad avanza, falla y completa su backfill por separado.

import "server-only";

import { TipoEvento } from "@prisma/client";

import {
  CAPACIDAD_CANCELACIONES_EVENTOS,
  CAPACIDAD_ENVIOS_EVENTOS,
  CAPACIDAD_PEDIDOS_EVENTOS,
  CAPACIDAD_TRANSFERENCIAS_EVENTOS,
  CONTRATO_CANCELACIONES_EVENTOS,
  CONTRATO_ENVIOS_EVENTOS,
  CONTRATO_PEDIDOS_EVENTOS,
  CONTRATO_TRANSFERENCIAS_EVENTOS,
  type CapacidadEventos,
  type ContratoEventos,
  type CursorCancelaciones,
  type CursorEnvios,
  type CursorPedidos,
  type CursorTransferencias,
  type EventoPedidoSolicitado,
  type EventoTransferenciaCancelada,
  type EventoTransferenciaEnviada,
  type EventoTransferenciaRecibida,
} from "../../shared/erp/contrato.ts";
import { aFilaPedidoSolicitado, aFilaTransferenciaCancelada, aFilaTransferenciaEnviada } from "./pedidosEnviosCancelaciones.ts";
import { aFilaEvento, type FilaEvento } from "./transferenciaRecibida.ts";

export type DefinicionIngesta<K extends string, E, C> = {
  readonly contrato: ContratoEventos<K, E, C>;
  /** El tipo de Evento que produce la capacidad. */
  readonly tipo: TipoEvento;
  /** Si el evento dice de qué local es, que sea el pedido. Sin esto, el local es el de la respuesta. */
  readonly delLocal?: (e: E, localId: number) => boolean;
  /** Un evento ya validado, del local `localId` (el de la respuesta, ya comprobado) → la fila. */
  readonly aFila: (e: E, localId: number) => FilaEvento;
};

export const INGESTA_TRANSFERENCIAS: DefinicionIngesta<
  typeof CAPACIDAD_TRANSFERENCIAS_EVENTOS,
  EventoTransferenciaRecibida,
  CursorTransferencias
> = Object.freeze({
  contrato: CONTRATO_TRANSFERENCIAS_EVENTOS,
  tipo: TipoEvento.TRANSFERENCIA_RECIBIDA,
  // El local del evento es su destino: tiene que ser el pedido (OTRO_DESTINO).
  delLocal: (e: EventoTransferenciaRecibida, localId: number) => e.destino.id === localId,
  // La fila toma el local del destino, como siempre: ya se comprobó que es el pedido.
  aFila: (e: EventoTransferenciaRecibida) => aFilaEvento(e),
});

export const INGESTA_PEDIDOS: DefinicionIngesta<typeof CAPACIDAD_PEDIDOS_EVENTOS, EventoPedidoSolicitado, CursorPedidos> = Object.freeze({
  contrato: CONTRATO_PEDIDOS_EVENTOS,
  tipo: TipoEvento.PEDIDO_SOLICITADO,
  aFila: aFilaPedidoSolicitado,
});

export const INGESTA_ENVIOS: DefinicionIngesta<typeof CAPACIDAD_ENVIOS_EVENTOS, EventoTransferenciaEnviada, CursorEnvios> = Object.freeze({
  contrato: CONTRATO_ENVIOS_EVENTOS,
  tipo: TipoEvento.TRANSFERENCIA_ENVIADA,
  aFila: aFilaTransferenciaEnviada,
});

export const INGESTA_CANCELACIONES: DefinicionIngesta<
  typeof CAPACIDAD_CANCELACIONES_EVENTOS,
  EventoTransferenciaCancelada,
  CursorCancelaciones
> = Object.freeze({
  contrato: CONTRATO_CANCELACIONES_EVENTOS,
  tipo: TipoEvento.TRANSFERENCIA_CANCELADA,
  aFila: aFilaTransferenciaCancelada,
});

/** El tipo de Evento de cada capacidad. Es lo que una persona puede ver de un local si `mi_alcance` le anuncia esa capacidad. */
export const TIPO_DE_CAPACIDAD: Readonly<Record<CapacidadEventos, TipoEvento>> = Object.freeze({
  [CAPACIDAD_TRANSFERENCIAS_EVENTOS]: TipoEvento.TRANSFERENCIA_RECIBIDA,
  [CAPACIDAD_PEDIDOS_EVENTOS]: TipoEvento.PEDIDO_SOLICITADO,
  [CAPACIDAD_ENVIOS_EVENTOS]: TipoEvento.TRANSFERENCIA_ENVIADA,
  [CAPACIDAD_CANCELACIONES_EVENTOS]: TipoEvento.TRANSFERENCIA_CANCELADA,
});
