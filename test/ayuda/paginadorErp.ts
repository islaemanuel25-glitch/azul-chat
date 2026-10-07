// La paginación de `transferencias_eventos` del ERP, para los dobles de test.
//
// Reglas del contrato (erpmanual 25172fe, transferenciasEventos.js): orden por
// (fechaRecepcion, transferenciaId); estrictamente después de `desde`; `limite`
// por página; `siguiente` = el último devuelto o, sin eventos, el mismo
// `desde`; `hayMas` si quedan. test/db/eventos.test.ts comprueba que esto da
// EXACTAMENTE las páginas que dio el ERP real en el fixture.

import {
  claveDeTransferenciaRecibida,
  cursorAnterior,
  type CursorTransferencias,
  type DatosTransferenciasEventos,
  type EventoTransferenciaRecibida,
} from "../../src/shared/erp/contrato.ts";
import { FIXTURES_ERP_25172FE } from "./servidorErp.ts";

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
