// src/server/erp/cliente.ts
//
// EL CLIENTE DE AZUL CHAT HACIA EL ERP. Server-side, y NO genérico.
//
// Conoce UNA ruta —`POST /api/integraciones/azul-chat/consultar`— y UNA
// capacidad —`ventas_resumen`—. No recibe URLs, rutas, métodos ni cabeceras de
// quien lo usa: no hay forma de pedirle que llame otra cosa. Una capacidad
// nueva es un método nuevo acá, con su propio constructor de cuerpo.
//
// ── EL CAMINO DE UNA CONSULTA ──────────────────────────────────────────────
//
//   1. configuración: sin secreto válido, no se llama (FAIL CLOSED);
//   2. cuerpo: se valida la entrada y se serializa UNA vez con JSON.stringify;
//   3. firma: sobre ese mismo string, con la marca en segundos;
//   4. fetch: ese mismo string como body, sin seguir redirecciones;
//   5. timeout: un AbortController corta la llamada Y la lectura del cuerpo;
//   6. respuesta: se valida la forma y se traduce conservando el código público.
//
// ── SIN REINTENTOS ─────────────────────────────────────────────────────────
//
// Una consulta que falla devuelve el fallo y termina. No hay retry, ni
// inmediato ni diferido: si "ventas de hoy" falló, volver a pedirla minutos
// después contestaría otra pregunta que nadie hizo. Reintentar lo decide la
// persona. El ERP además limita por usuario: reintentar solo gastaría su cupo.
//
// ── LOGS ───────────────────────────────────────────────────────────────────
//
// Un renglón por consulta, con el tipo cerrado de `../log.ts`. Ni secreto, ni
// firma, ni vínculo, ni cuerpo, ni el texto de la respuesta.

import "server-only";

import { randomUUID } from "node:crypto";

import {
  esCodigoErrorErp,
  esDatosVentasResumen,
  type CodigoErrorLocal,
  type DatosVentasResumen,
  type FalloErp,
  type FalloLocal,
  type ResultadoConsulta,
} from "../../shared/erp/contrato.ts";
import { registrarEnConsola, type Registrador } from "../log.ts";
import { leerConfigErp, type Entorno } from "./config.ts";
import { APLICACION, CABECERAS, marcaDeTiempo } from "./firma.ts";
import { CAPACIDAD_VENTAS_RESUMEN, construirCuerpoVentasResumen } from "./ventasResumen.ts";

/** La única ruta del ERP que este cliente sabe llamar. */
export const RUTA_CONSULTAR = "/api/integraciones/azul-chat/consultar";

/** Lo que el ERP acepta como máximo (erpmanual: atender.js, MAX_BYTES_CUERPO). */
export const MAX_BYTES_CUERPO = 4096;

/** Una respuesta de `ventas_resumen` mide unos cientos de bytes. Esto es holgura, no un número del contrato. */
export const MAX_BYTES_RESPUESTA = 64 * 1024;

/** Lo que se espera al ERP antes de abortar, incluyendo leer la respuesta. */
export const TIMEOUT_MS_POR_DEFECTO = 10_000;

export type DependenciasCliente = {
  readonly entorno?: Entorno;
  readonly fetch?: typeof globalThis.fetch;
  /** Milisegundos epoch. Para la marca de tiempo y la duración. */
  readonly ahora?: () => number;
  readonly timeoutMs?: number;
  readonly registrar?: Registrador;
  readonly generarRequestId?: () => string;
};

export type ClienteErp = {
  ventasResumen(entrada: unknown): Promise<ResultadoConsulta<DatosVentasResumen>>;
};

class LecturaExcedida extends Error {}

