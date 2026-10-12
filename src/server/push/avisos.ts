// src/server/push/avisos.ts
//
// QUÉ SE AVISA, A QUIÉN Y UNA SOLA VEZ (Tanda 5A). Solo servidor.
//
// Corre al final de la sincronización de fondo de una persona (un vínculo),
// con los locales que `mi_alcance` le autoriza HOY y lo que sigue visible de
// cada uno después de sincronizar (las mismas capacidades y tipos que la
// interfaz). No decide autorización: la recibe.
//
// ── QUÉ ENTRA EN UN AVISO ──────────────────────────────────────────────────
//
// Por local, los eventos que cumplen TODO esto:
//
//   · `historico = false`: nunca backfill;
//   · de un tipo que la persona puede ver hoy en ese local;
//   · con `Evento.id` mayor que la marca de AvisoLocal (todavía no se
//     consideraron para avisar), sea la corrida de quien sea la que los
//     ingirió (desde la Tanda 5B, abrir la app no ingiere);
//   · con `Evento.id` mayor que lo LEÍDO: lo que la persona ya leyó en la app
//     no se le avisa.
//
// ── UNA SOLA VEZ ───────────────────────────────────────────────────────────
//
// AvisoLocal es una marca de agua sobre Evento.id, como LecturaLocal. Los
// eventos nuevos siempre tienen ids mayores, así que lo que quedó por debajo
// de la marca no se vuelve a mirar. Por local:
//
//   1. la primera vez, la marca nace en el mayor Evento.id actual del local:
//      lo que ya había no es novedad (como la línea de base de lectura);
//   2. se lee la marca `m` y el tope `t` (el mayor Evento.id del local);
//   3. se elige qué avisar entre `m` y `t`;
//   4. la marca pasa de `m` a `t` con un UPDATE condicionado a que siga en `m`.
//      Si otra corrida la movió primero, esta no avisa nada de ese local: así
//      dos corridas a la vez no mandan el mismo aviso dos veces.
//
// El aviso se manda DESPUÉS de mover la marca: si el envío falla, ese aviso se
// pierde y no se reintenta (cada evento se avisa a lo sumo una vez). La marca
// avanza aunque la persona no tenga suscripción: activarlas mañana no trae una
// avalancha de lo de hoy.
//
// ── EL TEXTO ───────────────────────────────────────────────────────────────
//
// Agrupado por local y por corrida: un evento es "{Local}: {título}" con el
// mismo título que la tarjeta (shared/chats/textos.ts); dos o más,
// "{Local}: N novedades". Sin montos, productos ni ids técnicos (fuera del
// número de transferencia o pedido del título). Tocarlo abre ese local.

import "server-only";

import type { PrismaClient, TipoEvento } from "@prisma/client";

import { resumenDeEvento } from "../../shared/chats/textos.ts";
import { aEventoPublico, SELECT_PUBLICO } from "../chats/historial.ts";
import { enviarAviso, TTL_AVISO_SEGUNDOS, type Aviso, type DependenciasEnvio } from "./enviar.ts";

export const TITULO_AVISO = "Azul Chat";

/** Un local autorizado hoy, con su nombre de hoy y los tipos que la persona puede ver. */
export type LocalParaAvisar = { readonly localId: number; readonly nombre: string; readonly tipos: readonly TipoEvento[] };

export type ResultadoAvisos = {
  /** Avisos armados (uno por local con novedades). */
  readonly avisos: number;
  /** Envíos que el servicio de push aceptó. */
  readonly enviados: number;
  /** Envíos que fallaron (sin contar los vencidos). */
  readonly fallidos: number;
  /** Suscripciones borradas porque el servicio de push dijo 404 o 410. */
  readonly borradas: number;
};

/** "Casiano: Transferencia #404 recibida con diferencias" o "Casiano: 3 novedades". */
export function textoDeAviso(nombreLocal: string, titulos: readonly string[]): string {
  return titulos.length === 1 ? `${nombreLocal}: ${titulos[0]}` : `${nombreLocal}: ${titulos.length} novedades`;
}

export function avisoDeLocal(local: { readonly localId: number; readonly nombre: string }, titulos: readonly string[]): Aviso {
  return {
    titulo: TITULO_AVISO,
    cuerpo: textoDeAviso(local.nombre, titulos),
    url: `/?vista=local&localId=${local.localId}`,
    etiqueta: `local-${local.localId}`,
  };
}

type Db = PrismaClient;

/**
 * Elige qué avisar en un local y mueve su marca. Devuelve los títulos de los
 * eventos a avisar (vacío si no hay nada o si otra corrida ganó la marca).
 */
