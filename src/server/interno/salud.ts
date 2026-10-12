// src/server/interno/salud.ts
//
// LA SALUD DE LA SINCRONIZACIÓN DE FONDO (Tanda 12). Solo servidor.
//
// Cada corrida de POST /api/interno/sincronizar que pasó la puerta anota acá
// su resultado, en UNA sola fila (SaludSincronizacion): un éxito pone la hora
// del último éxito y las fallas seguidas en cero; una falla pone la hora, un
// motivo corto —un código cerrado, nunca un mensaje— y suma una falla seguida.
// No se guarda una fila por corrida. Con esto decide el vigía (vigia.ts).
//
// Qué es una falla de la corrida, no de una persona:
//
//   · ERP_CUPO_EXCEDIDO: el ERP cortó por cupo (LIMITE_EXCEDIDO) y la corrida
//     se cortó ahí;
//   · ERP_NO_DISPONIBLE: no se pudo con NINGUNA de las personas que se
//     intentaron (el ERP caído, lento o rechazando). Que una persona falle y
//     las demás no, no es una caída: es esa persona;
//   · BASE: la corrida misma no pudo con la base propia.
//
// Una corrida sin personas (nadie con sesión) es un éxito: corrió, y no había
// nada que hacer.

import "server-only";

import type { PrismaClient } from "@prisma/client";

/** Los motivos de una falla de la corrida, cerrados (también en un CHECK de la base). */
export const MOTIVOS_FALLA = ["ERP_NO_DISPONIBLE", "ERP_CUPO_EXCEDIDO", "BASE"] as const;
export type MotivoFalla = (typeof MOTIVOS_FALLA)[number];

export type ResultadoCorrida = { readonly ok: true } | { readonly ok: false; readonly motivo: MotivoFalla };

type Db = Pick<PrismaClient, "$executeRaw">;

/** El resultado de una corrida a partir de sus cuentas (sincronizar.ts, ResumenTarea). */
export function resultadoDeCorrida(r: { readonly personas: number; readonly revocadas: number; readonly conFalla: number; readonly cortadaPorCupo: boolean }): ResultadoCorrida {
  if (r.cortadaPorCupo) return { ok: false, motivo: "ERP_CUPO_EXCEDIDO" };
  const intentadas = r.personas - r.revocadas;
  if (intentadas > 0 && r.conFalla >= intentadas) return { ok: false, motivo: "ERP_NO_DISPONIBLE" };
  return { ok: true };
}

/** Anota el resultado de una corrida que empezó en `inicio`. Una sola fila, en una sola sentencia. */
export async function registrarCorrida(db: Db, inicio: Date, r: ResultadoCorrida): Promise<void> {
  if (r.ok) {
    await db.$executeRaw`
      INSERT INTO "SaludSincronizacion" ("unica", "ultimoExitoEn", "fallasSeguidas", "actualizadoEn")
      VALUES (true, ${inicio}, 0, now())
      ON CONFLICT ("unica") DO UPDATE
        SET "ultimoExitoEn" = GREATEST(COALESCE("SaludSincronizacion"."ultimoExitoEn", EXCLUDED."ultimoExitoEn"), EXCLUDED."ultimoExitoEn"),
            "fallasSeguidas" = 0,
            "actualizadoEn" = now()`;
    return;
  }
  await db.$executeRaw`
    INSERT INTO "SaludSincronizacion" ("unica", "ultimaFallaEn", "ultimaFallaMotivo", "fallasSeguidas", "actualizadoEn")
    VALUES (true, ${inicio}, ${r.motivo}, 1, now())
    ON CONFLICT ("unica") DO UPDATE
      SET "ultimaFallaEn" = EXCLUDED."ultimaFallaEn",
          "ultimaFallaMotivo" = EXCLUDED."ultimaFallaMotivo",
          "fallasSeguidas" = "SaludSincronizacion"."fallasSeguidas" + 1,
          "actualizadoEn" = now()`;
}
