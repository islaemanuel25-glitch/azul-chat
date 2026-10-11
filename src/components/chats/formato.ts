// LOS TEXTOS DE LOS CHATS, EN UN SOLO LUGAR.
//
// Cómo se cuenta un evento y cómo se muestra una fecha se decide acá, y lo usan
// la lista, el Local y General. Ninguna pantalla arma estos textos por su cuenta.
//
// Las fechas llegan del servidor como instantes ISO en UTC; acá se muestran en
// la zona del teléfono (o en la que se pase, para los tests). Sin librerías:
// Intl alcanza.

import type { EventoPublico, EventoTransferenciaRecibidaPublico } from "../../shared/chats/api.ts";

const IDIOMA = "es-AR";

/**
 * El título de un evento, el mismo en la conversación, en General y en el
 * resumen de la lista (Figma DpxKeDtugjdB8IfuGnHZcz, pantalla 01):
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

/** Solo una recepción con diferencias lleva marca y borde de alerta. Ningún otro tipo. */
export function esAlerta(e: EventoPublico): boolean {
  return e.tipo === "TRANSFERENCIA_RECIBIDA" && e.tieneDiferencias;
}

/**
 * Cuántas LÍNEAS tienen diferencia. El dato es por línea del remito, no por
 * producto: un mismo producto puede estar en más de una línea. Sin diferencias
 * (o sin cantidad informada), nada.
 */
export function detalleDeDiferencias(e: Pick<EventoTransferenciaRecibidaPublico, "tieneDiferencias" | "lineasConDiferencia">): string | null {
  if (!e.tieneDiferencias || e.lineasConDiferencia <= 0) return null;
  return e.lineasConDiferencia === 1 ? "1 línea con diferencia" : `${e.lineasConDiferencia} líneas con diferencias`;
}

/** "1 línea", "12 líneas": las líneas del pedido o del remito, como las contó el ERP. */
export function cantidadDeLineas(k: number): string {
  return k === 1 ? "1 línea" : `${k.toLocaleString(IDIOMA)} líneas`;
}

/**
 * Lo secundario de un evento, en una sola línea chica, separado por " · ":
 *
 *   · recibida: [líneas con diferencias] · Desde {origen} · hora;
 *   · pedido: A {origen} · {k} línea(s) · hora (se le pide al origen);
 *   · enviada: Desde {origen} · {k} línea(s) · hora;
 *   · cancelada: Desde {origen} · hora.
 */
export function metaDeEvento(e: EventoPublico, zona?: string): string {
  const hora = formatearHora(e.fecha, zona);
  switch (e.tipo) {
    case "TRANSFERENCIA_RECIBIDA":
      return [detalleDeDiferencias(e), `Desde ${e.origen.nombre}`, hora].filter(Boolean).join(" · ");
    case "PEDIDO_SOLICITADO":
      return [`A ${e.origen.nombre}`, cantidadDeLineas(e.lineas), hora].join(" · ");
    case "TRANSFERENCIA_ENVIADA":
      return [`Desde ${e.origen.nombre}`, cantidadDeLineas(e.lineas), hora].join(" · ");
    case "TRANSFERENCIA_CANCELADA":
      return [`Desde ${e.origen.nombre}`, hora].join(" · ");
  }
}

/** El día calendario del instante en esa zona, como "AAAA-MM-DD". */
function claveDeDia(instante: Date, zona: string | undefined): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instante);
  const valor = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

/** La clave del día anterior a esa clave. */
function diaAnterior(clave: string): string {
  const [a, m, d] = clave.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

type Relativo = "HOY" | "AYER" | "ANTES";

function relativo(instante: Date, ahora: Date, zona: string | undefined): Relativo {
  const dia = claveDeDia(instante, zona);
  const hoy = claveDeDia(ahora, zona);
  if (dia === hoy) return "HOY";
  return dia === diaAnterior(hoy) ? "AYER" : "ANTES";
}

/** "18:22". */
export function formatearHora(iso: string, zona?: string): string {
  return new Intl.DateTimeFormat(IDIOMA, { timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** Para la lista: la hora si es de hoy, "Ayer", o la fecha corta. */
export function formatearMomento(iso: string, ahora: Date = new Date(), zona?: string): string {
  const instante = new Date(iso);
  switch (relativo(instante, ahora, zona)) {
    case "HOY":
      return formatearHora(iso, zona);
    case "AYER":
      return "Ayer";
    case "ANTES": {
      const mismoAnio = claveDeDia(instante, zona).slice(0, 4) === claveDeDia(ahora, zona).slice(0, 4);
      return new Intl.DateTimeFormat(IDIOMA, { timeZone: zona, day: "numeric", month: "numeric", ...(mismoAnio ? {} : { year: "2-digit" }) }).format(instante);
    }
  }
}

/** Para separar los días de una conversación: "Hoy", "Ayer" o "lunes, 5 de octubre". */
export function etiquetaDeDia(iso: string, ahora: Date = new Date(), zona?: string): string {
  const instante = new Date(iso);
  switch (relativo(instante, ahora, zona)) {
    case "HOY":
      return "Hoy";
    case "AYER":
      return "Ayer";
    case "ANTES": {
      const mismoAnio = claveDeDia(instante, zona).slice(0, 4) === claveDeDia(ahora, zona).slice(0, 4);
      return new Intl.DateTimeFormat(IDIOMA, { timeZone: zona, weekday: "long", day: "numeric", month: "long", ...(mismoAnio ? {} : { year: "numeric" }) }).format(instante);
    }
  }
}

/** La clave de día de un instante, para agrupar una conversación. */
export function diaDe(iso: string, zona?: string): string {
  return claveDeDia(new Date(iso), zona);
}

// ── Ventas (Tanda 3A) ───────────────────────────────────────────────────────

/** "Ventas de hoy · Casiano". */
export function tituloDeVentas(nombreLocal: string): string {
  return `Ventas de hoy · ${nombreLocal}`;
}

/** "1 venta", "347 ventas", "1.234 ventas". */
export function cantidadDeVentas(n: number): string {
  return n === 1 ? "1 venta" : `${n.toLocaleString(IDIOMA)} ventas`;
}

const DECIMAL_ERP = /^(-?)(\d+)\.(\d{2})$/;

/**
 * Un monto del ERP ("1850320.00") como moneda es-AR ("$ 1.850.320,00"), sobre
 * el TEXTO: no pasa por number, así que no redondea ni pierde centavos. Lo que
 * no tiene la forma del contrato se muestra tal cual, sin inventar.
 */
export function formatearMonto(decimal: string): string {
  const m = DECIMAL_ERP.exec(decimal);
  if (!m) return decimal;
  const [, signo, entero, centavos] = m as unknown as [string, string, string, string];
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${signo}$ ${conMiles},${centavos}`;
}

/** "Efectivo · $ 620.000,00". */
export function lineaDeMedioDePago(m: { readonly etiqueta: string; readonly total: string }): string {
  return `${m.etiqueta} · ${formatearMonto(m.total)}`;
}

/** Dos letras para el avatar: "Casiano Casas" → "CC", "Casiano" → "CA". */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  const letras = palabras.length >= 2 ? `${palabras[0]![0]}${palabras[1]![0]}` : (palabras[0] ?? "").slice(0, 2);
  return letras.toLocaleUpperCase(IDIOMA);
}
