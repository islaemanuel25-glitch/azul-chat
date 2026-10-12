// CANDADO: /api/salud es un healthcheck real. 200 solo con configuración
// válida, base que contesta y esquema migrado HASTA LA ÚLTIMA MIGRACIÓN DE LA
// IMAGEN (Tanda 16); no llama al ERP, no escribe y no dice por qué falló.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import type { Registro } from "../../src/server/log.ts";
import { comprobarSalud, ultimaMigracionDeLaImagen, ultimaMigracionEn } from "../../src/server/salud.ts";
import {
  crearBaseDescartable,
  crearBaseMigradaCon,
  crearBaseVacia,
  MIGRACION_ROTA as ROTA,
  MIGRACIONES_DEL_REPO,
  type BaseDescartable,
} from "../ayuda/baseDescartable.ts";
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

// ── Tanda 16: la base al día con la imagen ───────────────────────────────────

const RAIZ = path.resolve(import.meta.dirname, "../..");
const ULTIMA = MIGRACIONES_DEL_REPO.at(-1)!;
const MIGRACIONES = MIGRACIONES_DEL_REPO;

describe("Tanda 16: /api/salud compara la última migración de la imagen", () => {
  it("la imagen sabe cuál es su última migración: la última carpeta de prisma/migrations, leída una vez", () => {
    assert.equal(ultimaMigracionDeLaImagen(), ULTIMA);
    assert.equal(ultimaMigracionEn(path.join(RAIZ, "no-existe")), null);
    // Una vez por proceso: aunque cambie el directorio de trabajo, no vuelve a leer el disco.
    const antes = process.cwd();
    process.chdir(tmpdir());
    try {
      assert.equal(ultimaMigracionDeLaImagen(), ULTIMA);
    } finally {
      process.chdir(antes);
    }
  });

  it("al día: 200", async () => {
    const registros: Registro[] = [];
    const r = await comprobarSalud({ entorno: ENTORNO, db: base.db, esperada: ULTIMA, registrar: (x) => registros.push(x) });
    assert.deepEqual(r, { ok: true, servicio: "azul-chat" });
    assert.deepEqual(registros, []);
  });

  it("la base de la imagen anterior (le falta la última): 503 migraciones_pendientes, el detalle solo en el log", async () => {
    const vieja = await crearBaseMigradaCon(MIGRACIONES.slice(0, -1));
    try {
      const registros: Registro[] = [];
      const r = await comprobarSalud({ entorno: ENTORNO, db: vieja.db, esperada: ULTIMA, registrar: (x) => registros.push(x) });
      assert.deepEqual(r, { ok: false, servicio: "azul-chat", fallas: ["migraciones_pendientes"] });
      assert.deepEqual(registros, [{ evento: "salud.migraciones_pendientes", esperada: ULTIMA, ultimaAplicada: MIGRACIONES.at(-2), aMedias: 0 }]);
      // La respuesta pública no nombra ninguna migración.
      const publica = JSON.stringify(r);
      for (const n of [...MIGRACIONES, ROTA]) assert.equal(publica.includes(n), false, n);
      assert.equal(/\d{14}|_prisma|migration_name/.test(publica), false);
      // CONTRAPRUEBA: la misma base, con la imagen anterior (la que la migró), está al día.
      assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: vieja.db, esperada: MIGRACIONES.at(-2)!, registrar: () => {} }), { ok: true, servicio: "azul-chat" });
    } finally {
      await vieja.borrar();
    }
  });

  it("una migración a medias (empezó y falló): 503, aunque la última de la imagen esté aplicada", async () => {
    const cortada = await crearBaseMigradaCon(MIGRACIONES, true);
    try {
      const [fila] = await cortada.db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
      assert.equal(fila?.n, 1, "Prisma dejó la rota empezada y sin terminar");
      for (const esperada of [ULTIMA, ROTA]) {
        const registros: Registro[] = [];
        const r = await comprobarSalud({ entorno: ENTORNO, db: cortada.db, esperada, registrar: (x) => registros.push(x) });
        assert.deepEqual(r, { ok: false, servicio: "azul-chat", fallas: ["migraciones_pendientes"] }, esperada);
        assert.equal(JSON.stringify(r).includes(ROTA), false);
        assert.deepEqual(registros, [{ evento: "salud.migraciones_pendientes", esperada, ultimaAplicada: ULTIMA, aMedias: 1 }]);
      }
    } finally {
      await cortada.borrar();
    }
  });

  it("una base MÁS NUEVA que la imagen (volver a la imagen anterior sin revertir la base) no es falla", async () => {
    assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: base.db, esperada: MIGRACIONES.at(-2)! }), { ok: true, servicio: "azul-chat" });
  });

  it("sin la tabla de control de Prisma (una base armada sin migrate deploy): esquema, no base", async () => {
    const sinControl = await crearBaseMigradaCon(MIGRACIONES);
    try {
      await sinControl.db.$executeRawUnsafe(`DROP TABLE "_prisma_migrations"`);
      assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: sinControl.db, esperada: ULTIMA, registrar: () => {} }), { ok: false, servicio: "azul-chat", fallas: ["esquema"] });
    } finally {
      await sinControl.borrar();
    }
  });

  it("si la imagen no sabe cuál es su última migración: 503 (fallo cerrado)", async () => {
    const registros: Registro[] = [];
    assert.deepEqual(await comprobarSalud({ entorno: ENTORNO, db: base.db, esperada: null, registrar: (x) => registros.push(x) }), { ok: false, servicio: "azul-chat", fallas: ["migraciones_pendientes"] });
    assert.equal(registros.length, 1);
  });
});
