// src/server/erp/cliente.ts
//
// EL CLIENTE DE AZUL CHAT HACIA EL ERP. Server-side, y NO genérico.
//
// Conoce DOS rutas del ERP, fijas, y CUATRO operaciones:
//
//   · canjear(codigo)                         → POST /api/integraciones/azul-chat/vinculo/canjear
//   · miAlcance(token)                        → POST /api/integraciones/azul-chat/consultar
//   · ventasResumen(token, entrada)           → POST /api/integraciones/azul-chat/consultar
//   · transferenciasEventos(token, entrada)   → POST /api/integraciones/azul-chat/consultar
//
// No recibe URLs, rutas, métodos, cabeceras ni nombres de capacidad de quien lo
// usa: no hay forma de pedirle que llame otra cosa. Una capacidad nueva es un
// método nuevo acá, con su propio constructor de cuerpo.
//
// ── EL CAMINO DE UNA LLAMADA ───────────────────────────────────────────────
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
// Una llamada que falla devuelve el fallo y termina. No hay retry, ni
// inmediato ni diferido: si "ventas de hoy" falló, volver a pedirla minutos
// después contestaría otra pregunta que nadie hizo; y un canje reintentado no
// puede funcionar nunca, porque el ERP gasta el código en el primer intento.
// Reintentar lo decide la persona.
//
// ── LOGS ───────────────────────────────────────────────────────────────────
//
// Un renglón por llamada, con el tipo cerrado de `../log.ts`. Ni secreto, ni
// firma, ni código de canje, ni token, ni cuerpo, ni el texto de la respuesta.

import "server-only";

import { randomUUID } from "node:crypto";

import {
  esCodigoErrorErp,
  esDatosMiAlcance,
  esDatosTransferenciasEventos,
  esDatosVentasResumen,
  type CodigoErrorLocal,
  type DatosMiAlcance,
  type DatosTransferenciasEventos,
  type DatosVentasResumen,
  type FalloErp,
  type FalloLocal,
  type ResultadoConsulta,
} from "../../shared/erp/contrato.ts";
import { registrarEnConsola, type Registrador, type RegistroConsultaErp } from "../log.ts";
import { construirCuerpoCanje, esDatosCanje, type DatosCanje } from "./canje.ts";
import { leerConfigErp, type Entorno } from "./config.ts";
import { APLICACION, CABECERAS, marcaDeTiempo } from "./firma.ts";
import { construirCuerpoMiAlcance } from "./miAlcance.ts";
import { construirCuerpoTransferenciasEventos } from "./transferenciasEventos.ts";
import { construirCuerpoVentasResumen } from "./ventasResumen.ts";

/** Las únicas dos rutas del ERP que este cliente sabe llamar. */
export const RUTA_CONSULTAR = "/api/integraciones/azul-chat/consultar";
export const RUTA_CANJEAR = "/api/integraciones/azul-chat/vinculo/canjear";

/** Lo que el ERP acepta como máximo (erpmanual: atender.js, MAX_BYTES_CUERPO). */
export const MAX_BYTES_CUERPO = 4096;

/** Una respuesta de estas operaciones mide a lo sumo unos KB. Esto es holgura, no un número del contrato. */
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
  /** Cambia el código humano por un token. Una sola vez: el ERP gasta el código. */
  canjear(codigo: unknown): Promise<ResultadoConsulta<DatosCanje>>;
  /** Quién es la persona del token y qué locales puede consultar HOY. */
  miAlcance(token: string): Promise<ResultadoConsulta<DatosMiAlcance>>;
  /** Cuánto se vendió en un local y un período. `entrada` = `{ alcance, periodo }`. */
  ventasResumen(token: string, entrada: unknown): Promise<ResultadoConsulta<DatosVentasResumen>>;
  /**
   * Una página de las transferencias que RECIBIÓ un local, como eventos.
   * `entrada` = `{ alcance, desde?, limite? }`, con `desde` tal como lo devolvió el ERP.
   */
  transferenciasEventos(token: string, entrada: unknown): Promise<ResultadoConsulta<DatosTransferenciasEventos>>;
};

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
      throw new Error("respuesta demasiado grande");
    }
    partes.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(partes));
}

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

