// La paginación de `transferencias_eventos` del ERP, para los dobles de test.
//
// Reglas del contrato (erpmanual 25172fe, transferenciasEventos.js): orden por
// (fechaRecepcion, transferenciaId); estrictamente después de `desde`; `limite`
// por página; `siguiente` = el último devuelto o, sin eventos, el mismo
// `desde`; `hayMas` si quedan. test/db/eventos.test.ts comprueba que esto da
// EXACTAMENTE las páginas que dio el ERP real en el fixture.

import {
  claveDeEvento,
  claveDeTransferenciaRecibida,
  CONTRATO_CANCELACIONES_EVENTOS,
  CONTRATO_ENVIOS_EVENTOS,
  CONTRATO_PEDIDOS_EVENTOS,
  cursorAnterior,
  cursorDe,
  posicionAnterior,
  posicionDe,
  type ContratoEventos,
  type CursorTransferencias,
  type DatosCancelacionesEventos,
  type DatosEnviosEventos,
  type DatosPedidosEventos,
  type DatosTransferenciasEventos,
  type EventoPedidoSolicitado,
  type EventoTransferenciaCancelada,
  type EventoTransferenciaEnviada,
  type EventoTransferenciaRecibida,
} from "../../src/shared/erp/contrato.ts";
import { FIXTURES_ERP_25172FE, FIXTURES_ERP_76B9A71 } from "./servidorErp.ts";

/** La plantilla de `datos`: la respuesta real `sinDesde` del ERP. */
const PLANTILLA = FIXTURES_ERP_25172FE.transferenciasEventos.sinDesde.respuesta.cuerpo.datos as DatosTransferenciasEventos;
/** El `hasta` de la respuesta real: todos los eventos de los fixtures son anteriores. */
export const HASTA_FIXTURE = PLANTILLA.hasta;
/** Un evento real del fixture, para usar de molde. */
const MOLDE = PLANTILLA.eventos[0]!;

export const posicion = (e: EventoTransferenciaRecibida): CursorTransferencias => ({ fechaRecepcion: e.fechaRecepcion, transferenciaId: e.transferenciaId });

export function paginarEventos(o: {
  universo: readonly EventoTransferenciaRecibida[];
  local: { id: number; nombre: string };
  grupoId: number;
  desde: CursorTransferencias | null | undefined;
  limite: number | undefined;
  hasta?: string;
}): DatosTransferenciasEventos {
  const limite = o.limite ?? 50;
  const desde = o.desde ?? null;
  // Orden estable: dos eventos en la misma posición quedan como vinieron.
  const ordenados = [...o.universo].sort((a, b) => (cursorAnterior(posicion(a), posicion(b)) ? -1 : cursorAnterior(posicion(b), posicion(a)) ? 1 : 0));
  const despues = ordenados.filter((e) => !desde || cursorAnterior(desde, posicion(e)));
  const eventos = despues.slice(0, limite);
  const ultimo = eventos.at(-1);
  return {
    ...PLANTILLA,
    local: o.local,
    grupoId: o.grupoId,
    hasta: o.hasta ?? HASTA_FIXTURE,
    eventos,
    siguiente: ultimo ? posicion(ultimo) : desde,
    hayMas: despues.length > limite,
  };
}

// ── Las capacidades de la Tanda 4A del ERP (Tanda 4B de Azul Chat) ──────────
//
// El mismo cursor (erpmanual 76b9a71, cursorDeEventos.js), con los nombres de
// claves de cada capacidad. Plantilla y moldes: las respuestas REALES de
// test/fixtures/erp-76b9a71.json. test/db/eventosTanda4b.test.ts comprueba que
// esto da EXACTAMENTE las páginas que dio el ERP.

type CapacidadTanda4a = "pedidos_eventos" | "envios_eventos" | "cancelaciones_eventos";
const PLANTILLAS_4A = {
  pedidos_eventos: FIXTURES_ERP_76B9A71.pedidos_eventos.completa.respuesta.cuerpo.datos as DatosPedidosEventos,
  envios_eventos: FIXTURES_ERP_76B9A71.envios_eventos.completa.respuesta.cuerpo.datos as DatosEnviosEventos,
  cancelaciones_eventos: FIXTURES_ERP_76B9A71.cancelaciones_eventos.completa.respuesta.cuerpo.datos as DatosCancelacionesEventos,
};
const CONTRATOS_4A = {
  pedidos_eventos: CONTRATO_PEDIDOS_EVENTOS,
  envios_eventos: CONTRATO_ENVIOS_EVENTOS,
  cancelaciones_eventos: CONTRATO_CANCELACIONES_EVENTOS,
} as const;
/** El `hasta` de las respuestas reales: todos los eventos de esos fixtures son anteriores. */
export const HASTA_FIXTURE_4A = PLANTILLAS_4A.pedidos_eventos.hasta;

