// src/server/erp/cajasResumen.ts
//
// LA SOLICITUD DE `cajas_resumen` (Tanda 7B): SE CONSTRUYE ACÁ Y EN NINGÚN OTRO LADO.
//
// Forma exacta del ERP en producción (erpmanual 14ae247,
// lib/integraciones/azul-chat/cajasResumen.js, `resolverPedido`):
//
//   {
//     "capacidad":  "cajas_resumen",
//     "delegacion": { "token": "del1_…" },
//     "alcance":    { "grupoId": 1, "localId": 3 },
//     "parametros": { "periodo": { "tipo": "hoy" } }
//   }
//
// con periodo = { tipo: "hoy" } | { tipo: "ayer" } | { tipo: "fecha", fecha: "AAAA-MM-DD" }:
// UN día argentino. El ERP acepta además `turnoOperativo` (nombre o id); Azul
// Chat NO lo manda: pide el día entero y elige el turno sobre los nombres que
// el ERP devolvió (preguntas/cajas.ts), así una pregunta por turno gasta una
// sola consulta y un turno que no existe muestra los que sí.
//
// Solo FORMA: enteros positivos y una fecha de calendario real. "La fecha está
// en el futuro" depende de qué día es hoy en Argentina: lo decide el ERP.

import "server-only";

import type { PeriodoCajas } from "../../shared/erp/contrato.ts";
import { CAPACIDAD_CAJAS_RESUMEN } from "../../shared/erp/contrato.ts";
import { esTokenDelegacion } from "./credenciales.ts";
import { esEnteroPositivo, esFechaReal, esObjetoPlano, soloEstas, tieneTodas } from "./ventasResumen.ts";

export { CAPACIDAD_CAJAS_RESUMEN };

export type CuerpoCajasResumen = {
  readonly capacidad: typeof CAPACIDAD_CAJAS_RESUMEN;
  readonly delegacion: { readonly token: string };
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly parametros: { readonly periodo: PeriodoCajas };
};

/** Lo que el resto de Azul Chat le pasa al cliente: qué local y qué día. */
export type EntradaCajasResumen = {
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly periodo: PeriodoCajas;
};

type Rechazo = { readonly ok: false; readonly codigo: "SOLICITUD_INVALIDA" | "PERIODO_INVALIDO"; readonly detalle: string };

function validarPeriodo(periodo: unknown): { ok: true; periodo: PeriodoCajas } | Rechazo {
  const invalido = (detalle: string): Rechazo => ({ ok: false, codigo: "PERIODO_INVALIDO", detalle });
  if (!esObjetoPlano(periodo)) return invalido("Falta el período: hoy, ayer o una fecha.");
  const { tipo } = periodo;
  if (tipo === "hoy" || tipo === "ayer") {
    if (!soloEstas(periodo, ["tipo"])) return invalido(`El período ${tipo} no acepta más datos que tipo.`);
    return { ok: true, periodo: { tipo } };
  }
  if (tipo !== "fecha") return invalido("El período tiene que ser hoy, ayer o fecha: un solo día.");
  if (!soloEstas(periodo, ["tipo", "fecha"]) || !esFechaReal(periodo.fecha)) return invalido("La fecha tiene que ser AAAA-MM-DD real.");
  return { ok: true, periodo: { tipo: "fecha", fecha: periodo.fecha } };
}

/**
 * Valida la entrada y arma el cuerpo exacto que se firma y se manda.
 *
 * @param token el token de delegación, descifrado en el servidor desde el vínculo de la sesión.
 * @param entrada `{ alcance: { grupoId, localId }, periodo }`.
 */
export function construirCuerpoCajasResumen(token: string, entrada: unknown): { ok: true; cuerpo: CuerpoCajasResumen } | Rechazo {
  const invalida = (detalle: string): Rechazo => ({ ok: false, codigo: "SOLICITUD_INVALIDA", detalle });
  if (!esTokenDelegacion(token)) return invalida("El token de delegación no tiene la forma del ERP.");
  if (!esObjetoPlano(entrada)) return invalida("La entrada tiene que ser un objeto.");
  const CLAVES = ["alcance", "periodo"] as const;
  if (!soloEstas(entrada, CLAVES) || !tieneTodas(entrada, CLAVES)) return invalida("La entrada lleva exactamente alcance y periodo.");
  const { alcance } = entrada;
  if (!esObjetoPlano(alcance) || !soloEstas(alcance, ["grupoId", "localId"])) return invalida("El alcance solo acepta grupoId y localId.");
  if (!esEnteroPositivo(alcance.grupoId) || !esEnteroPositivo(alcance.localId)) return invalida("grupoId y localId tienen que ser enteros positivos.");
  const periodo = validarPeriodo(entrada.periodo);
  if (!periodo.ok) return periodo;
  return {
    ok: true,
    cuerpo: {
      capacidad: CAPACIDAD_CAJAS_RESUMEN,
      delegacion: { token },
      alcance: { grupoId: alcance.grupoId, localId: alcance.localId },
      parametros: { periodo: periodo.periodo },
    },
  };
}
