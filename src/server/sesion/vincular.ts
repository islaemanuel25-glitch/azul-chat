// src/server/sesion/vincular.ts
//
// POST /api/sesion/vincular — LA PERSONA PEGA EL CÓDIGO QUE COPIÓ DEL ERP Y
// ESTE DISPOSITIVO QUEDA CON UNA SESIÓN PROPIA DE AZUL CHAT.
//
// El navegador manda SOLO `{ "codigo": "vin1_…" }`. Ni usuarioId, ni
// vinculoId, ni local, ni grupo: cualquier otra clave rechaza la solicitud. La
// identidad la dice el ERP al canjear.
//
//   1. Origin exacto (http/origen.ts);
//   2. cupo por IP y del proceso (http/limitador.ts);
//   3. cuerpo cerrado y código con la forma del ERP;
//   4. que Azul Chat esté listo: configuración, clave, base e instalación. Va
//      ANTES del canje a propósito: si algo local no anda, mejor no gastar el
//      código;
//   5. canje en el ERP, firmado (erp/cliente.ts);
//   6. token cifrado, vínculo guardado y sesión creada, en UNA transacción local;
//   7. cookie de sesión.
//
// ── LO QUE NO ES ATÓMICO, Y NO SE FINGE ────────────────────────────────────
//
// El ERP gasta el código en su base en el paso 5, antes de que Azul Chat pueda
// confirmar la suya en el 6. No hay transacción entre las dos bases. Si el 6
// falla, el código ya no sirve y el token se pierde con la petición: se
// contesta VINCULACION_NO_COMPLETADA, se registra sin código ni token, y NO se
// reintenta el canje — no podría funcionar nunca, y reintentar el guardado
// local con un token que se está por descartar no cambia nada. La persona
// genera otro código en el ERP; generarlo revoca el vínculo cuyo token se perdió.
//
// Lo mismo si el canje se corta por TIEMPO: el ERP pudo haberlo gastado. La
// respuesta le dice a la persona que genere otro.
//
// El código existe solo durante esta petición: no se guarda, no se loguea, no
// va en ninguna URL y no se devuelve.

import "server-only";

import type { CodigoErrorSesion, RespuestaVincular } from "../../shared/sesion/api.ts";
import { esCodigoCanje } from "../erp/credenciales.ts";
import { leerObjetoJson } from "../http/cuerpo.ts";
import { ipDeLaSolicitud } from "../http/limitador.ts";
import { origenPermitido } from "../http/origen.ts";
import { json } from "../http/respuestas.ts";
import { cookieDeSesion, leerIdDeCookie } from "./cookie.ts";
import type { DependenciasSesion } from "./dependencias.ts";
import { asegurarInstalacion, guardarVinculoYCrearSesion } from "./repositorio.ts";

/** Un `{"codigo":"vin1_…"}` mide 59 bytes. Esto es holgura, no un número del contrato. */
const MAX_BYTES_CUERPO = 1024;

const MENSAJES: Record<CodigoErrorSesion, string> = {
  SOLICITUD_INVALIDA: "La solicitud no tiene la forma esperada.",
  CODIGO_NO_VALIDO: "El código no es válido o ya no se puede usar. Generá uno nuevo desde el ERP.",
  ORIGEN_NO_PERMITIDO: "Esta solicitud no viene de Azul Chat.",
  LIMITE_EXCEDIDO: "Demasiados intentos. Esperá un momento y volvé a probar.",
  ERP_NO_DISPONIBLE: "El ERP no respondió. Si el código ya se usó, generá uno nuevo desde el ERP.",
  SERVICIO_NO_DISPONIBLE: "Azul Chat no está disponible en este momento.",
  VINCULACION_NO_COMPLETADA: "No se pudo completar la vinculación. El código ya no sirve: generá uno nuevo desde el ERP.",
};

const STATUS: Record<CodigoErrorSesion, number> = {
  SOLICITUD_INVALIDA: 400,
  CODIGO_NO_VALIDO: 400,
  ORIGEN_NO_PERMITIDO: 403,
  LIMITE_EXCEDIDO: 429,
  ERP_NO_DISPONIBLE: 503,
  SERVICIO_NO_DISPONIBLE: 503,
  VINCULACION_NO_COMPLETADA: 500,
};

