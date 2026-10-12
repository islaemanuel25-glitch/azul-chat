// CANDADOS DE GET /api/chats/stock (Tanda 8B), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// sesión real (vincular con un código del ERP de mentira) → `mi_alcance` vivo →
// el local anuncia `stock_consulta` → `stock_consulta` en modo bajo_minimo →
// respuesta. El ERP es test/ayuda/erpConEstado.ts: `mi_alcance` del fixture
// del ERP 25172fe (al que se le suma `stock_consulta` donde el test lo dice) y,
// para stock, el caso del fixture del ERP 41f702b o un error real. Ningún test
// llama al ERP real.
//
// La forma de la consulta (400) y la copia campo por campo están en
// test/unidad/stockChats.test.ts.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { manejarChats, manejarLocal, manejarStock } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { RespuestaLocal, RespuestaStock } from "../../src/shared/chats/api.ts";
import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { ERRORES_ERP, FIXTURES_ERP_25172FE, FIXTURES_ERP_41F702B, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";
import { bajoMinimoDelFixture } from "../ayuda/stock.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const MA = FIXTURES_ERP_25172FE.miAlcance;
const alcance = (n: "adminGlobal" | "encargado" | "cajero") => structuredClone(MA[n].respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>;

const ADMIN = 9;
const ENCARGADO = 11;
const CASIANO = 3;
const CENTRO = 20;

let base: BaseDescartable;
let erp: ErpConEstado;
let registros: Registro[];

before(async () => {
  base = await crearBaseDescartable();
  erp = await levantarErpConEstado();
});
after(async () => {
  await erp?.cerrar();
  await base?.borrar();
});
beforeEach(async () => {
  await base.vaciar();
  erp.recibidas.length = 0;
  erp.respuestasStock.length = 0;
  erp.respuestaParaCapacidad.clear();
  erp.ponerModo("normal");
  erp.cupo.desactivar();
  erp.alcances.clear();
  erp.alcances.set(ADMIN, alcance("adminGlobal"));
  erp.alcances.set(ENCARGADO, alcance("encargado"));
  // El mi_alcance de 25172fe es anterior a stock_consulta: el encargado la recibe en Casiano, como en el fixture 41f702b.
  sumarCapacidad(ENCARGADO, CASIANO, "stock_consulta");
  registros = [];
});

function deps(timeoutMs = 2000): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  return {
    config: leerConfigAzulChat({ AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE }),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: Date.now,
    registrar,
    generarRequestId: randomUUID,
  };
}

const conCookie = (cookie: string | null): Record<string, string> => (cookie ? { cookie: `${NOMBRE_COOKIE}=${cookie}` } : {});

async function vincular(usuarioId: number): Promise<string> {
  const res = await manejarVincular(
    new Request(`${ORIGEN}/api/sesion/vincular`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, "x-forwarded-for": "203.0.113.1" },
      body: JSON.stringify({ codigo: erp.emitirCodigo(usuarioId) }),
    }),
    deps(),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const m = new RegExp(`^${NOMBRE_COOKIE}=([^;]*)`).exec(res.headers.get("set-cookie") ?? "");
  assert.ok(m?.[1]);
  return m[1];
}

async function stock(cookie: string | null, localId: number, d = deps()) {
  const res = await manejarStock(new Request(`${ORIGEN}/api/chats/stock?localId=${localId}`, { headers: conCookie(cookie) }), d);
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: JSON.parse(texto) as RespuestaStock, res };
}

const consultas = (capacidad: string) => erp.cuerposA("consultar").filter((c) => c.capacidad === capacidad);

function localDe(usuarioId: number, localId: number) {
  const a = erp.alcances.get(usuarioId) as Rompible<DatosMiAlcance>;
  const l = a.locales.find((x) => x.id === localId);
  assert.ok(l, `el alcance no tiene el local ${localId}`);
  return l;
}
function sumarCapacidad(usuarioId: number, localId: number, capacidad: string) {
  const l = localDe(usuarioId, localId);
  l.capacidades = [...(l.capacidades ?? []), capacidad] as never;
}
function quitarCapacidad(usuarioId: number, localId: number, capacidad: string) {
  const l = localDe(usuarioId, localId);
  l.capacidades = (l.capacidades ?? []).filter((c) => c !== capacidad) as never;
}

