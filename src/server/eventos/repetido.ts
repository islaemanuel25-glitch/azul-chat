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
// payload de cada tipo, nunca el texto del JSON, que PostgreSQL y JavaScript
// pueden devolver con las claves en otro orden. Qué campos cuentan lo decide
// cada tipo: en PEDIDO_SOLICITADO, otra cantidad de líneas con la misma clave
// es lo esperado y cuenta como IGUAL (pedidosEnviosCancelaciones.ts).

import "server-only";

import {
  esPayloadPedidoSolicitadoV1,
  esPayloadTransferenciaCanceladaV1,
  esPayloadTransferenciaEnviadaV1,
  mismoPayloadPedidoSolicitado,
  mismoPayloadTransferenciaCancelada,
  mismoPayloadTransferenciaEnviada,
  PAYLOAD_VERSION_PEDIDO_SOLICITADO,
  PAYLOAD_VERSION_TRANSFERENCIA_CANCELADA,
  PAYLOAD_VERSION_TRANSFERENCIA_ENVIADA,
} from "./pedidosEnviosCancelaciones.ts";
import type { FilaEvento } from "./transferenciaRecibida.ts";
import { esPayloadTransferenciaRecibidaV1, mismoPayloadTransferenciaRecibida, PAYLOAD_VERSION_TRANSFERENCIA_RECIBIDA } from "./transferenciaRecibida.ts";

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

/** Un comparador por tipo: la versión que sabe leer, su guardián y qué campos cuentan. */
type Comparador = {
  readonly version: number;
  readonly es: (v: unknown) => boolean;
  readonly mismo: (a: never, b: never) => boolean;
};

const COMPARADORES: Readonly<Record<string, Comparador>> = Object.freeze({
  TRANSFERENCIA_RECIBIDA: { version: PAYLOAD_VERSION_TRANSFERENCIA_RECIBIDA, es: esPayloadTransferenciaRecibidaV1, mismo: mismoPayloadTransferenciaRecibida },
  PEDIDO_SOLICITADO: { version: PAYLOAD_VERSION_PEDIDO_SOLICITADO, es: esPayloadPedidoSolicitadoV1, mismo: mismoPayloadPedidoSolicitado },
  TRANSFERENCIA_ENVIADA: { version: PAYLOAD_VERSION_TRANSFERENCIA_ENVIADA, es: esPayloadTransferenciaEnviadaV1, mismo: mismoPayloadTransferenciaEnviada },
  TRANSFERENCIA_CANCELADA: { version: PAYLOAD_VERSION_TRANSFERENCIA_CANCELADA, es: esPayloadTransferenciaCanceladaV1, mismo: mismoPayloadTransferenciaCancelada },
});

/** ¿Los dos payloads cuentan lo mismo? Con la versión que sabe leer el tipo, campo por campo. */
function mismoPayload(guardado: EventoGuardado, nueva: FilaEvento): boolean {
  if (guardado.payloadVersion !== nueva.payloadVersion) return false;
  const c = Object.prototype.hasOwnProperty.call(COMPARADORES, nueva.tipo) ? COMPARADORES[nueva.tipo] : undefined;
  if (!c || nueva.payloadVersion !== c.version) return false;
  const a = guardado.payload;
  const b = nueva.payload;
  if (!c.es(a) || !c.es(b)) return false;
  return c.mismo(a as never, b as never);
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
