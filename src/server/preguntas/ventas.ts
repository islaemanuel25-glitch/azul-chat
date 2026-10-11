// src/server/preguntas/ventas.ts
//
// VENTAS PARA UNA PREGUNTA: COPIAR LO DEL ERP Y SUMAR (Tanda 6A). Sin red.
//
// De cada local, lo que el ERP contestó, copiado campo por campo y solo si es
// del local, el grupo y el período pedidos. La suma de "todos los locales" la
// hace el código, en centavos enteros (BigInt) sobre el decimal en texto del
// ERP: sin coma flotante, sin redondeos, y nunca la IA.

import "server-only";

import type { DatosVentasResumen, Periodo } from "../../shared/erp/contrato.ts";
import type { TotalVentas, VentasDeUnLocal } from "../../shared/chats/preguntas.ts";

const DECIMAL = /^(-?)(\d+)\.(\d{2})$/;

/** "1234.50" → 123450n; null si no es el decimal del contrato. */
export function aCentavos(texto: string): bigint | null {
  const m = DECIMAL.exec(texto);
  if (!m) return null;
  const valor = BigInt(m[2]!) * 100n + BigInt(m[3]!);
  return m[1] ? -valor : valor;
}

/** 123450n → "1234.50". */
export function deCentavos(c: bigint): string {
  const negativo = c < 0n;
  const a = negativo ? -c : c;
  return `${negativo ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}

/** Lo que contestó el ERP → lo que se muestra, o null si no es lo que se pidió. */
export function ventasDeUnLocal(d: DatosVentasResumen, pedido: { localId: number; grupoId: number; periodo: Periodo }): VentasDeUnLocal | null {
  if (d.local.id !== pedido.localId || d.grupoId !== pedido.grupoId || d.periodo.tipo !== pedido.periodo.tipo) return null;
  if (pedido.periodo.tipo === "rango" && (d.periodo.desde !== pedido.periodo.desde || d.periodo.hasta !== pedido.periodo.hasta)) return null;
  return {
    local: { id: d.local.id, nombre: d.local.nombre },
    cantidadVentas: d.cantidadVentas,
    totalVendido: d.totalVendido,
    mediosDePago: d.mediosDePago.map((m) => ({ medio: m.medio, etiqueta: m.etiqueta, total: m.total, cantidadPagos: m.cantidadPagos })),
    advertencias: d.advertencias.map((a) => ({ codigo: a.codigo, mensaje: a.mensaje })),
  };
}

/**
 * La suma de varios locales: cantidad, total y cada medio de pago (por su
 * clave `medio`, en el orden en que aparece por primera vez). null si algún
 * monto no tiene la forma del contrato: no se suma lo que no se puede leer.
 */
export function sumarVentas(locales: readonly VentasDeUnLocal[]): TotalVentas | null {
  let cantidad = 0;
  let total = 0n;
  const medios = new Map<string, { etiqueta: string; total: bigint; cantidadPagos: number }>();
  for (const l of locales) {
    const t = aCentavos(l.totalVendido);
    if (t === null) return null;
    cantidad += l.cantidadVentas;
    total += t;
    for (const m of l.mediosDePago) {
      const c = aCentavos(m.total);
      if (c === null) return null;
      const previo = medios.get(m.medio);
      medios.set(m.medio, { etiqueta: previo?.etiqueta ?? m.etiqueta, total: (previo?.total ?? 0n) + c, cantidadPagos: (previo?.cantidadPagos ?? 0) + m.cantidadPagos });
    }
  }
  return {
    cantidadVentas: cantidad,
    totalVendido: deCentavos(total),
    mediosDePago: [...medios].map(([medio, m]) => ({ medio, etiqueta: m.etiqueta, total: deCentavos(m.total), cantidadPagos: m.cantidadPagos })),
  };
}
