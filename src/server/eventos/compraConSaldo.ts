// src/server/eventos/compraConSaldo.ts
//
// COMPRA_CON_SALDO (capacidad `compras_saldo_eventos`, ERP fd1bca1): DE EVENTO
// DEL ERP A FILA DE `Evento`, Y SU PAYLOAD V1.
//
// El evento no trae local: es del local de la RESPUESTA del ERP (el que se
// pidió, comprobado por pagina.ts), el dueño de la compra, el que debe.
//
//   COMPRA_CON_SALDO  erpLocalId = el local dueño de la compra
//                     erpReferenciaId = compraConSaldoId, fechaOperacion = confirmadoEn
//                     payload v1 = { pedidoId, proveedor, total, pagado, saldo, texto }
//
// `texto` es el que arma el ERP ("{proveedor}: pedido $X · pagado $Y · quedan
// $Z a deber"). Se guarda tal cual y es lo que se muestra y lo que se avisa:
// Azul Chat no recalcula ni reformatea montos (CLAUDE.md, no se duplican reglas
// del ERP). Los tres números van al lado por si una pantalla los necesita, y
// son los del momento de CONFIRMAR: la cuenta puede pagarse después y eso no
// reescribe el evento.
//
// El payload se arma de cero con esos campos: un campo de más del ERP no se
// guarda. Nada de quién confirmó, productos, permisos, token ni sesión.
//
// Una clave repetida con otros números u otro texto es una foto distinta
// (CONTENIDO_DIFERENTE): se conserva la primera y se anota, como en los
// otros tipos. El ERP no reescribe una CompraConSaldo, así que no se espera.

import "server-only";

import { TipoEvento } from "@prisma/client";

import type { EventoCompraConSaldo } from "../../shared/erp/contrato.ts";
import type { FilaEvento } from "./transferenciaRecibida.ts";

export const PAYLOAD_VERSION_COMPRA_CON_SALDO = 1;

type Proveedor = { readonly id: number; readonly nombre: string };

export type PayloadCompraConSaldoV1 = {
  readonly pedidoId: number;
  readonly proveedor: Proveedor | null;
  readonly total: number;
  readonly pagado: number;
  readonly saldo: number;
  readonly texto: string;
};

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const soloClaves = (o: Record<string, unknown>, claves: readonly string[]) =>
  Object.keys(o).length === claves.length && claves.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const esEnteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const esMonto = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const esProveedor = (v: unknown): v is Proveedor | null =>
  v === null || (esObjeto(v) && soloClaves(v, ["id", "nombre"]) && esEnteroPositivo(v.id) && typeof v.nombre === "string");

/** El guardián del payload v1: exactamente esos campos, con esos tipos. Sirve para escribir y para leer. */
export function esPayloadCompraConSaldoV1(v: unknown): v is PayloadCompraConSaldoV1 {
  return (
    esObjeto(v) &&
    soloClaves(v, ["pedidoId", "proveedor", "total", "pagado", "saldo", "texto"]) &&
    esEnteroPositivo(v.pedidoId) &&
    esProveedor(v.proveedor) &&
    esMonto(v.total) &&
    esMonto(v.pagado) &&
    esMonto(v.saldo) &&
    typeof v.texto === "string" &&
    v.texto.length > 0
  );
}

/** Todos los campos cuentan. */
export function mismoPayloadCompraConSaldo(a: PayloadCompraConSaldoV1, b: PayloadCompraConSaldoV1): boolean {
  const mismoProveedor =
    a.proveedor === null || b.proveedor === null ? a.proveedor === b.proveedor : a.proveedor.id === b.proveedor.id && a.proveedor.nombre === b.proveedor.nombre;
  return mismoProveedor && a.pedidoId === b.pedidoId && a.total === b.total && a.pagado === b.pagado && a.saldo === b.saldo && a.texto === b.texto;
}

/** Un evento ya validado por el contrato, del local de la respuesta → la fila. Revienta si el payload no da v1. */
export function aFilaCompraConSaldo(e: EventoCompraConSaldo, localId: number): FilaEvento<PayloadCompraConSaldoV1> {
  const payload: PayloadCompraConSaldoV1 = {
    pedidoId: e.pedidoId,
    proveedor: e.proveedor ? { id: e.proveedor.id, nombre: e.proveedor.nombre } : null,
    total: e.total,
    pagado: e.pagado,
    saldo: e.saldo,
    texto: e.texto,
  };
  if (!esPayloadCompraConSaldoV1(payload)) throw new Error("payload de COMPRA_CON_SALDO inválido");
  return {
    tipo: TipoEvento.COMPRA_CON_SALDO,
    claveExterna: e.eventoId,
    erpLocalId: localId,
    erpReferenciaId: e.compraConSaldoId,
    fechaOperacion: new Date(e.confirmadoEn),
    payloadVersion: PAYLOAD_VERSION_COMPRA_CON_SALDO,
    payload,
  };
}
