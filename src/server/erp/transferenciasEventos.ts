// src/server/erp/transferenciasEventos.ts
//
// LA SOLICITUD DE `transferencias_eventos`.
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
// Desde la Tanda 4B la arma el constructor común de las capacidades de eventos
// (eventos.ts), con el contrato de esta capacidad: la misma forma, las mismas
// reglas. Que el local esté en el alcance, y que la persona tenga
// `transferencias.ver`, lo decide el ERP en cada pregunta.

import "server-only";

import { CAPACIDAD_TRANSFERENCIAS_EVENTOS, CONTRATO_TRANSFERENCIAS_EVENTOS, type CursorTransferencias } from "../../shared/erp/contrato.ts";
import { construirCuerpoEventos, type CuerpoEventos, type EntradaEventos } from "./eventos.ts";

export { LIMITE_MAXIMO } from "./eventos.ts";

export type CuerpoTransferenciasEventos = CuerpoEventos<typeof CAPACIDAD_TRANSFERENCIAS_EVENTOS, CursorTransferencias>;

/** Lo que el resto de Azul Chat le pasa al cliente: qué local, desde dónde y cuántos. */
export type EntradaTransferenciasEventos = EntradaEventos<CursorTransferencias>;

/** Valida la entrada y arma el cuerpo exacto que se firma y se manda. `null` si la entrada no tiene la forma. */
export function construirCuerpoTransferenciasEventos(token: string, entrada: unknown): CuerpoTransferenciasEventos | null {
  return construirCuerpoEventos(CONTRATO_TRANSFERENCIAS_EVENTOS, token, entrada);
}
