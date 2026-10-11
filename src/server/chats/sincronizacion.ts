// src/server/chats/sincronizacion.ts
//
// TRAER LO NUEVO DE LOS LOCALES AUTORIZADOS, CON FRECUENCIA MÍNIMA.
//
// ── DOS CACHÉS QUE NO SON LO MISMO ─────────────────────────────────────────
//
//   · AUTORIZACIÓN: no hay caché. `mi_alcance` se pide en CADA solicitud
//     (autorizacion.ts).
//   · INGESTA: sí hay frecuencia mínima, compartida por el CursorIngesta de
//     cada (local, capacidad). Si esa capacidad de ese local se sincronizó bien
//     hace menos de 30 s, no se vuelve a pedir al ERP: se usa lo ya guardado.
//     Es seguro porque solo decide QUÉ tan fresco está lo guardado, nunca QUIÉN
//     puede verlo.
//
// En cada local se ingieren SOLO las capacidades de eventos que `mi_alcance`
// le anuncia hoy (Tanda 4B: `transferencias_eventos`, `pedidos_eventos`,
// `envios_eventos`, `cancelaciones_eventos`), de a una, en el orden del
// catálogo, con la ingesta de siempre: arriendo, hasta 3 páginas de 100,
// cursor y backfill. Sin worker, sin cron, sin polling: solo cuando una
// persona pide los chats.
//
// ── QUÉ SE HACE CON CADA RESULTADO ─────────────────────────────────────────
//
//   · sincronizó, estaba fresco u otra solicitud lo está sincronizando: al día;
//   · el ERP dijo VINCULO_NO_VALIDO: se corta TODO y se devuelve ese fallo,
//     para que el flujo de siempre invalide el vínculo;
//   · el ERP dijo NO_AUTORIZADO para esa capacidad en ese local (cambió entre
//     `mi_alcance` y esta llamada): esa capacidad SALE de esta respuesta, y con
//     ella sus tipos de evento. Fallo cerrado para ella. Si no le queda
//     ninguna, el local entero sale;
//   · cualquier otra falla (ERP caído, lento, cupo, contrato, contradicción,
//     base): la capacidad queda como está y el local se marca DEMORADA. Las
//     otras capacidades del local, y los otros locales, siguen. Se muestra lo
//     ya guardado: la autorización de AHORA para ese local ya se comprobó.

import "server-only";

import { randomUUID } from "node:crypto";

import {
  CAPACIDAD_CANCELACIONES_EVENTOS,
  CAPACIDAD_ENVIOS_EVENTOS,
  CAPACIDAD_PEDIDOS_EVENTOS,
  CAPACIDAD_TRANSFERENCIAS_EVENTOS,
  type CapacidadEventos,
  type FalloErp,
  type FalloLocal,
} from "../../shared/erp/contrato.ts";
import type { EstadoSincronizacion } from "../../shared/chats/api.ts";
import { INGESTA_CANCELACIONES, INGESTA_ENVIOS, INGESTA_PEDIDOS } from "../eventos/capacidades.ts";
import { sincronizarEventosLocal, sincronizarTransferenciasLocal, type ResultadoSincronizacion } from "../eventos/ingesta.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import type { Autorizacion, LocalDeEventos } from "./autorizacion.ts";

/** Por debajo de esto, una capacidad de un local sincronizada no se vuelve a pedir al ERP. Frecuencia de INGESTA, no de autorización. */
export const FRECUENCIA_MINIMA_INGESTA_MS = 30_000;

/** Un local que sigue en la respuesta: con las capacidades que el ERP no negó en esta solicitud, y su estado. */
export type LocalSincronizado = LocalDeEventos & { readonly sincronizacion: EstadoSincronizacion };

export type ResultadoDeSincronizar =
  | { readonly ok: true; readonly locales: readonly LocalSincronizado[] }
  /** El ERP rechazó el token: hay que invalidar el vínculo. */
  | { readonly ok: false; readonly fallo: FalloErp | FalloLocal };

