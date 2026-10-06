// CANDADO: /api/version dice el commit de la imagen y nada más.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerVersion } from "../../src/server/version.ts";

const SHA = "616d01d3a1cc4a63bebd85baa7afe396267f47f9";

describe("la identidad de build", () => {
  it("devuelve el SHA completo de APP_BUILD_ID", () => {
    assert.deepEqual(leerVersion({ APP_BUILD_ID: SHA }), { servicio: "azul-chat", commit: SHA });
  });

  it("algo que no es un SHA completo no se presenta como identidad", () => {
    for (const malo of [undefined, "", "616d01d", SHA.toUpperCase(), `${SHA}0`, "dev", `${SHA}\n`]) {
      assert.deepEqual(leerVersion(malo === undefined ? {} : { APP_BUILD_ID: malo }), { servicio: "azul-chat", commit: null }, String(malo));
    }
  });

  it("no expone nada del entorno además del commit", () => {
    const v = leerVersion({
      APP_BUILD_ID: SHA,
      AZUL_CHAT_INTEGRACION_SECRET: "secreto-que-no-tiene-que-salir-0123456789",
      DATABASE_URL: "postgresql://u:clave@h/b",
      NODE_ENV: "production",
    });
    assert.deepEqual(Object.keys(v).sort(), ["commit", "servicio"]);
    assert.equal(/secreto|clave|postgresql|production/.test(JSON.stringify(v)), false);
  });
});