/** Lo que guardan todas las tablas de Azul Chat menos las de sesión, como texto. */
async function volcado(): Promise<string> {
  const [fila] = await base.db.$queryRawUnsafe<{ x: string }[]>(
    `SELECT json_build_object(
       'e', (SELECT json_agg(t ORDER BY t.id) FROM "Evento" t),
       'c', (SELECT json_agg(t ORDER BY t.id) FROM "CursorIngesta" t),
       'l', (SELECT json_agg(t ORDER BY t."vinculoId", t."erpLocalId") FROM "LecturaLocal" t),
       'p', (SELECT json_agg(t ORDER BY t.id) FROM "Pregunta" t))::text AS x`,
  );
  return fila!.x;
}

const error = (codigo: string) => {
  const e = ERRORES_ERP[codigo];
  assert.ok(e, `el fixture no tiene ${codigo}`);
  return { status: e.status, cuerpo: e.cuerpo };
};

async function sesionViva(cookie: string): Promise<boolean> {
  const res = await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps());
  return res.status === 200;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/chats/stock: autorizado", () => {
  it("8B-1. local con stock_consulta: los bajo mínimo del ERP, tal cual, con el nombre de mi_alcance; nada se guarda", async () => {
    const enc = await vincular(ENCARGADO);
    const antes = await volcado();
    const r = await stock(enc, CASIANO);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.cuerpo, { estado: "OK", ...bajoMinimoDelFixture({ id: CASIANO, nombre: "Casiano" }) });
    assert.equal(r.res.headers.get("set-cookie"), null);
    assert.equal(await volcado(), antes);
  });

  it("8B-2. cupo: 1 mi_alcance + 1 stock_consulta; el grupo de mi_alcance, modo bajo_minimo, SIN texto ni nada del usuario", async () => {
    const enc = await vincular(ENCARGADO);
    erp.recibidas.length = 0;
    await stock(enc, CASIANO);
    assert.deepEqual(erp.cuerposA("consultar").map((c) => c.capacidad), ["mi_alcance", "stock_consulta"]);
    const [pedida] = consultas("stock_consulta");
    assert.deepEqual(pedida!.alcance, { grupoId: 1, localId: CASIANO });
    assert.deepEqual(pedida!.parametros, { modo: "bajo_minimo" });
    assert.deepEqual(Object.keys(pedida!).sort(), ["alcance", "capacidad", "delegacion", "parametros"]);
  });

  it("8B-3. STOCK_MINIMO_NO_DISPONIBLE no es una falla: 200 con sinMinimo, y la sesión sigue", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasStock.push(FIXTURES_ERP_41F702B.bajoMinimo.stockMinimoNoDisponible.respuesta);
    const r = await stock(enc, CASIANO);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.cuerpo, { estado: "OK", local: { id: CASIANO, nombre: "Casiano" }, sinMinimo: true });
    assert.ok(await sesionViva(enc));
  });

  it("8B-4. chats/local anuncia `stock` solo si el mi_alcance de AHORA trae stock_consulta en ese local; anunciar no consulta", async () => {
    const enc = await vincular(ENCARGADO);
    const anuncia = async () => {
      const res = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${CASIANO}`, { headers: conCookie(enc) }), deps());
      assert.equal(res.status, 200);
      return ((await res.json()) as Extract<RespuestaLocal, { estado: "OK" }>).local.stock;
    };
    assert.equal(await anuncia(), true);
    quitarCapacidad(ENCARGADO, CASIANO, "stock_consulta");
    assert.equal(await anuncia(), false);
    assert.equal(consultas("stock_consulta").length, 0);
  });
});

describe("GET /api/chats/stock: sin la capacidad", () => {
  it("8B-5. local en el alcance SIN stock_consulta: 403 NO_AUTORIZADO y el ERP no recibe stock_consulta", async () => {
    const adm = await vincular(ADMIN);
    const r = await stock(adm, CASIANO);
    assert.equal(r.status, 403);
    assert.deepEqual(r.cuerpo, { estado: "NO_AUTORIZADO" });
    assert.equal(consultas("stock_consulta").length, 0);
  });

  it("8B-6. la autorización es de AHORA: la capacidad que el ERP deja de anunciar se deja de aceptar, con la misma sesión", async () => {
    const enc = await vincular(ENCARGADO);
    assert.equal((await stock(enc, CASIANO)).status, 200);
    quitarCapacidad(ENCARGADO, CASIANO, "stock_consulta");
    assert.equal((await stock(enc, CASIANO)).status, 403);
  });

  it("sin cookie: 401 SIN_SESION, sin llamar al ERP; otro grupo: 403", async () => {
    assert.equal((await stock(null, CASIANO)).status, 401);
    assert.equal(erp.recibidas.length, 0);
    const enc = await vincular(ENCARGADO);
    assert.equal((await stock(enc, CENTRO)).status, 403);
  });
});

describe("GET /api/chats/stock: el ERP no da una respuesta buena", () => {
  it("8B-7. ERP caído: 503 ERP_NO_DISPONIBLE, sin reintentos, y la sesión sigue", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasStock.push(error("INTEGRACION_NO_DISPONIBLE"));
    const r = await stock(enc, CASIANO);
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    assert.equal(consultas("stock_consulta").length, 1, "sin reintentos");
    assert.ok(await sesionViva(enc));
  });

  it("8B-8. cupo del ERP lleno: 429 ERP_CUPO_EXCEDIDO, su estado propio; con el cupo real, el segundo toque", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasStock.push(error("LIMITE_EXCEDIDO"));
    const r = await stock(enc, CASIANO);
    assert.deepEqual([r.status, r.cuerpo], [429, { estado: "ERP_CUPO_EXCEDIDO" }]);
    erp.cupo.activar({ maxPorUsuario: 3 });
    assert.equal((await stock(enc, CASIANO)).status, 200, "mi_alcance + stock_consulta = 2 de 3");
    const r2 = await stock(enc, CASIANO);
    assert.deepEqual([r2.status, r2.cuerpo], [429, { estado: "ERP_CUPO_EXCEDIDO" }]);
  });

  it("8B-9. NO_AUTORIZADO del ERP: 503; VINCULO_NO_VALIDO: 401 y vínculo invalidado", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasStock.push(error("NO_AUTORIZADO"));
    assert.deepEqual((await stock(enc, CASIANO)).cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    erp.respuestasStock.push(error("VINCULO_NO_VALIDO"));
    const r = await stock(enc, CASIANO);
    assert.deepEqual([r.status, r.cuerpo], [401, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" }]);
    assert.equal(await sesionViva(enc), false);
  });

  it("8B-10. respuesta de otro local, de otro modo o con forma inválida: 503, sin mostrar nada", async () => {
    const enc = await vincular(ENCARGADO);
    const real = FIXTURES_ERP_41F702B.bajoMinimo.conFaltantes.respuesta.cuerpo.datos as Record<string, unknown>;
    const deCasiano = { ...real, local: { id: CASIANO, nombre: "Casiano", esDeposito: false } };
    const rotas: unknown[] = [
      { ok: true, datos: real }, // es del local 1 del fixture, no de Casiano (3)
      { ok: true, datos: { ...(FIXTURES_ERP_41F702B.producto.variasCoincidencias.respuesta.cuerpo.datos as object), local: deCasiano.local } },
      { ok: true, datos: { ...deCasiano, total: 0 } },
      { ok: true },
    ];
    for (const cuerpo of rotas) {
      erp.respuestasStock.push({ status: 200, cuerpo });
      const r = await stock(enc, CASIANO);
      assert.deepEqual([r.status, r.cuerpo], [503, { estado: "ERP_NO_DISPONIBLE" }], JSON.stringify(cuerpo).slice(0, 80));
    }
    // CONTRAPRUEBA: la misma respuesta, de Casiano, sí se muestra.
    erp.respuestasStock.push({ status: 200, cuerpo: { ok: true, datos: deCasiano } });
    assert.equal((await stock(enc, CASIANO)).status, 200);
  });
});
