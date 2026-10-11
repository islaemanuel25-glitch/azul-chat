// CANDADOS DE LA FUNDACIÓN DE EVENTOS, CONTRA POSTGRESQL: ingesta idempotente,
// cursor compartido, arriendo, backfill e histórico, y lectura por vínculo.
//
// El ERP es un doble que pagina sobre los eventos REALES del fixture generado
// ejecutando el ERP (erp-25172fe.json, `sinDesde` y `despuesDelReset`), con las
// mismas reglas del contrato. El primer candado comprueba que ese doble
// devuelve EXACTAMENTE las páginas que devolvió el ERP: si no, todo lo demás
// probaría contra una ficción.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { construirCuerpoTransferenciasEventos, type EntradaTransferenciasEventos } from "../../src/server/erp/transferenciasEventos.ts";
import type { PrismaClient } from "@prisma/client";

import { DURACION_ARRIENDO_MS, guardarEventos, sincronizarTransferenciasLocal, type ConsultarPagina } from "../../src/server/eventos/ingesta.ts";
import { aFilaEvento } from "../../src/server/eventos/transferenciaRecibida.ts";
import { avanzarLectura, contarNoLeidos, inicializarLectura, leerLectura } from "../../src/server/eventos/lectura.ts";
import {
  type CursorTransferencias,
  type DatosTransferenciasEventos,
  type EventoTransferenciaRecibida,
  type ResultadoConsulta,
} from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { paginarEventos } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, TOKEN_PRUEBA, pedidoConToken, type Rompible } from "../ayuda/servidorErp.ts";

const TE = FIXTURES_ERP_25172FE.transferenciasEventos;
const INSTALACION = "instalacion-prueba";
const CASIANO = { grupoId: 1, localId: 3 };
const CIFRADO_DE_FORMA = `v1.${"A".repeat(16)}.${"B".repeat(40)}.${"C".repeat(22)}`;
const datosDe = (n: keyof typeof TE) => structuredClone(TE[n].respuesta.cuerpo.datos) as DatosTransferenciasEventos;
/** Los eventos reales de Casiano, en orden: 180, 181 y 182 (mismo milisegundo), 183. */
const HISTORIA = datosDe("sinDesde").eventos;
/** El 180 otra vez, después de un reset-operativo, con otra fecha. */
const DESPUES_DEL_RESET = datosDe("despuesDelReset").eventos;
const UN_CURSOR = (e: EventoTransferenciaRecibida): CursorTransferencias => ({ fechaRecepcion: e.fechaRecepcion, transferenciaId: e.transferenciaId });
/** Los tipos visibles de estos candados: solo recepciones (desde la Tanda 4B, contarNoLeidos los pide). */
const RECIBIDAS = ["TRANSFERENCIA_RECIBIDA"] as const;

/**
 * El ERP, para la ingesta: pagina sobre `universo` como el contrato —estrictamente
 * después de `desde`, `limite` por página, `siguiente` = último o el mismo
 * `desde`, `hayMas` si quedan—. Cada pedido se arma con el constructor real del
 * cliente: lo que el doble acepta, el cliente lo puede mandar.
 */
