// Una base PostgreSQL de un solo uso para los tests de test/db/.
//
// Se crea con un nombre al azar en un servidor LOCAL, se le aplican las
// migraciones del repo con `prisma migrate deploy` (el mismo camino que en un
// despliegue: si la migración no aplica desde cero, el test se cae acá) y se
// borra al terminar.
//
// El servidor lo dice AZUL_CHAT_TEST_DATABASE_URL, una URL a la base de
// mantenimiento (p. ej. postgresql://postgres:…@localhost:5432/postgres). No
// se hereda de DATABASE_URL a propósito: los tests crean y borran bases, y
// nunca tienen que apuntar a la base de nadie. Sin la variable, o con un host
// que no es la propia máquina, los tests FALLAN: un candado de base que se
// saltea en silencio se lee como cubierto.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

export const VARIABLE_SERVIDOR_PRUEBA = "AZUL_CHAT_TEST_DATABASE_URL";
const RAIZ = path.resolve(import.meta.dirname, "../..");
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type BaseDescartable = {
  readonly nombre: string;
  readonly url: string;
  readonly db: PrismaClient;
  /** Deja todas las tablas vacías, sin tocar la migración. */
  vaciar(): Promise<void>;
  borrar(): Promise<void>;
};

function servidorDePrueba(): URL {
  const crudo = process.env[VARIABLE_SERVIDOR_PRUEBA];
  if (!crudo) {
    throw new Error(`${VARIABLE_SERVIDOR_PRUEBA} no está definida: los tests de base necesitan un PostgreSQL local de pruebas.`);
  }
  const url = new URL(crudo);
  if (!HOSTS_LOCALES.has(url.hostname)) throw new Error(`${VARIABLE_SERVIDOR_PRUEBA} tiene que apuntar a la propia máquina.`);
  if (process.env.NODE_ENV === "production") throw new Error("los tests de base no corren con NODE_ENV=production");
  return url;
}

function urlDeLaBase(servidor: URL, nombre: string): string {
  const u = new URL(servidor.href);
  u.pathname = `/${nombre}`;
  return u.href;
}

/** Aplica las migraciones del repo, como en un despliegue. */
export function migrar(url: string): void {
  execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/** Crea una base vacía con nombre al azar. Solo nombres de este prefijo se crean y se borran. */
export async function crearBaseVacia(prefijo = "azulchat_prueba"): Promise<{ nombre: string; url: string; borrar(): Promise<void> }> {
  const servidor = servidorDePrueba();
  const nombre = `${prefijo}_${randomBytes(6).toString("hex")}`;
  if (!/^azulchat_[a-z_]+_[0-9a-f]{12}$/.test(nombre)) throw new Error("nombre de base inesperado");
  const admin = new PrismaClient({ datasourceUrl: servidor.href });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${nombre}"`);
  } finally {
    await admin.$disconnect();
  }
  return {
    nombre,
    url: urlDeLaBase(servidor, nombre),
    async borrar() {
      const a = new PrismaClient({ datasourceUrl: servidor.href });
      try {
        await a.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
      } finally {
        await a.$disconnect();
      }
    },
  };
}

export async function crearBaseDescartable(): Promise<BaseDescartable> {
  const vacia = await crearBaseVacia();
  try {
    migrar(vacia.url);
  } catch (e) {
    await vacia.borrar();
    throw e;
  }
  const db = new PrismaClient({ datasourceUrl: vacia.url });
  return {
    nombre: vacia.nombre,
    url: vacia.url,
    db,
    async vaciar() {
      await db.$executeRawUnsafe(`TRUNCATE "Pregunta", "ConsumoIa", "AvisoLocal", "PushSuscripcion", "LecturaLocal", "Evento", "CursorIngesta", "Sesion", "Vinculo", "AccesoPersona", "Instalacion", "SaludSincronizacion"`);
    },
    async borrar() {
      await db.$disconnect();
      await vacia.borrar();
    },
  };
}

// ── Tanda 16: bases migradas a medias, como las deja un despliegue de verdad ──

/** Las carpetas de migración del repo, en orden. */
export const MIGRACIONES_DEL_REPO: readonly string[] = readdirSync(path.join(RAIZ, "prisma/migrations"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

/** Una migración que se agrega después de todas y falla a mitad de camino. */
export const MIGRACION_ROTA = "20991231000000_rota_a_proposito";

/**
 * Una copia de prisma/ con esas migraciones (y, si se pide, una más que falla
 * a mitad de camino), aplicada con el MISMO `prisma migrate deploy` del
 * despliegue sobre una base vacía. Así la base queda como la dejaría de verdad
 * una imagen anterior, o un despliegue que se cortó: nada se escribe a mano.
 */
export async function crearBaseMigradaCon(nombres: readonly string[], conRota = false) {
  const tmp = mkdtempSync(path.join(tmpdir(), "azulchat-migrada-"));
  cpSync(path.join(RAIZ, "prisma/schema.prisma"), path.join(tmp, "schema.prisma"));
  cpSync(path.join(RAIZ, "prisma/migrations/migration_lock.toml"), path.join(tmp, "migrations/migration_lock.toml"));
  for (const n of nombres) cpSync(path.join(RAIZ, "prisma/migrations", n), path.join(tmp, "migrations", n), { recursive: true });
  if (conRota) {
    mkdirSync(path.join(tmp, "migrations", MIGRACION_ROTA));
    writeFileSync(path.join(tmp, "migrations", MIGRACION_ROTA, "migration.sql"), 'CREATE TABLE "Rota" (id int);\nSELECT 1/0;\n');
  }
  const vacia = await crearBaseVacia();
  try {
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["migrate", "deploy", "--schema", path.join(tmp, "schema.prisma")], {
      cwd: RAIZ,
      env: { ...process.env, DATABASE_URL: vacia.url },
      stdio: "pipe",
    });
    if (conRota) throw new Error("la migración rota tenía que fallar");
  } catch (e) {
    if (!conRota || (e instanceof Error && e.message === "la migración rota tenía que fallar")) {
      await vacia.borrar();
      throw e;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const db = new PrismaClient({ datasourceUrl: vacia.url });
  return {
    db,
    url: vacia.url,
    async borrar() {
      await db.$disconnect();
      await vacia.borrar();
    },
  };
}

