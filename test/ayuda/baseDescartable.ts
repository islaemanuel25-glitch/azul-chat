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
import path from "node:path";

import { PrismaClient } from "@prisma/client";

export const VARIABLE_SERVIDOR_PRUEBA = "AZUL_CHAT_TEST_DATABASE_URL";
const RAIZ = path.resolve(import.meta.dirname, "../..");
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type BaseDescartable = {
  readonly nombre: string;
  readonly url: string;
  readonly db: PrismaClient;
  /** Deja las tres tablas vacías, sin tocar la migración. */
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
      await db.$executeRawUnsafe(`TRUNCATE "Sesion", "Vinculo", "Instalacion"`);
    },
    async borrar() {
      await db.$disconnect();
      await vacia.borrar();
    },
  };
}
