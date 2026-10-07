// CANDADO: el cursor del historial de chats es opaco y estricto, el id de un
// evento viaja como texto, y la lista de chats tiene un orden total.
//
// El cursor es { f: fecha ISO, i: id } en JSON y base64url. No lleva local ni
// instalación —la consulta los filtra siempre desde el servidor—, y uno con
// cualquier otra forma se rechaza entero, no se "arregla".

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerMarcas, ordenDeChats } from "../../src/server/chats/manejadores.ts";
import { codificarCursor, decodificarCursor, leerIdEvento } from "../../src/server/chats/historial.ts";
import type { EventoPublico, LocalDeChats } from "../../src/shared/chats/api.ts";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

describe("cursor del historial", () => {
  it("ida y vuelta exacta, con ids más allá de Number", () => {
    const p = { fecha: new Date("2026-10-07T13:30:15.250Z"), id: 9_223_372_036_854_775_807n };
    const c = codificarCursor(p);
    assert.match(c, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodificarCursor(c), p);
  });

  it("rechaza todo lo que no tenga EXACTAMENTE la forma", () => {
    const malos: unknown[] = [
      undefined,
      "",
      "no es base64url!",
      "x".repeat(201),
      b64([]),
      b64(null),
      b64({ f: "2026-10-07T12:00:00.000Z" }),
      b64({ f: "2026-10-07T12:00:00.000Z", i: "5", l: 3 }),
      b64({ f: "2026-10-07T12:00:00.000Z", i: "5", instalacion: "otra" }),
      b64({ f: "2026-10-07T12:00:00.000Z", i: 5 }),
      b64({ f: "2026-10-07T12:00:00.000Z", i: "0" }),
      b64({ f: "2026-10-07T12:00:00.000Z", i: "05" }),
      b64({ f: "2026-10-07T12:00:00.000Z", i: "-5" }),
      b64({ f: "2026-10-07T12:00:00.000Z", i: "9223372036854775808" }),
      b64({ f: "2026-10-07", i: "5" }),
      b64({ f: "2026-13-07T12:00:00.000Z", i: "5" }),
      b64({ f: 1, i: "5" }),
      Buffer.from("{no es json", "utf8").toString("base64url"),
    ];
    for (const m of malos) assert.equal(decodificarCursor(m), null, String(m));
  });

  it("leerIdEvento: entero positivo en texto que entra en un BIGINT", () => {
    assert.equal(leerIdEvento("1"), 1n);
    assert.equal(leerIdEvento("9223372036854775807"), 9_223_372_036_854_775_807n);
    for (const m of [1, "0", "01", "1.0", "1e3", " 1", "9223372036854775808", null]) assert.equal(leerIdEvento(m), null, String(m));
  });
});

describe("marcas de leído", () => {
  it("acepta la forma exacta y rechaza claves de más, ids numéricos y locales repetidos", () => {
    assert.deepEqual(leerMarcas({ marcas: [{ localId: 3, hastaEventoId: "12" }] }), [{ localId: 3, hasta: 12n }]);
    assert.equal(leerMarcas({ marcas: [{ localId: 3, hastaEventoId: 12 }] }), null);
    assert.equal(leerMarcas({ marcas: [{ localId: 3, hastaEventoId: "12", extra: 1 }] }), null);
    assert.equal(leerMarcas({ marcas: [{ localId: 3, hastaEventoId: "1" }, { localId: 3, hastaEventoId: "2" }] }), null);
    assert.equal(leerMarcas(null), null);
  });
});

describe("orden de la lista de chats", () => {
  const ev = (fecha: string, id: string): EventoPublico => ({
    id,
    tipo: "TRANSFERENCIA_RECIBIDA",
    fecha,
    transferenciaId: 1,
    origen: { id: 9, nombre: "Depósito", esDeposito: true },
    destino: { id: 3, nombre: "Casiano" },
    tieneDiferencias: false,
    lineasConDiferencia: 0,
  });
  const l = (localId: number, nombre: string, ultimoEvento: EventoPublico | null, noLeidos = 0): LocalDeChats => ({
    localId,
    nombre,
    esDeposito: false,
    ultimoEvento,
    noLeidos,
    sincronizacion: "AL_DIA",
  });

  it("por el último evento (fecha, después id), sin eventos al final por nombre y id; los no leídos no cuentan", () => {
    const locales = [
      l(7, "Zeta", null),
      l(4, "Alfa", null),
      l(2, "Alfa", null),
      l(3, "Casiano", ev("2026-10-07T12:00:00.000Z", "10"), 0),
      l(9, "Depósito", ev("2026-10-07T12:00:00.000Z", "11"), 0),
      l(5, "Belgrano", ev("2026-10-06T12:00:00.000Z", "99"), 50),
    ];
    const esperado = [9, 3, 5, 2, 4, 7];
    for (let i = 0; i < 10; i++) {
      const mezcla = [...locales].sort(() => (i % 2 ? 1 : -1));
      assert.deepEqual(mezcla.sort(ordenDeChats).map((x) => x.localId), esperado);
    }
  });
});
