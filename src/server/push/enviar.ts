// src/server/push/enviar.ts
//
// UN ENVÍO A UN SERVICIO DE PUSH (Tanda 5A). Solo servidor.
//
// El cifrado (RFC 8291) y la firma VAPID (RFC 8292) los arma la librería
// `web-push` (config.ts, `armar`); el envío lo hace este archivo, con `fetch`,
// para poder inyectarlo en los tests y que ningún test llame a un servicio de
// push real. Mismo criterio que el cliente del ERP:
//
//   · sin reintentos: si falla, se anota el código y la próxima corrida avisa
//     lo próximo. Un aviso perdido no se reenvía (cada evento se avisa una vez);
//   · sin seguir redirecciones;
//   · con corte por tiempo;
//   · 404 o 410 del servicio: la suscripción ya no existe (el navegador la
//     dio de baja, se desinstaló la app). Se BORRA.
//
// Solo se manda a endpoints de la lista de suscripcion.ts: una fila con otro
// endpoint (no debería existir) no se intenta.

import "server-only";

import type { ConfigPush, SuscripcionDestino } from "./config.ts";
import { endpointPermitido } from "./suscripcion.ts";

/** Cuánto guarda el servicio de push un aviso si el teléfono está apagado: 12 horas. Más tarde ya no es novedad. */
export const TTL_AVISO_SEGUNDOS = 12 * 60 * 60;
/** Lo que se espera al servicio de push antes de abortar. */
export const TIMEOUT_MS_PUSH = 10_000;

export type ResultadoEnvio =
  | { readonly tipo: "ENVIADO" }
  /** 404/410: la suscripción ya no existe. Hay que borrarla. */
  | { readonly tipo: "VENCIDA" }
  /** Cualquier otra cosa. `codigo` es cerrado: HTTP_<status>, TIEMPO_AGOTADO, INALCANZABLE o ENDPOINT_NO_PERMITIDO. */
  | { readonly tipo: "FALLO"; readonly codigo: string };

/** El contenido de un aviso. Es lo único que viaja (cifrado) al teléfono. */
export type Aviso = {
  /** "Azul Chat". */
  readonly titulo: string;
  /** "Casiano: Transferencia #404 recibida con diferencias" o "Casiano: 3 novedades". */
  readonly cuerpo: string;
  /** Qué abrir al tocarlo: `/?vista=local&localId=N`; desde la Tanda 12, `/` para un aviso del sistema (interno/vigia.ts). */
  readonly url: string;
  /** Un aviso nuevo del mismo local (o del sistema) reemplaza al anterior en la bandeja. */
  readonly etiqueta: string;
};

export type DependenciasEnvio = {
  readonly config: ConfigPush;
  /** El `fetch` hacia los servicios de push. En los tests, uno de mentira. */
  readonly transporte?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
};

export async function enviarAviso(deps: DependenciasEnvio, destino: SuscripcionDestino, aviso: Aviso): Promise<ResultadoEnvio> {
  if (!endpointPermitido(destino.endpoint)) return { tipo: "FALLO", codigo: "ENDPOINT_NO_PERMITIDO" };
  const hacerFetch = deps.transporte ?? globalThis.fetch;
  const armado = deps.config.armar(destino, JSON.stringify(aviso), { ttlSegundos: TTL_AVISO_SEGUNDOS });
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), deps.timeoutMs ?? TIMEOUT_MS_PUSH);
  try {
    const res = await hacerFetch(armado.endpoint, {
      method: "POST",
      headers: armado.headers,
      body: new Uint8Array(armado.cuerpo),
      signal: controlador.signal,
      redirect: "error",
      cache: "no-store",
    });
    // El cuerpo de la respuesta no interesa: se descarta sin leerlo entero.
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 410) return { tipo: "VENCIDA" };
    if (res.status >= 200 && res.status < 300) return { tipo: "ENVIADO" };
    return { tipo: "FALLO", codigo: `HTTP_${res.status}` };
  } catch {
    return { tipo: "FALLO", codigo: controlador.signal.aborted ? "TIEMPO_AGOTADO" : "INALCANZABLE" };
  } finally {
    clearTimeout(temporizador);
  }
}