function erpDoble(universo: () => readonly EventoTransferenciaRecibida[], hasta = datosDe("sinDesde").hasta) {
  const pedidos: EntradaTransferenciasEventos[] = [];
  let respuestaForzada: ((e: EntradaTransferenciasEventos) => Promise<ResultadoConsulta<DatosTransferenciasEventos>>) | null = null;
  const consultar: ConsultarPagina = async (entrada) => {
    pedidos.push(entrada);
    assert.ok(construirCuerpoTransferenciasEventos(TOKEN_PRUEBA, entrada), "la ingesta mandó un pedido que el cliente no armaría");
    if (respuestaForzada) return respuestaForzada(entrada);
    const plantilla = datosDe("sinDesde");
    const datos = paginarEventos({ universo: universo(), local: plantilla.local, grupoId: plantilla.grupoId, desde: entrada.desde, limite: entrada.limite, hasta });
    return { ok: true, datos, requestId: "doble" };
  };
  return {
    consultar,
    pedidos,
    forzar(f: typeof respuestaForzada) {
      respuestaForzada = f;
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
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
  ids = 0;
});

const sincronizar = (consultar: ConsultarPagina, extra: Partial<Parameters<typeof sincronizarTransferenciasLocal>[0]> = {}) =>
  sincronizarTransferenciasLocal({
    db: base.db,
    instalacionId: INSTALACION,
    alcance: CASIANO,
    consultar,
    ahora: () => reloj,
    generarId: () => `ejecucion-${++ids}`,
    limitePorPagina: 2,
    maxPaginas: 1,
    ...extra,
  });
const cursor = () => base.db.cursorIngesta.findFirstOrThrow({ where: { instalacionId: INSTALACION, erpLocalId: 3 } });
const eventos = () => base.db.evento.findMany({ orderBy: { id: "asc" } });
const claves = async () => (await eventos()).map((e) => e.claveExterna);
const sql = (q: string) => base.db.$executeRawUnsafe(q);

async function vinculo(id: string, erpUsuarioId: number) {
  await sql(`INSERT INTO "Vinculo" (id, "instalacionId", "erpUsuarioId", "erpVinculoId", "tokenCifrado", "erpCanjeadoEn")
             VALUES ('${id}', '${INSTALACION}', ${erpUsuarioId}, ${erpUsuarioId + 100}, '${CIFRADO_DE_FORMA}', now())`);
  return id;
}

describe("el doble del ERP es el ERP", () => {
  it("pagina igual que el ERP real: mismas páginas que pagina1, pagina2 y vacia del fixture, para los mismos pedidos", async () => {
    const erp = erpDoble(() => HISTORIA);
    for (const n of ["pagina1", "pagina2", "vacia"] as const) {
      const p = TE[n].pedido.parametros as { desde?: CursorTransferencias; limite: number };
      const r = await erp.consultar({ alcance: CASIANO, desde: p.desde ?? null, limite: p.limite });
      assert.ok(r.ok);
      assert.deepEqual(r.datos, TE[n].respuesta.cuerpo.datos, n);
    }
  });
});

describe("ingesta: idempotencia y cursor", () => {
  it("O. guarda como cursor EXACTAMENTE el siguiente del ERP, y manda ese mismo desde en el pedido siguiente", async () => {
    const erp = erpDoble(() => HISTORIA);
    const r = await sincronizar(erp.consultar);
    assert.equal(r.tipo, "SINCRONIZADO");
    assert.deepEqual((await cursor()).cursor, datosDe("pagina1").siguiente);
    await sincronizar(erp.consultar);
    assert.deepEqual(erp.pedidos[1], { alcance: CASIANO, desde: (TE.pagina2.pedido.parametros as { desde: CursorTransferencias }).desde, limite: 2 });
    // El cuerpo que se armaría con ese pedido es, byte a byte, el que el ERP real aceptó.
    assert.equal(JSON.stringify(construirCuerpoTransferenciasEventos(TOKEN_PRUEBA, erp.pedidos[1])), pedidoConToken(TE.pagina2, TOKEN_PRUEBA));
  });

  it("A. la misma página dos veces deja una fila por evento", async () => {
    const erp = erpDoble(() => HISTORIA);
    await sincronizar(erp.consultar);
    // El cursor vuelve a vacío: el ERP entrega la misma primera página otra vez.
    await sql(`UPDATE "CursorIngesta" SET "cursor" = NULL`);
    const r = await sincronizar(erp.consultar);
    assert.equal(r.tipo, "SINCRONIZADO");
    assert.equal((r as { eventosNuevos: number }).eventosNuevos, 0);
    assert.deepEqual(await claves(), HISTORIA.slice(0, 2).map((e) => e.eventoId));
  });

  it("B. páginas solapadas no duplican", async () => {
    const erp = erpDoble(() => HISTORIA);
    await sincronizar(erp.consultar); // 180, 181
    // El cursor vuelve a una posición anterior (después del 180): la página trae 181 otra vez y el 182.
    await sql(`UPDATE "CursorIngesta" SET "cursor" = '${JSON.stringify(UN_CURSOR(HISTORIA[0]!))}'::jsonb`);
    await sincronizar(erp.consultar, { maxPaginas: 5 });
    assert.deepEqual(await claves(), HISTORIA.map((e) => e.eventoId));
  });

  it("D. el mismo transferenciaId con otra fecha (reset-operativo) es OTRO evento", async () => {
    let universo: readonly EventoTransferenciaRecibida[] = HISTORIA;
    const erp = erpDoble(() => universo, datosDe("despuesDelReset").hasta);
    await sincronizar(erp.consultar, { maxPaginas: 5 });
    universo = DESPUES_DEL_RESET;
    await sincronizar(erp.consultar);
    const del180 = (await eventos()).filter((e) => e.erpReferenciaId === 180);
    assert.deepEqual(del180.map((e) => e.claveExterna), ["TRANSFERENCIA_RECIBIDA:180:2026-10-07T12:00:00.000Z", "TRANSFERENCIA_RECIBIDA:180:2026-10-08T10:00:00.000Z"]);
  });

  it("C. la misma clave externa en otra instalación es otra fila (el unique es por instalación)", async () => {
    // La base admite una sola instalación (CHECK + índice): para ejercer el
    // unique compuesto se levantan esas dos reglas DENTRO de una transacción que
    // se deshace. Fuera de ella la base queda como estaba.
    const clave = HISTORIA[0]!.eventoId;
    const insertar = (inst: string) =>
      `INSERT INTO "Evento" ("instalacionId", tipo, "claveExterna", "erpLocalId", "erpReferenciaId", "fechaOperacion", "payloadVersion", payload, historico)
       VALUES ('${inst}', 'TRANSFERENCIA_RECIBIDA', '${clave}', 3, 180, '2026-10-07 12:00:00.000', 1, '{}', true)`;
    await assert.rejects(
      base.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DROP INDEX "Instalacion_unica_key"`);
        await tx.$executeRawUnsafe(`INSERT INTO "Instalacion" (id) VALUES ('otra-instalacion')`);
        await tx.$executeRawUnsafe(insertar(INSTALACION));
        await tx.$executeRawUnsafe(insertar("otra-instalacion"));
        const n = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Evento" WHERE "claveExterna" = '${clave}'`);
        assert.equal(n[0]!.n, 2n);
        await assert.rejects(tx.$executeRawUnsafe(insertar(INSTALACION)), /23505/);
        throw new Error("deshacer");
      }),
      /deshacer|23505/,
    );
    assert.equal((await base.db.instalacion.count()), 1, "la regla de una sola instalación quedó como estaba");
  });
});

