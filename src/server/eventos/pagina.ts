// src/server/eventos/pagina.ts
//
// UNA PÁGINA DE UNA CAPACIDAD DE EVENTOS, VALIDADA CONTRA LO QUE SE PIDIÓ,
// ANTES DE GUARDAR NADA.
//
// La forma la mira el contrato (`esDatosEventosDe`): eventos bien formados,
// clave igual a la que arma el ERP, orden estricto, ninguno más nuevo que
// `hasta`, `siguiente` igual al último. Acá se mira lo que depende del PEDIDO,
// que el contrato no sabe:
//
//   · el local de la respuesta es el que se pidió;
//   · si el evento dice de qué local es (TRANSFERENCIA_RECIBIDA trae
//     `destino`), es ese local. Los tipos de la Tanda 4B no traen destino: su
//     local es el de la respuesta;
//   · el primer evento viene estrictamente después del `desde` mandado;
//   · una página sin eventos repite el `desde` (o null si no hubo);
//   · no vienen más eventos que el `limite`, y `hayMas` solo con la página llena.
//
// Si falla UNA cosa, la página entera es RESPUESTA_INVALIDA: no se guarda nada
// de ella y el cursor no se mueve. Una página a medias rompería el cursor: lo
// que se salteara no volvería nunca.

import "server-only";

import {
  CONTRATO_TRANSFERENCIAS_EVENTOS,
  esDatosEventosDe,
  posicionAnterior,
  posicionDe,
  type ContratoEventos,
  type CursorTransferencias,
  type DatosEventos,
  type DatosTransferenciasEventos,
} from "../../shared/erp/contrato.ts";

export type PedidoDePagina<C> = {
  readonly localId: number;
  readonly desde: C | null;
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

export type ResultadoPaginaDe<D> =
  | { readonly ok: true; readonly datos: D }
  | { readonly ok: false; readonly codigo: "RESPUESTA_INVALIDA"; readonly motivo: MotivoPaginaInvalida };

export type ResultadoPagina = ResultadoPaginaDe<DatosTransferenciasEventos>;

/**
 * Valida una página de la capacidad `contrato`. `delLocal`, si el tipo dice de
 * qué local es cada evento, comprueba que sea el pedido (OTRO_DESTINO).
 */
export function validarPaginaDe<K extends string, E, C>(
  contrato: ContratoEventos<K, E, C>,
  datos: unknown,
  pedido: PedidoDePagina<C>,
  delLocal?: (e: E, localId: number) => boolean,
): ResultadoPaginaDe<DatosEventos<K, E, C>> {
  const invalida = (motivo: MotivoPaginaInvalida) => ({ ok: false, codigo: "RESPUESTA_INVALIDA", motivo }) as const;
  if (!esDatosEventosDe(contrato, datos)) return invalida("FORMA");
  if (datos.local.id !== pedido.localId) return invalida("OTRO_LOCAL");
  if (delLocal && !datos.eventos.every((e) => delLocal(e, pedido.localId))) return invalida("OTRO_DESTINO");
  const desde = pedido.desde === null ? null : posicionDe(contrato, pedido.desde);
  const primero = datos.eventos[0];
  if (primero && desde && !posicionAnterior(desde, posicionDe(contrato, primero))) return invalida("NO_AVANZA");
  if (!primero) {
    const siguiente = datos.siguiente === null ? null : posicionDe(contrato, datos.siguiente);
    const misma = siguiente === null || desde === null ? siguiente === desde : siguiente.fecha === desde.fecha && siguiente.id === desde.id;
    if (!misma) return invalida("SIGUIENTE_DE_PAGINA_VACIA");
  }
  if (datos.eventos.length > pedido.limite) return invalida("DEMASIADOS_EVENTOS");
  if (datos.hayMas && datos.eventos.length !== pedido.limite) return invalida("HAY_MAS_SIN_PAGINA_LLENA");
  return { ok: true, datos };
}

/** `transferencias_eventos`: además, el destino de TODOS los eventos es el local pedido. */
export function validarPagina(datos: unknown, pedido: PedidoDePagina<CursorTransferencias>): ResultadoPagina {
  return validarPaginaDe(CONTRATO_TRANSFERENCIAS_EVENTOS, datos, pedido, (e, localId) => e.destino.id === localId) as ResultadoPagina;
}
