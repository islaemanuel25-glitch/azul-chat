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
//   · esquema: las tablas de la migración existen (la base está migrada).
//
// Todo es lectura: ni una escritura, ni siquiera la fila de la instalación.
// La respuesta dice QUÉ comprobación falló, nunca por qué: ni nombres de
// variables, ni valores, ni el error de la base.

import "server-only";

import { leerConfigAzulChat } from "./configuracion.ts";
import type { Db } from "./db.ts";
import { leerConfigErp, type Entorno } from "./erp/config.ts";

export type FallaSalud = "configuracion" | "base" | "esquema";

export type Salud =
  | { readonly ok: true; readonly servicio: "azul-chat" }
  | { readonly ok: false; readonly servicio: "azul-chat"; readonly fallas: readonly FallaSalud[] };

/** Lo que tarda como máximo la consulta a la base antes de darla por caída. */
export const TIMEOUT_BASE_MS = 2000;

const TABLAS = ["Instalacion", "Vinculo", "Sesion"] as const;

export async function comprobarSalud({
  entorno = process.env,
  db,
  timeoutMs = TIMEOUT_BASE_MS,
}: {
  entorno?: Entorno;
  db: Db | null;
  timeoutMs?: number;
}): Promise<Salud> {
  const fallas: FallaSalud[] = [];
  if (!leerConfigAzulChat(entorno).ok || !leerConfigErp(entorno).ok) fallas.push("configuracion");

  if (!db) {
    fallas.push("base");
  } else {
    const r = await conTiempo(consultarEsquema(db), timeoutMs);
    if (r === "base") fallas.push("base");
    else if (!r) fallas.push("esquema");
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