describe("ingesta: páginas inválidas", () => {
  const rotas: [string, (d: Rompible<DatosTransferenciasEventos>) => void][] = [
    ["E. local ajeno en la respuesta", (d) => (d.local = { id: 20, nombre: "Centro" })],
    ["F. destino distinto en un evento", (d) => (d.eventos[1]!.destino = { id: 20, nombre: "Centro" })],
    ["G. eventoId mal formado", (d) => (d.eventos[0]!.eventoId = "TRANSFERENCIA_RECIBIDA:180")],
    ["H. eventoId con otra fecha", (d) => (d.eventos[1]!.eventoId = "TRANSFERENCIA_RECIBIDA:181:2026-10-07T13:30:15.000Z")],
  ];
  for (const [titulo, romper] of rotas) {
    it(`${titulo}: la página entera se rechaza, no se guarda nada y el cursor no se mueve`, async () => {
      const erp = erpDoble(() => HISTORIA);
      await sincronizar(erp.consultar); // 180, 181: el cursor ya está en algún lado
      const antes = await cursor();
      const filas = await claves();
      erp.forzar(async () => {
        const d = datosDe("pagina2") as Rompible<DatosTransferenciasEventos>;
        romper(d);
        return { ok: true, datos: d, requestId: "rota" };
      });
      const r = await sincronizar(erp.consultar);
      assert.equal(r.tipo, "RESPUESTA_INVALIDA");
      const despues = await cursor();
      assert.deepEqual(despues.cursor, antes.cursor);
      assert.equal(despues.ultimoErrorCodigo, "RESPUESTA_INVALIDA");
      assert.equal(despues.arrendadoPor, null, "el arriendo se soltó");
      assert.deepEqual(await claves(), filas);
    });
  }
});

describe("ingesta: arriendo y concurrencia", () => {
  it("I. dos sincronizaciones a la vez: una toma el arriendo y llama al ERP; la otra no", async () => {
    const erp = erpDoble(() => HISTORIA);
    let soltar!: () => void;
    const esperando = new Promise<void>((ok) => (soltar = ok));
    let llamadas = 0;
    const lenta: ConsultarPagina = async (e) => {
      llamadas++;
      await esperando;
      return erp.consultar(e);
    };
    const primera = sincronizar(lenta);
    // La segunda corre mientras la primera espera al ERP.
    while (llamadas === 0) await new Promise((r) => setImmediate(r));
    const segunda = await sincronizar(lenta);
    soltar();
    assert.equal(segunda.tipo, "OCUPADO");
    assert.equal((await primera).tipo, "SINCRONIZADO");
    assert.equal(llamadas, 1);
  });

  it("J. con un arriendo vigente de otro, no se llama al ERP", async () => {
    const erp = erpDoble(() => HISTORIA);
    await sincronizar(erp.consultar);
    await base.db.cursorIngesta.updateMany({ data: { arrendadoHasta: new Date(reloj + 10_000), arrendadoPor: "otra" } });
    const r = await sincronizar(erp.consultar);
    assert.equal(r.tipo, "OCUPADO");
    assert.equal(erp.pedidos.length, 1);
  });

  it("K. un arriendo vencido se puede tomar", async () => {
    const erp = erpDoble(() => HISTORIA);
    await sincronizar(erp.consultar);
    await base.db.cursorIngesta.updateMany({ data: { arrendadoHasta: new Date(reloj - 1), arrendadoPor: "colgada" } });
    assert.equal((await sincronizar(erp.consultar)).tipo, "SINCRONIZADO");
    assert.equal((await cursor()).arrendadoPor, null);
  });

  it("L. quien perdió el arriendo mientras esperaba al ERP no avanza el cursor ni guarda", async () => {
    const erp = erpDoble(() => HISTORIA);
    const robada: ConsultarPagina = async (e) => {
      // Mientras esta ejecución espera, su arriendo vence y otra lo toma.
      await base.db.cursorIngesta.updateMany({ data: { arrendadoHasta: new Date(reloj + DURACION_ARRIENDO_MS), arrendadoPor: "otra-ejecucion" } });
      return erp.consultar(e);
    };
    const r = await sincronizar(robada);
    assert.equal(r.tipo, "ARRIENDO_PERDIDO");
    const c = await cursor();
    assert.equal(c.cursor, null);
    assert.equal(c.arrendadoPor, "otra-ejecucion", "el arriendo ajeno no se toca");
    assert.deepEqual(await claves(), []);
  });

  it("el caso de control de L: con el arriendo propio, la misma secuencia sí guarda (L falla por el arriendo y no por otra cosa)", async () => {
    const erp = erpDoble(() => HISTORIA);
    const r = await sincronizar(async (e) => erp.consultar(e));
    assert.equal(r.tipo, "SINCRONIZADO");
    assert.equal((await claves()).length, 2);
  });
});

