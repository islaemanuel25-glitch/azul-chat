// CANDADOS DE "PENDIENTES" (Tanda 9B), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// sesión real (vincular con un código del ERP de mentira) → `mi_alcance` vivo →
// los locales que anuncian `pedidos_pendientes` o `cajas_resumen` → por local,
// las fuentes que anuncia → respuesta. El ERP es test/ayuda/erpConEstado.ts:
// `mi_alcance` del fixture del ERP 25172fe (al que se le suman las capacidades
// donde el test lo dice), los pedidos del fixture ccf2894 y las cajas del
// fixture 14ae247, o un error real. Ninguno llama al ERP ni a Gemini reales.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { manejarGeneral, manejarLocal, manejarPendientes, manejarPendientesGeneral } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { leerConfigIa } from "../../src/server/ia/config.ts";
import type { Registro } from "../../src/server/log.ts";
import { manejarPreguntar } from "../../src/server/preguntas/manejador.ts";
import { VERSION_RESULTADO } from "../../src/server/preguntas/guardadas.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { Pendiente, RespuestaGeneral, RespuestaLocal, RespuestaPendientes, RespuestaPendientesGeneral } from "../../src/shared/chats/api.ts";
import type { RespuestaPregunta } from "../../src/shared/chats/preguntas.ts";
import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { ERRORES_ERP, FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const CLAVE_IA = `AIza${randomBytes(18).toString("hex")}`;
const MA = FIXTURES_ERP_25172FE.miAlcance;

const ADMIN = 9;
const ENCARGADO = 11;
const CASIANO = 3;
const BELGRANO = 5;
const DEPOSITO = 9;
const CENTRO = 20;

let base: BaseDescartable;
let erp: ErpConEstado;
let registros: Registro[];
let respuestaIa: () => Response;

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
  erp.pedidosPorLocal.clear();
  erp.ponerModo("normal");
  erp.cupo.desactivar();
  erp.alcances.clear();
  erp.alcances.set(ADMIN, structuredClone(MA.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  erp.alcances.set(ENCARGADO, structuredClone(MA.encargado.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  // El mi_alcance de 25172fe es anterior a las dos: el encargado las recibe en Casiano, como un ENCARGADO real de ccf2894.
  sumar(ENCARGADO, CASIANO, "cajas_resumen", "pedidos_pendientes");
  registros = [];
  respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
});

const transporteIa: typeof fetch = async () => respuestaIa();

function respuestaGemini(salida: Record<string, unknown>): Response {
  const completa = { intencion: null, tipoEvento: null, local: null, periodo: null, desde: null, hasta: null, turno: null, modoStock: null, producto: null, restriccionesNoSoportadas: [], ...salida };
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(completa) }] } }],
      usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 40, totalTokenCount: 640 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function deps(): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  const ia = leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA });
  return {
    config: leerConfigAzulChat({ AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE }),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 2000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: Date.now,
    registrar,
    generarRequestId: randomUUID,
    ia: ia.ok ? ia : { ok: false },
    transporteIa,
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

async function pendientes(cookie: string | null, query = `localId=${CASIANO}`) {
  const res = await manejarPendientes(new Request(`${ORIGEN}/api/chats/pendientes?${query}`, { headers: conCookie(cookie) }), deps());
  return { status: res.status, cuerpo: (await res.json()) as RespuestaPendientes };
}
async function general(cookie: string | null, query = "") {
  const res = await manejarPendientesGeneral(new Request(`${ORIGEN}/api/chats/pendientes/general${query}`, { headers: conCookie(cookie) }), deps());
  return { status: res.status, cuerpo: (await res.json()) as RespuestaPendientesGeneral };
}
async function preguntar(cookie: string, cuerpo: unknown) {
  const res = await manejarPreguntar(
    new Request(`${ORIGEN}/api/chats/preguntar`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) }, body: JSON.stringify(cuerpo) }),
    deps(),
  );
  return { status: res.status, cuerpo: (await res.json()) as RespuestaPregunta & { guardadaId?: string } };
}

const consultas = () => erp.cuerposA("consultar").map((c) => (c.capacidad === "cajas_resumen" ? `cajas:${(c.parametros as { periodo: { tipo: string } }).periodo.tipo}` : (c.capacidad as string)));

