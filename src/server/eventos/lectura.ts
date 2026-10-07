// src/server/eventos/lectura.ts
//
// HASTA DÓNDE LEYÓ UNA PERSONA EN UN LOCAL.
//
// La identidad de lectura es el VINCULO —la persona en esta instalación—, no la
// sesión: dos dispositivos de la misma persona leen lo mismo. La instalación no
// se recibe: sale del vínculo, así que no se puede leer ni marcar sobre los
// eventos de otra.
//
// La lectura se mide con Evento.id, que es la secuencia de INGESTA y no la
// fecha de la operación: dos eventos del mismo milisegundo se distinguen, y uno
// viejo que se conoció tarde cuenta como nuevo, porque para Azul Chat lo es.
//
// La regla de no leído (la va a usar la capa de chats):
//
//   historico = false  Y  Evento.id > leidoHastaEventoId
//
// Esto NO autoriza nada: antes de leer o marcar un local, la capa de arriba
// comprueba con el ERP que la persona lo pueda ver hoy.

import "server-only";

import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

/** El mayor Evento.id del local en la instalación del vínculo, o 0n. */
async function maximoDelLocal(db: Db, vinculoId: string, erpLocalId: number): Promise<bigint> {
  const [f] = await db.$queryRaw<{ m: bigint | null }[]>`
    SELECT max(e."id") AS m
    FROM "Evento" e JOIN "Vinculo" v ON v."instalacionId" = e."instalacionId"
    WHERE v."id" = ${vinculoId} AND e."erpLocalId" = ${erpLocalId}`;
  return f?.m ?? 0n;
}

/** Lo leído, o null si la persona todavía no tiene línea de base en ese local. */
export async function leerLectura(db: Db, vinculoId: string, erpLocalId: number): Promise<bigint | null> {
  const [f] = await db.$queryRaw<{ l: bigint }[]>`
    SELECT "leidoHastaEventoId" AS l FROM "LecturaLocal" WHERE "vinculoId" = ${vinculoId} AND "erpLocalId" = ${erpLocalId}`;
  return f ? f.l : null;
}

/**
 * LA LÍNEA DE BASE: la primera vez que la persona ve un local, todo lo que ya
 * existía es historia para ella. Se fija en el mayor Evento.id actual del
 * local, o 0 si no hay ninguno. Si ya tenía, no la toca.
 */
export async function inicializarLectura(db: Db, vinculoId: string, erpLocalId: number): Promise<bigint> {
  await db.$executeRaw`
    INSERT INTO "LecturaLocal" ("vinculoId", "erpLocalId", "leidoHastaEventoId", "actualizadoEn")
    SELECT v."id", ${erpLocalId}, COALESCE(max(e."id"), 0), now()
    FROM "Vinculo" v LEFT JOIN "Evento" e ON e."instalacionId" = v."instalacionId" AND e."erpLocalId" = ${erpLocalId}
    WHERE v."id" = ${vinculoId}
    GROUP BY v."id"
    ON CONFLICT ("vinculoId", "erpLocalId") DO NOTHING`;
  const l = await leerLectura(db, vinculoId, erpLocalId);
  if (l === null) throw new Error("el vínculo no existe");
  return l;
}

/**
 * Marca leído hasta `hastaEventoId`. Se RECORTA al mayor Evento.id que existe
 * en el local (un id inventado no adelanta lo que todavía no llegó) y nunca
 * retrocede (GREATEST). Devuelve lo leído después.
 */
export async function avanzarLectura(db: Db, vinculoId: string, erpLocalId: number, hastaEventoId: bigint): Promise<bigint> {
  if (hastaEventoId < 0n) throw new Error("id de evento negativo");
  const tope = await maximoDelLocal(db, vinculoId, erpLocalId);
  const objetivo = hastaEventoId < tope ? hastaEventoId : tope;
  await db.$executeRaw`
    INSERT INTO "LecturaLocal" ("vinculoId", "erpLocalId", "leidoHastaEventoId", "actualizadoEn")
    VALUES (${vinculoId}, ${erpLocalId}, ${objetivo}, now())
    ON CONFLICT ("vinculoId", "erpLocalId") DO UPDATE
      SET "leidoHastaEventoId" = GREATEST("LecturaLocal"."leidoHastaEventoId", EXCLUDED."leidoHastaEventoId"),
          "actualizadoEn" = now()`;
  const l = await leerLectura(db, vinculoId, erpLocalId);
  if (l === null) throw new Error("el vínculo no existe");
  return l;
}

/**
 * Cuántos eventos no leídos tiene la persona en el local: no históricos y
 * posteriores a lo leído. Sin línea de base todavía, cero: lo anterior a su
 * primera visita es historia.
 */
export async function contarNoLeidos(db: Db, vinculoId: string, erpLocalId: number): Promise<number> {
  const [f] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(e."id") AS n
    FROM "LecturaLocal" l
    JOIN "Vinculo" v ON v."id" = l."vinculoId"
    JOIN "Evento" e ON e."instalacionId" = v."instalacionId" AND e."erpLocalId" = l."erpLocalId"
    WHERE l."vinculoId" = ${vinculoId} AND l."erpLocalId" = ${erpLocalId}
      AND e."historico" = false AND e."id" > l."leidoHastaEventoId"`;
  return Number(f?.n ?? 0n);
}
