// src/server/salud.ts
//
// ¿ESTA INSTANCIA PUEDE ATENDER? GET /api/salud, el healthcheck de producción.
//
// Contesta 200 solo si se cumplen las tres cosas sin las que ninguna ruta de
// sesión funciona:
//
//   · configuracion: la de Azul Chat (instalación, origen, clave de cifrado) y
//     la del cliente ERP (URL y secreto) son válidas. Se validan LOCALMENTE:
//     no se llama al ERP. Un ERP caído no es una instancia rota — las rutas de
//     sesión ya lo informan como ERP_NO_DISPONIBLE — y hacer depender el
//     healthcheck del ERP haría que Docker reinicie Azul Chat por un problema
//     que reiniciarlo no arregla;
//   · base: PostgreSQL contesta dentro del tiempo;
//   · esquema: las tablas de la migración existen (la base está migrada);
//   · migraciones_pendientes (Tanda 16): la ÚLTIMA migración que trae la
//     imagen (la última carpeta de prisma/migrations, leída UNA vez por
//     proceso, no en cada pedido) está aplicada y terminada en
//     `_prisma_migrations`, y no hay ninguna empezada sin terminar. Mirar solo
//     las tablas de la primera migración daba 200 con la base atrasada.
//     Que la base tenga una migración MÁS NUEVA que la imagen no es falla: es
//     lo que pasa al volver a la imagen anterior sin revertir la base, y el
//     despliegue lo permite (docs/DEPLOY.md, rollback).
//
// Todo es lectura: ni una escritura, ni siquiera la fila de la instalación.
// La respuesta dice QUÉ comprobación falló, nunca por qué: ni nombres de
// variables, ni valores, ni el error de la base, ni nombres de migraciones
// (esos van al log: salud.migraciones_pendientes).

import "server-only";

import { readdirSync } from "node:fs";
import path from "node:path";

import { leerConfigAzulChat } from "./configuracion.ts";
import type { Db } from "./db.ts";
import { leerConfigErp, type Entorno } from "./erp/config.ts";
import { registrarEnConsola, type Registrador } from "./log.ts";

export type FallaSalud = "configuracion" | "base" | "esquema" | "migraciones_pendientes";

export type Salud =
  | { readonly ok: true; readonly servicio: "azul-chat" }
  | { readonly ok: false; readonly servicio: "azul-chat"; readonly fallas: readonly FallaSalud[] };

/** Lo que tarda como máximo la consulta a la base antes de darla por caída. */
export const TIMEOUT_BASE_MS = 2000;

// `_prisma_migrations` también: sin ella no se puede saber qué migraciones hay.
const TABLAS = ["Instalacion", "Vinculo", "Sesion", "_prisma_migrations"] as const;

/** El nombre de una carpeta de migración de Prisma: fecha y nombre. */
const NOMBRE_MIGRACION = /^\d{14}_[a-z0-9_]+$/;

/** La última migración de esa carpeta (la de nombre mayor), o `null` si no se puede leer o no hay. */
export function ultimaMigracionEn(carpeta: string): string | null {
  try {
    const nombres = readdirSync(carpeta, { withFileTypes: true })
      .filter((e) => e.isDirectory() && NOMBRE_MIGRACION.test(e.name))
      .map((e) => e.name)
      .sort();
    return nombres.at(-1) ?? null;
  } catch {
    return null;
  }
}

let ultimaDeLaImagen: { readonly nombre: string | null } | null = null;

/**
 * La última migración que trae ESTA imagen, leída una sola vez por proceso.
 * En la imagen, `prisma/` está junto al servidor (/app/prisma, Dockerfile);
 * en desarrollo, en la raíz del repo. Las dos son el directorio de trabajo.
 */
export function ultimaMigracionDeLaImagen(): string | null {
  ultimaDeLaImagen ??= { nombre: ultimaMigracionEn(path.join(process.cwd(), "prisma", "migrations")) };
  return ultimaDeLaImagen.nombre;
}

export async function comprobarSalud({
  entorno = process.env,
  db,
  timeoutMs = TIMEOUT_BASE_MS,
  esperada = ultimaMigracionDeLaImagen(),
  registrar = registrarEnConsola,
}: {
  entorno?: Entorno;
  db: Db | null;
  timeoutMs?: number;
  /** La última migración que trae la imagen. `null`: no se pudo saber, y eso es falla. */
  esperada?: string | null;
  registrar?: Registrador;
}): Promise<Salud> {
  const fallas: FallaSalud[] = [];
  if (!leerConfigAzulChat(entorno).ok || !leerConfigErp(entorno).ok) fallas.push("configuracion");

  if (!db) {
    fallas.push("base");
  } else {
    const r = await conTiempo(consultarEsquema(db), timeoutMs);
    if (r === "base") fallas.push("base");
    else if (!r) fallas.push("esquema");
    else {
      const m = await conTiempo(consultarMigraciones(db, esperada), timeoutMs);
      if (m === "base") fallas.push("base");
      else if (!m.alDia) {
        fallas.push("migraciones_pendientes");
        registrar({ evento: "salud.migraciones_pendientes", esperada, ultimaAplicada: m.ultimaAplicada, aMedias: m.aMedias });
      }
    }
  }

  return fallas.length === 0 ? { ok: true, servicio: "azul-chat" } : { ok: false, servicio: "azul-chat", fallas };
}

/** `true` si las tres tablas existen. Una sola consulta, de solo lectura. */
async function consultarEsquema(db: Db): Promise<boolean> {
  const [fila] = await db.$queryRaw<{ faltan: number }[]>`
    SELECT count(*)::int AS faltan
    FROM unnest(${TABLAS as unknown as string[]}::text[]) AS t(nombre)
    WHERE to_regclass(format('public.%I', t.nombre)) IS NULL`;
  return fila?.faltan === 0;
}

/**
 * ¿La base tiene aplicada y TERMINADA la última migración de la imagen, y
 * ninguna a medias? Una a medias es la que Prisma empezó y no terminó ni
 * revirtió (`finished_at` y `rolled_back_at` nulos): `migrate deploy` se niega
 * a seguir hasta que alguien la resuelva. Una sola consulta, de solo lectura.
 */
async function consultarMigraciones(db: Db, esperada: string | null): Promise<{ alDia: boolean; ultimaAplicada: string | null; aMedias: number }> {
  const [fila] = await db.$queryRaw<{ esta: boolean; ultima: string | null; a_medias: number }[]>`
    SELECT
      coalesce(bool_or(migration_name = ${esperada}::text AND finished_at IS NOT NULL AND rolled_back_at IS NULL), false) AS esta,
      max(migration_name) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ultima,
      (count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL))::int AS a_medias
    FROM "_prisma_migrations"`;
  const aMedias = fila?.a_medias ?? 0;
  return { alDia: esperada !== null && fila?.esta === true && aMedias === 0, ultimaAplicada: fila?.ultima ?? null, aMedias };
}

/** El resultado, o "base" si la consulta falla o no termina a tiempo. */
async function conTiempo<T>(promesa: Promise<T>, ms: number): Promise<T | "base"> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<"base">((ok) => {
    temporizador = setTimeout(() => ok("base"), ms);
  });
  try {
    return await Promise.race([promesa.catch((): "base" => "base"), limite]);
  } finally {
    clearTimeout(temporizador);
  }
}
