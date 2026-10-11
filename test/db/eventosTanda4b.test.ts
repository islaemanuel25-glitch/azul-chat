// CANDADOS DE LA INGESTA DE PEDIDO_SOLICITADO, TRANSFERENCIA_ENVIADA Y
// TRANSFERENCIA_CANCELADA (Tanda 4B), CONTRA POSTGRESQL.
//
// La maquinaria es la de transferencias_eventos (ingesta.ts); acá se fija lo
// que cambia por capacidad: su cursor, su backfill, su clave y qué cuenta como
// la misma foto. El ERP es un doble que pagina sobre los eventos REALES del
// fixture erp-76b9a71.json con las reglas del contrato, y el primer candado
// comprueba que da EXACTAMENTE las páginas que dio el ERP.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { construirCuerpoEventos, type EntradaEventos } from "../../src/server/erp/eventos.ts";
import { INGESTA_CANCELACIONES, INGESTA_ENVIOS, INGESTA_PEDIDOS, type DefinicionIngesta } from "../../src/server/eventos/capacidades.ts";
import { sincronizarEventosLocal, sincronizarTransferenciasLocal } from "../../src/server/eventos/ingesta.ts";
import type { DatosEventos, ResultadoConsulta } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { cancelacion, envio, paginarEventos, paginarEventos4a, pedido } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, FIXTURES_ERP_76B9A71, TOKEN_PRUEBA, type IntercambioErp } from "../ayuda/servidorErp.ts";

type Capacidad = "pedidos_eventos" | "envios_eventos" | "cancelaciones_eventos";
const F = FIXTURES_ERP_76B9A71;
const INSTALACION = "instalacion-prueba";
const LOCAL_A = { id: 2, nombre: "Local A" };
const ALCANCE = { grupoId: 1, localId: LOCAL_A.id };
const DEFINICIONES = {
  pedidos_eventos: INGESTA_PEDIDOS,
  envios_eventos: INGESTA_ENVIOS,
  cancelaciones_eventos: INGESTA_CANCELACIONES,
} as unknown as Record<Capacidad, DefinicionIngesta<string, object, object>>;
/** Los eventos REALES de Local A en el fixture, por capacidad. */
const HISTORIA = (c: Capacidad) => structuredClone((F[c].completa.respuesta.cuerpo.datos as { eventos: object[] }).eventos);

/** El ERP de una capacidad: pagina sobre `universo` como el contrato, y cada pedido se arma con el constructor real del cliente. */
function erpDoble(capacidad: Capacidad, universo: () => readonly object[]) {
  const pedidos: EntradaEventos<object>[] = [];
  let forzada: (() => ResultadoConsulta<DatosEventos<string, object, object>>) | null = null;
  const consultar = async (entrada: EntradaEventos<object>): Promise<ResultadoConsulta<DatosEventos<string, object, object>>> => {
    pedidos.push(entrada);
    assert.ok(construirCuerpoEventos(DEFINICIONES[capacidad].contrato, TOKEN_PRUEBA, entrada), "la ingesta mandó un pedido que el cliente no armaría");
    if (forzada) return forzada();
    const datos = paginarEventos4a(capacidad, { universo: universo(), local: LOCAL_A, grupoId: 1, desde: entrada.desde, limite: entrada.limite });
    return { ok: true, datos: datos as unknown as DatosEventos<string, object, object>, requestId: "doble" };
  };
  return {
    consultar,
    pedidos,
    forzar(f: typeof forzada) {
      forzada = f;
    },
  };
}

let base: BaseDescartable;
let reloj: number;
let ids: number;
before(async () => {
  base = await crearBaseDescartable();
});
after(async () => {
  await base?.borrar();
});
beforeEach(async () => {
  await base.vaciar();
  await base.db.$executeRawUnsafe(`INSERT INTO "Instalacion" (id) VALUES ('${INSTALACION}')`);
  reloj = Date.parse(F.ahora);
  ids = 0;
});

