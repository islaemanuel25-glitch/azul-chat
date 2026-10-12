// CANDADOS DEL HORARIO DE SILENCIO (Tanda 11): qué horas calla, en hora de
// Argentina, con y sin cruzar la medianoche, y la forma exacta de lo que se guarda.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enSilencio, horaEnArgentina } from "../../src/server/push/silencio.ts";
import { esHorarioSilencio } from "../../src/shared/sesion/configuracion.ts";

/** El instante de esa hora de Argentina (UTC−3, sin horario de verano) del 8/10/2026. */
const aLas = (hora: number) => new Date(Date.UTC(2026, 9, 8, hora + 3, 30));
const callaA = (h: { activo: boolean; desde: number; hasta: number }) => Array.from({ length: 24 }, (_, hora) => hora).filter((hora) => enSilencio(h, aLas(hora)));

describe("el horario de silencio", () => {
  it("la hora es la de Argentina: 12:30 UTC son las 09:30; 02:30 UTC del 9, las 23:30 del 8", () => {
    assert.equal(horaEnArgentina(new Date("2026-10-08T12:30:00.000Z")), 9);
    assert.equal(horaEnArgentina(new Date("2026-10-09T02:30:00.000Z")), 23);
    assert.equal(horaEnArgentina(new Date("2026-10-09T03:00:00.000Z")), 0);
  });

  it("dentro del día: de 8 a 10 calla las 8 y las 9, no las 10", () => {
    assert.deepEqual(callaA({ activo: true, desde: 8, hasta: 10 }), [8, 9]);
  });

  it("cruzando la medianoche: de 0 a 7 y de 22 a 7", () => {
    assert.deepEqual(callaA({ activo: true, desde: 0, hasta: 7 }), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(callaA({ activo: true, desde: 22, hasta: 7 }), [0, 1, 2, 3, 4, 5, 6, 22, 23]);
    assert.deepEqual(callaA({ activo: true, desde: 23, hasta: 0 }), [23]);
  });

  it("apagado no calla nunca, sea cual sea el horario guardado (CONTRAPRUEBA)", () => {
    assert.deepEqual(callaA({ activo: false, desde: 0, hasta: 7 }), []);
    assert.deepEqual(callaA({ activo: false, desde: 22, hasta: 7 }), []);
  });

  it("lo que se guarda: exactamente { activo, desde, hasta }, horas enteras de 0 a 23 y distintas", () => {
    assert.ok(esHorarioSilencio({ activo: true, desde: 22, hasta: 7 }));
    assert.ok(esHorarioSilencio({ activo: false, desde: 0, hasta: 23 }));
    for (const malo of [
      null,
      [],
      { activo: true, desde: 7, hasta: 7 },
      { activo: true, desde: 24, hasta: 7 },
      { activo: true, desde: 1.5, hasta: 7 },
      { activo: 1, desde: 1, hasta: 7 },
      { activo: true, desde: "1", hasta: 7 },
      { activo: true, desde: 1 },
      { activo: true, desde: 1, hasta: 7, extra: true },
    ]) {
      assert.equal(esHorarioSilencio(malo), false, JSON.stringify(malo));
    }
  });
});
