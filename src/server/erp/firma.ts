// src/server/erp/firma.ts
//
// LA FIRMA HMAC QUE EXIGE EL ERP. Copia exacta del contrato del otro lado
// (erpmanual: lib/integraciones/azul-chat/autenticacionAplicacion.js):
//
//   firma = hex(HMAC_SHA256(secreto, "v1\n" + aplicacion + "\n" + marca + "\n" + cuerpo))
//
// sobre los BYTES UTF-8 de ese texto. `marca` es el Unix timestamp en
// SEGUNDOS, como string decimal. El ERP acepta ±300 s de diferencia de reloj.
//
// El `cuerpo` que se firma tiene que ser el MISMO string que se manda: el ERP
// verifica sobre los bytes que llegan por la red, y además exige que sean JSON
// canónico (`JSON.stringify(JSON.parse(texto)) === texto`). Por eso el cliente
// serializa una sola vez y pasa esa misma variable a la firma y al `fetch`.

import "server-only";

import { createHmac } from "node:crypto";

export const APLICACION = "azul-chat";
export const VERSION_FIRMA = "v1";

export const CABECERAS = Object.freeze({
  aplicacion: "x-erp-integracion-aplicacion",
  marca: "x-erp-integracion-marca",
  firma: "x-erp-integracion-firma",
});

/** Unix timestamp en segundos, como lo espera la cabecera de marca. */
export function marcaDeTiempo(ahoraMs: number): string {
  return String(Math.floor(ahoraMs / 1000));
}

/** Los bytes exactos que entran al HMAC. Exportado para que el candado los compare. */
export function mensajeAFirmar(aplicacion: string, marca: string, cuerpo: string): Buffer {
  return Buffer.from(`${VERSION_FIRMA}\n${aplicacion}\n${marca}\n${cuerpo}`, "utf8");
}

/** HMAC-SHA256 en hexadecimal minúscula, 64 caracteres. */
export function firmarSolicitud(args: { secreto: string; aplicacion: string; marca: string; cuerpo: string }): string {
  return createHmac("sha256", args.secreto)
    .update(mensajeAFirmar(args.aplicacion, args.marca, args.cuerpo))
    .digest("hex");
}
