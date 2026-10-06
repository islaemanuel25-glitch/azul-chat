import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import { LARGO_MINIMO_SECRETO, leerConfigErp } from "../../src/server/erp/config.ts";
import { SECRETO_PRUEBA } from "../ayuda/servidorErp.ts";

const BASE = "https://erp.ejemplo.invalid";

describe("configuración del cliente ERP: fail closed", () => {
  it("sin secreto, apagado", () => {
    assert.deepEqual(leerConfigErp({ ERP_BASE_URL: BASE }), { ok: false, motivo: "SECRETO_AUSENTE" });
    assert.deepEqual(leerConfigErp({ ERP_BASE_URL: BASE, AZUL_CHAT_INTEGRACION_SECRET: "" }), {
      ok: false,
      motivo: "SECRETO_AUSENTE",
    });
  });

  it("con un secreto más corto que el mínimo del ERP (32), apagado", () => {
    assert.equal(LARGO_MINIMO_SECRETO, 32);
    const corto = "x".repeat(31);
    assert.deepEqual(leerConfigErp({ ERP_BASE_URL: BASE, AZUL_CHAT_INTEGRACION_SECRET: corto }), {
      ok: false,
      motivo: "SECRETO_CORTO",
    });
    assert.equal(leerConfigErp({ ERP_BASE_URL: BASE, AZUL_CHAT_INTEGRACION_SECRET: "x".repeat(32) }).ok, true);
  });

  it("NO usa AUTH_SECRET (ni otro secreto) como respaldo", () => {
    const entorno = {
      ERP_BASE_URL: BASE,
      AUTH_SECRET: SECRETO_PRUEBA,
      NEXTAUTH_SECRET: SECRETO_PRUEBA,
      SECRET: SECRETO_PRUEBA,
    };
    assert.deepEqual(leerConfigErp(entorno), { ok: false, motivo: "SECRETO_AUSENTE" });
  });

  it("un secreto igual a AUTH_SECRET se rechaza, como en el ERP", () => {
    const entorno = { ERP_BASE_URL: BASE, AUTH_SECRET: SECRETO_PRUEBA, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA };
    assert.deepEqual(leerConfigErp(entorno), { ok: false, motivo: "SECRETO_COMPARTIDO" });
  });

  it("sin URL base, apagado", () => {
    assert.deepEqual(leerConfigErp({ AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }), {
      ok: false,
      motivo: "BASE_URL_AUSENTE",
    });
  });

  it("la URL base es un origen: sin ruta, query, fragmento ni credenciales", () => {
    for (const malo of [
      "no es url",
      "https://erp.ejemplo.invalid/api",
      "https://erp.ejemplo.invalid/?x=1",
      "https://erp.ejemplo.invalid/#x",
      "https://usuario:clave@erp.ejemplo.invalid",
      "ftp://erp.ejemplo.invalid",
    ]) {
      assert.deepEqual(leerConfigErp({ ERP_BASE_URL: malo, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }), {
        ok: false,
        motivo: "BASE_URL_INVALIDA",
      }, malo);
    }
  });

  it("http solo contra la propia máquina", () => {
    const con = (url: string) => leerConfigErp({ ERP_BASE_URL: url, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }).ok;
    assert.equal(con("http://erp.ejemplo.invalid"), false);
    assert.equal(con("http://10.0.0.5:3000"), false);
    assert.equal(con("http://127.0.0.1:3000"), true);
    assert.equal(con("http://localhost:3000"), true);
    assert.equal(con("https://erp.ejemplo.invalid/"), true);
  });

  it("la configuración válida no expone el secreto en ninguna propiedad", () => {
    const r = leerConfigErp({ ERP_BASE_URL: BASE, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA });
    assert.ok(r.ok);
    assert.equal(JSON.stringify(r).includes(SECRETO_PRUEBA), false);
    assert.equal(inspect(r, { depth: 10, showHidden: true }).includes(SECRETO_PRUEBA), false);
    assert.equal(r.config.origen, BASE);
  });
});
