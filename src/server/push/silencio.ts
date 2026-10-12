// src/server/push/silencio.ts
//
// EL HORARIO DE SILENCIO (Tanda 11). Solo servidor.
//
// Mientras la persona está en su horario de silencio, la sincronización de
// fondo NO le manda push (interno/sincronizar.ts). Todo lo demás sigue igual:
// los eventos se ingieren, quedan sin leer, y la marca de avisos
// (push/avisos.ts) AVANZA, así que al salir del horario no llega el atraso
// acumulado —nada de ráfagas a las 7 de la mañana—: solo lo que pase después.
//
// La hora es la de Argentina (sin horario de verano), en horas enteras. El
// intervalo es [desde, hasta): "0 a 7" silencia de 00:00 a 06:59; "22 a 7"
// cruza la medianoche y silencia de 22:00 a 06:59.

import "server-only";

import type { HorarioSilencio } from "../../shared/sesion/configuracion.ts";

const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";

/** La hora (0 a 23) de ese instante en Argentina. */
export function horaEnArgentina(ahora: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: ZONA_ARGENTINA, hour: "numeric", hourCycle: "h23" }).format(ahora);
  return Number(h);
}

/** ¿Ese instante cae dentro del horario de silencio? Apagado, nunca. */
export function enSilencio(h: HorarioSilencio, ahora: Date): boolean {
  if (!h.activo) return false;
  const hora = horaEnArgentina(ahora);
  return h.desde < h.hasta ? hora >= h.desde && hora < h.hasta : hora >= h.desde || hora < h.hasta;
}