describe("ingesta: errores del ERP", () => {
  it("M. un fallo deja el cursor quieto, suelta el arriendo y anota el código; no reintenta", async () => {
    const erp = erpDoble(() => HISTORIA);
    await sincronizar(erp.consultar);
    const antes = await cursor();
    for (const codigo of ["NO_AUTORIZADO", "LIMITE_EXCEDIDO", "VINCULO_NO_VALIDO"] as const) {
      let llamadas = 0;
      const r = await sincronizar(async () => (llamadas++, { ok: false, origen: "erp", codigo, status: 403, requestId: "r" }));
      assert.equal(r.tipo, "FALLO_ERP");
      assert.equal(llamadas, 1, "sin reintentos");
      const c = await cursor();
      assert.deepEqual([c.cursor, c.ultimoErrorCodigo, c.arrendadoPor], [antes.cursor, codigo, null]);
      assert.ok(c.ultimoErrorEn);
    }
    for (const codigo of ["ERP_INALCANZABLE", "TIEMPO_AGOTADO"] as const) {
      const r = await sincronizar(async () => ({ ok: false, origen: "local", codigo, requestId: "r" }));
      assert.equal(r.tipo, "FALLO_ERP");
      assert.deepEqual([(await cursor()).cursor, (await cursor()).ultimoErrorCodigo], [antes.cursor, codigo]);
    }
  });

  it("N. una sincronización buena después limpia el error", async () => {
    const erp = erpDoble(() => HISTORIA);
    await sincronizar(async () => ({ ok: false, origen: "local", codigo: "ERP_INALCANZABLE", requestId: "r" }));
    assert.equal((await cursor()).ultimoErrorCodigo, "ERP_INALCANZABLE");
    await sincronizar(erp.consultar);
    const c = await cursor();
    assert.deepEqual([c.ultimoErrorCodigo, c.ultimoErrorEn], [null, null]);
  });
});

describe("ingesta: backfill e histórico", () => {
  it("P. una página con hayMas deja el backfill abierto", async () => {
    await sincronizar(erpDoble(() => HISTORIA).consultar);
    assert.equal((await cursor()).backfillCompletoEn, null);
  });

  it("Q. si la primera página ya dice hayMas: false, el backfill queda completo y esos eventos son históricos", async () => {
    await sincronizar(erpDoble(() => HISTORIA.slice(0, 1)).consultar);
    assert.ok((await cursor()).backfillCompletoEn);
    assert.deepEqual((await eventos()).map((e) => e.historico), [true]);
  });

  it("R. un backfill de varias visitas: todo es histórico, aunque la última página complete", async () => {
    const erp = erpDoble(() => HISTORIA);
    for (let i = 0; i < 3; i++) await sincronizar(erp.consultar);
    assert.ok((await cursor()).backfillCompletoEn);
    const todos = await eventos();
    assert.equal(todos.length, 4);
    assert.ok(todos.every((e) => e.historico));
  });

  it("S. lo que entra después del backfill ya no es histórico, y lo histórico no cambia", async () => {
    let universo: readonly EventoTransferenciaRecibida[] = HISTORIA;
    const erp = erpDoble(() => universo, datosDe("despuesDelReset").hasta);
    await sincronizar(erp.consultar, { maxPaginas: 5 });
    universo = [...HISTORIA, ...DESPUES_DEL_RESET];
    await sincronizar(erp.consultar);
    const todos = await eventos();
    assert.deepEqual(todos.map((e) => e.historico), [true, true, true, true, false]);
  });

  it("varias páginas en una sola sincronización, hasta su tope; lo que falta queda para la próxima", async () => {
    const erp = erpDoble(() => HISTORIA);
    const r = await sincronizar(erp.consultar, { limitePorPagina: 1, maxPaginas: 3 });
    assert.deepEqual([r.tipo, (r as { paginas?: number }).paginas, (r as { hayMas?: boolean }).hayMas], ["SINCRONIZADO", 3, true]);
    assert.equal((await claves()).length, 3);
    const r2 = await sincronizar(erp.consultar, { limitePorPagina: 1, maxPaginas: 3 });
    assert.deepEqual([(r2 as { paginas?: number }).paginas, (r2 as { hayMas?: boolean }).hayMas], [1, false]);
    assert.deepEqual(await claves(), HISTORIA.map((e) => e.eventoId));
  });
});

