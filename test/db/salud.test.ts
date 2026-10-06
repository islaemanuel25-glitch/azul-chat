// CANDADO: /api/salud es un healthcheck real. 200 solo con configuración
// válida, base que contesta y esquema migrado; no llama al ERP, no escribe y no
// dice por qué falló.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { comprobarSalud } from "../../src/server/salud.ts";
import { crearBaseDescartable, crearBaseVacia, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { SECRETO_PRUEBA } from "../ayuda/servidorErp.ts";

const ENTORNO = Object.freeze({
  AZUL_CHAT_INSTALACION_ID: "instalacion-prueba",
  AZUL_CHAT_ORIGEN_PUBLICO: "https://chat.ejemplo.invalid",
  AZUL_CHAT_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  // Un ERP que no existe: si la salud lo llamara, tardaría o fallaría.
  ERP_BASE_URL: "https://erp.ejemplo.invalid",
  AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA,
});

let base: BaseDescartable;
let vacia: Awaited<ReturnType<typeof crearBaseVacia>>;
let dbVacia: PrismaClient;

before(async () => {
  base = await crearBaseDescartable();
  vacia = await crearBaseVacia();
  dbVacia = new PrismaClient({ datasourceUrl: vacia.url });
});
after(async () => {
  await dbVacia?.$disconnect();
  await vacia?.borrar();
  await base?.borrar();
});

describe("/api/salud", () => {
  it("200 con configuración válida y base migrada, sin llamar al ERP", async () => {
    const llamadas: unknown[] = [];
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (...a: unknown[]) => {
      llamadas.push(a);
      throw new Error("la salud no llama a nadie");
    }) as typeof fetch;
    try {
      assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: base.db }), { ok: true, servicio: "azul-chat" });
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    assert.equal(llamadas.length, 0);
  });

  it("no escribe nada: ni la instalación", async () => {
    await comprobarSalud({ entorno: ENTORNO, db: base.db });
    const [fila] = await base.db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT ((SELECT count(*) FROM "Instalacion") + (SELECT count(*) FROM "Vinculo") + (SELECT count(*) FROM "Sesion"))::int AS n`,
    );
    assert.equal(fila?.n, 0);
  });

  it("base vacía sin migrar: esquema", async () => {
    assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: dbVacia }), { ok: false, servicio: "azul-chat", fallas: ["esquema"] });
  });

  it("sin base o con una que no contesta a tiempo: base", async () => {
    assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: null }), { ok: false, servicio: "azul-chat", fallas: ["base"] });
    const colgada = { $queryRaw: () => new Promise(() => {}) } as unknown as PrismaClient;
    const t0 = Date.now();
    assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: colgada, timeoutMs: 100 }), { ok: false, servicio: "azul-chat", fallas: ["base"] });
    assert.ok(Date.now() - t0 < 1000);
    const rota = { $queryRaw: () => Promise.reject(new Error("password authentication failed for user x")) } as unknown as PrismaClient;
    const r = await comprobarSalud({ entorno: ENTORNO, db: rota });
    assert.deepEqual(r, { ok: false, servicio: "azul-chat", fallas: ["base"] });
  });

  it("configuración incompleta o inválida: configuracion, sin decir cuál variable", async () => {
    for (const roto of [
      { ...ENTORNO, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: undefined },
      { ...ENTORNO, AZUL_CHAT_INTEGRACION_SECRET: undefined },
      { ...ENTORNO, ERP_BASE_URL: "http://operix.cloud" },
      { ...ENTORNO, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: ENTORNO.AZUL_CHAT_INTEGRACION_SECRET },
    ]) {
      const r = await comprobarSalud({ entorno: roto, db: base.db });
      assert.deepEqual(r, { ok: false, servicio: "azul-chat", fallas: ["configuracion"] });
      assert.equal(/AZUL|ERP_|KEY|SECRET|http/.test(JSON.stringify(r)), false);
    }
  });
});
