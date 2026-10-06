// src/server/sesion/repositorio.ts
//
// LA PERSISTENCIA DE LA INSTALACIÓN, EL VÍNCULO Y LAS SESIONES.
//
// Todo lo que escribe va en UNA transacción de la base de Azul Chat. Lo que no
// puede ir en esa transacción es el canje del ERP, que pasa antes y en otra
// base: ver vincular.ts sobre por qué eso no se finge atómico.

import "server-only";

import { Prisma } from "@prisma/client";

import type { Db } from "../db.ts";
import { DURACION_SESION_MS, generarIdSesion, hashIdSesion } from "./cookie.ts";

export class OtraInstalacion extends Error {}
export class VinculoReemplazadoEInvalido extends Error {}

/**
 * La instalación de este despliegue. La crea si la base está vacía; si la base
 * ya es de OTRA instalación, falla: un despliegue no adopta los vínculos de otro.
 */
export async function asegurarInstalacion(db: Db, instalacionId: string): Promise<void> {
  await db.instalacion.createMany({ data: [{ id: instalacionId }], skipDuplicates: true });
  const fila = await db.instalacion.findFirst({ select: { id: true } });
  if (!fila || fila.id !== instalacionId) throw new OtraInstalacion();
}

export type DatosVinculoNuevo = {
  readonly instalacionId: string;
  readonly erpUsuarioId: number;
  readonly erpVinculoId: number;
  readonly erpCanjeadoEn: Date;
  /** Ya cifrado. Esta pieza nunca ve el token claro. */
  readonly tokenCifrado: string;
};

/**
 * Guarda el vínculo de la persona y crea una sesión nueva, en una transacción.
 *
 * Una fila por persona. Si ya existía:
 *   · con un `erpVinculoId` MENOR, se reemplazan el vínculo y el token (y se
 *     vuelve a habilitar si estaba invalidado). Las sesiones de otros
 *     dispositivos siguen andando con el token nuevo; las ya revocadas siguen
 *     revocadas.
 *   · con uno MAYOR, este canje llegó tarde: el ERP ya revocó su vínculo al
 *     autorizar el nuevo. Se conserva el token nuevo y la sesión se cuelga de
 *     la misma persona. Si ese vínculo nuevo ya estaba invalidado, no hay token
 *     vigente que usar y falla.
 *
 * `revocarIdSesionAnterior`: la sesión que este dispositivo traía, si traía:
 * se revoca, porque el dispositivo pasa a usar la nueva.
 *
 * @returns el identificador CLARO de la sesión, para la cookie. No se guarda.
 */
export async function guardarVinculoYCrearSesion(
  db: Db,
  datos: DatosVinculoNuevo,
  { ahora, revocarIdSesionAnterior }: { ahora: Date; revocarIdSesionAnterior: string | null },
): Promise<{ idSesion: string; expiraEn: Date }> {
  const idSesion = generarIdSesion();
  const expiraEn = new Date(ahora.getTime() + DURACION_SESION_MS);

  await db.$transaction(async (tx) => {
    // INSERT … ON CONFLICT DO NOTHING: si dos dispositivos de la misma persona
    // se vinculan a la vez, uno inserta y el otro encuentra la fila.
    await tx.vinculo.createMany({
      data: [{ ...datos, vinculadoEn: ahora }],
      skipDuplicates: true,
    });
    // La fila de la persona, bloqueada hasta el final de la transacción.
    const [fila] = await tx.$queryRaw<{ id: string; erpVinculoId: number; invalidadoEn: Date | null }[]>(Prisma.sql`
      SELECT "id", "erpVinculoId", "invalidadoEn" FROM "Vinculo"
      WHERE "instalacionId" = ${datos.instalacionId} AND "erpUsuarioId" = ${datos.erpUsuarioId}
      FOR UPDATE`);
    if (!fila) throw new Error("el vínculo no quedó escrito");

    if (fila.erpVinculoId < datos.erpVinculoId) {
      await tx.vinculo.update({
        where: { id: fila.id },
        data: {
          erpVinculoId: datos.erpVinculoId,
          tokenCifrado: datos.tokenCifrado,
          erpCanjeadoEn: datos.erpCanjeadoEn,
          vinculadoEn: ahora,
          invalidadoEn: null,
          motivoInvalidacion: null,
        },
      });
    } else if (fila.erpVinculoId > datos.erpVinculoId && fila.invalidadoEn) {
      throw new VinculoReemplazadoEInvalido();
    }

    if (revocarIdSesionAnterior) {
      await tx.sesion.updateMany({
        where: { idHash: hashIdSesion(revocarIdSesionAnterior), revocadaEn: null },
        data: { revocadaEn: ahora },
      });
    }
    await tx.sesion.create({ data: { idHash: hashIdSesion(idSesion), vinculoId: fila.id, creadaEn: ahora, expiraEn } });
  });

  return { idSesion, expiraEn };
}

export type SesionVigente = {
  readonly sesionId: string;
  readonly vinculo: {
    readonly id: string;
    readonly erpUsuarioId: number;
    readonly erpVinculoId: number;
    readonly tokenCifrado: string;
  };
};

/**
 * La sesión de ese identificador, si sigue valiendo: existe, no se revocó, no
 * venció, su vínculo está vigente y es de ESTA instalación.
 */
export async function leerSesionVigente(db: Db, idSesion: string, instalacionId: string, ahora: Date): Promise<SesionVigente | null> {
  const s = await db.sesion.findUnique({
    where: { idHash: hashIdSesion(idSesion) },
    select: {
      id: true,
      expiraEn: true,
      revocadaEn: true,
      vinculo: { select: { id: true, instalacionId: true, erpUsuarioId: true, erpVinculoId: true, tokenCifrado: true, invalidadoEn: true } },
    },
  });
  if (!s || s.revocadaEn || s.expiraEn <= ahora) return null;
  const v = s.vinculo;
  if (v.invalidadoEn || v.instalacionId !== instalacionId) return null;
  return { sesionId: s.id, vinculo: { id: v.id, erpUsuarioId: v.erpUsuarioId, erpVinculoId: v.erpVinculoId, tokenCifrado: v.tokenCifrado } };
}

/** Revoca SOLO la sesión de ese identificador. Las demás de la persona siguen. */
export async function revocarSesion(db: Db, idSesion: string, ahora: Date): Promise<boolean> {
  const r = await db.sesion.updateMany({ where: { idHash: hashIdSesion(idSesion), revocadaEn: null }, data: { revocadaEn: ahora } });
  return r.count > 0;
}

/**
 * El ERP rechazó el token: el vínculo queda invalidado y TODAS sus sesiones
 * revocadas, en una transacción.
 *
 * Solo si el vínculo sigue teniendo el token que el ERP rechazó
 * (`erpVinculoId`): si mientras tanto otro dispositivo se volvió a vincular,
 * el token es otro y no se toca nada.
 *
 * @returns cuántas sesiones se revocaron, o `null` si el vínculo ya había cambiado.
 */
export async function invalidarVinculo(db: Db, vinculoId: string, erpVinculoId: number, ahora: Date): Promise<number | null> {
  return db.$transaction(async (tx) => {
    const r = await tx.vinculo.updateMany({
      where: { id: vinculoId, erpVinculoId, invalidadoEn: null },
      data: { invalidadoEn: ahora, motivoInvalidacion: "TOKEN_RECHAZADO_POR_ERP" },
    });
    if (r.count === 0) return null;
    const s = await tx.sesion.updateMany({ where: { vinculoId, revocadaEn: null }, data: { revocadaEn: ahora } });
    return s.count;
  });
}