/** ¿Esta capacidad de este local se sincronizó bien hace menos de la frecuencia mínima? */
async function estaFresco(deps: DependenciasSesion, a: Autorizacion, localId: number, capacidad: CapacidadEventos): Promise<boolean> {
  const cursor = await a.contexto.db.cursorIngesta.findUnique({
    where: {
      instalacionId_erpLocalId_capacidad: {
        instalacionId: a.contexto.config.instalacionId,
        erpLocalId: localId,
        capacidad,
      },
    },
    select: { ultimaSincronizacionEn: true },
  });
  const ultima = cursor?.ultimaSincronizacionEn;
  return !!ultima && deps.ahora() - ultima.getTime() < FRECUENCIA_MINIMA_INGESTA_MS;
}

/** Una capacidad de un local, con la ingesta común y el método del cliente ERP de esa capacidad. */
function sincronizarCapacidad(
  deps: DependenciasSesion,
  a: Autorizacion,
  local: LocalDeEventos,
  capacidad: CapacidadEventos,
  generarId: () => string,
): Promise<ResultadoSincronizacion> {
  const base = {
    db: a.contexto.db,
    instalacionId: a.contexto.config.instalacionId,
    alcance: { grupoId: local.grupoId, localId: local.localId },
    ahora: deps.ahora,
    generarId,
  };
  switch (capacidad) {
    case CAPACIDAD_TRANSFERENCIAS_EVENTOS:
      return sincronizarTransferenciasLocal({ ...base, consultar: (entrada) => deps.erp.transferenciasEventos(a.token, entrada) });
    case CAPACIDAD_PEDIDOS_EVENTOS:
      return sincronizarEventosLocal(INGESTA_PEDIDOS, { ...base, consultar: (entrada) => deps.erp.pedidosEventos(a.token, entrada) });
    case CAPACIDAD_ENVIOS_EVENTOS:
      return sincronizarEventosLocal(INGESTA_ENVIOS, { ...base, consultar: (entrada) => deps.erp.enviosEventos(a.token, entrada) });
    case CAPACIDAD_CANCELACIONES_EVENTOS:
      return sincronizarEventosLocal(INGESTA_CANCELACIONES, { ...base, consultar: (entrada) => deps.erp.cancelacionesEventos(a.token, entrada) });
  }
}

const codigoErp = (r: ResultadoSincronizacion): string | null => (r.tipo === "FALLO_ERP" && r.fallo.origen === "erp" ? r.fallo.codigo : null);

/**
 * Sincroniza, de a uno, los locales autorizados que lo necesitan, y en cada
 * uno sus capacidades anunciadas. Devuelve los que siguen en la respuesta,
 * con las capacidades que siguen y su estado.
 */
export async function sincronizarAutorizados(
  deps: DependenciasSesion,
  a: Autorizacion,
  locales: readonly LocalDeEventos[],
  generarId: () => string = randomUUID,
): Promise<ResultadoDeSincronizar> {
  const salida: LocalSincronizado[] = [];
  for (const local of locales) {
    const vigentes: CapacidadEventos[] = [];
    let demorada = false;
    for (const capacidad of local.capacidades) {
      if (await estaFresco(deps, a, local.localId, capacidad)) {
        vigentes.push(capacidad);
        continue;
      }
      const r = await sincronizarCapacidad(deps, a, local, capacidad, generarId);
      const codigo = codigoErp(r);
      if (codigo === "VINCULO_NO_VALIDO" && r.tipo === "FALLO_ERP") return { ok: false, fallo: r.fallo };
      if (codigo === "NO_AUTORIZADO") continue;
      vigentes.push(capacidad);
      if (r.tipo !== "SINCRONIZADO" && r.tipo !== "OCUPADO") demorada = true;
    }
    if (vigentes.length === 0) continue;
    salida.push({ ...local, capacidades: vigentes, sincronizacion: demorada ? "DEMORADA" : "AL_DIA" });
  }
  return { ok: true, locales: salida };
}
