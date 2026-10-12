// CANDADO: la migración propia aplica desde una base VACÍA, coincide con
// schema.prisma, y la base misma impide lo que no puede pasar — aunque lo
// intente un código con un error o un script a mano.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { crearBaseDescartable, crearBaseVacia, type BaseDescartable } from "../ayuda/baseDescartable.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const CIFRADO_DE_FORMA = `v1.${"A".repeat(16)}.${"B".repeat(40)}.${"C".repeat(22)}`;
const HASH = "a".repeat(64);

let base: BaseDescartable;

before(async () => {
  // crearBaseDescartable crea la base vacía y aplica `prisma migrate deploy`: si no aplica, falla acá.
  base = await crearBaseDescartable();
});
after(async () => {
  await base?.borrar();
});

const sql = (q: string) => base.db.$executeRawUnsafe(q);
/** SQLSTATE de PostgreSQL: se decide por el código, no por el texto del mensaje. */
const UNICO = "23505";
const CHECK = "23514";
const CLAVE_AJENA = "23503";
async function rechaza(q: string, ...codigos: string[]) {
  await assert.rejects(sql(q), (e: Error) => codigos.some((c) => e.message.includes(`Code: \`${c}\``)), q);
}

describe("la migración", () => {
  it("38. aplica desde una base vacía y deja las tablas de identidad y sesión, y desde la Tanda 2 las de eventos", async () => {
    const tablas = await base.db.$queryRawUnsafe<{ t: string }[]>(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    );
    assert.deepEqual(tablas.map((x) => x.t), ["AccesoPersona", "AvisoLocal", "ConsumoIa", "CursorIngesta", "Evento", "Instalacion", "LecturaLocal", "Pregunta", "PushSuscripcion", "SaludSincronizacion", "Sesion", "Vinculo", "_prisma_migrations"]);
    const aplicadas = await base.db.$queryRawUnsafe<{ n: string }[]>(`SELECT migration_name AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
    const enElRepo = readdirSync(path.join(RAIZ, "prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.deepEqual(aplicadas.map((x) => x.n).sort(), enElRepo.sort());
  });

  it("39. ninguna columna guarda autoridad ni secretos en claro: ni rol, permisos, locales, grupo, código, contraseña ni token claro", async () => {
    const columnas = await base.db.$queryRawUnsafe<{ c: string }[]>(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`,
    );
    // La lista es exhaustiva a propósito: una columna nueva se agrega acá a
    // sabiendas. Las de la Tanda 2 tampoco son autoridad: `erpLocalId` es DÓNDE
    // ocurrió un hecho o QUÉ local se pagina, nunca un permiso para verlo;
    // `capacidad` nombra lo que se pagina, no algo que la persona pueda;
    // `ultimoErrorCodigo` es un código cerrado, nunca un mensaje; y no hay
    // ningún token, sesión, rol, permiso, alcance ni lista de capacidades.
    // Las de la Tanda 5A: `PushSuscripcion` guarda lo que el NAVEGADOR entrega
    // al suscribirse (el endpoint del servicio de push y sus claves PÚBLICAS de
    // cifrado), no un secreto de Azul Chat ni del ERP; `AvisoLocal` es una
    // marca de agua sobre Evento.id, como LecturaLocal.
    // La de la Tanda 6A: `ConsumoIa` son cuentas del mes (tokens, costo,
    // preguntas): ni la pregunta, ni la respuesta, ni quién preguntó.
    // La de la Tanda 6C: `Pregunta` guarda lo que la persona preguntó y la
    // respuesta que vio (pedido del dueño), por vínculo y chat. `requisitos`
    // NO autoriza nada: es una lista de lo que el resultado trae, que se
    // compara contra mi_alcance de hoy y solo puede OCULTAR la pregunta.
    assert.deepEqual(columnas.map((x) => x.c), [
      // Tanda 15: los accesos de cada persona en Azul Chat. Seis booleanos que
      // solo RESTAN a lo que da el ERP (nunca suman), por id de persona del
      // ERP, y quién (otro id de persona) y cuándo los cambió. No es el rol ni
      // los permisos del ERP: esos se piden vivos en cada pedido.
      "AccesoPersona.caja",
      "AccesoPersona.cambiadoEn",
      "AccesoPersona.cambiadoPorErpUsuarioId",
      "AccesoPersona.entrar",
      "AccesoPersona.erpUsuarioId",
      "AccesoPersona.ia",
      "AccesoPersona.instalacionId",
      "AccesoPersona.pendientes",
      "AccesoPersona.stock",
      "AccesoPersona.ventas",
      "AvisoLocal.actualizadoEn",
      "AvisoLocal.avisadoHastaEventoId",
      "AvisoLocal.erpLocalId",
      "AvisoLocal.vinculoId",
      "ConsumoIa.actualizadoEn",
      "ConsumoIa.costoMicroUsd",
      "ConsumoIa.mes",
      "ConsumoIa.preguntas",
      "ConsumoIa.tokensEntrada",
      "ConsumoIa.tokensSalida",
      "CursorIngesta.arrendadoHasta",
      "CursorIngesta.arrendadoPor",
      "CursorIngesta.backfillCompletoEn",
      "CursorIngesta.capacidad",
      "CursorIngesta.cursor",
      "CursorIngesta.erpLocalId",
      "CursorIngesta.id",
      "CursorIngesta.instalacionId",
      "CursorIngesta.ultimaDiferenciaContenidoClave",
      "CursorIngesta.ultimaDiferenciaContenidoEn",
      "CursorIngesta.ultimaSincronizacionEn",
      "CursorIngesta.ultimoErrorCodigo",
      "CursorIngesta.ultimoErrorEn",
      "Evento.claveExterna",
      "Evento.erpLocalId",
      "Evento.erpReferenciaId",
      "Evento.fechaOperacion",
      "Evento.historico",
      "Evento.id",
      "Evento.ingeridoEn",
      "Evento.instalacionId",
      "Evento.payload",
      "Evento.payloadVersion",
      "Evento.tipo",
      "Instalacion.creadaEn",
      "Instalacion.id",
      "Instalacion.unica",
      "LecturaLocal.actualizadoEn",
      "LecturaLocal.erpLocalId",
      "LecturaLocal.leidoHastaEventoId",
      "LecturaLocal.vinculoId",
      "Pregunta.creadaEn",
      "Pregunta.erpLocalId",
      "Pregunta.id",
      "Pregunta.requisitos",
      "Pregunta.resultado",
      "Pregunta.resultadoVersion",
      "Pregunta.texto",
      "Pregunta.vinculoId",
      "PushSuscripcion.auth",
      "PushSuscripcion.creadaEn",
      "PushSuscripcion.endpoint",
      "PushSuscripcion.id",
      "PushSuscripcion.p256dh",
      "PushSuscripcion.sesionId",
      "PushSuscripcion.ultimoEnvioEn",
      "PushSuscripcion.ultimoErrorCodigo",
      "PushSuscripcion.ultimoErrorEn",
      "PushSuscripcion.vinculoId",
      // Tanda 12: la salud de la sincronización. Una sola fila con horas,
      // un contador y CÓDIGOS cerrados de motivo (nunca un mensaje del ERP);
      // las dos listas son ids de persona del ERP a los que ya se avisó,
      // copiados de AZUL_CHAT_AVISOS_SISTEMA: a quién avisar, no qué puede.
      "SaludSincronizacion.actualizadoEn",
      "SaludSincronizacion.avisadosApertura",
      "SaludSincronizacion.fallasSeguidas",
      "SaludSincronizacion.incidenteDesde",
      "SaludSincronizacion.incidenteMotivo",
      "SaludSincronizacion.pendientesRecuperacion",
      "SaludSincronizacion.ultimaFallaEn",
      "SaludSincronizacion.ultimaFallaMotivo",
      "SaludSincronizacion.ultimoExitoEn",
      "SaludSincronizacion.unica",
      "SaludSincronizacion.vigiaDesdeEn",
      "Sesion.creadaEn",
      "Sesion.expiraEn",
      "Sesion.id",
      "Sesion.idHash",
      "Sesion.revocadaEn",
      "Sesion.vinculoId",
      "Vinculo.erpCanjeadoEn",
      // Tanda 15: el nombre que dio el ERP, solo para mostrarlo en Accesos.
      "Vinculo.erpNombre",
      "Vinculo.erpUsuarioId",
      "Vinculo.erpVinculoId",
      "Vinculo.id",
      "Vinculo.instalacionId",
      "Vinculo.invalidadoEn",
      "Vinculo.motivoInvalidacion",
      // Tanda 11: el horario de silencio de la persona. Una preferencia de
      // Azul Chat, no autoridad: solo decide si se manda un push o no.
      "Vinculo.silencioActivo",
      "Vinculo.silencioDesde",
      "Vinculo.silencioHasta",
      "Vinculo.tokenCifrado",
      // Tanda 14: cuándo le tocó a la persona la corrida de fondo. Solo
      // ordena turnos entre personas: ni autoridad ni dato del ERP.
      "Vinculo.ultimoTurnoFondoEn",
      "Vinculo.vinculadoEn",
    ]);
  });

  it("Tanda 4B: la migración de pedidos, envíos y cancelaciones aplica sobre una base CON datos y no los toca", async () => {
    // La base como está en producción antes de la Tanda 4B: las dos migraciones
    // anteriores aplicadas, con un evento, su cursor y una lectura. Recién ahí
    // `migrate deploy`, como en un despliegue.
    const prisma = path.join(RAIZ, "node_modules/.bin/prisma");
    const NUEVA = "20261011120000_eventos_pedidos_envios_cancelaciones";
    const anteriores = readdirSync(path.join(RAIZ, "prisma/migrations"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name < NUEVA)
      .map((d) => d.name)
      .sort();
    assert.deepEqual(anteriores, ["20261006180000_identidad_y_sesion", "20261007120000_eventos_ingesta_y_lectura"]);
    const vieja = await crearBaseVacia("azulchat_previa");
    const db = new PrismaClient({ datasourceUrl: vieja.url });
    const correr = (args: string[]) => execFileSync(prisma, args, { cwd: RAIZ, stdio: "pipe", env: { ...process.env, DATABASE_URL: vieja.url } });
    try {
      for (const m of anteriores) {
        correr(["db", "execute", "--url", vieja.url, "--file", `prisma/migrations/${m}/migration.sql`]);
        correr(["migrate", "resolve", "--applied", m]);
      }
      await db.$executeRawUnsafe(`INSERT INTO "Instalacion" (id) VALUES ('instalacion-prueba')`);
      await db.$executeRawUnsafe(`INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
                                  VALUES ('00000000-0000-0000-0000-000000000001', 'instalacion-prueba', 7, 41, '${CIFRADO_DE_FORMA}', now())`);
      await db.$executeRawUnsafe(`INSERT INTO "Evento" ("instalacionId", tipo, "claveExterna", "erpLocalId", "erpReferenciaId", "fechaOperacion", "payloadVersion", payload, historico)
                                  VALUES ('instalacion-prueba', 'TRANSFERENCIA_RECIBIDA', 'TRANSFERENCIA_RECIBIDA:180:2026-10-07T12:00:00.000Z', 3, 180, '2026-10-07 12:00:00.000', 1, '{"a":1}', true)`);
      await db.$executeRawUnsafe(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad, cursor, "backfillCompletoEn")
                                  VALUES (gen_random_uuid(), 'instalacion-prueba', 3, 'transferencias_eventos', '{"fechaRecepcion":"2026-10-07T12:00:00.000Z","transferenciaId":180}', now())`);
      await db.$executeRawUnsafe(`INSERT INTO "LecturaLocal" ("vinculoId", "erpLocalId", "leidoHastaEventoId", "actualizadoEn") VALUES ('00000000-0000-0000-0000-000000000001', 3, 1, now())`);
      const volcar = () =>
        db.$queryRawUnsafe<{ x: string }[]>(
          `SELECT json_build_object('e', (SELECT json_agg(t) FROM "Evento" t), 'c', (SELECT json_agg(t) FROM "CursorIngesta" t),
                                    'l', (SELECT json_agg(t) FROM "LecturaLocal" t))::text AS x`,
        );
      const antes = await volcar();

      correr(["migrate", "deploy"]);

      assert.deepEqual(await volcar(), antes, "ni una fila cambió");
      const tipos = await db.$queryRawUnsafe<{ t: string }[]>(`SELECT unnest(enum_range(NULL::"TipoEvento"))::text AS t`);
      assert.deepEqual(
        tipos.map((x) => x.t),
        ["TRANSFERENCIA_RECIBIDA", "PEDIDO_SOLICITADO", "TRANSFERENCIA_ENVIADA", "TRANSFERENCIA_CANCELADA"],
      );
    } finally {
      await db.$disconnect();
      await vieja.borrar();
    }
  });

  it("la migración coincide con schema.prisma (sin deriva)", async () => {
    const sombra = await crearBaseVacia("azulchat_sombra");
    try {
      // --exit-code: 0 sin diferencias, 2 con diferencias.
      execFileSync(
        path.join(RAIZ, "node_modules/.bin/prisma"),
        ["migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "prisma/schema.prisma", "--shadow-database-url", sombra.url, "--exit-code"],
        { cwd: RAIZ, stdio: "pipe", env: { ...process.env, DATABASE_URL: sombra.url } },
      );
    } finally {
      await sombra.borrar();
    }
  });
});

describe("40. invariantes que sostiene la base", () => {
  before(async () => {
    await base.vaciar();
    await sql(`INSERT INTO "Instalacion" (id) VALUES ('instalacion-prueba')`);
    await sql(`INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
               VALUES ('00000000-0000-0000-0000-000000000001', 'instalacion-prueba', 7, 41, '${CIFRADO_DE_FORMA}', now())`);
  });

  it("una sola instalación por base", async () => {
    await rechaza(`INSERT INTO "Instalacion" (id) VALUES ('otra-instalacion')`, UNICO);
    await rechaza(`INSERT INTO "Instalacion" (id, unica) VALUES ('otra-instalacion', false)`, CHECK);
    await rechaza(`UPDATE "Instalacion" SET id = 'Con Mayúsculas'`, CHECK, CLAVE_AJENA);
  });

  it("el token solo se guarda con la forma del cifrado: un token claro o un código no entran", async () => {
    for (const malo of ["del1_" + "A".repeat(43), "vin1_" + "A".repeat(43), "", "v1.corto"]) {
      await rechaza(`UPDATE "Vinculo" SET "tokenCifrado" = '${malo}'`, CHECK);
    }
  });

  it("una persona, un vínculo por instalación; un vínculo del ERP, una fila", async () => {
    await rechaza(
      `INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
       VALUES ('00000000-0000-0000-0000-000000000002', 'instalacion-prueba', 7, 42, '${CIFRADO_DE_FORMA}', now())`,
      UNICO,
    );
    await rechaza(
      `INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
       VALUES ('00000000-0000-0000-0000-000000000003', 'instalacion-prueba', 8, 41, '${CIFRADO_DE_FORMA}', now())`,
      UNICO,
    );
  });

  it("ids del ERP positivos; invalidado y motivo van juntos", async () => {
    await rechaza(`UPDATE "Vinculo" SET "erpUsuarioId" = 0`, CHECK);
    await rechaza(`UPDATE "Vinculo" SET "erpVinculoId" = -1`, CHECK);
    await rechaza(`UPDATE "Vinculo" SET "invalidadoEn" = now()`, CHECK);
    await rechaza(`UPDATE "Vinculo" SET "motivoInvalidacion" = 'TOKEN_RECHAZADO_POR_ERP'`, CHECK);
  });

  it("la sesión guarda un hash SHA-256 hexadecimal, vence después de crearse y no se revoca antes", async () => {
    const insertar = (hash: string, expira = "now() + interval '1 day'", revocada = "NULL") =>
      `INSERT INTO "Sesion" (id, "idHash", "vinculoId", "creadaEn", "expiraEn", "revocadaEn")
       VALUES (gen_random_uuid(), '${hash}', '00000000-0000-0000-0000-000000000001', now(), ${expira}, ${revocada})`;
    await sql(insertar(HASH));
    await rechaza(insertar(HASH), UNICO);
    await rechaza(insertar("A".repeat(43)), CHECK);
    await rechaza(insertar("B".repeat(64)), CHECK);
    await rechaza(insertar("c".repeat(64), "now()"), CHECK);
    await rechaza(insertar("d".repeat(64), "now() + interval '1 day'", "now() - interval '1 hour'"), CHECK);
  });

  it("5A. una suscripción push: endpoint https único, claves con la forma del navegador, error con fecha y código juntos; la marca de avisos no es negativa", async () => {
    const [s] = await base.db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Sesion" LIMIT 1`);
    const P256 = "B" + "A".repeat(86);
    const AUTH = "A".repeat(22);
    const insertar = (endpoint: string, p256dh = P256, auth = AUTH, error = "NULL, NULL") =>
      `INSERT INTO "PushSuscripcion" (id, "vinculoId", "sesionId", endpoint, p256dh, auth, "ultimoErrorEn", "ultimoErrorCodigo")
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '${s!.id}', '${endpoint}', '${p256dh}', '${auth}', ${error})`;
    await sql(insertar("https://fcm.googleapis.com/fcm/send/x"));
    await rechaza(insertar("https://fcm.googleapis.com/fcm/send/x"), UNICO);
    await rechaza(insertar("http://fcm.googleapis.com/fcm/send/y"), CHECK);
    await rechaza(insertar("https://fcm.googleapis.com/fcm/send/z", "corta"), CHECK);
    await rechaza(insertar("https://fcm.googleapis.com/fcm/send/w", P256, "corta"), CHECK);
    await rechaza(insertar("https://fcm.googleapis.com/fcm/send/v", P256, AUTH, "now(), NULL"), CHECK);
    const aviso = (hasta: string, local = "3") =>
      `INSERT INTO "AvisoLocal" ("vinculoId", "erpLocalId", "avisadoHastaEventoId") VALUES ('00000000-0000-0000-0000-000000000001', ${local}, ${hasta})`;
    await rechaza(aviso("-1"), CHECK);
    await rechaza(aviso("1", "0"), CHECK);
    await sql(aviso("0"));
    await sql(`DELETE FROM "AvisoLocal"`);
    await sql(`DELETE FROM "PushSuscripcion"`);
  });

  it("6A. el consumo de IA: un mes real por fila, una sola fila por mes y ninguna cuenta negativa", async () => {
    const consumo = (mes: string, extra = "") => `INSERT INTO "ConsumoIa" (mes${extra ? ", " + extra.split("=")[0] : ""}) VALUES ('${mes}'${extra ? ", " + extra.split("=")[1] : ""})`;
    await sql(consumo("2026-10"));
    await rechaza(consumo("2026-10"), UNICO);
    for (const mal of ["2026-13", "2026-00", "26-10", "2026-1", "2026-10-01"]) await rechaza(consumo(mal), CHECK);
    for (const col of ['"costoMicroUsd"=-1', '"tokensEntrada"=-1', '"tokensSalida"=-1', '"preguntas"=-1']) await rechaza(consumo("2026-11", col), CHECK);
    await sql(`DELETE FROM "ConsumoIa"`);
  });

  it("6C. las preguntas guardadas: texto de 1 a 300, local positivo o null, resultado objeto con estado, requisitos lista, de un vínculo que existe", async () => {
    const [v] = await base.db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Vinculo" LIMIT 1`);
    assert.ok(v, "hace falta un vínculo de las pruebas de arriba");
    const pregunta = (o: { vinculo?: string; local?: string; texto?: string; version?: string; resultado?: string; requisitos?: string } = {}) =>
      `INSERT INTO "Pregunta" ("vinculoId", "erpLocalId", texto, "resultadoVersion", resultado, requisitos) VALUES ('${o.vinculo ?? v.id}', ${o.local ?? "3"}, '${o.texto ?? "¿Cuánto vendió hoy?"}', ${o.version ?? "1"}, '${o.resultado ?? '{"estado":"NO_ENTIENDO","ejemplos":[]}'}', '${o.requisitos ?? "[]"}')`;
    await sql(pregunta());
    await sql(pregunta({ local: "NULL" }));
    await sql(pregunta({ texto: "x".repeat(300) }));
    await rechaza(pregunta({ texto: "" }), CHECK);
    await rechaza(pregunta({ texto: "x".repeat(301) }), CHECK);
    await rechaza(pregunta({ local: "0" }), CHECK);
    await rechaza(pregunta({ version: "0" }), CHECK);
    await rechaza(pregunta({ resultado: "[]" }), CHECK);
    await rechaza(pregunta({ resultado: '{"otra":1}' }), CHECK);
    await rechaza(pregunta({ requisitos: "{}" }), CHECK);
    await rechaza(pregunta({ vinculo: "00000000-0000-0000-0000-00000000dead" }), CLAVE_AJENA);
    await sql(`DELETE FROM "Pregunta"`);
  });

  it("11. el horario de silencio: apagado de 0 a 7 por defecto; horas de 0 a 23, distintas", async () => {
    const [v] = await base.db.$queryRawUnsafe<{ a: boolean; d: number; h: number }[]>(
      `SELECT "silencioActivo" AS a, "silencioDesde" AS d, "silencioHasta" AS h FROM "Vinculo" LIMIT 1`,
    );
    assert.deepEqual(v, { a: false, d: 0, h: 7 }, "un vínculo existente queda con el silencio apagado");
    await sql(`UPDATE "Vinculo" SET "silencioActivo" = true, "silencioDesde" = 22, "silencioHasta" = 7`);
    for (const [d, h] of [
      [7, 7],
      [24, 7],
      [-1, 7],
      [0, 24],
    ] as const) {
      await rechaza(`UPDATE "Vinculo" SET "silencioDesde" = ${d}, "silencioHasta" = ${h}`, CHECK);
    }
    await sql(`UPDATE "Vinculo" SET "silencioActivo" = false, "silencioDesde" = 0, "silencioHasta" = 7`);
  });

  it("12. la salud de la sincronización: una sola fila; motivos con código cerrado y junto a su hora; fallas no negativas", async () => {
    await sql(`INSERT INTO "SaludSincronizacion" (unica) VALUES (true)`);
    await rechaza(`INSERT INTO "SaludSincronizacion" (unica) VALUES (false)`, CHECK);
    await rechaza(`UPDATE "SaludSincronizacion" SET "ultimaFallaEn" = now()`, CHECK);
    await rechaza(`UPDATE "SaludSincronizacion" SET "ultimaFallaMotivo" = 'BASE'`, CHECK);
    await rechaza(`UPDATE "SaludSincronizacion" SET "ultimaFallaEn" = now(), "ultimaFallaMotivo" = 'El ERP dijo: boom'`, CHECK);
    await rechaza(`UPDATE "SaludSincronizacion" SET "ultimaFallaEn" = now(), "ultimaFallaMotivo" = 'SIN_CORRIDAS'`, CHECK);
    await rechaza(`UPDATE "SaludSincronizacion" SET "incidenteDesde" = now()`, CHECK);
    await rechaza(`UPDATE "SaludSincronizacion" SET "incidenteDesde" = now(), "incidenteMotivo" = 'OTRO'`, CHECK);
    await rechaza(`UPDATE "SaludSincronizacion" SET "fallasSeguidas" = -1`, CHECK);
    await sql(`UPDATE "SaludSincronizacion" SET "ultimaFallaEn" = now(), "ultimaFallaMotivo" = 'ERP_CUPO_EXCEDIDO', "incidenteDesde" = now(), "incidenteMotivo" = 'SIN_CORRIDAS', "fallasSeguidas" = 3`);
    await sql(`DELETE FROM "SaludSincronizacion"`);
  });

  it("15. los accesos: ids del ERP positivos, quién y cuándo juntos, todo en false por defecto; el nombre, corto y no vacío", async () => {
    const instalacion = (await base.db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Instalacion" LIMIT 1`))[0]!.id;
    const acceso = (extra = "", valores = "") => `INSERT INTO "AccesoPersona" ("instalacionId", "erpUsuarioId"${extra}) VALUES ('${instalacion}', 77${valores})`;
    await sql(acceso());
    const [fila] = await base.db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT entrar, ventas, caja, stock, pendientes, ia FROM "AccesoPersona"`);
    assert.deepEqual(fila, { entrar: false, ventas: false, caja: false, stock: false, pendientes: false, ia: false }, "cerrado por defecto");
    await sql(`DELETE FROM "AccesoPersona"`);
    await rechaza(acceso().replace(", 77", ", 0"), CHECK);
    await rechaza(acceso(', "cambiadoPorErpUsuarioId"', ", 9"), CHECK);
    await rechaza(acceso(', "cambiadoEn"', ", now()"), CHECK);
    await rechaza(acceso(', "cambiadoPorErpUsuarioId", "cambiadoEn"', ", -1, now()"), CHECK);
    await sql(acceso(', "cambiadoPorErpUsuarioId", "cambiadoEn"', ", 9, now()"));
    await sql(`DELETE FROM "AccesoPersona"`);
    await rechaza(`UPDATE "Vinculo" SET "erpNombre" = ''`, CHECK);
    await rechaza(`UPDATE "Vinculo" SET "erpNombre" = '${"x".repeat(121)}'`, CHECK);
  });

  it("no se borra un vínculo con sesiones ni una instalación con vínculos", async () => {
    await rechaza(`DELETE FROM "Vinculo"`, CLAVE_AJENA);
    await rechaza(`DELETE FROM "Instalacion"`, CLAVE_AJENA);
  });
});
