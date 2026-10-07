// LOS TEXTOS DE LOS CHATS, EN UN SOLO LUGAR.
//
// Cómo se cuenta un evento y cómo se muestra una fecha se decide acá, y lo usan
// la lista, el Local y General. Ninguna pantalla arma estos textos por su cuenta.
//
// Las fechas llegan del servidor como instantes ISO en UTC; acá se muestran en
// la zona del teléfono (o en la que se pase, para los tests). Sin librerías:
// Intl alcanza.

import type { EventoPublico } from "../../shared/chats/api.ts";

const IDIOMA = "es-AR";

/** "Transferencia #182 recibida", o "… recibida con diferencias". */
export function resumenDeEvento(e: Pick<EventoPublico, "transferenciaId" | "tieneDiferencias">): string {
  return `Transferencia #${e.transferenciaId} recibida${e.tieneDiferencias ? " con diferencias" : ""}`;
}

/**
 * Cuántas LÍNEAS tienen diferencia. El dato es por línea del remito, no por
 * producto: un mismo producto puede estar en más de una línea. Sin diferencias
 * (o sin cantidad informada), nada.
 */
export function detalleDeDiferencias(e: Pick<EventoPublico, "tieneDiferencias" | "lineasConDiferencia">): string | null {
  if (!e.tieneDiferencias || e.lineasConDiferencia <= 0) return null;
  return e.lineasConDiferencia === 1 ? "1 línea con diferencia" : `${e.lineasConDiferencia} líneas con diferencias`;
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

/** Dos letras para el avatar: "Casiano Casas" → "CC", "Casiano" → "CA". */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  const letras = palabras.length >= 2 ? `${palabras[0]![0]}${palabras[1]![0]}` : (palabras[0] ?? "").slice(0, 2);
  return letras.toLocaleUpperCase(IDIOMA);
}
