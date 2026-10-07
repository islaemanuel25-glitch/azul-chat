// src/server/eventos/conSesion.ts
//
// LA INGESTA DE UN LOCAL CON LA DELEGACIÓN DE LA SESIÓN DE LA SOLICITUD.
//
// Une `sincronizarTransferenciasLocal` con `conDelegacion`, para que un fallo
// del ERP durante la ingesta siga el MISMO camino que cualquier otra llamada:
//
//   · VINCULO_NO_VALIDO: el vínculo se invalida y todas sus sesiones se revocan;
//   · NO_AUTORIZADO, caído, lento, cupo: no se invalida nada;
//   · ningún fallo se reintenta solo.
//
// NO autoriza: el local tiene que llegar ya autorizado por la capa de arriba,
// con `mi_alcance` vivo anunciando `transferencias_eventos` en ese local. Y el
// ERP vuelve a autorizar cada página con el token de quien pregunta.

import "server-only";

import { randomUUID } from "node:crypto";

import type { ResultadoConsulta } from "../../shared/erp/contrato.ts";
import { conDelegacion, type ResultadoDelegado } from "../sesion/delegacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import { sincronizarTransferenciasLocal, type ResultadoSincronizacion } from "./ingesta.ts";

export async function sincronizarTransferenciasDeLaSesion(
  headers: Headers,
  deps: DependenciasSesion,
  alcance: { readonly grupoId: number; readonly localId: number },
  generarId: () => string = randomUUID,
): Promise<ResultadoDelegado<ResultadoSincronizacion>> {
  return conDelegacion<ResultadoSincronizacion>(headers, deps, async (token): Promise<ResultadoConsulta<ResultadoSincronizacion>> => {
    // `conDelegacion` ya comprobó configuración y base antes de llegar acá.
    if (!deps.config.ok || !deps.db) return { ok: false, origen: "local", codigo: "INTEGRACION_NO_CONFIGURADA", requestId: deps.generarRequestId() };
    const r = await sincronizarTransferenciasLocal({
      db: deps.db,
      instalacionId: deps.config.config.instalacionId,
      alcance,
      consultar: (entrada) => deps.erp.transferenciasEventos(token, entrada),
      ahora: deps.ahora,
      generarId,
    });
    // El fallo del ERP vuelve tal cual, para que `conDelegacion` decida si invalida el vínculo.
    if (r.tipo === "FALLO_ERP") return r.fallo;
    return { ok: true, datos: r, requestId: deps.generarRequestId() };
  });
}