type Operacion = RegistroConsultaErp["operacion"];

/** El cuerpo ya validado, o el código local con el que se rechaza sin llamar. */
type CuerpoArmado = { ok: true; cuerpo: object } | { ok: false; codigo: CodigoErrorLocal };

export function crearClienteErp(deps: DependenciasCliente = {}): ClienteErp {
  const entorno = deps.entorno ?? process.env;
  const hacerFetch = deps.fetch ?? globalThis.fetch;
  const ahora = deps.ahora ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS_POR_DEFECTO;
  const registrar = deps.registrar ?? registrarEnConsola;
  const generarRequestId = deps.generarRequestId ?? randomUUID;

  /**
   * Una llamada firmada a UNA de las dos rutas fijas. Privada: no se exporta y
   * nadie de afuera elige `ruta`.
   */
  async function llamar<T>(
    operacion: Operacion,
    ruta: typeof RUTA_CONSULTAR | typeof RUTA_CANJEAR,
    armar: () => CuerpoArmado,
    esDatos: (v: unknown) => v is T,
  ): Promise<ResultadoConsulta<T>> {
    const requestId = generarRequestId();
    const inicio = ahora();

    const terminar = <R extends ResultadoConsulta<T>>(resultado: R, status: number | null, motivo?: string): R => {
      registrar({
        evento: "erp.consulta",
        requestId,
        operacion,
        duracionMs: Math.max(0, ahora() - inicio),
        status,
        codigo: resultado.ok ? "OK" : resultado.codigo,
        ...(motivo === undefined ? {} : { motivo }),
      });
      return resultado;
    };
    const falloLocal = (codigo: CodigoErrorLocal, status: number | null, motivo?: string): FalloLocal =>
      terminar({ ok: false, origen: "local", codigo, requestId, ...(status === null ? {} : { status }) }, status, motivo);

    // 1. Configuración. Sin ella no se arma ni se firma nada.
    const leida = leerConfigErp(entorno);
    if (!leida.ok) return falloLocal("INTEGRACION_NO_CONFIGURADA", null, leida.motivo);
    const { origen, firmar } = leida.config;

    // 2. Cuerpo: se serializa UNA vez. Este string es el que se firma y el que viaja.
    const armado = armar();
    if (!armado.ok) return falloLocal(armado.codigo, null);
    const cuerpo = JSON.stringify(armado.cuerpo);
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
      const respuesta = await hacerFetch(new URL(ruta, origen), {
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
        // Una redirección mandaría la firma, el código o el token a otro lugar. El ERP no redirige estas rutas.
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
      if (status !== 200 || !esDatos(json.datos)) return falloLocal("RESPUESTA_INVALIDA", status);
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

  return Object.freeze({
    canjear: (codigo: unknown) =>
      llamar("canjear", RUTA_CANJEAR, (): CuerpoArmado => {
        const cuerpo = construirCuerpoCanje(codigo);
        return cuerpo ? { ok: true, cuerpo } : { ok: false, codigo: "SOLICITUD_INVALIDA" };
      }, esDatosCanje),

    miAlcance: (token: string) =>
      llamar("mi_alcance", RUTA_CONSULTAR, (): CuerpoArmado => {
        const cuerpo = construirCuerpoMiAlcance(token);
        return cuerpo ? { ok: true, cuerpo } : { ok: false, codigo: "SOLICITUD_INVALIDA" };
      }, esDatosMiAlcance),

    ventasResumen: (token: string, entrada: unknown) =>
      llamar("ventas_resumen", RUTA_CONSULTAR, (): CuerpoArmado => {
        const construido = construirCuerpoVentasResumen(token, entrada);
        return construido.ok ? { ok: true, cuerpo: construido.cuerpo } : { ok: false, codigo: construido.codigo };
      }, esDatosVentasResumen),

    transferenciasEventos: (token: string, entrada: unknown) =>
      llamar("transferencias_eventos", RUTA_CONSULTAR, (): CuerpoArmado => {
        const cuerpo = construirCuerpoTransferenciasEventos(token, entrada);
        return cuerpo ? { ok: true, cuerpo } : { ok: false, codigo: "SOLICITUD_INVALIDA" };
      }, esDatosTransferenciasEventos),
  });
}