const sincronizar = (capacidad: Capacidad, consultar: ReturnType<typeof erpDoble>["consultar"], extra: { limitePorPagina?: number; maxPaginas?: number } = {}) =>
  sincronizarEventosLocal(DEFINICIONES[capacidad], {
    db: base.db,
    instalacionId: INSTALACION,
    alcance: ALCANCE,
    consultar,
    ahora: () => reloj,
    generarId: () => `ejecucion-${++ids}`,
    limitePorPagina: 2,
    maxPaginas: 1,
    ...extra,
  });
const cursor = (capacidad: string) => base.db.cursorIngesta.findUniqueOrThrow({
  where: { instalacionId_erpLocalId_capacidad: { instalacionId: INSTALACION, erpLocalId: LOCAL_A.id, capacidad } },
});
const eventos = () => base.db.evento.findMany({ orderBy: { id: "asc" } });

for (const capacidad of ["pedidos_eventos", "envios_eventos", "cancelaciones_eventos"] as const) {
  const casos = F[capacidad];
  const tipo = DEFINICIONES[capacidad].tipo;

  describe(`${capacidad}: el doble es el ERP`, () => {
    it("pagina igual que el ERP real: mismas páginas que pagina1, pagina2 y completa del fixture, para los mismos pedidos", async () => {
      const erp = erpDoble(capacidad, () => HISTORIA(capacidad));
      for (const n of ["pagina1", "pagina2", "completa"] as const) {
        const i: IntercambioErp = casos[n];
        const p = i.pedido.parametros as { desde?: object; limite: number };
        const r = await erp.consultar({ alcance: ALCANCE, desde: p.desde ?? null, limite: p.limite });
        assert.ok(r.ok);
        assert.deepEqual(r.datos, i.respuesta.cuerpo.datos, n);
      }
    });
  });

  describe(`${capacidad}: cursor, backfill e idempotencia`, () => {
    it("guarda como cursor EXACTAMENTE el siguiente del ERP, lo manda tal cual, y todo el backfill es historia hasta la primera página sin más", async () => {
      const historia = HISTORIA(capacidad);
      assert.ok(historia.length >= 3, "el fixture trae más de una página de 2");
      const erp = erpDoble(capacidad, () => historia);
      const r1 = await sincronizar(capacidad, erp.consultar);
      assert.equal(r1.tipo, "SINCRONIZADO");
      assert.deepEqual((await cursor(capacidad)).cursor, (casos.pagina1.respuesta.cuerpo.datos as { siguiente: object }).siguiente);
      assert.equal((await cursor(capacidad)).backfillCompletoEn, null);
      await sincronizar(capacidad, erp.consultar, { maxPaginas: 10 });
      assert.deepEqual(erp.pedidos[1]!.desde, (casos.pagina1.respuesta.cuerpo.datos as { siguiente: object }).siguiente, "el desde del segundo pedido es el siguiente del primero");
      const c = await cursor(capacidad);
      assert.ok(c.backfillCompletoEn, "backfill completo");
      const guardados = await eventos();
      assert.equal(guardados.length, historia.length);
      assert.ok(guardados.every((e) => e.historico && e.tipo === tipo && e.erpLocalId === LOCAL_A.id));
      // Lo que llega después ya no es historia.
      const nuevo =
        capacidad === "pedidos_eventos"
          ? pedido({ pedidoId: 900, fecha: "2026-10-11T00:49:00.000Z" })
          : capacidad === "envios_eventos"
            ? envio({ transferenciaId: 900, fecha: "2026-10-11T00:49:00.000Z" })
            : cancelacion({ transferenciaId: 900, fecha: "2026-10-11T00:49:00.000Z" });
      historia.push(nuevo);
      reloj += 31_000;
      await sincronizar(capacidad, erp.consultar, { maxPaginas: 10 });
      const ultimo = (await eventos()).at(-1)!;
      assert.equal(ultimo.erpReferenciaId, 900);
      assert.equal(ultimo.historico, false);
      assert.equal(ultimo.claveExterna, (nuevo as { eventoId: string }).eventoId);
    });

    it("la misma página dos veces no duplica nada", async () => {
      const erp = erpDoble(capacidad, () => HISTORIA(capacidad));
      await sincronizar(capacidad, erp.consultar, { limitePorPagina: 100 });
      await base.db.$executeRawUnsafe(`UPDATE "CursorIngesta" SET "cursor" = NULL`);
      reloj += 31_000;
      const r = await sincronizar(capacidad, erp.consultar, { limitePorPagina: 100 });
      assert.ok(r.tipo === "SINCRONIZADO" && r.eventosNuevos === 0 && r.contenidoDiferente === 0, JSON.stringify(r));
      assert.equal((await eventos()).length, HISTORIA(capacidad).length);
    });

    it("un fallo del ERP deja el cursor donde estaba y anota el código", async () => {
      const erp = erpDoble(capacidad, () => HISTORIA(capacidad));
      await sincronizar(capacidad, erp.consultar);
      const antes = (await cursor(capacidad)).cursor;
      const negado = casos.sinPermiso.respuesta.cuerpo as { codigo: "NO_AUTORIZADO" };
      erp.forzar(() => ({ ok: false, origen: "erp", codigo: negado.codigo, status: 403, requestId: "doble" }));
      const r = await sincronizar(capacidad, erp.consultar);
      assert.equal(r.tipo, "FALLO_ERP");
      const c = await cursor(capacidad);
      assert.deepEqual(c.cursor, antes);
      assert.equal(c.ultimoErrorCodigo, "NO_AUTORIZADO");
    });
  });
}

