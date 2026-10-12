// CANDADO (Tanda 16): EL BACKUP NO ROTA SI EL DUMP TRAE MENOS TABLAS DE LAS QUE HAY.
//
// Corre ops/backup/backup-azul-chat.sh DE VERDAD, con un `docker` de mentira en
// el PATH que, en vez de entrar al contenedor, hace un `pg_dump` REAL de una
// base descartable migrada con `prisma migrate deploy`. Así el dump tiene la
// forma exacta del de producción (mismas tablas, misma marca de cierre), y el
// caso malo es una base de verdad a la que le faltan migraciones, no un archivo
// escrito a mano.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { crearBaseDescartable, crearBaseMigradaCon, MIGRACIONES_DEL_REPO, type BaseDescartable } from "../ayuda/baseDescartable.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(RAIZ, "ops/backup/backup-azul-chat.sh");
const VIEJOS = ["azul-chat-20260101_030000.sql.gz", "azul-chat-20260102_030000.sql.gz"];

let completa: BaseDescartable;
let vieja: Awaited<ReturnType<typeof crearBaseMigradaCon>>;
let bin: string;

before(async () => {
  completa = await crearBaseDescartable();
  // La base como la dejó la PRIMERA migración: las tres tablas de entonces y la de Prisma.
  vieja = await crearBaseMigradaCon(MIGRACIONES_DEL_REPO.slice(0, 1));
  bin = mkdtempSync(path.join(tmpdir(), "azulchat-docker-"));
  // `docker inspect` dice que corre; `docker exec ... pg_dump` es un pg_dump real de DUMP_URL.
  writeFileSync(
    path.join(bin, "docker"),
    '#!/usr/bin/env bash\ncase "$1" in\n  inspect) echo true ;;\n  exec) exec pg_dump --no-owner --no-acl "$DUMP_URL" ;;\n  *) exit 99 ;;\nesac\n',
  );
  chmodSync(path.join(bin, "docker"), 0o755);
});
after(async () => {
  rmSync(bin, { recursive: true, force: true });
  await vieja?.borrar();
  await completa?.borrar();
});

/** Corre el script contra esa base, con dos backups viejos y RETENER=1. */
function correr(url: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "azulchat-backups-"));
  mkdirSync(dir, { recursive: true });
  for (const v of VIEJOS) writeFileSync(path.join(dir, v), "viejo");
  const r = spawnSync("bash", [SCRIPT], {
    env: { PATH: `${bin}:${process.env.PATH}`, DUMP_URL: url, AZUL_CHAT_BACKUP_DIR: dir, AZUL_CHAT_BACKUP_RETENER: "1", HOME: dir } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const archivos = readdirSync(dir).sort();
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stderr: r.stderr, archivos };
}

describe("el backup cuenta las tablas del dump", () => {
  it("16. un dump de la base al día trae exactamente TABLAS_MINIMAS tablas, y el script lo guarda y rota", () => {
    const minimas = Number(/^TABLAS_MINIMAS=(\d+)$/m.exec(readFileSync(SCRIPT, "utf8"))?.[1]);
    const r = correr(completa.url);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`dump OK: \\d+ bytes, ${minimas} tablas`), "la base al día tiene justo el mínimo: ni una de más");
    // RETENER=1: queda solo el nuevo; los dos viejos se rotaron.
    assert.equal(r.archivos.length, 1);
    assert.ok(!VIEJOS.includes(r.archivos[0]!));
  });

  it("un dump con menos tablas (una base a la que le faltan migraciones): sale con error y NO rota los viejos", () => {
    const r = correr(vieja.url);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /ERROR: 4 tablas en el dump, se esperaban 13 o más\. No se rota\./);
    assert.deepEqual(r.archivos, VIEJOS, "los viejos siguen y no quedó ni el nuevo ni el parcial");
  });
});
