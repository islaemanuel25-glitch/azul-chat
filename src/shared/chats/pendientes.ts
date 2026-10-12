// src/shared/chats/pendientes.ts
//
// QUÉ ES "PENDIENTE" Y EN QUÉ ORDEN SE MUESTRA (Tanda 9B). Puro: sin red, sin
// base. Lo usan el servidor (para armar la respuesta y la foto de una pregunta
// guardada) y los tests.
//
// Las reglas son del dueño (Figma "Azul Chat — Mobile V1", pantalla 04
// "Pendientes", pills IMPORTANTE / NORMAL). Ningún número se calcula: los
// montos, las horas y las líneas son los del ERP, copiados.
//
//   · Pedido: todo pedido que `pedidos_pendientes` devuelve. IMPORTANTE si
//     tiene más de 24 h (`antiguedadHoras > 24`); si no, NORMAL.
//   · Caja (de `cajas_resumen` de hoy o de ayer): las CON_DIFERENCIA o las
//     que Tesorería todavía no verificó (FALTA_VERIFICAR). Con faltante,
//     IMPORTANTE; con sobrante, NORMAL; sin diferencia pero sin verificar,
//     NORMAL. Una caja con diferencia que además falta verificar es UNA fila,
//     por la diferencia.
//   · Orden: IMPORTANTE primero; dentro de cada grupo, lo más viejo primero
//     (el pedido por `solicitadoAt`, la caja por su apertura; sin fecha, al
//     final). Empate: pedidos antes que cajas, y por id.

import type { CajasDelDia, EtiquetaPendiente, Pendiente, PendienteCaja, PendientePedido } from "./api.ts";

/** Más de estas horas, un pedido es IMPORTANTE. */
export const HORAS_PEDIDO_IMPORTANTE = 24;

/** Lo que `pedidos_pendientes` devuelve de cada pedido. */
export type PedidoDelErp = {
  readonly id: number;
  readonly solicitadoAt: string | null;
  readonly origen: { readonly id: number; readonly nombre: string };
  readonly lineas: number;
  readonly antiguedadHoras: number | null;
};

export function etiquetaDePedido(antiguedadHoras: number | null): EtiquetaPendiente {
  return antiguedadHoras !== null && antiguedadHoras > HORAS_PEDIDO_IMPORTANTE ? "IMPORTANTE" : "NORMAL";
}

/** Cada pedido pendiente, con su etiqueta. */
export function pendientesDePedidos(pedidos: readonly PedidoDelErp[]): PendientePedido[] {
  return pedidos.map((p) => ({
    tipo: "PEDIDO",
    etiqueta: etiquetaDePedido(p.antiguedadHoras),
    pedidoId: p.id,
    solicitadoAt: p.solicitadoAt,
    origen: { id: p.origen.id, nombre: p.origen.nombre },
    lineas: p.lineas,
    antiguedadHoras: p.antiguedadHoras,
  }));
}

/** Las cajas de un día que hay que revisar, con su motivo y su etiqueta. */
export function pendientesDeCajas(dia: CajasDelDia, cual: "hoy" | "ayer"): PendienteCaja[] {
  const salida: PendienteCaja[] = [];
  for (const t of dia.turnos) {
    for (const c of t.cajas) {
      const tipo = c.estado === "CON_DIFERENCIA" ? c.diferencia?.tipo : undefined;
      const diferencia = c.diferencia && (tipo === "FALTA" || tipo === "SOBRA") ? { tipo, monto: c.diferencia.monto } : null;
      const sinVerificar = c.verificacionTesoreria === "FALTA_VERIFICAR";
      if (!diferencia && !sinVerificar) continue;
      const motivo = diferencia ? diferencia.tipo : "FALTA_VERIFICAR";
      salida.push({
        tipo: "CAJA",
        etiqueta: motivo === "FALTA" ? "IMPORTANTE" : "NORMAL",
        cajaId: c.id,
        operador: c.operador,
        nombreCaja: c.etiqueta,
        turno: t.turno.nombre,
        dia: cual,
        apertura: c.apertura,
        motivo,
        monto: diferencia ? diferencia.monto : null,
      });
    }
  }
  return salida;
}

const fechaDe = (p: Pendiente): number => {
  const iso = p.tipo === "PEDIDO" ? p.solicitadoAt : p.apertura;
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};
const idDe = (p: Pendiente) => (p.tipo === "PEDIDO" ? p.pedidoId : p.cajaId);

/** IMPORTANTE primero; dentro, lo más viejo primero. */
export function compararPendientes(a: Pendiente, b: Pendiente): number {
  if (a.etiqueta !== b.etiqueta) return a.etiqueta === "IMPORTANTE" ? -1 : 1;
  const fa = fechaDe(a);
  const fb = fechaDe(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  if (a.tipo !== b.tipo) return a.tipo === "PEDIDO" ? -1 : 1;
  return idDe(a) - idDe(b);
}

/** Todo lo pendiente de un local, en el orden en que se muestra. */
export function ordenarPendientes(lista: readonly Pendiente[]): Pendiente[] {
  return [...lista].sort(compararPendientes);
}
