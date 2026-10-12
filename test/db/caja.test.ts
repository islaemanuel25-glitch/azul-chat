// CANDADOS DE GET /api/chats/caja (Tanda 7B), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// sesión real (vincular con un código del ERP de mentira) → `mi_alcance` vivo →
// el local anuncia `cajas_resumen` → `cajas_resumen` con período "hoy" →
// respuesta. El ERP es test/ayuda/erpConEstado.ts: `mi_alcance` del fixture
// del ERP 25172fe (al que se le suma `cajas_resumen` donde el test lo dice) y,
// para cajas, el día del fixture del ERP 14ae247 o un error real. Ningún test
// llama al ERP real.
//
// La forma de la consulta (400) y la copia campo por campo están en
// test/unidad/cajasChats.test.ts.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { manejarCaja, manejarChats, manejarLocal } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { RespuestaCaja, RespuestaLocal } from "../../src/shared/chats/api.ts";
import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { ADMINISTRADORES_DE_PRUEBA } from "../ayuda/accesos.ts";
import { cajasDelDiaDelFixture } from "../ayuda/cajas.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { ERRORES_ERP, FIXTURES_ERP_14AE247, FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

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
  erp.respuestasCajas.length = 0;
  erp.respuestaParaCapacidad.clear();
  erp.ponerModo("normal");
  erp.cupo.desactivar();
  erp.alcances.clear();
  erp.alcances.set(ADMIN, alcance("adminGlobal"));
  erp.alcances.set(ENCARGADO, alcance("encargado"));
  // El mi_alcance de 25172fe es anterior a cajas_resumen: el encargado la recibe en Casiano, como la tesorera del fixture 14ae247.
  sumarCapacidad(ENCARGADO, CASIANO, "cajas_resumen");
  registros = [];
});