describe("lectura por vínculo", () => {
  /** Backfill completo sin eventos, y después el universo: lo que entra NO es histórico. */
  async function enVivo(universo: readonly EventoTransferenciaRecibida[]) {
    let u: readonly EventoTransferenciaRecibida[] = [];
    const erp = erpDoble(() => u, datosDe("despuesDelReset").hasta);
    await sincronizar(erp.consultar);
    assert.ok((await cursor()).backfillCompletoEn);
    u = universo;
    await sincronizar(erp.consultar, { maxPaginas: 10 });
    return eventos();
  }

  it("AA/AB. persona nueva: línea de base en el máximo actual del local, o 0 si no hay eventos", async () => {
    const v = await vinculo("00000000-0000-0000-0000-000000000001", 7);
    assert.equal(await inicializarLectura(base.db, v, 3), 0n, "AB. sin eventos, 0");
    const w = await vinculo("00000000-0000-0000-0000-000000000002", 8);
    const evs = await enVivo(HISTORIA);
    assert.equal(await inicializarLectura(base.db, w, 3), evs.at(-1)!.id, "AA. con eventos, el máximo");
    assert.equal(await contarNoLeidos(base.db, w, 3, RECIBIDAS), 0, "lo anterior a su primera visita es historia");
    assert.equal(await inicializarLectura(base.db, v, 3), 0n, "una línea de base ya creada no se mueve");
  });

  it("T. los históricos nunca cuentan como no leídos, aunque la lectura esté en 0", async () => {
    const v = await vinculo("00000000-0000-0000-0000-000000000001", 7);
    await sincronizar(erpDoble(() => HISTORIA).consultar, { maxPaginas: 5 });
    assert.equal(await avanzarLectura(base.db, v, 3, 0n), 0n);
    assert.equal(await contarNoLeidos(base.db, v, 3, RECIBIDAS), 0);
  });

  it("U. dos eventos del mismo milisegundo se distinguen por el id de ingesta", async () => {
    const v = await vinculo("00000000-0000-0000-0000-000000000001", 7);
    await avanzarLectura(base.db, v, 3, 0n);
    const evs = await enVivo(HISTORIA);
    const [e181, e182] = evs.filter((e) => e.erpReferenciaId === 181 || e.erpReferenciaId === 182);
    assert.equal(e181!.fechaOperacion.getTime(), e182!.fechaOperacion.getTime());
    assert.ok(e181!.id < e182!.id);
    await avanzarLectura(base.db, v, 3, e181!.id);
    assert.equal(await contarNoLeidos(base.db, v, 3, RECIBIDAS), 2, "quedan el 182 y el 183");
  });

  it("V. un evento con fecha más vieja que se conoce tarde cuenta como nuevo", async () => {
    const v = await vinculo("00000000-0000-0000-0000-000000000001", 7);
    await avanzarLectura(base.db, v, 3, 0n);
    const evs = await enVivo(HISTORIA.slice(2)); // 182 y 183
    await avanzarLectura(base.db, v, 3, evs.at(-1)!.id);
    assert.equal(await contarNoLeidos(base.db, v, 3, RECIBIDAS), 0);
    // El contrato del ERP no lo manda (el cursor lo impide); si un hecho así se
    // conoce tarde, la lectura por ingesta lo cuenta igual. Se inserta directo.
    const viejo = HISTORIA[0]!;
    await sql(`INSERT INTO "Evento" ("instalacionId", tipo, "claveExterna", "erpLocalId", "erpReferenciaId", "fechaOperacion", "payloadVersion", payload, historico)
               VALUES ('${INSTALACION}', 'TRANSFERENCIA_RECIBIDA', '${viejo.eventoId}', 3, ${viejo.transferenciaId}, '2026-10-07 12:00:00.000', 1, '{}', false)`);
    assert.equal(await contarNoLeidos(base.db, v, 3, RECIBIDAS), 1);
  });

  it("W/X. la lectura es del vínculo: la comparten sus sesiones; otro vínculo lee aparte", async () => {
    const v = await vinculo("00000000-0000-0000-0000-000000000001", 7);
    const w = await vinculo("00000000-0000-0000-0000-000000000002", 8);
    for (const [i, vid] of [[1, v], [2, v], [3, w]] as const) {
      await sql(`INSERT INTO "Sesion" (id, "idHash", "vinculoId", "expiraEn") VALUES ('00000000-0000-0000-0000-00000000010${i}', '${String(i).repeat(64)}', '${vid}', now() + interval '1 day')`);
    }
    await avanzarLectura(base.db, v, 3, 0n);
    await avanzarLectura(base.db, w, 3, 0n);
    const evs = await enVivo(HISTORIA);
    await avanzarLectura(base.db, v, 3, evs[1]!.id);
    // Dos sesiones, un vínculo: no hay lectura por sesión, así que las dos ven lo mismo.
    const deSesiones = await base.db.sesion.findMany({ where: { vinculoId: v }, select: { vinculoId: true } });
    for (const s of deSesiones) assert.equal(await leerLectura(base.db, s.vinculoId, 3), evs[1]!.id);
    assert.equal(await contarNoLeidos(base.db, v, 3, RECIBIDAS), 2);
    assert.equal(await contarNoLeidos(base.db, w, 3, RECIBIDAS), 4, "X. el otro vínculo no leyó nada");
  });

  it("Y/Z. la lectura nunca retrocede y se recorta al máximo real del local", async () => {
    const v = await vinculo("00000000-0000-0000-0000-000000000001", 7);
    await avanzarLectura(base.db, v, 3, 0n);
    const evs = await enVivo(HISTORIA);
    await avanzarLectura(base.db, v, 3, evs[2]!.id);
    assert.equal(await avanzarLectura(base.db, v, 3, evs[0]!.id), evs[2]!.id, "Y. no retrocede");
    assert.equal(await avanzarLectura(base.db, v, 3, evs.at(-1)!.id + 1000n), evs.at(-1)!.id, "Z. se recorta al máximo");
    assert.equal(await avanzarLectura(base.db, v, 20, 999n), 0n, "Z. en un local sin eventos, 0");
  });
});

