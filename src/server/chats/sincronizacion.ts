// src/server/chats/sincronizacion.ts
//
// TRAER LO NUEVO DE LOS LOCALES AUTORIZADOS, CON FRECUENCIA MÍNIMA.
//
// ── DOS CACHÉS QUE NO SON LO MISMO ─────────────────────────────────────────
//
//   · AUTORIZACIÓN: no hay caché. `mi_alcance` se pide en CADA solicitud
//     (autorizacion.ts).
//   · INGESTA: sí hay frecuencia mínima, compartida por el CursorIngesta de
//     cada local. Si ese local se sincronizó bien hace menos de 30 s, no se
//     vuelve a pedir `transferencias_eventos`: se usa lo ya guardado. Es
//     seguro porque solo decide QUÉ tan fresco está lo guardado, nunca QUIÉN
//     puede verlo.
//
// Un local que necesita sincronizar usa la ingesta de la fundación tal cual:
// arriendo, hasta 3 páginas de 100, cursor y backfill. Sin worker, sin cron,
// sin polling: solo cuando una persona pide los chats.
//
// ── QUÉ SE HACE CON CADA RESULTADO ─────────────────────────────────────────
//
//   · sincronizó, estaba fresco u otra solicitud lo está sincronizando: AL_DIA;
//   · el ERP dijo VINCULO_NO_VALIDO: se corta TODO y se devuelve ese fallo,
//     para que el flujo de siempre invalide el vínculo;
//   · el ERP dijo NO_AUTORIZADO para ese local (cambió entre `mi_alcance` y
//     esta llamada): el local SALE de esta respuesta. Fallo cerrado para él;
//   · cualquier otra falla (ERP caído, lento, cupo, contrato, contradicción,
//     base): DEMORADA. Se muestra lo ya guardado: la autorización de AHORA
//     para ese local ya se comprobó.

import "server-only";

import { randomUUID } from "node:crypto";

import { CAPACIDAD_TRANSFERENCIAS_EVENTOS, type FalloErp, type FalloLocal } from "../../shared/erp/contrato.ts";
import type { EstadoSincronizacion } from "../../shared/chats/api.ts";
import { sincronizarTransferenciasLocal } from "../eventos/ingesta.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import type { Autorizacion, LocalAutorizado } from "./autorizacion.ts";

/** Por debajo de esto, un local sincronizado no se vuelve a pedir al ERP. Frecuencia de INGESTA, no de autorización. */
export const FRECUENCIA_MINIMA_INGESTA_MS = 30_000;

export type LocalSincronizado = LocalAutorizado & { readonly sincronizacion: EstadoSincronizacion };

export type ResultadoDeSincronizar =
  | { readonly ok: true; readonly locales: readonly LocalSincronizado[] }
  /** El ERP rechazó el token: hay que invalidar el vínculo. */
  | { readonly ok: false; readonly fallo: FalloErp | FalloLocal };

/** ¿Este local se sincronizó bien hace menos de la frecuencia mínima? */
async function estaFresco(deps: DependenciasSesion, a: Autorizacion, localId: number): Promise<boolean> {
  const cursor = await a.contexto.db.cursorIngesta.findUnique({
    where: {
      instalacionId_erpLocalId_capacidad: {
        instalacionId: a.contexto.config.instalacionId,
        erpLocalId: localId,
        capacidad: CAPACIDAD_TRANSFERENCIAS_EVENTOS,
      },
    },
    select: { ultimaSincronizacionEn: true },
  });
  const ultima = cursor?.ultimaSincronizacionEn;
  return !!ultima && deps.ahora() - ultima.getTime() < FRECUENCIA_MINIMA_INGESTA_MS;
}

/**
 * Sincroniza, de a uno, los locales autorizados que lo necesitan. Devuelve
 * los que siguen en la respuesta, con su estado.
 */
export async function sincronizarAutorizados(
  deps: DependenciasSesion,
  a: Autorizacion,
  locales: readonly LocalAutorizado[],
  generarId: () => string = randomUUID,
): Promise<ResultadoDeSincronizar> {
  const salida: LocalSincronizado[] = [];
  for (const local of locales) {
    if (await estaFresco(deps, a, local.localId)) {
      salida.push({ ...local, sincronizacion: "AL_DIA" });
      continue;
    }
    const r = await sincronizarTransferenciasLocal({
      db: a.contexto.db,
      instalacionId: a.contexto.config.instalacionId,
      alcance: { grupoId: local.grupoId, localId: local.localId },
      consultar: (entrada) => deps.erp.transferenciasEventos(a.token, entrada),
      ahora: deps.ahora,
      generarId,
    });
    if (r.tipo === "FALLO_ERP" && r.fallo.origen === "erp" && r.fallo.codigo === "VINCULO_NO_VALIDO") return { ok: false, fallo: r.fallo };
    if (r.tipo === "FALLO_ERP" && r.fallo.origen === "erp" && r.fallo.codigo === "NO_AUTORIZADO") continue;
    const alDia = r.tipo === "SINCRONIZADO" || r.tipo === "OCUPADO";
    salida.push({ ...local, sincronizacion: alDia ? "AL_DIA" : "DEMORADA" });
  }
  return { ok: true, locales: salida };
}