describe("una clave que vuelve con otra foto", () => {
  it("PEDIDO_SOLICITADO con otra cantidad de líneas: se conserva la primera y NO se anota como diferencia", async () => {
    let universo = [pedido({ pedidoId: 91, fecha: "2026-10-10T20:00:00.000Z", lineas: 3 })];
    const erp = erpDoble("pedidos_eventos", () => universo);
    await sincronizar("pedidos_eventos", erp.consultar, { limitePorPagina: 100 });
    universo = [pedido({ pedidoId: 91, fecha: "2026-10-10T20:00:00.000Z", lineas: 7 })];
    await base.db.$executeRawUnsafe(`UPDATE "CursorIngesta" SET "cursor" = NULL`);
    reloj += 31_000;
    const r = await sincronizar("pedidos_eventos", erp.consultar, { limitePorPagina: 100 });
    assert.ok(r.tipo === "SINCRONIZADO" && r.contenidoDiferente === 0, JSON.stringify(r));
    const [e] = await eventos();
    assert.deepEqual(e!.payload, { origen: universo[0]!.origen, lineas: 3 }, "la foto de la primera vez");
    const c = await cursor("pedidos_eventos");
    assert.equal(c.ultimaDiferenciaContenidoClave, null, "no es una anomalía");
  });

  it("TRANSFERENCIA_ENVIADA con otra cantidad de líneas: se conserva la primera y se anota, como siempre", async () => {
    let universo = [envio({ transferenciaId: 184, fecha: "2026-10-10T20:00:00.000Z", lineas: 3 })];
    const erp = erpDoble("envios_eventos", () => universo);
    await sincronizar("envios_eventos", erp.consultar, { limitePorPagina: 100 });
    universo = [envio({ transferenciaId: 184, fecha: "2026-10-10T20:00:00.000Z", lineas: 7 })];
    await base.db.$executeRawUnsafe(`UPDATE "CursorIngesta" SET "cursor" = NULL`);
    reloj += 31_000;
    const r = await sincronizar("envios_eventos", erp.consultar, { limitePorPagina: 100 });
    assert.ok(r.tipo === "SINCRONIZADO" && r.contenidoDiferente === 1, JSON.stringify(r));
    assert.equal(((await eventos())[0]!.payload as { lineas: number }).lineas, 3);
    assert.equal((await cursor("envios_eventos")).ultimaDiferenciaContenidoClave, universo[0]!.eventoId);
  });
});