describe("una clave que vuelve: identidad contra foto", () => {
  const CASIANO_LOCAL = { id: 3, nombre: "Casiano" };
  /** Una página válida por contrato con esos eventos (después de nada): siguiente = el último, sin más. */
  const pagina = (eventos: EventoTransferenciaRecibida[], local = CASIANO_LOCAL): DatosTransferenciasEventos => ({
    ...datosDe("sinDesde"),
    local,
    eventos,
    siguiente: UN_CURSOR(eventos.at(-1)!),
    hayMas: false,
  });
  /** La ingesta, con el ERP contestando SIEMPRE esa página. */
  const ingerir = (d: DatosTransferenciasEventos, alcance = CASIANO) => {
    const erp = erpDoble(() => []);
    erp.forzar(async () => ({ ok: true, datos: structuredClone(d), requestId: "forzada" }));
    return sincronizar(erp.consultar, { alcance, limitePorPagina: 10 });
  };
  const cursorDe = (erpLocalId: number) => base.db.cursorIngesta.findFirst({ where: { instalacionId: INSTALACION, erpLocalId } });
  const filaDe = (clave: string) => base.db.evento.findUnique({ where: { instalacionId_claveExterna: { instalacionId: INSTALACION, claveExterna: clave } } });
  /** El ERP vuelve a entregar desde el principio (cursor vacío). */
  const volverAlPrincipio = () => sql(`UPDATE "CursorIngesta" SET "cursor" = NULL`);
  const [E180, E181, E182] = HISTORIA as [EventoTransferenciaRecibida, EventoTransferenciaRecibida, EventoTransferenciaRecibida];
  const conPayload = (e: EventoTransferenciaRecibida, c: (x: Rompible<EventoTransferenciaRecibida>) => void) => {
    const x = structuredClone(e) as Rompible<EventoTransferenciaRecibida>;
    c(x);
    return x as EventoTransferenciaRecibida;
  };

  it("AG. la misma clave con la misma identidad y la misma foto es un duplicado: sin error ni diagnóstico", async () => {
    await ingerir(pagina([E180, E181]));
    await volverAlPrincipio();
    const r = await ingerir(pagina([E180, E181]));
    assert.deepEqual([r.tipo, (r as { eventosNuevos: number }).eventosNuevos, (r as { contenidoDiferente?: number }).contenidoDiferente], ["SINCRONIZADO", 0, 0]);
    const c = await cursorDe(3);
    assert.deepEqual([c?.ultimoErrorCodigo, c?.ultimaDiferenciaContenidoClave], [null, null]);
    assert.equal(await base.db.evento.count(), 2);
  });

  it("AH/AL/AM/AN. la misma clave guardada en el local 3 aparece en una página del local 5: EVENTO_CONTRADICTORIO, nada de la página entra, el cursor del 5 no se mueve y la fila original queda intacta", async () => {
    await ingerir(pagina([E180]));
    const original = await filaDe(E180.eventoId);
    const BELGRANO = { id: 5, nombre: "Belgrano" };
    const nuevoDel5: EventoTransferenciaRecibida = {
      ...E181,
      transferenciaId: 500,
      fechaRecepcion: "2026-10-07T13:00:00.000Z",
      eventoId: "TRANSFERENCIA_RECIBIDA:500:2026-10-07T13:00:00.000Z",
      destino: BELGRANO,
    };
    // Válida por contrato para el local 5: misma clave que el 180, destino 5, y un evento nuevo de verdad.
    const r = await ingerir(pagina([{ ...E180, destino: BELGRANO }, nuevoDel5], BELGRANO), { grupoId: 1, localId: 5 });
    assert.deepEqual(r, { tipo: "EVENTO_CONTRADICTORIO", claveExterna: E180.eventoId, paginas: 0, eventosNuevos: 0 }, "AH");
    const c5 = await cursorDe(5);
    assert.deepEqual([c5?.cursor, c5?.ultimoErrorCodigo, c5?.arrendadoPor], [null, "EVENTO_CONTRADICTORIO", null], "AL: el cursor del 5 quieto, el error anotado, el arriendo suelto");
    assert.ok(c5?.ultimoErrorEn);
    assert.equal(await filaDe(nuevoDel5.eventoId), null, "AM: el evento nuevo de la misma página tampoco entró");
    assert.equal(await base.db.evento.count(), 1);
    assert.deepEqual(await filaDe(E180.eventoId), original, "AN: la fila original, igual en todo");
  });

  it("AI/AJ. otra referencia u otra fecha bajo la misma clave no llegan a guardarse: el contrato las rechaza antes, y la base también", async () => {
    await ingerir(pagina([E180]));
    await volverAlPrincipio();
    for (const roto of [{ ...E180, transferenciaId: 999 }, { ...E180, fechaRecepcion: "2026-10-07T12:00:00.001Z" }]) {
      const r = await ingerir(pagina([roto]));
      assert.equal(r.tipo, "RESPUESTA_INVALIDA");
    }
    // Y si alguien intentara guardarla igual, saltándose el contrato, la base no la acepta ni la confunde con un duplicado.
    const fila = { ...aFilaEvento(E180), erpReferenciaId: 999 };
    await assert.rejects(base.db.$transaction((tx) => guardarEventos(tx, INSTALACION, [fila], false)));
    assert.equal(await base.db.evento.count(), 1);
  });

  for (const [codigo, titulo, cambio] of [
    ["AO", "tieneDiferencias distinto", (x: Rompible<EventoTransferenciaRecibida>) => (x.tieneDiferencias = !x.tieneDiferencias)],
    ["AP", "lineasConDiferencia distinto", (x: Rompible<EventoTransferenciaRecibida>) => (x.lineasConDiferencia += 2)],
    ["AQ", "nombre del origen distinto (un depósito renombrado)", (x: Rompible<EventoTransferenciaRecibida>) => (x.origen.nombre = "Depósito Norte")],
    ["AR", "nombre del destino distinto (un local renombrado)", (x: Rompible<EventoTransferenciaRecibida>) => (x.destino.nombre = "Casiano Casas")],
  ] as const) {
    it(`${codigo}/AS/AT/AU. misma identidad y ${titulo}: se conserva la primera foto, queda el diagnóstico, el cursor avanza y lo nuevo de la página entra`, async () => {
      await ingerir(pagina([E180, E181]));
      const original = await filaDe(E181.eventoId);
      await volverAlPrincipio();
      const r = await ingerir(pagina([E180, conPayload(E181, cambio), E182]));
      assert.deepEqual(
        [r.tipo, (r as { eventosNuevos: number }).eventosNuevos, (r as { contenidoDiferente?: number }).contenidoDiferente],
        ["SINCRONIZADO", 1, 1],
        "no es contradicción: la página se guardó",
      );
      assert.deepEqual(await filaDe(E181.eventoId), original, `${codigo}: la primera foto, intacta`);
      const c = await cursorDe(3);
      assert.deepEqual([c?.ultimaDiferenciaContenidoClave, c?.ultimoErrorCodigo], [E181.eventoId, null], "AS: diagnóstico sí, error no");
      assert.ok(c?.ultimaDiferenciaContenidoEn);
      assert.deepEqual(c?.cursor, UN_CURSOR(E182), "AT: el cursor avanzó");
      assert.ok(await filaDe(E182.eventoId), "AU: el evento nuevo de la misma página entró");
    });
  }

  it("el diagnóstico de contenido no se borra con una sincronización buena posterior (es historia, no un error)", async () => {
    await ingerir(pagina([E180]));
    await volverAlPrincipio();
    await ingerir(pagina([conPayload(E180, (x) => (x.destino.nombre = "Casiano Casas"))]));
    await volverAlPrincipio();
    await ingerir(pagina([E180, E181]));
    const c = await cursorDe(3);
    assert.deepEqual([c?.ultimaDiferenciaContenidoClave, c?.ultimoErrorCodigo], [E180.eventoId, null]);
  });

  it("AW. dos transacciones guardan la misma página a la vez: la segunda espera, el índice único decide y no hay error falso", async () => {
    const filas = [aFilaEvento(E180), aFilaEvento(E181)];
    let insertoLaPrimera!: () => void;
    const primeraInserto = new Promise<void>((ok) => (insertoLaPrimera = ok));
    let soltarPrimera!: () => void;
    const puedeTerminar = new Promise<void>((ok) => (soltarPrimera = ok));
    const primera = base.db.$transaction(async (tx) => {
      const r = await guardarEventos(tx, INSTALACION, filas, false);
      insertoLaPrimera();
      await puedeTerminar; // la transacción sigue abierta con las filas sin confirmar
      return r;
    });
    await primeraInserto;
    // La segunda choca con filas sin confirmar: su INSERT espera a que la primera termine.
    const segunda = base.db.$transaction((tx) => guardarEventos(tx, INSTALACION, filas, false));
    await new Promise((r) => setTimeout(r, 100));
    soltarPrimera();
    const [a, b] = await Promise.all([primera, segunda]);
    assert.deepEqual(a, { creados: 2, contenidoDiferente: [] });
    assert.deepEqual(b, { creados: 0, contenidoDiferente: [] }, "la segunda vio las filas confirmadas y las comparó: duplicado legítimo");
    assert.equal(await base.db.evento.count(), 2);
  });
});