export function respuestaDeError(codigo: CodigoErrorSesion, extra: Record<string, string> = {}): Response {
  const cuerpo: RespuestaVincular = { ok: false, codigo, mensaje: MENSAJES[codigo] };
  return json(cuerpo, { status: STATUS[codigo], extra });
}

export async function manejarVincular(request: Request, deps: DependenciasSesion): Promise<Response> {
  const requestId = deps.generarRequestId();
  const fallar = (codigo: CodigoErrorSesion, etapa?: "configuracion" | "base" | "persistencia", extra?: Record<string, string>) => {
    deps.registrar({ evento: "sesion.vincular", requestId, resultado: codigo, ...(etapa ? { etapa } : {}) });
    return respuestaDeError(codigo, extra);
  };

  // Sin configuración no hay origen contra el cual comparar: se rechaza todo.
  if (!deps.config.ok) return fallar("SERVICIO_NO_DISPONIBLE", "configuracion");
  const { config } = deps.config;

  // 1. Origen.
  if (!origenPermitido(request.headers, config.origenPublico)) return fallar("ORIGEN_NO_PERMITIDO");

  // 2. Cupo.
  const cupo = deps.limitador.consumir(ipDeLaSolicitud(request.headers), deps.ahora());
  if (!cupo.ok) return fallar("LIMITE_EXCEDIDO", undefined, { "Retry-After": String(cupo.reintentarEnSegundos) });

  // 3. El cuerpo: exactamente { codigo }, con la forma del ERP.
  const datos = await leerObjetoJson(request, MAX_BYTES_CUERPO);
  if (!datos || Object.keys(datos).length !== 1 || !Object.prototype.hasOwnProperty.call(datos, "codigo")) {
    return fallar("SOLICITUD_INVALIDA");
  }
  const { codigo } = datos;
  if (!esCodigoCanje(codigo)) return fallar("CODIGO_NO_VALIDO");

  // 4. Azul Chat listo, ANTES de gastar el código en el ERP.
  if (!deps.db) return fallar("SERVICIO_NO_DISPONIBLE", "configuracion");
  try {
    await asegurarInstalacion(deps.db, config.instalacionId);
  } catch {
    return fallar("SERVICIO_NO_DISPONIBLE", "base");
  }

  // 5. El canje. Una vez: si falla, no se reintenta.
  const canje = await deps.erp.canjear(codigo);
  if (!canje.ok) {
    return fallar(canje.origen === "erp" && canje.codigo === "CODIGO_NO_VALIDO" ? "CODIGO_NO_VALIDO" : "ERP_NO_DISPONIBLE");
  }
  const d = canje.datos;

  // 6. Cifrar y guardar. Desde acá el código ya está gastado en el ERP.
  const ahora = new Date(deps.ahora());
  let sesion: { idSesion: string };
  try {
    const tokenCifrado = config.cifrador.cifrar(d.tokenDelegacion, {
      instalacionId: config.instalacionId,
      erpUsuarioId: d.usuarioId,
      erpVinculoId: d.vinculoId,
    });
    sesion = await guardarVinculoYCrearSesion(
      deps.db,
      {
        instalacionId: config.instalacionId,
        erpUsuarioId: d.usuarioId,
        erpVinculoId: d.vinculoId,
        erpCanjeadoEn: new Date(d.canjeadoEn),
        tokenCifrado,
      },
      { ahora, revocarIdSesionAnterior: leerIdDeCookie(request.headers) },
    );
  } catch {
    // Sin el mensaje del error: puede llevar argumentos de la consulta.
    return fallar("VINCULACION_NO_COMPLETADA", "persistencia");
  }

  // 7. La cookie. El cuerpo no lleva nada más.
  deps.registrar({ evento: "sesion.vincular", requestId, resultado: "OK" });
  const cuerpo: RespuestaVincular = { ok: true };
  return json(cuerpo, { cookie: cookieDeSesion(sesion.idSesion, { produccion: config.produccion }) });
}
