// CANDADOS DE GET /api/chats/ventas (Tanda 3A), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// sesión real (vincular con un código del ERP de mentira) → `mi_alcance` vivo →
// el local anuncia `ventas_resumen` → `ventas_resumen` con período "hoy" →
// respuesta. El ERP es test/ayuda/erpConEstado.ts con los `mi_alcance` de los
// fixtures generados ejecutando el ERP 25172fe y, para ventas, DATOS_ERP (la
// salida real de armarVentasResumen) o un error del fixture del ERP 8920516.
// Ningún test llama al ERP real.
//
// La ruta se ejerce por su manejador (src/app solo delega) con un Request HTTP
// y la cookie de una sesión de verdad. La forma de la consulta (400) y la
// respuesta pública campo por campo están en test/unidad/ventasChats.test.ts.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { manejarChats, manejarLocal, manejarVentas } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { RespuestaLocal, RespuestaVentas } from "../../src/shared/chats/api.ts";
import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { DATOS_ERP, FIXTURES_ERP, FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const MA = FIXTURES_ERP_25172FE.miAlcance;
const alcance = (n: "adminGlobal" | "encargado" | "cajero") => structuredClone(MA[n].respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>;

/** Personas del ERP de mentira. */
const ADMIN = 9;
const ENCARGADO = 11;
const CAJERO = 12;

/** Encargado: solo Casiano (3, grupo 1) con ventas_resumen. Cajero: Casiano sin capacidades. Admin: 5, 3, 9 (grupo 1) y 20 (grupo 2). */
const CASIANO = 3;
const DEPOSITO = 9;
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
  erp.respuestasVentas.length = 0;
  erp.ponerModo("normal");
  erp.alcances.clear();
  erp.alcances.set(ADMIN, alcance("adminGlobal"));
  erp.alcances.set(ENCARGADO, alcance("encargado"));
  erp.alcances.set(CAJERO, alcance("cajero"));
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

async function ventas(cookie: string | null, localId: number, d = deps()) {
  const res = await manejarVentas(new Request(`${ORIGEN}/api/chats/ventas?localId=${localId}`, { headers: conCookie(cookie) }), d);
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: JSON.parse(texto) as Extract<RespuestaVentas, { estado: "OK" }>, res };
}

/** Las consultas que llegaron al ERP con esa capacidad. */
const consultas = (capacidad: string) => erp.cuerposA("consultar").filter((c) => c.capacidad === capacidad);

/** Cambia las capacidades de un local en el `mi_alcance` de la persona. */
function capacidadesDe(usuarioId: number, localId: number, capacidades: unknown) {
  const a = erp.alcances.get(usuarioId) as Rompible<DatosMiAlcance>;
  const l = a.locales.find((x) => x.id === localId);
  assert.ok(l, `el alcance no tiene el local ${localId}`);
  l.capacidades = capacidades as never;
}

/** Lo que guardan todas las tablas de Azul Chat menos las de sesión, como texto. */
async function volcado(): Promise<string> {
  const [fila] = await base.db.$queryRawUnsafe<{ x: string }[]>(
    `SELECT json_build_object(
       'e', (SELECT json_agg(t ORDER BY t.id) FROM "Evento" t),
       'c', (SELECT json_agg(t ORDER BY t.id) FROM "CursorIngesta" t),
       'l', (SELECT json_agg(t ORDER BY t."vinculoId", t."erpLocalId") FROM "LecturaLocal" t))::text AS x`,
  );
  return fila!.x;
}

const errorDelErp = (codigo: string) => {
  const e = FIXTURES_ERP.errores[codigo];
  assert.ok(e, `el fixture no tiene ${codigo}`);
  return { status: e.status, cuerpo: e.cuerpo };
};

/** La sesión sigue viva: GET /api/chats contesta 200 con la misma cookie. */
async function sesionViva(cookie: string): Promise<boolean> {
  const res = await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps());
  return res.status === 200;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/chats/ventas: autorizado", () => {
  it("3A-1. local en el alcance de hoy con ventas_resumen: las ventas de hoy del ERP, tal cual, con el nombre de mi_alcance", async () => {
    const enc = await vincular(ENCARGADO);
    const antes = await volcado();
    const r = await ventas(enc, CASIANO);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.cuerpo, {
      estado: "OK",
      local: { id: CASIANO, nombre: "Casiano" },
      periodo: { desde: DATOS_ERP.periodo.desde, hasta: DATOS_ERP.periodo.hasta },
      cantidadVentas: DATOS_ERP.cantidadVentas,
      totalVendido: DATOS_ERP.totalVendido,
      mediosDePago: DATOS_ERP.mediosDePago,
      advertencias: DATOS_ERP.advertencias,
    });
    assert.equal(r.res.headers.get("set-cookie"), null);
    // Nada se guarda: ni eventos, ni cursor, ni lectura.
    assert.equal(await volcado(), antes);
  });

  it("3A-2. el grupo sale de mi_alcance y el período es hoy; nada del usuario viaja; una llamada a cada capacidad, sin reintentos", async () => {
    const adm = await vincular(ADMIN);
    // Centro es del grupo 2 en el mi_alcance de adminGlobal. El ERP de mentira contesta Casiano, así que
    // la respuesta no es del local pedido y no se muestra: lo que importa acá es lo que VIAJÓ.
    await ventas(adm, CENTRO);
    const pedidas = consultas("ventas_resumen");
    assert.equal(pedidas.length, 1);
    assert.deepEqual(pedidas[0]!.alcance, { grupoId: 2, localId: CENTRO });
    assert.deepEqual(pedidas[0]!.parametros, { periodo: { tipo: "hoy" } });
    assert.deepEqual(Object.keys(pedidas[0]!).sort(), ["alcance", "capacidad", "delegacion", "parametros"]);
    assert.equal(consultas("mi_alcance").length, 1);
    assert.equal(consultas("transferencias_eventos").length, 0);
  });

  it("3A-0. chats/local anuncia `ventas` solo si el mi_alcance de AHORA trae ventas_resumen en ese local", async () => {
    const enc = await vincular(ENCARGADO);
    const anuncia = async () => {
      const res = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${CASIANO}`, { headers: conCookie(enc) }), deps());
      assert.equal(res.status, 200);
      return ((await res.json()) as Extract<RespuestaLocal, { estado: "OK" }>).local.ventas;
    };
    assert.equal(await anuncia(), true);
    capacidadesDe(ENCARGADO, CASIANO, ["transferencias_eventos"]);
    assert.equal(await anuncia(), false);
    // Anunciar no es consultar: abrir el chat no pide ventas.
    assert.equal(consultas("ventas_resumen").length, 0);
  });

  it("3A-3. alcanza con ventas_resumen: un local sin transferencias_eventos también", async () => {
    const enc = await vincular(ENCARGADO);
    capacidadesDe(ENCARGADO, CASIANO, ["ventas_resumen"]);
    assert.equal((await ventas(enc, CASIANO)).status, 200);
  });
});

describe("GET /api/chats/ventas: sin permiso", () => {
  it("3A-4. local fuera del alcance de hoy: 403 NO_AUTORIZADO, como chats/local, y el ERP no recibe ventas_resumen", async () => {
    const enc = await vincular(ENCARGADO);
    for (const id of [CENTRO, DEPOSITO, 999]) {
      const r = await ventas(enc, id);
      assert.equal(r.status, 403, String(id));
      assert.deepEqual(r.cuerpo, { estado: "NO_AUTORIZADO" });
    }
    assert.equal(consultas("ventas_resumen").length, 0);
  });

  it("3A-5. local en el alcance SIN la capacidad: 403 NO_AUTORIZADO, sin consultar ventas", async () => {
    const caj = await vincular(CAJERO); // Casiano con capacidades []
    assert.deepEqual((await ventas(caj, CASIANO)).cuerpo, { estado: "NO_AUTORIZADO" });
    const adm = await vincular(ADMIN);
    capacidadesDe(ADMIN, DEPOSITO, ["transferencias_eventos"]);
    assert.deepEqual((await ventas(adm, DEPOSITO)).cuerpo, { estado: "NO_AUTORIZADO" });
    capacidadesDe(ADMIN, DEPOSITO, undefined); // un ERP que no anuncia capacidades: ninguna
    assert.deepEqual((await ventas(adm, DEPOSITO)).cuerpo, { estado: "NO_AUTORIZADO" });
    assert.equal(consultas("ventas_resumen").length, 0);
  });

  it("3A-6. la autorización es de AHORA: la capacidad que el ERP deja de anunciar se deja de aceptar", async () => {
    const enc = await vincular(ENCARGADO);
    assert.equal((await ventas(enc, CASIANO)).status, 200);
    capacidadesDe(ENCARGADO, CASIANO, ["transferencias_eventos"]);
    assert.equal((await ventas(enc, CASIANO)).status, 403);
  });

  it("sin cookie: 401 SIN_SESION, sin llamar al ERP", async () => {
    const r = await ventas(null, CASIANO);
    assert.equal(r.status, 401);
    assert.deepEqual(r.cuerpo, { estado: "SIN_SESION" });
    assert.equal(erp.cuerposA("consultar").length, 0);
  });
});

describe("GET /api/chats/ventas: el ERP no da una respuesta buena", () => {
  it("3A-7. ERP caído al consultar ventas: 503 ERP_NO_DISPONIBLE y la sesión sigue", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasVentas.push(errorDelErp("INTEGRACION_NO_DISPONIBLE"));
    const r = await ventas(enc, CASIANO);
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    assert.equal(r.res.headers.get("set-cookie"), null);
    assert.equal(consultas("ventas_resumen").length, 1, "sin reintentos");
    assert.ok(await sesionViva(enc));
  });

  it("3A-8. ERP lento (no contesta ventas): se corta por tiempo, 503, sin reintento, la sesión sigue", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasVentas.push({ colgar: true });
    const r = await ventas(enc, CASIANO, deps(200));
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    assert.equal(consultas("ventas_resumen").length, 1);
    assert.ok(await sesionViva(enc));
  });

  it("3A-9. ERP caído desde mi_alcance: 503, y ventas ni se pide", async () => {
    const enc = await vincular(ENCARGADO);
    erp.ponerModo("caido");
    assert.deepEqual((await ventas(enc, CASIANO)).cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    erp.ponerModo("normal");
    assert.equal(consultas("ventas_resumen").length, 0);
  });

  it("3A-10. NO_AUTORIZADO del ERP en ventas: 503 ERP_NO_DISPONIBLE, sin revocar nada", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasVentas.push(errorDelErp("NO_AUTORIZADO"));
    const r = await ventas(enc, CASIANO);
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    assert.ok(await sesionViva(enc));
    assert.equal(registros.some((x) => x.evento === "vinculo.invalidado"), false);
  });

  it("3A-11. VINCULO_NO_VALIDO en ventas: 401 con motivo, cookie borrada y el vínculo invalidado, como en el resto", async () => {
    const enc = await vincular(ENCARGADO);
    erp.respuestasVentas.push(errorDelErp("VINCULO_NO_VALIDO"));
    const r = await ventas(enc, CASIANO);
    assert.equal(r.status, 401);
    assert.deepEqual(r.cuerpo, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" });
    assert.match(r.res.headers.get("set-cookie") ?? "", new RegExp(`^${NOMBRE_COOKIE}=;`));
    assert.ok(registros.some((x) => x.evento === "vinculo.invalidado"));
    assert.equal(await sesionViva(enc), false);
    const vinculo = await base.db.vinculo.findFirst({ where: { erpUsuarioId: ENCARGADO } });
    assert.ok(vinculo?.invalidadoEn, "el vínculo local quedó invalidado");
  });

  it("3A-12. respuesta con forma inválida: 503, sin números inventados ni completados", async () => {
    const enc = await vincular(ENCARGADO);
    const rotas: unknown[] = [
      { ok: true, datos: { ...DATOS_ERP, totalVendido: 1500 } },
      { ok: true, datos: { ...DATOS_ERP, totalVendido: "1500" } },
      { ok: true, datos: { ...DATOS_ERP, cantidadVentas: -1 } },
      { ok: true, datos: { ...DATOS_ERP, mediosDePago: [{ medio: "EFECTIVO", etiqueta: "Efectivo", total: "x", cantidadPagos: 1 }] } },
      { ok: true, datos: { ...DATOS_ERP, version: 2 } },
      { ok: true, datos: { ...DATOS_ERP, local: { id: DEPOSITO, nombre: "Depósito Central" } } },
      { ok: true, datos: { ...DATOS_ERP, periodo: { ...DATOS_ERP.periodo, tipo: "ayer" } } },
      { ok: true },
    ];
    for (const cuerpo of rotas) erp.respuestasVentas.push({ status: 200, cuerpo });
    for (const cuerpo of rotas) {
      const r = await ventas(enc, CASIANO);
      assert.equal(r.status, 503, JSON.stringify(cuerpo));
      assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    }
    assert.ok(await sesionViva(enc));
  });
});