describe("cada capacidad, su cursor", () => {
  it("las cuatro capacidades de un local avanzan por separado; la historia de una nueva no toca el backfill de otra", async () => {
    // Recepciones: el backfill completo, con la historia real de 25172fe sobre Local A.
    const recibidas = structuredClone((FIXTURES_ERP_25172FE.transferenciasEventos.sinDesde.respuesta.cuerpo.datos as { eventos: { destino: object }[] }).eventos).map(
      (e) => ({ ...e, destino: LOCAL_A }),
    );
    const r = await sincronizarTransferenciasLocal({
      db: base.db,
      instalacionId: INSTALACION,
      alcance: ALCANCE,
      consultar: async (entrada) => ({
        ok: true,
        datos: paginarEventos({ universo: recibidas as never, local: LOCAL_A, grupoId: 1, desde: entrada.desde, limite: entrada.limite }),
        requestId: "doble",
      }),
      ahora: () => reloj,
      generarId: () => `ejecucion-${++ids}`,
    });
    assert.equal(r.tipo, "SINCRONIZADO");
    const deRecepciones = await cursor("transferencias_eventos");
    // Los pedidos, recién anunciados: su propio cursor, su propio backfill.
    await sincronizar("pedidos_eventos", erpDoble("pedidos_eventos", () => HISTORIA("pedidos_eventos")).consultar, { limitePorPagina: 100 });
    assert.deepEqual(await cursor("transferencias_eventos"), deRecepciones, "el cursor de recepciones no se tocó");
    const p = await cursor("pedidos_eventos");
    assert.ok(p.backfillCompletoEn);
    // jsonb no conserva el orden de las claves: se comparan como conjunto (al ERP se le arma de nuevo, en su orden).
    assert.deepEqual(Object.keys(p.cursor as object).sort(), ["fechaSolicitud", "pedidoId"], "con las claves de SU contrato");
    const porTipo = await base.db.evento.groupBy({ by: ["tipo", "historico"], _count: true, orderBy: { tipo: "asc" } });
    // En el orden del enum, que es el de PostgreSQL.
    assert.deepEqual(
      porTipo.map((g) => [g.tipo, g.historico, g._count]),
      [
        ["TRANSFERENCIA_RECIBIDA", true, 4],
        ["PEDIDO_SOLICITADO", true, HISTORIA("pedidos_eventos").length],
      ],
    );
  });
});

describe("la base impide claves y capacidades que no son del contrato", () => {
  it("la clave de cada tipo nuevo es exactamente <TIPO>:<id>:<fecha ISO>, y la capacidad es una de las cuatro", async () => {
    const sql = (q: string) => base.db.$executeRawUnsafe(q);
    const insertar = (tipo: string, clave: string) =>
      sql(`INSERT INTO "Evento" ("instalacionId", tipo, "claveExterna", "erpLocalId", "erpReferenciaId", "fechaOperacion", "payloadVersion", payload, historico)
           VALUES ('${INSTALACION}', '${tipo}', '${clave}', 2, 91, '2026-10-10 20:00:00.000', 1, '{}', false)`);
    for (const tipo of ["PEDIDO_SOLICITADO", "TRANSFERENCIA_ENVIADA", "TRANSFERENCIA_CANCELADA"]) {
      await assert.rejects(insertar(tipo, `${tipo}:92:2026-10-10T20:00:00.000Z`), /23514/, `${tipo}: otra referencia`);
      await assert.rejects(insertar(tipo, `${tipo}:91:2026-10-10T20:00:00Z`), /23514/, `${tipo}: fecha sin milisegundos`);
      await insertar(tipo, `${tipo}:91:2026-10-10T20:00:00.000Z`);
    }
    for (const capacidad of ["pedidos_eventos", "envios_eventos", "cancelaciones_eventos"]) {
      await sql(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad) VALUES (gen_random_uuid(), '${INSTALACION}', 2, '${capacidad}')`);
    }
    await assert.rejects(
      sql(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad) VALUES (gen_random_uuid(), '${INSTALACION}', 2, 'ventas_resumen')`),
      /23514/,
    );
  });
});