function deps(timeoutMs = 2000): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  return {
    config: leerConfigAzulChat({ AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE, AZUL_CHAT_ADMINISTRADORES: ADMINISTRADORES_DE_PRUEBA }),
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

async function caja(cookie: string | null, localId: number, d = deps()) {
  const res = await manejarCaja(new Request(`${ORIGEN}/api/chats/caja?localId=${localId}`, { headers: conCookie(cookie) }), d);
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: JSON.parse(texto) as RespuestaCaja, res };
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

describe("GET /api/chats/caja: autorizado", () => {
  it("7B-1. local con cajas_resumen hoy: las cajas del día del ERP, tal cual, por turno, con el nombre de mi_alcance", async () => {
    const enc = await vincular(ENCARGADO);
    const antes = await volcado();
    const r = await caja(enc, CASIANO);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.cuerpo, { estado: "OK", ...cajasDelDiaDelFixture("hoy"), local: { id: CASIANO, nombre: "Casiano" } });
    assert.equal(r.res.headers.get("set-cookie"), null);
    // Nada se guarda: ni eventos, ni cursor, ni lectura, ni preguntas.
    assert.equal(await volcado(), antes);
  });

  it("7B-2. cupo: 1 mi_alcance + 1 cajas_resumen; el grupo de mi_alcance, período hoy, SIN turno ni nada del usuario; sin reintentos", async () => {
    const enc = await vincular(ENCARGADO);
    erp.recibidas.length = 0;
    await caja(enc, CASIANO);
    assert.deepEqual(erp.cuerposA("consultar").map((c) => c.capacidad), ["mi_alcance", "cajas_resumen"]);
    const [pedida] = consultas("cajas_resumen");
    assert.deepEqual(pedida!.alcance, { grupoId: 1, localId: CASIANO });
    assert.deepEqual(pedida!.parametros, { periodo: { tipo: "hoy" } });
    assert.deepEqual(Object.keys(pedida!).sort(), ["alcance", "capacidad", "delegacion", "parametros"]);
  });

  it("7B-3. chats/local anuncia `caja` solo si el mi_alcance de AHORA trae cajas_resumen en ese local; anunciar no consulta", async () => {
    const enc = await vincular(ENCARGADO);
    const anuncia = async () => {
      const res = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${CASIANO}`, { headers: conCookie(enc) }), deps());
      assert.equal(res.status, 200);
      return ((await res.json()) as Extract<RespuestaLocal, { estado: "OK" }>).local.caja;
    };
    assert.equal(await anuncia(), true);
    quitarCapacidad(ENCARGADO, CASIANO, "cajas_resumen");
    assert.equal(await anuncia(), false);
    assert.equal(consultas("cajas_resumen").length, 0);
  });
});

describe("GET /api/chats/caja: sin la capacidad", () => {
  it("7B-4. local en el alcance SIN cajas_resumen: 403 NO_AUTORIZADO y el ERP no recibe cajas_resumen", async () => {
    const adm = await vincular(ADMIN);
    const r = await caja(adm, CASIANO);
    assert.equal(r.status, 403);
    assert.deepEqual(r.cuerpo, { estado: "NO_AUTORIZADO" });
    assert.equal(consultas("cajas_resumen").length, 0);
  });

  it("7B-5. la autorización es de AHORA: la capacidad que el ERP deja de anunciar se deja de aceptar, con la misma sesión", async () => {
    const enc = await vincular(ENCARGADO);
    assert.equal((await caja(enc, CASIANO)).status, 200);
    quitarCapacidad(ENCARGADO, CASIANO, "cajas_resumen");
    assert.equal((await caja(enc, CASIANO)).status, 403);
  });

  it("sin cookie: 401 SIN_SESION, sin llamar al ERP", async () => {
    const r = await caja(null, CASIANO);
    assert.equal(r.status, 401);
    assert.equal(erp.recibidas.length, 0);
  });
});

describe("GET /api/chats/caja: el ERP no da una respuesta buena", () => {
  it("7B-6. ERP caído al consultar cajas: 503 ERP_NO_DISPONIBLE, sin reintentos, y la sesión sigue", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasCajas.push(error("INTEGRACION_NO_DISPONIBLE"));
    const r = await caja(enc, CASIANO);
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    assert.equal(consultas("cajas_resumen").length, 1, "sin reintentos");
    assert.ok(await sesionViva(enc));
  });

  it("7B-7. cupo del ERP lleno en cajas: 429 ERP_CUPO_EXCEDIDO, su estado propio", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasCajas.push(error("LIMITE_EXCEDIDO"));
    const r = await caja(enc, CASIANO);
    assert.equal(r.status, 429);
    assert.deepEqual(r.cuerpo, { estado: "ERP_CUPO_EXCEDIDO" });
    assert.ok(await sesionViva(enc));
  });

  it("7B-7b. con el cupo real del ERP: dos consultas por toque, y la que pasa el cupo es ERP_CUPO_EXCEDIDO", async () => {
    const enc = await vincular(ENCARGADO);
    erp.cupo.activar({ maxPorUsuario: 3 });
    assert.equal((await caja(enc, CASIANO)).status, 200, "mi_alcance + cajas_resumen = 2 de 3");
    const r = await caja(enc, CASIANO);
    assert.equal(r.status, 429, "la tercera (cajas_resumen) ya no entra");
    assert.deepEqual(r.cuerpo, { estado: "ERP_CUPO_EXCEDIDO" });
    assert.equal(erp.cupo.rechazos(), 1);
  });

  it("7B-8. TURNO_OPERATIVO_INVALIDO (no debería venir: no se pide turno): 503 ERP_NO_DISPONIBLE, sin revocar nada", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasCajas.push(FIXTURES_ERP_14AE247.rechazos.turnoInexistente.respuesta);
    const r = await caja(enc, CASIANO);
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    assert.ok(await sesionViva(enc));
    assert.equal(registros.some((x) => x.evento === "vinculo.invalidado"), false);
  });

  it("7B-9. NO_AUTORIZADO del ERP (mi_alcance lo anunció): 503, como ventas; VINCULO_NO_VALIDO: 401 y vínculo invalidado", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasCajas.push(error("NO_AUTORIZADO"));
    assert.deepEqual((await caja(enc, CASIANO)).cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    erp.respuestasCajas.push(error("VINCULO_NO_VALIDO"));
    const r = await caja(enc, CASIANO);
    assert.equal(r.status, 401);
    assert.deepEqual(r.cuerpo, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" });
    assert.equal(await sesionViva(enc), false);
  });

  it("7B-10. respuesta de otro local, de otro día o con forma inválida: 503, sin mostrar números", async () => {
    const enc = await vincular(ENCARGADO);
    const real = FIXTURES_ERP_14AE247.dia.hoy.respuesta.cuerpo.datos as Record<string, unknown>;
    const rotas: unknown[] = [
      { ok: true, datos: real }, // es del local 1 del fixture, no de Casiano (3)
      { ok: true, datos: { ...real, local: { id: CASIANO, nombre: "Casiano" }, periodo: { ...(real.periodo as object), tipo: "ayer" } } },
      { ok: true, datos: { ...real, local: { id: CASIANO, nombre: "Casiano" }, turnosOperativos: [{ turnoOperativo: { id: 1, nombre: "Mañana" } }] } },
      { ok: true },
    ];
    for (const cuerpo of rotas) {
      erp.respuestasCajas.push({ status: 200, cuerpo });
      const r = await caja(enc, CASIANO);
      assert.equal(r.status, 503, JSON.stringify(cuerpo).slice(0, 80));
      assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    }
  });

  it("CENTRO (otro grupo) sin la capacidad para el encargado: fuera de alcance, 403", async () => {
    const enc = await vincular(ENCARGADO);
    assert.equal((await caja(enc, CENTRO)).status, 403);
  });
});