async function novedadesDeLocal(db: Db, vinculoId: string, local: LocalParaAvisar): Promise<string[]> {
  // 1. La marca nace en el máximo actual: lo que ya había no es novedad.
  await db.$executeRaw`
    INSERT INTO "AvisoLocal" ("vinculoId", "erpLocalId", "avisadoHastaEventoId", "actualizadoEn")
    SELECT v."id", ${local.localId}, COALESCE(max(e."id"), 0), now()
    FROM "Vinculo" v LEFT JOIN "Evento" e ON e."instalacionId" = v."instalacionId" AND e."erpLocalId" = ${local.localId}
    WHERE v."id" = ${vinculoId}
    GROUP BY v."id"
    ON CONFLICT ("vinculoId", "erpLocalId") DO NOTHING`;

  // 2. La marca, el tope y lo leído.
  const [f] = await db.$queryRaw<{ marca: bigint; tope: bigint | null; leido: bigint | null; instalacion: string }[]>`
    SELECT a."avisadoHastaEventoId" AS marca,
           (SELECT max(e."id") FROM "Evento" e WHERE e."instalacionId" = v."instalacionId" AND e."erpLocalId" = ${local.localId}) AS tope,
           (SELECT l."leidoHastaEventoId" FROM "LecturaLocal" l WHERE l."vinculoId" = v."id" AND l."erpLocalId" = ${local.localId}) AS leido,
           v."instalacionId" AS instalacion
    FROM "AvisoLocal" a JOIN "Vinculo" v ON v."id" = a."vinculoId"
    WHERE a."vinculoId" = ${vinculoId} AND a."erpLocalId" = ${local.localId}`;
  if (!f || f.tope === null || f.tope <= f.marca) return [];
  const desde = f.leido !== null && f.leido > f.marca ? f.leido : f.marca;

  // 3. Qué avisar: no histórico, de los tipos visibles, entre la marca (o lo leído) y el tope.
  const filas =
    local.tipos.length === 0
      ? []
      : await db.evento.findMany({
          where: {
            instalacionId: f.instalacion,
            erpLocalId: local.localId,
            historico: false,
            tipo: { in: [...local.tipos] },
            id: { gt: desde, lte: f.tope },
          },
          orderBy: [{ fechaOperacion: "asc" }, { id: "asc" }],
          select: SELECT_PUBLICO,
        });

  // 4. La marca se mueve solo si sigue donde se leyó: si otra corrida ganó, esta no avisa.
  const movida = await db.$executeRaw`
    UPDATE "AvisoLocal" SET "avisadoHastaEventoId" = ${f.tope}, "actualizadoEn" = now()
    WHERE "vinculoId" = ${vinculoId} AND "erpLocalId" = ${local.localId} AND "avisadoHastaEventoId" = ${f.marca}`;
  if (movida !== 1) return [];
  return filas.map((fila) => resumenDeEvento(aEventoPublico(fila)));
}

/**
 * Arma los avisos de una persona y los manda a sus dispositivos con una sesión
 * vigente. Sin configuración de push, la marca avanza igual y no se manda nada.
 */
export async function avisarNovedades(
  db: Db,
  vinculoId: string,
  locales: readonly LocalParaAvisar[],
  envio: DependenciasEnvio | null,
  ahora: Date,
): Promise<ResultadoAvisos> {
  const avisos: Aviso[] = [];
  for (const local of locales) {
    const titulos = await novedadesDeLocal(db, vinculoId, local);
    if (titulos.length > 0) avisos.push(avisoDeLocal(local, titulos));
  }
  if (avisos.length === 0 || !envio) return { avisos: avisos.length, enviados: 0, fallidos: 0, borradas: 0 };
  return { avisos: avisos.length, ...(await enviarAVinculo(db, vinculoId, avisos, envio, ahora, TTL_AVISO_SEGUNDOS)) };
}

/**
 * Manda esos avisos a cada dispositivo de la persona con una sesión vigente,
 * anota el envío o el error en la suscripción y BORRA las que el servicio de
 * push dio por vencidas (404/410). Lo usan los avisos de novedades y, desde la
 * Tanda 12, los avisos del sistema (interno/vigia.ts). Sin reintentos.
 *
 * Desde la Tanda 13 cada aviso sale con `creadoEn` (la hora de esta corrida,
 * en ms) para que el service worker no muestre uno viejo encima de uno nuevo,
 * y con el TTL que diga quien llama: 12 h los de eventos, 6 h los del sistema.
 */
export async function enviarAVinculo(
  db: Db,
  vinculoId: string,
  avisos: readonly Aviso[],
  envio: DependenciasEnvio,
  ahora: Date,
  ttlSegundos: number,
): Promise<{ enviados: number; fallidos: number; borradas: number; dispositivos: number }> {
  let enviados = 0;
  let fallidos = 0;
  let borradas = 0;
  // Solo los dispositivos con una sesión que sigue valiendo: cerrar sesión corta sus avisos.
  const suscripciones = await db.pushSuscripcion.findMany({
    where: { vinculoId, sesion: { revocadaEn: null, expiraEn: { gt: ahora } } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
    orderBy: { creadaEn: "asc" },
  });
  for (const s of suscripciones) {
    for (const aviso of avisos) {
      const r = await enviarAviso(envio, s, { ...aviso, creadoEn: ahora.getTime() }, ttlSegundos);
      if (r.tipo === "VENCIDA") {
        await db.pushSuscripcion.deleteMany({ where: { id: s.id } });
        borradas += 1;
        break; // ya no existe: no se le manda el resto
      }
      if (r.tipo === "ENVIADO") {
        enviados += 1;
        await db.pushSuscripcion.update({ where: { id: s.id }, data: { ultimoEnvioEn: ahora, ultimoErrorEn: null, ultimoErrorCodigo: null } });
      } else {
        fallidos += 1;
        await db.pushSuscripcion.update({ where: { id: s.id }, data: { ultimoErrorEn: ahora, ultimoErrorCodigo: r.codigo } });
      }
    }
  }
  return { enviados, fallidos, borradas, dispositivos: suscripciones.length };
}

/** Las suscripciones cuya sesión ya no vale (cerrada o vencida) no van a recibir nada nunca: se borran. */
export async function borrarSuscripcionesSinSesion(db: Db, ahora: Date): Promise<number> {
  const r = await db.pushSuscripcion.deleteMany({
    where: { OR: [{ sesion: { revocadaEn: { not: null } } }, { sesion: { expiraEn: { lte: ahora } } }, { vinculo: { invalidadoEn: { not: null } } }] },
  });
  return r.count;
}

