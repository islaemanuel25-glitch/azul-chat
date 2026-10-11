// src/server/ia/consumo.ts
//
// EL GASTO EN IA DEL MES Y SU TOPE (Tanda 6A). Solo servidor.
//
// ── SE RESERVA ANTES DE LLAMAR, Y DE FORMA ATÓMICA ─────────────────────────
//
// Antes de cada llamada se suma a la fila del mes el peor caso de una pregunta
// (`reservaPorPregunta`, ia/tarifa.ts), con UN solo INSERT … ON CONFLICT DO
// UPDATE condicionado a no pasar el tope. PostgreSQL bloquea la fila del mes
// mientras lo hace: dos preguntas a la vez no pueden pasar el tope entre las
// dos, porque la segunda ve la reserva de la primera. Si no entra, no se
// llama a la IA (SALDO_AGOTADO).
//
// Después se AJUSTA al uso real: se suman los tokens y se corrige el costo
// (real − reservado, que casi siempre resta). Si Google no contestó, no se
// sabe qué cobró: la reserva queda entera, que es lo conservador. Como mucho
// el mes termina un poco por encima del tope si una pregunta usó más que el
// peor caso estimado; nunca porque dos se colaron a la vez.
//
// El mes es el mes calendario de Argentina ("AAAA-MM"): el tope vuelve a cero
// el día 1 a las 00:00 de Argentina.

import "server-only";

import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

/**
 * Reserva `reserva` millonésimas de dólar en el mes si no pasa `tope`, y
 * cuenta la pregunta. true si se reservó.
 */
export async function reservarPregunta(db: Db, mes: string, reserva: bigint, tope: bigint): Promise<boolean> {
  const filas = await db.$queryRaw<{ mes: string }[]>`
    INSERT INTO "ConsumoIa" ("mes", "costoMicroUsd", "preguntas", "actualizadoEn")
    SELECT ${mes}, ${reserva}, 1, now() WHERE ${reserva}::bigint <= ${tope}::bigint
    ON CONFLICT ("mes") DO UPDATE
      SET "costoMicroUsd" = "ConsumoIa"."costoMicroUsd" + EXCLUDED."costoMicroUsd",
          "preguntas" = "ConsumoIa"."preguntas" + 1,
          "actualizadoEn" = now()
      WHERE "ConsumoIa"."costoMicroUsd" + EXCLUDED."costoMicroUsd" <= ${tope}::bigint
    RETURNING "mes"`;
  return filas.length === 1;
}

/** Después de la llamada: los tokens de verdad y el costo corregido (nunca por debajo de cero). */
export async function ajustarPregunta(
  db: Db,
  mes: string,
  uso: { readonly tokensEntrada: number; readonly tokensSalida: number },
  diferenciaMicroUsd: bigint,
): Promise<void> {
  await db.$executeRaw`
    UPDATE "ConsumoIa"
       SET "tokensEntrada" = "tokensEntrada" + ${uso.tokensEntrada},
           "tokensSalida" = "tokensSalida" + ${uso.tokensSalida},
           "costoMicroUsd" = GREATEST(0, "costoMicroUsd" + ${diferenciaMicroUsd}::bigint),
           "actualizadoEn" = now()
     WHERE "mes" = ${mes}`;
}
