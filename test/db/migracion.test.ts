// CANDADO: la migración propia aplica desde una base VACÍA, coincide con
// schema.prisma, y la base misma impide lo que no puede pasar — aunque lo
// intente un código con un error o un script a mano.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { crearBaseDescartable, crearBaseVacia, type BaseDescartable } from "../ayuda/baseDescartable.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const CIFRADO_DE_FORMA = `v1.${"A".repeat(16)}.${"B".repeat(40)}.${"C".repeat(22)}`;
const HASH = "a".repeat(64);

let base: BaseDescartable;

before(async () => {
  // crearBaseDescartable crea la base vacía y aplica `prisma migrate deploy`: si no aplica, falla acá.
  base = await crearBaseDescartable();
});
after(async () => {
  await base?.borrar();
});

const sql = (q: string) => base.db.$executeRawUnsafe(q);
/** SQLSTATE de PostgreSQL: se decide por el código, no por el texto del mensaje. */
const UNICO = "23505";
const CHECK = "23514";
const CLAVE_AJENA = "23503";
async function rechaza(q: string, ...codigos: string[]) {
  await assert.rejects(sql(q), (e: Error) => codigos.some((c) => e.message.includes(`Code: \`${c}\``)), q);
}

describe("la migración", () => {
  it("38. aplica desde una base vacía y deja las tablas de identidad y sesión, y desde la Tanda 2 las de eventos", async () => {
    const tablas = await base.db.$queryRawUnsafe<{ t: string }[]>(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    );
    assert.deepEqual(tablas.map((x) => x.t), ["CursorIngesta", "Evento", "Instalacion", "LecturaLocal", "Sesion", "Vinculo", "_prisma_migrations"]);
    const aplicadas = await base.db.$queryRawUnsafe<{ n: string }[]>(`SELECT migration_name AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
    const enElRepo = readdirSync(path.join(RAIZ, "prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.deepEqual(aplicadas.map((x) => x.n).sort(), enElRepo.sort());
  });

  it("39. ninguna columna guarda autoridad ni secretos en claro: ni rol, permisos, locales, grupo, código, contraseña ni token claro", async () => {
    const columnas = await base.db.$queryRawUnsafe<{ c: string }[]>(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`,
    );
    // La lista es exhaustiva a propósito: una columna nueva se agrega acá a
    // sabiendas. Las de la Tanda 2 tampoco son autoridad: `erpLocalId` es DÓNDE
    // ocurrió un hecho o QUÉ local se pagina, nunca un permiso para verlo;
    // `capacidad` nombra lo que se pagina, no algo que la persona pueda;
    // `ultimoErrorCodigo` es un código cerrado, nunca un mensaje; y no hay
    // ningún token, sesión, rol, permiso, alcance ni lista de capacidades.
    assert.deepEqual(columnas.map((x) => x.c), [
      "CursorIngesta.arrendadoHasta",
      "CursorIngesta.arrendadoPor",
      "CursorIngesta.backfillCompletoEn",
      "CursorIngesta.capacidad",
      "CursorIngesta.cursor",
      "CursorIngesta.erpLocalId",
      "CursorIngesta.id",
      "CursorIngesta.instalacionId",
      "CursorIngesta.ultimaDiferenciaContenidoClave",
      "CursorIngesta.ultimaDiferenciaContenidoEn",
      "CursorIngesta.ultimaSincronizacionEn",
      "CursorIngesta.ultimoErrorCodigo",
      "CursorIngesta.ultimoErrorEn",
      "Evento.claveExterna",
      "Evento.erpLocalId",
      "Evento.erpReferenciaId",
      "Evento.fechaOperacion",
      "Evento.historico",
      "Evento.id",
      "Evento.ingeridoEn",
      "Evento.instalacionId",
      "Evento.payload",
      "Evento.payloadVersion",
      "Evento.tipo",
      "Instalacion.creadaEn",
      "Instalacion.id",
      "Instalacion.unica",
      "LecturaLocal.actualizadoEn",
      "LecturaLocal.erpLocalId",
      "LecturaLocal.leidoHastaEventoId",
      "LecturaLocal.vinculoId",
      "Sesion.creadaEn",
      "Sesion.expiraEn",
      "Sesion.id",
      "Sesion.idHash",
      "Sesion.revocadaEn",
      "Sesion.vinculoId",
      "Vinculo.erpCanjeadoEn",
      "Vinculo.erpUsuarioId",
      "Vinculo.erpVinculoId",
      "Vinculo.id",
      "Vinculo.instalacionId",
      "Vinculo.invalidadoEn",
      "Vinculo.motivoInvalidacion",
      "Vinculo.tokenCifrado",
      "Vinculo.vinculadoEn",
    ]);
  });

  it("la migración coincide con schema.prisma (sin deriva)", async () => {
    const sombra = await crearBaseVacia("azulchat_sombra");
    try {
      // --exit-code: 0 sin diferencias, 2 con diferencias.
      execFileSync(
        path.join(RAIZ, "node_modules/.bin/prisma"),
        ["migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "prisma/schema.prisma", "--shadow-database-url", sombra.url, "--exit-code"],
        { cwd: RAIZ, stdio: "pipe", env: { ...process.env, DATABASE_URL: sombra.url } },
      );
    } finally {
      await sombra.borrar();
    }
  });
});

describe("40. invariantes que sostiene la base", () => {
  before(async () => {
    await base.vaciar();
    await sql(`INSERT INTO "Instalacion" (id) VALUES ('instalacion-prueba')`);
    await sql(`INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
               VALUES ('00000000-0000-0000-0000-000000000001', 'instalacion-prueba', 7, 41, '${CIFRADO_DE_FORMA}', now())`);
  });

  it("una sola instalación por base", async () => {
    await rechaza(`INSERT INTO "Instalacion" (id) VALUES ('otra-instalacion')`, UNICO);
    await rechaza(`INSERT INTO "Instalacion" (id, unica) VALUES ('otra-instalacion', false)`, CHECK);
    await rechaza(`UPDATE "Instalacion" SET id = 'Con Mayúsculas'`, CHECK, CLAVE_AJENA);
  });

  it("el token solo se guarda con la forma del cifrado: un token claro o un código no entran", async () => {
    for (const malo of ["del1_" + "A".repeat(43), "vin1_" + "A".repeat(43), "", "v1.corto"]) {
      await rechaza(`UPDATE "Vinculo" SET "tokenCifrado" = '${malo}'`, CHECK);
    }
  });

  it("una persona, un vínculo por instalación; un vínculo del ERP, una fila", async () => {
    await rechaza(
      `INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
       VALUES ('00000000-0000-0000-0000-000000000002', 'instalacion-prueba', 7, 42, '${CIFRADO_DE_FORMA}', now())`,
      UNICO,
    );
    await rechaza(
      `INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
       VALUES ('00000000-0000-0000-0000-000000000003', 'instalacion-prueba', 8, 41, '${CIFRADO_DE_FORMA}', now())`,
      UNICO,
    );
  });

  it("ids del ERP positivos; invalidado y motivo van juntos", async () => {
    await rechaza(`UPDATE "Vinculo" SET "erpUsuarioId" = 0`, CHECK);
    await rechaza(`UPDATE "Vinculo" SET "erpVinculoId" = -1`, CHECK);
    await rechaza(`UPDATE "Vinculo" SET "invalidadoEn" = now()`, CHECK);
    await rechaza(`UPDATE "Vinculo" SET "motivoInvalidacion" = 'TOKEN_RECHAZADO_POR_ERP'`, CHECK);
  });

  it("la sesión guarda un hash SHA-256 hexadecimal, vence después de crearse y no se revoca antes", async () => {
    const insertar = (hash: string, expira = "now() + interval '1 day'", revocada = "NULL") =>
      `INSERT INTO "Sesion" (id, "idHash", "vinculoId", "creadaEn", "expiraEn", "revocadaEn")
       VALUES (gen_random_uuid(), '${hash}', '00000000-0000-0000-0000-000000000001', now(), ${expira}, ${revocada})`;
    await sql(insertar(HASH));
    await rechaza(insertar(HASH), UNICO);
    await rechaza(insertar("A".repeat(43)), CHECK);
    await rechaza(insertar("B".repeat(64)), CHECK);
    await rechaza(insertar("c".repeat(64), "now()"), CHECK);
    await rechaza(insertar("d".repeat(64), "now() + interval '1 day'", "now() - interval '1 hour'"), CHECK);
  });

  it("no se borra un vínculo con sesiones ni una instalación con vínculos", async () => {
    await rechaza(`DELETE FROM "Vinculo"`, CLAVE_AJENA);
    await rechaza(`DELETE FROM "Instalacion"`, CLAVE_AJENA);
  });
});
