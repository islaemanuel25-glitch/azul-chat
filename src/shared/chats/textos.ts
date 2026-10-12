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
  const { que, accion } = ROTULO_DE_TIPO[e.tipo];
  switch (e.tipo) {
    case "TRANSFERENCIA_RECIBIDA":
      return `${que} #${e.transferenciaId} ${accion}${e.tieneDiferencias ? ` ${CON_DIFERENCIAS}` : ""}`;
    case "PEDIDO_SOLICITADO":
      return `${que} #${e.pedidoId} ${accion}`;
    case "TRANSFERENCIA_ENVIADA":
    case "TRANSFERENCIA_CANCELADA":
      return `${que} #${e.transferenciaId} ${accion}`;
  }
}

/**
 * Las palabras del título de cada tipo, alrededor del número. Tanda 10: la
 * búsqueda del historial busca en ESTOS textos —los que se ven—, así que salen
 * de acá y no de una copia.
 */
export const ROTULO_DE_TIPO: Readonly<Record<EventoPublico["tipo"], { readonly que: string; readonly accion: string }>> = Object.freeze({
  TRANSFERENCIA_RECIBIDA: { que: "Transferencia", accion: "recibida" },
  PEDIDO_SOLICITADO: { que: "Pedido", accion: "solicitado" },
  TRANSFERENCIA_ENVIADA: { que: "Transferencia", accion: "enviada" },
  TRANSFERENCIA_CANCELADA: { que: "Transferencia", accion: "cancelada" },
});

/** Lo que se agrega al título de una recepción con diferencias. */
export const CON_DIFERENCIAS = "con diferencias";
