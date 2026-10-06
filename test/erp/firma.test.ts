import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { APLICACION, CABECERAS, firmarSolicitud, marcaDeTiempo, mensajeAFirmar } from "../../src/server/erp/firma.ts";
import { SECRETO_PRUEBA } from "../ayuda/servidorErp.ts";

// Vectores calculados FUERA de este código, con OpenSSL:
//   printf 'v1\nazul-chat\n1767225600\n<cuerpo>' | openssl dgst -sha256 -hmac '<secreto>' -hex
const CUERPO_VECTOR =
  '{"capacidad":"ventas_resumen","delegacion":{"usuarioId":7,"vinculo":"vin1_ejemplo"},"alcance":{"grupoId":1,"localId":3},"parametros":{"periodo":{"tipo":"hoy"}}}';
const FIRMA_VECTOR = "c8182d91e9fbdf03d2a924a3bf0e5f0a0a39b879e451b1b444ca174463cba5e9";
const FIRMA_VECTOR_UTF8 = "511a20d4af0e5ccecf1936975283b79fe444445bc67a349b5e28a4ec756ce734";

describe("firma HMAC", () => {
  it("coincide con un vector calculado por OpenSSL", () => {
    const firma = firmarSolicitud({ secreto: SECRETO_PRUEBA, aplicacion: "azul-chat", marca: "1767225600", cuerpo: CUERPO_VECTOR });
    assert.equal(firma, FIRMA_VECTOR);
  });

  it("firma los bytes UTF-8 del cuerpo, no otra codificación", () => {
    const firma = firmarSolicitud({ secreto: SECRETO_PRUEBA, aplicacion: "azul-chat", marca: "1767225600", cuerpo: '{"x":"ñandú €"}' });
    assert.equal(firma, FIRMA_VECTOR_UTF8);
  });

  it("el mensaje es exactamente v1\\n + aplicacion + \\n + marca + \\n + cuerpo", () => {
    const bytes = mensajeAFirmar("azul-chat", "123", "{}");
    assert.deepEqual(bytes, Buffer.from("v1\nazul-chat\n123\n{}", "utf8"));
  });

  it("es hexadecimal minúscula de 64 caracteres", () => {
    const firma = firmarSolicitud({ secreto: SECRETO_PRUEBA, aplicacion: APLICACION, marca: "1", cuerpo: "{}" });
    assert.match(firma, /^[0-9a-f]{64}$/);
  });

  it("cambia si cambia cualquier parte: secreto, aplicación, marca o cuerpo", () => {
    const base = { secreto: SECRETO_PRUEBA, aplicacion: APLICACION, marca: "100", cuerpo: "{}" };
    const f = firmarSolicitud(base);
    assert.notEqual(firmarSolicitud({ ...base, secreto: `${SECRETO_PRUEBA}x` }), f);
    assert.notEqual(firmarSolicitud({ ...base, aplicacion: "otra" }), f);
    assert.notEqual(firmarSolicitud({ ...base, marca: "101" }), f);
    assert.notEqual(firmarSolicitud({ ...base, cuerpo: "{ }" }), f);
  });

  it("es un HMAC-SHA256 estándar (contraste con node:crypto directo)", () => {
    const esperado = createHmac("sha256", SECRETO_PRUEBA).update("v1\nazul-chat\n5\n{}", "utf8").digest("hex");
    assert.equal(firmarSolicitud({ secreto: SECRETO_PRUEBA, aplicacion: "azul-chat", marca: "5", cuerpo: "{}" }), esperado);
  });
});

describe("aplicación, cabeceras y marca", () => {
  it("la aplicación es exactamente azul-chat", () => {
    assert.equal(APLICACION, "azul-chat");
  });

  it("las cabeceras son las que lee el ERP", () => {
    assert.deepEqual({ ...CABECERAS }, {
      aplicacion: "x-erp-integracion-aplicacion",
      marca: "x-erp-integracion-marca",
      firma: "x-erp-integracion-firma",
    });
  });

  it("la marca es Unix timestamp en SEGUNDOS, truncado", () => {
    assert.equal(marcaDeTiempo(1_767_225_600_999), "1767225600");
    assert.equal(marcaDeTiempo(0), "0");
    assert.match(marcaDeTiempo(Date.now()), /^\d{10}$/);
  });
});