describe("coberturas de la revisión", () => {
  /** La base, con UNA operación rota a propósito. */
  function conFalla(db: PrismaClient, que: "$transaction" | "cursorIngesta.findUnique"): PrismaClient {
    return new Proxy(db, {
      get(objetivo, prop, receptor) {
        if (que === "$transaction" && prop === "$transaction") return () => Promise.reject(new Error("falla simulada"));
        if (que === "cursorIngesta.findUnique" && prop === "cursorIngesta") {
          const real = objetivo.cursorIngesta;
          return new Proxy(real, {
            get: (o, p) => (p === "findUnique" ? () => Promise.reject(new Error("falla simulada")) : (Reflect.get(o, p) as (...a: unknown[]) => unknown).bind(o)),
          });
        }
        const v = Reflect.get(objetivo, prop, receptor);
        return typeof v === "function" ? v.bind(objetivo) : v;
      },
    });
  }

  it("la base falla DESPUÉS de una respuesta válida: el cursor no avanza, no quedan eventos y el arriendo se suelta", async () => {
    const erp = erpDoble(() => HISTORIA);
    await sincronizar(erp.consultar);
    const antes = await cursor();
    const filas = await claves();
    const r = await sincronizarTransferenciasLocal({
      db: conFalla(base.db, "$transaction"),
      instalacionId: INSTALACION,
      alcance: CASIANO,
      consultar: erp.consultar,
      ahora: () => reloj,
      generarId: () => "con-falla",
      limitePorPagina: 2,
      maxPaginas: 1,
    });
    assert.equal(r.tipo, "FALLA_LOCAL");
    const c = await cursor();
    assert.deepEqual([c.cursor, c.arrendadoPor, c.ultimoErrorCodigo], [antes.cursor, null, "FALLA_LOCAL"]);
    assert.deepEqual(await claves(), filas);
  });

  it("un backfill que llega al tope de 3 páginas con hayMas: guarda el cursor de la tercera, sigue abierto y todo es histórico", async () => {
    const r = await sincronizar(erpDoble(() => HISTORIA).consultar, { limitePorPagina: 1, maxPaginas: 3 });
    assert.deepEqual([r.tipo, (r as { hayMas?: boolean }).hayMas], ["SINCRONIZADO", true]);
    const c = await cursor();
    assert.deepEqual(c.cursor, UN_CURSOR(HISTORIA[2]!));
    assert.equal(c.backfillCompletoEn, null);
    const todos = await eventos();
    assert.equal(todos.length, 3);
    assert.ok(todos.every((e) => e.historico));
  });

  it("si la base falla justo después de tomar el arriendo, se suelta (solo el propio)", async () => {
    const r = await sincronizarTransferenciasLocal({
      db: conFalla(base.db, "cursorIngesta.findUnique"),
      instalacionId: INSTALACION,
      alcance: CASIANO,
      consultar: erpDoble(() => HISTORIA).consultar,
      ahora: () => reloj,
      generarId: () => "temprana",
      limitePorPagina: 2,
      maxPaginas: 1,
    });
    assert.equal(r.tipo, "FALLA_LOCAL");
    const c = await cursor();
    assert.deepEqual([c.arrendadoPor, c.arrendadoHasta], [null, null]);
  });
});