function localDe(usuarioId: number, localId: number) {
  const a = erp.alcances.get(usuarioId) as Rompible<DatosMiAlcance>;
  const l = a.locales.find((x) => x.id === localId);
  assert.ok(l, `el alcance no tiene el local ${localId}`);
  return l;
}
function sumar(usuarioId: number, localId: number, ...capacidades: string[]) {
  const l = localDe(usuarioId, localId);
  l.capacidades = [...(l.capacidades ?? []), ...capacidades] as never;
}
function quitar(usuarioId: number, localId: number, capacidad: string) {
  const l = localDe(usuarioId, localId);
  l.capacidades = (l.capacidades ?? []).filter((c) => c !== capacidad) as never;
}
const error = (codigo: string) => {
  const e = ERRORES_ERP[codigo];
  assert.ok(e, `el fixture no tiene ${codigo}`);
  return { status: e.status, cuerpo: e.cuerpo };
};

/** "P4", "C3:hoy": lo mínimo para comparar el orden. */
const clave = (p: Pendiente) => (p.tipo === "PEDIDO" ? `P${p.pedidoId}` : `C${p.cajaId}:${p.dia}`);

/** Lo que guardan las tablas de Azul Chat que no son de sesión, como texto. */
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

describe("GET /api/chats/pendientes: un local", () => {
  it("con las dos fuentes: pedidos y cajas de hoy y de ayer, IMPORTANTE primero; 1 + 3 consultas; nada se guarda", async () => {
    const cookie = await vincular(ENCARGADO);
    erp.recibidas.length = 0;
    const antes = await volcado();
    const r = await pendientes(cookie);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(r.cuerpo.estado === "OK");
    assert.deepEqual(r.cuerpo.local, { id: CASIANO, nombre: "Casiano" });
    assert.deepEqual(r.cuerpo.faltaron, []);
    // Bruno y Diego (faltantes) y los dos pedidos de 26 h; después Sofía (sin verificar) y Carla (sobrante). Ayer, sin cajas.
    assert.deepEqual(r.cuerpo.pendientes.map(clave), ["C3:hoy", "C5:hoy", "P4", "P7", "C1:hoy", "C4:hoy"]);
    assert.deepEqual(r.cuerpo.pendientes.map((p) => p.etiqueta), ["IMPORTANTE", "IMPORTANTE", "IMPORTANTE", "IMPORTANTE", "NORMAL", "NORMAL"]);
    assert.deepEqual(consultas(), ["mi_alcance", "pedidos_pendientes", "cajas:hoy", "cajas:ayer"]);
    // El local y el grupo de mi_alcance, nunca del navegador.
    for (const c of erp.cuerposA("consultar").slice(1)) assert.deepEqual(c.alcance, { grupoId: 1, localId: CASIANO });
    assert.equal(await volcado(), antes);
  });

  it("solo con cajas_resumen: no se piden pedidos (1 + 2); solo con pedidos_pendientes: no se piden cajas (1 + 1)", async () => {
    quitar(ENCARGADO, CASIANO, "pedidos_pendientes");
    const cookie = await vincular(ENCARGADO);
    erp.recibidas.length = 0;
    const r = await pendientes(cookie);
    assert.ok(r.cuerpo.estado === "OK");
    assert.ok(r.cuerpo.pendientes.every((p) => p.tipo === "CAJA"));
    assert.deepEqual(consultas(), ["mi_alcance", "cajas:hoy", "cajas:ayer"]);

    sumar(ENCARGADO, CASIANO, "pedidos_pendientes");
    quitar(ENCARGADO, CASIANO, "cajas_resumen");
    erp.recibidas.length = 0;
    const s = await pendientes(cookie);
    assert.ok(s.cuerpo.estado === "OK");
    assert.deepEqual(s.cuerpo.pendientes.map(clave), ["P4", "P7"]);
    assert.deepEqual(consultas(), ["mi_alcance", "pedidos_pendientes"]);
  });

  it("sin pendientes: la lista vacía, que la interfaz dice 'Nada pendiente'", async () => {
    quitar(ENCARGADO, CASIANO, "cajas_resumen");
    erp.pedidosPorLocal.set(CASIANO, []);
    const cookie = await vincular(ENCARGADO);
    const r = await pendientes(cookie);
    assert.deepEqual(r.cuerpo, { estado: "OK", local: { id: CASIANO, nombre: "Casiano" }, pendientes: [], faltaron: [] });
  });

  it("sin ninguna de las dos capacidades: NO_AUTORIZADO, y solo se gastó mi_alcance", async () => {
    quitar(ENCARGADO, CASIANO, "cajas_resumen");
    quitar(ENCARGADO, CASIANO, "pedidos_pendientes");
    const cookie = await vincular(ENCARGADO);
    erp.recibidas.length = 0;
    const r = await pendientes(cookie);
    assert.deepEqual([r.status, r.cuerpo.estado], [403, "NO_AUTORIZADO"]);
    assert.deepEqual(consultas(), ["mi_alcance"]);
    // Un local que no es suyo, igual.
    const otro = await pendientes(cookie, `localId=${CENTRO}`);
    assert.deepEqual([otro.status, otro.cuerpo.estado], [403, "NO_AUTORIZADO"]);
  });

  it("una fuente que falla: se muestran las otras y se dice cuál faltó", async () => {
    erp.respuestaParaCapacidad.set(`pedidos_pendientes:${CASIANO}`, error("INTEGRACION_NO_DISPONIBLE"));
    const cookie = await vincular(ENCARGADO);
    const r = await pendientes(cookie);
    assert.equal(r.status, 200);
    assert.ok(r.cuerpo.estado === "OK");
    assert.deepEqual(r.cuerpo.faltaron, ["PEDIDOS"]);
    assert.deepEqual(r.cuerpo.pendientes.map(clave), ["C3:hoy", "C5:hoy", "C1:hoy", "C4:hoy"]);
  });

  it("una respuesta que no es del local pedido no se muestra: esa fuente faltó", async () => {
    erp.respuestaParaCapacidad.set(`pedidos_pendientes:${CASIANO}`, {
      status: 200,
      cuerpo: { ok: true, datos: { capacidad: "pedidos_pendientes", version: 1, local: { id: BELGRANO, nombre: "Belgrano" }, grupoId: 1, pedidos: [] } },
    });
    const cookie = await vincular(ENCARGADO);
    const r = await pendientes(cookie);
    assert.ok(r.cuerpo.estado === "OK");
    assert.deepEqual(r.cuerpo.faltaron, ["PEDIDOS"]);
  });

  it("si ninguna contestó, es una falla y no 'nada pendiente'", async () => {
    erp.respuestaParaCapacidad.set(`pedidos_pendientes:${CASIANO}`, error("ERROR_AL_CALCULAR"));
    erp.respuestaParaCapacidad.set(`cajas_resumen:${CASIANO}`, error("INTEGRACION_NO_DISPONIBLE"));
    const cookie = await vincular(ENCARGADO);
    const r = await pendientes(cookie);
    assert.deepEqual([r.status, r.cuerpo.estado], [503, "ERP_NO_DISPONIBLE"]);
  });

  it("el cupo corta lo que falta: no se sigue gastando", async () => {
    erp.respuestasCajas.push(error("LIMITE_EXCEDIDO"));
    const cookie = await vincular(ENCARGADO);
    erp.recibidas.length = 0;
    const r = await pendientes(cookie);
    assert.ok(r.cuerpo.estado === "OK");
    assert.deepEqual(r.cuerpo.faltaron, ["CAJAS_HOY", "CAJAS_AYER"]);
    assert.deepEqual(consultas(), ["mi_alcance", "pedidos_pendientes", "cajas:hoy"]);
    // Y si el cupo cae en la primera, ninguna contestó: la falla del cupo.
    erp.respuestaParaCapacidad.set(`pedidos_pendientes:${CASIANO}`, error("LIMITE_EXCEDIDO"));
    erp.recibidas.length = 0;
    const s = await pendientes(cookie);
    assert.deepEqual([s.status, s.cuerpo.estado], [429, "ERP_CUPO_EXCEDIDO"]);
    assert.deepEqual(consultas(), ["mi_alcance", "pedidos_pendientes"]);
  });

  it("el vínculo que el ERP ya no reconoce: sin sesión", async () => {
    erp.respuestaParaCapacidad.set(`pedidos_pendientes:${CASIANO}`, error("VINCULO_NO_VALIDO"));
    const cookie = await vincular(ENCARGADO);
    const r = await pendientes(cookie);
    assert.deepEqual([r.status, r.cuerpo], [401, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" }]);
  });

  it("la forma de la consulta: el local, exactamente; sin sesión, 401", async () => {
    const cookie = await vincular(ENCARGADO);
    for (const q of ["", "localId=0", "localId=abc", `localId=${CASIANO}&localId=${CASIANO}`, `localId=${CASIANO}&capacidad=cajas_resumen`]) {
      assert.equal((await pendientes(cookie, q)).status, 400, q);
    }
    assert.equal((await pendientes(null)).status, 401);
  });

  it("el cupo, contado: un local con las dos fuentes gasta exactamente 4 del ERP", async () => {
    const cookie = await vincular(ENCARGADO);
    erp.cupo.activar({ maxPorUsuario: 4 });
    assert.equal((await pendientes(cookie)).status, 200);
    assert.equal(erp.cupo.rechazos(), 0);
    // La quinta del minuto ya no entra: mi_alcance da LIMITE_EXCEDIDO.
    assert.deepEqual((await pendientes(cookie)).cuerpo, { estado: "ERP_CUPO_EXCEDIDO" });
  });
});

describe("GET /api/chats/pendientes/general: todos", () => {
  beforeEach(() => {
    // Admin: Casiano con las dos, Belgrano solo pedidos (sin ninguno), el depósito solo cajas, Centro ninguna.
    sumar(ADMIN, CASIANO, "cajas_resumen", "pedidos_pendientes");
    sumar(ADMIN, BELGRANO, "pedidos_pendientes");
    sumar(ADMIN, DEPOSITO, "cajas_resumen");
    erp.pedidosPorLocal.set(BELGRANO, []);
  });

  it("una sección por local con alguna fuente; los que no tienen nada, al final; 1 + 3 + 1 + 2 consultas", async () => {
    erp.respuestaParaCapacidad.set(`cajas_resumen:${DEPOSITO}`, {
      status: 200,
      cuerpo: { ok: true, datos: { capacidad: "cajas_resumen", version: 1, local: { id: DEPOSITO, nombre: "Depósito Central" }, grupoId: 1, periodo: { tipo: "hoy", fecha: "2026-10-11", zonaHoraria: "America/Argentina/Cordoba" }, turnoOperativoPedido: null, turnosOperativos: [], advertencias: [] } },
    });
    const cookie = await vincular(ADMIN);
    erp.recibidas.length = 0;
    const r = await general(cookie);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(r.cuerpo.estado === "OK");
    // Casiano tiene; Belgrano no tiene nada; el depósito contestó con un período "hoy" a la de ayer: esa faltó (y lo dice).
    assert.deepEqual(
      r.cuerpo.locales.map((l) => [l.local.nombre, l.pendientes.length, l.faltaron]),
      [
        ["Casiano", 6, []],
        ["Depósito Central", 0, ["CAJAS_AYER"]],
        ["Belgrano", 0, []],
      ],
    );
    // En el orden de mi_alcance (Belgrano, Casiano, el depósito), de a una, y una sola mi_alcance.
    assert.deepEqual(consultas(), ["mi_alcance", "pedidos_pendientes", "pedidos_pendientes", "cajas:hoy", "cajas:ayer", "cajas:hoy", "cajas:ayer"]);
    assert.equal(consultas().length, 1 + 1 + 3 + 2);
    assert.deepEqual(
      erp.cuerposA("consultar").slice(1).map((c) => (c.alcance as { localId: number }).localId),
      [BELGRANO, CASIANO, CASIANO, CASIANO, DEPOSITO, DEPOSITO],
    );
  });

  it("los anuncios: /api/chats/local dice si el local tiene 'Pendientes' y /api/chats/general si algún local lo tiene", async () => {
    const cookie = await vincular(ADMIN);
    const local = async (id: number) =>
      (await (await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${id}`, { headers: conCookie(cookie) }), deps())).json()) as RespuestaLocal;
    const c = await local(CASIANO);
    const x = await local(CENTRO);
    assert.ok(c.estado === "OK" && x.estado === "OK");
    assert.deepEqual([c.local.pendientes, x.local.pendientes], [true, false]);
    const g = (await (await manejarGeneral(new Request(`${ORIGEN}/api/chats/general`, { headers: conCookie(cookie) }), deps())).json()) as RespuestaGeneral;
    assert.ok(g.estado === "OK" && g.pendientes === true);
    // Sin ninguna fuente en ningún local: sin chip en General, y la ruta dice NO_AUTORIZADO.
    for (const id of [CASIANO, BELGRANO, DEPOSITO]) {
      quitar(ADMIN, id, "cajas_resumen");
      quitar(ADMIN, id, "pedidos_pendientes");
    }
    const g2 = (await (await manejarGeneral(new Request(`${ORIGEN}/api/chats/general`, { headers: conCookie(cookie) }), deps())).json()) as RespuestaGeneral;
    assert.ok(g2.estado === "OK" && g2.pendientes === false);
    assert.deepEqual((await general(cookie)).cuerpo, { estado: "NO_AUTORIZADO" });
  });

  it("sin parámetros: uno de más es 400", async () => {
    const cookie = await vincular(ADMIN);
    assert.equal((await general(cookie, `?localId=${CASIANO}`)).status, 400);
  });
});

describe("la pregunta '¿qué está pendiente?'", () => {
  it("de un local: la misma respuesta que el chip, guardada en la versión nueva y mostrada como foto en el historial", async () => {
    const cookie = await vincular(ENCARGADO);
    respuestaIa = () => respuestaGemini({ intencion: "pendientes", local: "Casiano", periodo: "hoy" });
    const r = await preguntar(cookie, { pregunta: "¿Hay pedidos sin enviar?", localId: CASIANO });
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(r.cuerpo.estado === "PENDIENTES" && r.cuerpo.alcance === "LOCAL");
    const chip = await pendientes(cookie);
    assert.ok(chip.cuerpo.estado === "OK");
    assert.deepEqual({ estado: "OK", ...r.cuerpo.resultado }, chip.cuerpo);

    const fila = await base.db.pregunta.findFirstOrThrow({ select: { resultadoVersion: true, requisitos: true } });
    assert.equal(VERSION_RESULTADO, 4);
    assert.equal(fila.resultadoVersion, 4);
    assert.deepEqual(fila.requisitos, [
      { localId: CASIANO, capacidad: "pedidos_pendientes" },
      { localId: CASIANO, capacidad: "cajas_resumen" },
    ]);

    const historial = async () =>
      (await (await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${CASIANO}`, { headers: conCookie(cookie) }), deps())).json()) as RespuestaLocal;
    const h = await historial();
    assert.ok(h.estado === "OK");
    assert.equal(h.guardadas.length, 1);
    // La foto es exactamente lo que vio la pantalla (sin el `guardadaId` de la respuesta).
    assert.deepEqual({ ...h.guardadas[0]!.respuesta, guardadaId: r.cuerpo.guardadaId }, r.cuerpo);
    // Sin pedidos_pendientes hoy en Casiano, la foto ya no se muestra (fallo cerrado).
    quitar(ENCARGADO, CASIANO, "pedidos_pendientes");
    const oculto = await historial();
    assert.ok(oculto.estado === "OK");
    assert.equal(oculto.guardadas.length, 0);
  });

  it("de todos: un bloque por local, con el mismo orden que General", async () => {
    sumar(ADMIN, CASIANO, "cajas_resumen", "pedidos_pendientes");
    sumar(ADMIN, BELGRANO, "pedidos_pendientes");
    erp.pedidosPorLocal.set(BELGRANO, []);
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "pendientes", local: "todos", periodo: "hoy" });
    const r = await preguntar(cookie, { pregunta: "¿Qué está pendiente?" });
    assert.ok(r.cuerpo.estado === "PENDIENTES" && r.cuerpo.alcance === "TODOS", JSON.stringify(r.cuerpo));
    assert.deepEqual(r.cuerpo.locales.map((l) => [l.local.nombre, l.pendientes.length]), [["Casiano", 6], ["Belgrano", 0]]);
  });

  it("una pregunta de pendientes de 'ayer' no se entiende: es de ahora", async () => {
    const cookie = await vincular(ENCARGADO);
    erp.recibidas.length = 0;
    respuestaIa = () => respuestaGemini({ intencion: "pendientes", local: "Casiano", periodo: "ayer" });
    const r = await preguntar(cookie, { pregunta: "¿Qué quedó pendiente ayer?", localId: CASIANO });
    assert.equal(r.cuerpo.estado, "NO_ENTIENDO");
    assert.deepEqual(consultas(), ["mi_alcance"]);
  });
});
