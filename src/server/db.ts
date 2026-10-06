// src/server/db.ts
//
// EL CLIENTE DE LA BASE PROPIA DE AZUL CHAT. Uno por proceso.
//
// Exige DATABASE_URL de forma explícita: sin ella no se construye nada. Esta
// base es la de Azul Chat; la del ERP no se toca desde acá nunca.

import "server-only";

import { PrismaClient } from "@prisma/client";

import type { Entorno } from "./erp/config.ts";

export type Db = PrismaClient;

const global_ = globalThis as unknown as { __azulChatDb?: PrismaClient };

/** El cliente del proceso, o `null` si no hay DATABASE_URL (fail closed). */
export function obtenerDb(entorno: Entorno = process.env): Db | null {
  const url = entorno.DATABASE_URL;
  if (!url) return null;
  // En desarrollo Next recarga módulos: se reusa el cliente para no abrir un pool por recarga.
  global_.__azulChatDb ??= new PrismaClient({ datasourceUrl: url });
  return global_.__azulChatDb;
}
