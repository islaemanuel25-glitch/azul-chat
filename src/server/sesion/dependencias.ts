// src/server/sesion/dependencias.ts
//
// LO QUE NECESITAN LAS ACCIONES DE SESIÓN, INYECTADO. Las rutas de Next arman
// las de producción (ver `dependenciasDeProduccion`); los tests arman las suyas
// con una base descartable y un ERP de mentira.

import "server-only";

import { randomUUID } from "node:crypto";

import { leerConfigAzulChat, type ConfigAzulChat, type MotivoConfigAzulChat } from "../configuracion.ts";
import { obtenerDb, type Db } from "../db.ts";
import { crearClienteErp, type ClienteErp } from "../erp/cliente.ts";
import { crearLimitador, type Limitador } from "../http/limitador.ts";
import { leerConfigIa, type ConfigIa } from "../ia/config.ts";
import type { DependenciasIa } from "../ia/gemini.ts";
import { registrarEnConsola, type Registrador } from "../log.ts";

export type DependenciasSesion = {
  readonly config: { ok: true; config: ConfigAzulChat } | { ok: false; motivo: MotivoConfigAzulChat };
  readonly db: Db | null;
  readonly erp: ClienteErp;
  readonly limitador: Limitador;
  readonly ahora: () => number;
  readonly registrar: Registrador;
  readonly generarRequestId: () => string;
  /**
   * Tanda 6A: la IA que interpreta preguntas. Sin ella (o sin el campo, como
   * en los tests que no la usan) no hay preguntas: la caja no se muestra.
   */
  readonly ia?: { ok: true; config: ConfigIa } | { ok: false };
  /** Tanda 6A: el transporte hacia la IA. En los tests, uno de mentira; nunca la API real. */
  readonly transporteIa?: DependenciasIa["transporte"];
};

/** Uno por proceso: es el cupo de la vinculación (ver http/limitador.ts). */
const limitadorDelProceso = crearLimitador();

function iaDeProduccion(): { ok: true; config: ConfigIa } | { ok: false } {
  const ia = leerConfigIa();
  return ia.ok ? ia : { ok: false };
}

export function dependenciasDeProduccion(): DependenciasSesion {
  return {
    config: leerConfigAzulChat(),
    db: obtenerDb(),
    erp: crearClienteErp(),
    limitador: limitadorDelProceso,
    ahora: Date.now,
    registrar: registrarEnConsola,
    generarRequestId: randomUUID,
    ia: iaDeProduccion(),
  };
}
