// CANDADOS DEL VIGÍA (Tanda 12), sin base: cuándo una corrida es falla,
// cuándo hay incidente, a quién se avisa y cómo se dice la hora.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resultadoDeCorrida } from "../../src/server/interno/salud.ts";
import { AVISO_RECUPERACION, avisoDeApertura, desdeCuando, evaluar, leerDestinatarios } from "../../src/server/interno/vigia.ts";

const MIN = 60_000;
const T0 = new Date("2026-10-12T15:00:00.000Z"); // 12:00 en Argentina
const mas = (min: number) => new Date(T0.getTime() + min * MIN);
const salud = (s: Partial<Parameters<typeof evaluar>[0]> = {}) => ({
  ultimoExitoEn: null,
  ultimaFallaEn: null,
  ultimaFallaMotivo: null,
  fallasSeguidas: 0,
  vigiaDesdeEn: null,
  incidenteDesde: null,
  incidenteMotivo: null,
  avisadosApertura: [],
  pendientesRecuperacion: [],
  ...s,
});

describe("Tanda 12: cuándo una corrida de sincronizar es una falla", () => {
  it("el cupo cortado es falla; todas las intentadas fallidas es falla; alguna que anduvo, o nadie a quien sincronizar, es éxito", () => {
    assert.deepEqual(resultadoDeCorrida({ personas: 3, revocadas: 0, conFalla: 0, cortadaPorCupo: true }), { ok: false, motivo: "ERP_CUPO_EXCEDIDO" });
    assert.deepEqual(resultadoDeCorrida({ personas: 3, revocadas: 1, conFalla: 2, cortadaPorCupo: false }), { ok: false, motivo: "ERP_NO_DISPONIBLE" });
    assert.deepEqual(resultadoDeCorrida({ personas: 3, revocadas: 0, conFalla: 2, cortadaPorCupo: false }), { ok: true });
    assert.deepEqual(resultadoDeCorrida({ personas: 0, revocadas: 0, conFalla: 0, cortadaPorCupo: false }), { ok: true });
    assert.deepEqual(resultadoDeCorrida({ personas: 2, revocadas: 2, conFalla: 0, cortadaPorCupo: false }), { ok: true });
  });
});

describe("Tanda 12: cuándo hay incidente", () => {
  it("sin ninguna corrida y sin que el vigía haya mirado: no hay incidente", () => {
    assert.deepEqual(evaluar(salud(), mas(60)), { hay: false });
  });

  it("por tiempo: 10 minutos justos no; más de 10, sí, desde el último éxito", () => {
    assert.deepEqual(evaluar(salud({ ultimoExitoEn: T0 }), mas(10)), { hay: false });
    assert.deepEqual(evaluar(salud({ ultimoExitoEn: T0 }), mas(11)), { hay: true, desde: T0, motivo: "SIN_CORRIDAS" });
  });

  it("por fallas: 2 seguidas no; 3 sí, aunque el éxito sea reciente; el motivo es el de la falla", () => {
    const base = { ultimoExitoEn: T0, ultimaFallaEn: mas(4), ultimaFallaMotivo: "ERP_NO_DISPONIBLE" };
    assert.deepEqual(evaluar(salud({ ...base, fallasSeguidas: 2 }), mas(5)), { hay: false });
    assert.deepEqual(evaluar(salud({ ...base, fallasSeguidas: 3 }), mas(5)), { hay: true, desde: T0, motivo: "ERP_NO_DISPONIBLE" });
  });

  it("base sin corridas: cuenta desde que el vigía la vio por primera vez", () => {
    assert.deepEqual(evaluar(salud({ vigiaDesdeEn: T0 }), mas(10)), { hay: false });
    assert.deepEqual(evaluar(salud({ vigiaDesdeEn: T0 }), mas(11)), { hay: true, desde: T0, motivo: "SIN_CORRIDAS" });
  });

  it("una falla vieja, anterior al último éxito, no es el motivo: el timer dejó de correr", () => {
    const s = salud({ ultimoExitoEn: T0, ultimaFallaEn: mas(-30), ultimaFallaMotivo: "BASE" });
    assert.deepEqual(evaluar(s, mas(20)), { hay: true, desde: T0, motivo: "SIN_CORRIDAS" });
  });
});

describe("Tanda 12: a quién se avisa", () => {
  const leer = (v: string | undefined) => leerDestinatarios({ AZUL_CHAT_AVISOS_SISTEMA: v });
  it("ids del ERP separados por coma, con espacios, sin repetir", () => {
    assert.deepEqual(leer("9"), { tipo: "OK", ids: [9] });
    assert.deepEqual(leer(" 9, 11 ,9"), { tipo: "OK", ids: [9, 11] });
  });
  it("vacía o ausente: nadie; cualquier otra cosa: inválida, no se adivina", () => {
    assert.deepEqual(leer(undefined), { tipo: "VACIA" });
    assert.deepEqual(leer("  "), { tipo: "VACIA" });
    for (const mal of ["0", "-3", "9,", "9;11", "dueño", "9, x", "1.5", "99999999999"]) assert.deepEqual(leer(mal), { tipo: "INVALIDA" }, mal);
  });
});

describe("Tanda 12: qué dicen los avisos", () => {
  it("la hora es la de Argentina; si no fue hoy, dice el día", () => {
    assert.equal(desdeCuando(T0, mas(30)), "desde las 12:00");
    assert.equal(desdeCuando(new Date("2026-10-12T02:40:00.000Z"), mas(30)), "desde el 11/10 a las 23:40");
  });
  it("apertura con hora y motivo en palabras simples; recuperación fija; los dos abren la pantalla principal", () => {
    const a = avisoDeApertura(T0, "ERP_CUPO_EXCEDIDO", mas(15));
    assert.equal(a.cuerpo, "Azul Chat no se está actualizando desde las 12:00. El ERP rechaza por demasiadas consultas seguidas.");
    assert.equal(a.url, "/");
    assert.equal(AVISO_RECUPERACION.cuerpo, "Azul Chat volvió a actualizarse.");
    assert.equal(AVISO_RECUPERACION.url, "/");
    assert.equal(a.etiqueta, AVISO_RECUPERACION.etiqueta);
  });
});