/** Una página de una capacidad de la Tanda 4A, con las reglas del contrato. */
export function paginarEventos4a<K extends CapacidadTanda4a>(
  capacidad: K,
  o: {
    universo: readonly object[];
    local: { id: number; nombre: string };
    grupoId: number;
    desde: object | null | undefined;
    limite: number | undefined;
    hasta?: string;
  },
): (typeof PLANTILLAS_4A)[K] {
  const c = CONTRATOS_4A[capacidad] as unknown as ContratoEventos<string, object, object>;
  const pos = (x: object) => posicionDe(c, x);
  const limite = o.limite ?? 50;
  const desde = o.desde ?? null;
  const ordenados = [...o.universo].sort((a, b) => (posicionAnterior(pos(a), pos(b)) ? -1 : posicionAnterior(pos(b), pos(a)) ? 1 : 0));
  const despues = ordenados.filter((e) => !desde || posicionAnterior(pos(desde), pos(e)));
  const eventos = despues.slice(0, limite);
  const ultimo = eventos.at(-1);
  return {
    ...PLANTILLAS_4A[capacidad],
    local: o.local,
    grupoId: o.grupoId,
    hasta: o.hasta ?? HASTA_FIXTURE_4A,
    eventos,
    siguiente: ultimo ? cursorDe(c, ultimo) : desde,
    hayMas: despues.length > limite,
  } as (typeof PLANTILLAS_4A)[K];
}

const MOLDE_PEDIDO = PLANTILLAS_4A.pedidos_eventos.eventos[0]!;
const MOLDE_ENVIO = PLANTILLAS_4A.envios_eventos.eventos[0]!;
const MOLDE_CANCELACION = PLANTILLAS_4A.cancelaciones_eventos.eventos[0]!;

/** Un pedido solicitado con la forma de uno real del fixture y su clave armada como la arma el ERP. */
export function pedido(o: { pedidoId: number; fecha: string; origen?: { id: number; nombre: string }; lineas?: number }): EventoPedidoSolicitado {
  return {
    ...MOLDE_PEDIDO,
    eventoId: claveDeEvento("PEDIDO_SOLICITADO", o.pedidoId, o.fecha),
    pedidoId: o.pedidoId,
    fechaSolicitud: o.fecha,
    origen: o.origen ?? MOLDE_PEDIDO.origen,
    lineas: o.lineas ?? MOLDE_PEDIDO.lineas,
  };
}

/** Un envío con la forma de uno real del fixture. */
export function envio(o: { transferenciaId: number; fecha: string; origen?: { id: number; nombre: string }; lineas?: number; pedidoId?: number | null }): EventoTransferenciaEnviada {
  return {
    ...MOLDE_ENVIO,
    eventoId: claveDeEvento("TRANSFERENCIA_ENVIADA", o.transferenciaId, o.fecha),
    transferenciaId: o.transferenciaId,
    fechaEnvio: o.fecha,
    origen: o.origen ?? MOLDE_ENVIO.origen,
    lineas: o.lineas ?? MOLDE_ENVIO.lineas,
    pedidoId: o.pedidoId === undefined ? MOLDE_ENVIO.pedidoId : o.pedidoId,
  };
}

/** Una cancelación con la forma de una real del fixture. */
export function cancelacion(o: { transferenciaId: number; fecha: string; origen?: { id: number; nombre: string }; pedidoId?: number | null }): EventoTransferenciaCancelada {
  return {
    ...MOLDE_CANCELACION,
    eventoId: claveDeEvento("TRANSFERENCIA_CANCELADA", o.transferenciaId, o.fecha),
    transferenciaId: o.transferenciaId,
    fechaCancelacion: o.fecha,
    origen: o.origen ?? MOLDE_CANCELACION.origen,
    pedidoId: o.pedidoId === undefined ? MOLDE_CANCELACION.pedidoId : o.pedidoId,
  };
}

/**
 * Una recepción de otro local o con otro id y fecha, con la forma de un evento
 * real del fixture y su clave armada como la arma el ERP.
 */
export function recepcion(o: {
  local: { id: number; nombre: string };
  transferenciaId: number;
  fecha: string;
  tieneDiferencias?: boolean;
  lineasConDiferencia?: number;
}): EventoTransferenciaRecibida {
  return {
    ...MOLDE,
    eventoId: claveDeTransferenciaRecibida(o.transferenciaId, o.fecha),
    transferenciaId: o.transferenciaId,
    fechaRecepcion: o.fecha,
    destino: o.local,
    tieneDiferencias: o.tieneDiferencias ?? false,
    lineasConDiferencia: o.lineasConDiferencia ?? 0,
  };
}
