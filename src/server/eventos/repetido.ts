// src/server/eventos/repetido.ts
//
// CUANDO EL ERP VUELVE A ENTREGAR UNA CLAVE QUE YA ESTÁ GUARDADA.
//
// La clave externa identifica el hecho. Que vuelva es normal —páginas
// solapadas, la misma página dos veces—, y lo que importa es si cuenta la
// MISMA verdad. Tres casos:
//
//   · IGUAL: misma identidad y misma foto. Un duplicado: no pasa nada.
//   · IDENTIDAD_CONTRADICTORIA: la clave es la misma pero cambia el tipo, el
//     local, la referencia o la fecha. Son dos hechos distintos con el mismo
//     nombre: la ingesta rechaza la página entera (EVENTO_CONTRADICTORIO).
//   · CONTENIDO_DIFERENTE: misma identidad, otra foto (un local renombrado,
//     un conteo recalculado). La fila guardada es la foto de la PRIMERA
//     ingesta y no se reescribe; la diferencia se diagnostica y la ingesta
//     sigue.
//
// La comparación es SEMÁNTICA: campo por campo sobre la forma conocida del
// payload, nunca el texto del JSON, que PostgreSQL y JavaScript pueden
// devolver con las claves en otro orden.

import "server-only";

import type { FilaEvento } from "./transferenciaRecibida.ts";
import { esPayloadTransferenciaRecibidaV1, PAYLOAD_VERSION_TRANSFERENCIA_RECIBIDA } from "./transferenciaRecibida.ts";

export type ClasificacionRepetido = "IGUAL" | "CONTENIDO_DIFERENTE" | "IDENTIDAD_CONTRADICTORIA";

/** Lo que se lee de la fila guardada para comparar. `tipo` como texto: la comparación no supone el enum. */
export type EventoGuardado = {
  readonly tipo: string;
  readonly erpLocalId: number;
  readonly erpReferenciaId: number;
  readonly fechaOperacion: Date;
  readonly payloadVersion: number;
  readonly payload: unknown;
};

/** ¿Los dos payloads cuentan lo mismo? Solo para v1 de TRANSFERENCIA_RECIBIDA, campo por campo. */
function mismoPayload(guardado: EventoGuardado, nueva: FilaEvento): boolean {
  if (guardado.payloadVersion !== nueva.payloadVersion) return false;
  if (nueva.payloadVersion !== PAYLOAD_VERSION_TRANSFERENCIA_RECIBIDA) return false;
  const a = guardado.payload;
  const b = nueva.payload;
  if (!esPayloadTransferenciaRecibidaV1(a) || !esPayloadTransferenciaRecibidaV1(b)) return false;
  return (
    a.origen.id === b.origen.id &&
    a.origen.nombre === b.origen.nombre &&
    a.origen.esDeposito === b.origen.esDeposito &&
    a.destino.id === b.destino.id &&
    a.destino.nombre === b.destino.nombre &&
    a.tieneDiferencias === b.tieneDiferencias &&
    a.lineasConDiferencia === b.lineasConDiferencia
  );
}

/** Compara lo que llegó con lo guardado bajo la misma clave externa. Pura. */
export function clasificarRepetido(guardado: EventoGuardado, nueva: FilaEvento): ClasificacionRepetido {
  const mismaIdentidad =
    guardado.tipo === nueva.tipo &&
    guardado.erpLocalId === nueva.erpLocalId &&
    guardado.erpReferenciaId === nueva.erpReferenciaId &&
    guardado.fechaOperacion.getTime() === nueva.fechaOperacion.getTime();
  if (!mismaIdentidad) return "IDENTIDAD_CONTRADICTORIA";
  return mismoPayload(guardado, nueva) ? "IGUAL" : "CONTENIDO_DIFERENTE";
}
