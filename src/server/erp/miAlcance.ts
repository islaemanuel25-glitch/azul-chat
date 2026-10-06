// src/server/erp/miAlcance.ts
//
// LA SOLICITUD DE `mi_alcance`. Forma exacta del ERP desplegado (erpmanual
// 8920516, lib/integraciones/azul-chat/atender.js y capacidades.js):
//
//   {
//     "capacidad":  "mi_alcance",
//     "delegacion": { "token": "del1_…" },
//     "parametros": {}
//   }
//
// Sin `alcance`: el ERP lo rechaza en esta capacidad, porque el alcance lo
// decide él con el usuario y el rol de hoy. Sin parámetros.

import "server-only";

import { esTokenDelegacion } from "./credenciales.ts";

export const CAPACIDAD_MI_ALCANCE = "mi_alcance";

export type CuerpoMiAlcance = {
  readonly capacidad: typeof CAPACIDAD_MI_ALCANCE;
  readonly delegacion: { readonly token: string };
  readonly parametros: Record<string, never>;
};

export function construirCuerpoMiAlcance(token: string): CuerpoMiAlcance | null {
  if (!esTokenDelegacion(token)) return null;
  return { capacidad: CAPACIDAD_MI_ALCANCE, delegacion: { token }, parametros: {} };
}
