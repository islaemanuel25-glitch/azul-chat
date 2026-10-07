// src/server/eventos/pagina.ts
//
// UNA PÁGINA DE `transferencias_eventos`, VALIDADA CONTRA LO QUE SE PIDIÓ, ANTES
// DE GUARDAR NADA.
//
// La forma la mira el contrato (`esDatosTransferenciasEventos`): eventos bien
// formados, clave igual a la que arma el ERP, orden estricto, ninguno más nuevo
// que `hasta`, `siguiente` igual al último. Acá se mira lo que depende del
// PEDIDO, que el contrato no sabe:
//
//   · el local de la respuesta es el que se pidió;
//   · el destino de TODOS los eventos es ese local;
//   · el primer evento viene estrictamente después del `desde` mandado;
//   · una página sin eventos repite el `desde` (o null si no hubo);
//   · no vienen más eventos que el `limite`, y `hayMas` solo con la página llena.
//
// Si falla UNA cosa, la página entera es RESPUESTA_INVALIDA: no se guarda nada
// de ella y el cursor no se mueve. Una página a medias rompería el cursor: lo
// que se salteara no volvería nunca.

import "server-only";

import {
  cursorAnterior,
  esDatosTransferenciasEventos,
  type CursorTransferencias,
  type DatosTransferenciasEventos,
} from "../../shared/erp/contrato.ts";

export type PedidoDePagina = {
  readonly localId: number;
  readonly desde: CursorTransferencias | null;
  readonly limite: number;
};

/** Para los tests y el diagnóstico: qué regla falló. Nunca se muestra ni se guarda como mensaje. */
export type MotivoPaginaInvalida =
  | "FORMA"
  | "OTRO_LOCAL"
  | "OTRO_DESTINO"
  | "NO_AVANZA"
  | "SIGUIENTE_DE_PAGINA_VACIA"
  | "DEMASIADOS_EVENTOS"
  | "HAY_MAS_SIN_PAGINA_LLENA";

export type ResultadoPagina =
  | { readonly ok: true; readonly datos: DatosTransferenciasEventos }
  | { readonly ok: false; readonly codigo: "RESPUESTA_INVALIDA"; readonly motivo: MotivoPaginaInvalida };

const invalida = (motivo: MotivoPaginaInvalida): ResultadoPagina => ({ ok: false, codigo: "RESPUESTA_INVALIDA", motivo });
const mismaPosicion = (a: CursorTransferencias | null, b: CursorTransferencias | null) =>
  a === null || b === null ? a === b : a.fechaRecepcion === b.fechaRecepcion && a.transferenciaId === b.transferenciaId;

export function validarPagina(datos: unknown, pedido: PedidoDePagina): ResultadoPagina {
  if (!esDatosTransferenciasEventos(datos)) return invalida("FORMA");
  if (datos.local.id !== pedido.localId) return invalida("OTRO_LOCAL");
  if (!datos.eventos.every((e) => e.destino.id === pedido.localId)) return invalida("OTRO_DESTINO");
  const primero = datos.eventos[0];
  if (primero && pedido.desde) {
    const pos = { fechaRecepcion: primero.fechaRecepcion, transferenciaId: primero.transferenciaId };
    if (!cursorAnterior(pedido.desde, pos)) return invalida("NO_AVANZA");
  }
  if (!primero && !mismaPosicion(datos.siguiente, pedido.desde)) return invalida("SIGUIENTE_DE_PAGINA_VACIA");
  if (datos.eventos.length > pedido.limite) return invalida("DEMASIADOS_EVENTOS");
  if (datos.hayMas && datos.eventos.length !== pedido.limite) return invalida("HAY_MAS_SIN_PAGINA_LLENA");
  return { ok: true, datos };
}