/** Lee el cuerpo de la respuesta sin pasarse de `max` bytes, en UTF-8 estricto. */
async function leerTextoAcotado(respuesta: Response, max: number): Promise<string> {
  if (!respuesta.body) return "";
  const lector = respuesta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lector.cancel().catch(() => {});
      throw new LecturaExcedida();
    }
    partes.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(partes));
}

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function crearClienteErp(deps: DependenciasCliente = {}): ClienteErp {
  const entorno = deps.entorno ?? process.env;
  const hacerFetch = deps.fetch ?? globalThis.fetch;
  const ahora = deps.ahora ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS_POR_DEFECTO;
  const registrar = deps.registrar ?? registrarEnConsola;
  const generarRequestId = deps.generarRequestId ?? randomUUID;

  async function ventasResumen(entrada: unknown): Promise<ResultadoConsulta<DatosVentasResumen>> {
    const capacidad = CAPACIDAD_VENTAS_RESUMEN;
    const requestId = generarRequestId();
    const inicio = ahora();

    const terminar = <R extends ResultadoConsulta<DatosVentasResumen>>(
      resultado: R,
      status: number | null,
      motivo?: string,
    ): R => {
      registrar({
        evento: "erp.consulta",
        requestId,
        capacidad,
        duracionMs: Math.max(0, ahora() - inicio),
        status,
        codigo: resultado.ok ? "OK" : resultado.codigo,
        ...(motivo === undefined ? {} : { motivo }),
      });
      return resultado;
    };
    const falloLocal = (codigo: CodigoErrorLocal, status: number | null, motivo?: string): FalloLocal =>
      terminar(
        { ok: false, origen: "local", codigo, requestId, ...(status === null ? {} : { status }) },
        status,
        motivo,
      );

    // 1. Configuración. Sin ella no se arma ni se firma nada.
    const leida = leerConfigErp(entorno);
    if (!leida.ok) return falloLocal("INTEGRACION_NO_CONFIGURADA", null, leida.motivo);
    const { origen, firmar } = leida.config;

    // 2. Cuerpo: se serializa UNA vez. Este string es el que se firma y el que viaja.
    const construido = construirCuerpoVentasResumen(entrada);
    if (!construido.ok) return falloLocal(construido.codigo, null);
    const cuerpo = JSON.stringify(construido.cuerpo);
    if (Buffer.byteLength(cuerpo, "utf8") > MAX_BYTES_CUERPO) return falloLocal("SOLICITUD_INVALIDA", null);

    // 3. Firma.
    const marca = marcaDeTiempo(ahora());
    const firma = firmar({ aplicacion: APLICACION, marca, cuerpo });

    // 4 y 5. La llamada, con un solo AbortController para el fetch y la lectura.
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    let status: number;
    let texto: string;
    try {
      const respuesta = await hacerFetch(new URL(RUTA_CONSULTAR, origen), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          [CABECERAS.aplicacion]: APLICACION,
          [CABECERAS.marca]: marca,
          [CABECERAS.firma]: firma,
        },
        body: cuerpo,
        signal: controlador.signal,
        // Una redirección mandaría la firma y el vínculo a otro lugar. El ERP no redirige esta ruta.
        redirect: "error",
        cache: "no-store",
      });
      status = respuesta.status;
      try {
        texto = await leerTextoAcotado(respuesta, MAX_BYTES_RESPUESTA);
      } catch {
        // Excedida, UTF-8 inválido o cortada a mitad: no hay respuesta que leer.
        if (controlador.signal.aborted) return falloLocal("TIEMPO_AGOTADO", status);
        return falloLocal("RESPUESTA_INVALIDA", status);
      }
    } catch {
      if (controlador.signal.aborted) return falloLocal("TIEMPO_AGOTADO", null);
      return falloLocal("ERP_INALCANZABLE", null);
    } finally {
      clearTimeout(temporizador);
    }

    // 6. La respuesta.
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      return falloLocal("RESPUESTA_INVALIDA", status);
    }
    if (!esObjeto(json)) return falloLocal("RESPUESTA_INVALIDA", status);

    if (json.ok === true) {
      if (status !== 200 || !esDatosVentasResumen(json.datos)) return falloLocal("RESPUESTA_INVALIDA", status);
      return terminar({ ok: true, datos: json.datos, requestId }, status);
    }

    if (json.ok === false && esCodigoErrorErp(json.codigo)) {
      const fallo: FalloErp = {
        ok: false,
        origen: "erp",
        codigo: json.codigo,
        status,
        requestId,
        ...(typeof json.referencia === "string" ? { referencia: json.referencia } : {}),
        ...(typeof json.reintentarEnSegundos === "number" && Number.isFinite(json.reintentarEnSegundos)
          ? { reintentarEnSegundos: json.reintentarEnSegundos }
          : {}),
        ...(typeof json.error === "string" ? { mensajeErp: json.error } : {}),
      };
      return terminar(fallo, status);
    }

    // Un código que no está en el contrato (o ninguno): no se inventa uno.
    return falloLocal("RESPUESTA_INVALIDA", status);
  }

  return Object.freeze({ ventasResumen });
}
