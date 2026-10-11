// src/shared/chats/textos.ts
//
// EL TÍTULO DE UN EVENTO, EN UN SOLO LUGAR PARA LA INTERFAZ Y PARA LOS AVISOS.
//
// La interfaz lo usa en la conversación, en General y en el resumen de la
// lista (components/chats/formato.ts lo reexporta). Desde la Tanda 5A lo usa
// también el servidor para el texto de una notificación push: lo que avisa el
// teléfono con la app cerrada dice exactamente lo mismo que la tarjeta.

import type { EventoPublico } from "./api.ts";

/**
 * El título de un evento (Figma DpxKeDtugjdB8IfuGnHZcz, pantalla 01):
 *
 *   · "Transferencia #182 recibida", o "… recibida con diferencias";
 *   · "Pedido #91 solicitado";
 *   · "Transferencia #184 enviada";
 *   · "Transferencia #184 cancelada".
 */
export function resumenDeEvento(e: EventoPublico): string {
  switch (e.tipo) {
    case "TRANSFERENCIA_RECIBIDA":
      return `Transferencia #${e.transferenciaId} recibida${e.tieneDiferencias ? " con diferencias" : ""}`;
    case "PEDIDO_SOLICITADO":
      return `Pedido #${e.pedidoId} solicitado`;
    case "TRANSFERENCIA_ENVIADA":
      return `Transferencia #${e.transferenciaId} enviada`;
    case "TRANSFERENCIA_CANCELADA":
      return `Transferencia #${e.transferenciaId} cancelada`;
  }
}