describe("lo que sostiene la base", () => {
  const CHECK = "23514";
  const UNICO = "23505";
  const CLAVE_AJENA = "23503";
  const rechaza = (q: string, codigo: string) => assert.rejects(sql(q), (e: Error) => e.message.includes(`Code: \`${codigo}\``), q);
  const insertarEvento = (clave: string, payload = "'{}'") =>
    `INSERT INTO "Evento" ("instalacionId", tipo, "claveExterna", "erpLocalId", "erpReferenciaId", "fechaOperacion", "payloadVersion", payload, historico)
     VALUES ('${INSTALACION}', 'TRANSFERENCIA_RECIBIDA', '${clave}', 3, 180, '2026-10-07 12:00:00.000', 1, ${payload}, true)`;
  const CLAVE = "TRANSFERENCIA_RECIBIDA:180:2026-10-07T12:00:00.000Z";

  it("AC. un payload que no es objeto no entra", async () => {
    for (const p of ["'[]'", "'\"x\"'", "'1'", "'null'"]) await rechaza(insertarEvento(CLAVE, p), CHECK);
  });
  it("AD. una clave externa repetida no entra", async () => {
    await sql(insertarEvento(CLAVE));
    await rechaza(insertarEvento(CLAVE), UNICO);
  });
  it("la clave externa tiene que coincidir con el id y la fecha de la fila", async () => {
    await rechaza(insertarEvento("TRANSFERENCIA_RECIBIDA:181:2026-10-07T12:00:00.000Z"), CHECK);
    await rechaza(insertarEvento("TRANSFERENCIA_RECIBIDA:180:2026-10-07T12:00:00Z"), CHECK);
    await rechaza(insertarEvento("OTRO:180:2026-10-07T12:00:00.000Z"), CHECK);
  });
  it("AE. no se borra una instalación con eventos o cursores, ni un vínculo con lecturas", async () => {
    await sql(insertarEvento(CLAVE));
    await rechaza(`DELETE FROM "Instalacion"`, CLAVE_AJENA);
    await sql(`DELETE FROM "Evento"`);
    await sql(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad) VALUES ('c1', '${INSTALACION}', 3, 'transferencias_eventos')`);
    await rechaza(`DELETE FROM "Instalacion"`, CLAVE_AJENA);
    const v = await vinculo("00000000-0000-0000-0000-000000000001", 7);
    await avanzarLectura(base.db, v, 3, 0n);
    await rechaza(`DELETE FROM "Vinculo"`, CLAVE_AJENA);
  });
  it("el arriendo y su dueño van juntos; el error y su fecha también; una sola capacidad conocida", async () => {
    await sql(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad) VALUES ('c1', '${INSTALACION}', 3, 'transferencias_eventos')`);
    await rechaza(`UPDATE "CursorIngesta" SET "arrendadoHasta" = now()`, CHECK);
    await rechaza(`UPDATE "CursorIngesta" SET "arrendadoPor" = 'x'`, CHECK);
    await rechaza(`UPDATE "CursorIngesta" SET "ultimoErrorCodigo" = 'X'`, CHECK);
    await rechaza(`UPDATE "CursorIngesta" SET "cursor" = '[]'::jsonb`, CHECK);
    await rechaza(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad) VALUES ('c2', '${INSTALACION}', 3, 'ventas_resumen')`, CHECK);
    await rechaza(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad) VALUES ('c3', '${INSTALACION}', 3, 'transferencias_eventos')`, UNICO);
  });
});
