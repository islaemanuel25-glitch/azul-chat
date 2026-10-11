// CANDADOS DE LAS PREGUNTAS EN LENGUAJE NATURAL (Tanda 6A), DE PUNTA A PUNTA,
// CONTRA POSTGRESQL.
//
// La ruta se ejerce por su manejador —el archivo de src/app solo delega
// (test/frontera/rutas.test.ts)— con una sesión real. El ERP es el de mentira
// con estado (test/ayuda/erpConEstado.ts). La IA es un `fetch` de mentira que
// anota lo que recibe y contesta lo que el test le carga, con la forma de
// `generateContent` de Gemini. Ningún test llama a Gemini ni al ERP reales.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { codificarCursor, decodificarCursor, paginaDeHistorial, type PosicionHistorial } from "../../src/server/chats/historial.ts";
import { manejarGeneral, manejarLocal } from "../../src/server/chats/manejadores.ts";
import { FRECUENCIA_MINIMA_INGESTA_MS } from "../../src/server/chats/sincronizacion.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { leerConfigIa } from "../../src/server/ia/config.ts";
import { ENDPOINT_IA } from "../../src/server/ia/gemini.ts";
import { costoMicroUsd, MODELO_IA, reservaPorPregunta } from "../../src/server/ia/tarifa.ts";
import { manejarSincronizar } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import type { Registro } from "../../src/server/log.ts";
import { DIAS_DE_RETENCION, fuenteDePreguntas, guardarPregunta } from "../../src/server/preguntas/guardadas.ts";
import { esquemaDeIntencion, instruccionesDeIntencion } from "../../src/server/preguntas/intencion.ts";
import { manejarPreguntar } from "../../src/server/preguntas/manejador.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { RespuestaGeneral, RespuestaLocal } from "../../src/shared/chats/api.ts";
import { EJEMPLOS_DE_PREGUNTAS, RESTRICCIONES_NO_SOPORTADAS, type RespuestaPregunta } from "../../src/shared/chats/preguntas.ts";
import type { DatosMiAlcance, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { recepcion } from "../ayuda/paginadorErp.ts";
import { DATOS_ERP, FIXTURES_ERP, FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const CLAVE_IA = `AIza${randomBytes(18).toString("hex")}`;
const ADMIN = 9;
const ENCARGADO = 11;
const CASIANO = { id: 3, nombre: "Casiano" };
const DEPOSITO = { id: 9, nombre: "Depósito Central" };
const MA = FIXTURES_ERP_25172FE.miAlcance;
const HISTORIA_CASIANO = structuredClone((FIXTURES_ERP_25172FE.transferenciasEventos.sinDesde.respuesta.cuerpo.datos as { eventos: EventoTransferenciaRecibida[] }).eventos);
/** "Ahora" del fixture: 2026-10-08 09:00 en Argentina. Los cuatro eventos reales de Casiano son de AYER. */
const HOY = "2026-10-08";
const AYER = "2026-10-07";

let base: BaseDescartable;
let erp: ErpConEstado;
let registros: Registro[];
let reloj: number;

/** Lo que recibió la IA de mentira. */
let llamadasIa: { url: string; headers: Record<string, string>; cuerpo: Record<string, unknown> }[];
/** Lo que contesta la IA de mentira a la próxima llamada. */
let respuestaIa: () => Promise<Response> | Response;

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
  erp.respuestasEventos.length = 0;
  erp.respuestaParaLocal.clear();
  erp.eventosPorLocal.clear();
  erp.eventosPorCapacidad.clear();
  erp.respuestaParaCapacidad.clear();
  erp.respuestasVentas.length = 0;
  erp.ponerModo("normal");
  erp.cupo.desactivar();
  erp.alcances.clear();
  erp.alcances.set(ADMIN, structuredClone(MA.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  erp.alcances.set(ENCARGADO, structuredClone(MA.encargado.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  erp.eventosPorLocal.set(CASIANO.id, structuredClone(HISTORIA_CASIANO));
  erp.eventosPorLocal.set(DEPOSITO.id, [recepcion({ local: DEPOSITO, transferenciaId: 300, fecha: "2026-10-07T08:00:00.000Z" })]);
  registros = [];
  llamadasIa = [];
  respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
});

const transporteIa: typeof fetch = async (url, init) => {
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  llamadasIa.push({ url: String(url), headers, cuerpo: JSON.parse(String(init?.body)) as Record<string, unknown> });
  return respuestaIa();
};

/** Una respuesta de `generateContent` con esa intención (los campos que faltan, en null) y ese uso. */
function respuestaGemini(
  salida: Record<string, unknown>,
  { uso = { promptTokenCount: 600, candidatesTokenCount: 40, thoughtsTokenCount: 120 }, finishReason = "STOP", texto }: { uso?: Record<string, number>; finishReason?: string; texto?: string } = {},
): Response {
  const completa = { intencion: null, tipoEvento: null, local: null, periodo: null, desde: null, hasta: null, restriccionesNoSoportadas: [], ...salida };
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason, content: { role: "model", parts: [{ text: texto ?? JSON.stringify(completa) }] } }],
      usageMetadata: { ...uso, totalTokenCount: Object.values(uso).reduce((a, b) => a + b, 0) },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function deps(entornoIa: Record<string, string> | null = { AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA }): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  const ia = entornoIa ? leerConfigIa(entornoIa) : null;
  return {
    config: leerConfigAzulChat({ AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE }),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 2000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
    ...(ia ? { ia: ia.ok ? ia : { ok: false } } : {}),
    transporteIa,
  };
}

const conCookie = (cookie: string): Record<string, string> => ({ cookie: `${NOMBRE_COOKIE}=${cookie}` });

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

/** La corrida de fondo: lo único que trae eventos del ERP. */
async function fondo() {
  const puerta = leerPuertaTarea({ AZUL_CHAT_TAREA_SECRET: SECRETO_TAREA });
  assert.ok(puerta.ok);
  const res = await manejarSincronizar(
    new Request("http://127.0.0.1:3100/api/interno/sincronizar", {
      method: "POST",
      headers: { host: "127.0.0.1:3100", "x-forwarded-proto": "http", [CABECERA_SECRETO_TAREA]: SECRETO_TAREA },
    }),
    { ...deps(), puerta, push: { ok: false } },
  );
  assert.equal(res.status, 200, await res.text());
}

/** Tanda 6C: `guardadaId` (con qué id se guardó, o null) va aparte, así `cuerpo` es la respuesta tal cual. */
type Contestada = { status: number; texto: string; cuerpo: Exclude<RespuestaPregunta, never>; guardadaId: string | null };

async function preguntar(cookie: string | null, cuerpo: unknown, { d = deps(), origen = ORIGEN }: { d?: DependenciasSesion; origen?: string | null } = {}): Promise<Contestada> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(cookie ? conCookie(cookie) : {}) };
  if (origen) headers.origin = origen;
  const res = await manejarPreguntar(new Request(`${ORIGEN}/api/chats/preguntar`, { method: "POST", headers, body: JSON.stringify(cuerpo) }), d);
  const texto = await res.text();
  const { guardadaId = null, ...respuesta } = JSON.parse(texto) as RespuestaPregunta & { guardadaId?: unknown };
  assert.ok(guardadaId === null || (typeof guardadaId === "string" && /^[1-9][0-9]*$/.test(guardadaId)), `guardadaId: ${String(guardadaId)}`);
  return { status: res.status, texto, cuerpo: respuesta as RespuestaPregunta, guardadaId: guardadaId as string | null };
}

const capacidadesPedidas = () => erp.cuerposA("consultar").map((c) => c.capacidad as string);
const consumo = () => base.db.consumoIa.findUnique({ where: { mes: "2026-10" } });

/** El cuerpo de ventas del ERP para ese local y período: DATOS_ERP (salida real de armarVentasResumen) con otro local. */
function ventasDe(local: { id: number; nombre: string; grupoId?: number }, totalVendido: string, medios: [string, string, string][], periodo = { tipo: "hoy", desde: HOY, hasta: HOY }) {
  return {
    status: 200,
    cuerpo: {
      ok: true,
      datos: {
        ...structuredClone(DATOS_ERP),
        local: { id: local.id, nombre: local.nombre },
        grupoId: local.grupoId ?? 1,
        periodo: { ...periodo, zonaHoraria: DATOS_ERP.periodo.zonaHoraria },
        cantidadVentas: medios.length,
        totalVendido,
        mediosDePago: medios.map(([medio, etiqueta, total]) => ({ medio, etiqueta, total, cantidadPagos: 1 })),
        advertencias: [],
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("sin clave de IA no hay preguntas", () => {
  it("las respuestas de Local y General dicen preguntas: false; con clave, true", async () => {
    const cookie = await vincular(ADMIN);
    const pedirLocal = async (d: DependenciasSesion) =>
      JSON.parse(await (await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=3`, { headers: conCookie(cookie) }), d)).text()) as Extract<RespuestaLocal, { estado: "OK" }>;
    const pedirGeneral = async (d: DependenciasSesion) =>
      JSON.parse(await (await manejarGeneral(new Request(`${ORIGEN}/api/chats/general`, { headers: conCookie(cookie) }), d)).text()) as Extract<RespuestaGeneral, { estado: "OK" }>;
    assert.equal((await pedirLocal(deps(null))).preguntas, false);
    assert.equal((await pedirGeneral(deps(null))).preguntas, false);
    assert.equal((await pedirLocal(deps({ AZUL_CHAT_GEMINI_API_KEY: "corta" }))).preguntas, false, "una clave sin forma de clave: fallo cerrado");
    assert.equal((await pedirLocal(deps())).preguntas, true);
    assert.equal((await pedirGeneral(deps())).preguntas, true);
  });

  it("POST sin clave: IA_NO_DISPONIBLE, sin gastar ni una consulta al ERP ni llamar a la IA", async () => {
    const cookie = await vincular(ADMIN);
    erp.recibidas.length = 0;
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió hoy?", localId: 3 }, { d: deps(null) });
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "IA_NO_DISPONIBLE" });
    assert.deepEqual(capacidadesPedidas(), []);
    assert.equal(llamadasIa.length, 0);
  });

  it("la configuración: clave con forma, distinta de los otros secretos, y un tope bien escrito (o el de 5 dólares)", () => {
    assert.deepEqual(leerConfigIa({}), { ok: false, motivo: "CLAVE_AUSENTE" });
    assert.deepEqual(leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: "con espacios adentro 123456" }), { ok: false, motivo: "CLAVE_INVALIDA" });
    assert.deepEqual(leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA, AZUL_CHAT_INTEGRACION_SECRET: CLAVE_IA }), { ok: false, motivo: "CLAVE_COMPARTIDA" });
    for (const malo of ["cinco", "-1", "0", "5,50", "1e3", "5000"]) {
      assert.deepEqual(leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA, AZUL_CHAT_IA_TOPE_USD: malo }), { ok: false, motivo: "TOPE_INVALIDO" }, malo);
    }
    const porDefecto = leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA });
    assert.ok(porDefecto.ok && porDefecto.config.topeMicroUsd === 5_000_000n);
    const conTope = leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA, AZUL_CHAT_IA_TOPE_USD: "7.5" });
    assert.ok(conTope.ok && conTope.config.topeMicroUsd === 7_500_000n);
  });
});

describe("a la IA no le llega ningún dato de negocio", () => {
  it("el destino es el generateContent del modelo, y el cuerpo es la pregunta, la fecha, el local actual, los nombres y el esquema: nada más", async () => {
    const cookie = await vincular(ADMIN);
    await fondo(); // con eventos guardados y ventas en el ERP: nada de eso puede viajar
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy" });
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió hoy?", localId: CASIANO.id });
    assert.equal(r.status, 200, r.texto);
    assert.equal(llamadasIa.length, 1);
    const [llamada] = llamadasIa;
    assert.equal(llamada!.url, ENDPOINT_IA);
    assert.ok(ENDPOINT_IA.includes(`/models/${MODELO_IA}:generateContent`));
    assert.equal(llamada!.headers["x-goog-api-key"], CLAVE_IA);
    const nombres = ["Belgrano", "Casiano", "Depósito Central", "Centro"];
    assert.deepEqual(llamada!.cuerpo, {
      contents: [{ role: "user", parts: [{ text: instruccionesDeIntencion({ pregunta: "¿Cuánto vendió hoy?", hoy: HOY, localActual: "Casiano", nombres }) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: JSON.parse(JSON.stringify(esquemaDeIntencion(nombres))),
        temperature: 0,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    // Y, por si las instrucciones cambian: ningún id, token, monto ni evento adentro.
    const viajo = JSON.stringify(llamada!.cuerpo);
    const token = erp.tokenVigente(ADMIN)!;
    const v = await base.db.vinculo.findFirstOrThrow();
    for (const prohibido of [token, v.id, String(v.erpVinculoId), cookie, "localId", "grupoId", "1500.00", "Mercado Pago", "transferenciaId", "Local Centro", '"3"', ":3", "Emanuel"]) {
      assert.ok(!viajo.includes(prohibido), `a la IA le llegó ${prohibido}`);
    }
  });

  it("CONTRAPRUEBA: el candado ve un dato de negocio si viajara", () => {
    const instrucciones = instruccionesDeIntencion({ pregunta: "x", hoy: HOY, localActual: null, nombres: ["Casiano"] });
    assert.ok(!instrucciones.includes("1500.00"));
    assert.ok(`${instrucciones} total 1500.00`.includes("1500.00"));
  });
});

describe("la IA solo interpreta: lo que no cierra es NO_ENTIENDO", () => {
  const casos: [string, () => Response][] = [
    ["una clave de más", () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy", sql: "DROP" })],
    ["una intención fuera del catálogo", () => respuestaGemini({ intencion: "borrar", local: "Casiano", periodo: "hoy" })],
    ["un local que no está hoy", () => respuestaGemini({ intencion: "ventas", local: "Palermo", periodo: "hoy" })],
    ["un rango de 32 días", () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "rango", desde: "2026-09-07", hasta: "2026-10-08" })],
    ["un rango de eventos de 32 días", () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "todos", periodo: "rango", desde: "2026-09-07", hasta: "2026-10-08" })],
    ["desde después de hasta", () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "todos", periodo: "rango", desde: "2026-10-08", hasta: "2026-10-01" })],
    ["una fecha que no existe", () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "todos", periodo: "rango", desde: "2026-02-30", hasta: "2026-03-01" })],
    ["hoy con fechas", () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy", desde: HOY, hasta: HOY })],
    ["eventos sin tipo", () => respuestaGemini({ intencion: "eventos", local: "Casiano", periodo: "hoy" })],
    ["ventas con tipo de evento", () => respuestaGemini({ intencion: "ventas", tipoEvento: "pedidos", local: "Casiano", periodo: "hoy" })],
    ["un tipo de evento sin la capacidad en ese local", () => respuestaGemini({ intencion: "eventos", tipoEvento: "pedidos", local: "Casiano", periodo: "hoy" })],
    ["no es JSON", () => respuestaGemini({}, { texto: "Vendió $1.500.000" })],
    ["cortada", () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy" }, { finishReason: "MAX_TOKENS" })],
    ["no_entiendo", () => respuestaGemini({ intencion: "no_entiendo" })],
    ["una restricción fuera del catálogo (6B)", () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy", restriccionesNoSoportadas: ["sucursal"] })],
    ["restricciones que no son una lista (6B)", () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy", restriccionesNoSoportadas: null })],
    ["sin la clave de restricciones (6B)", () => respuestaGemini({}, { texto: JSON.stringify({ intencion: "ventas", tipoEvento: null, local: "Casiano", periodo: "hoy", desde: null, hasta: null }) })],
  ];
  for (const [nombre, respuesta] of casos) {
    it(nombre, async () => {
      const cookie = await vincular(ADMIN);
      respuestaIa = respuesta;
      erp.recibidas.length = 0;
      const r = await preguntar(cookie, { pregunta: "una pregunta cualquiera" });
      assert.equal(r.status, 200, r.texto);
      assert.deepEqual(r.cuerpo, { estado: "NO_ENTIENDO", ejemplos: EJEMPLOS_DE_PREGUNTAS });
      assert.deepEqual(capacidadesPedidas(), ["mi_alcance"], "no se consultó nada más al ERP");
    });
  }

  it("ventas de un local sin ventas_resumen hoy: NO_ENTIENDO, aunque tenga eventos", async () => {
    const a = erp.alcances.get(ADMIN) as Rompible<DatosMiAlcance>;
    a.locales.find((l) => l.id === CASIANO.id)!.capacidades = ["transferencias_eventos"] as never;
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy" });
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió Casiano?" });
    assert.equal(r.cuerpo.estado, "NO_ENTIENDO");
    assert.deepEqual(capacidadesPedidas().filter((c) => c === "ventas_resumen"), []);
  });
});

describe("ventas: el ERP calcula, el código suma", () => {
  it("un local: 1 mi_alcance + 1 ventas_resumen, y la tarjeta copia lo del ERP", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy" });
    erp.recibidas.length = 0;
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió hoy?", localId: CASIANO.id });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(capacidadesPedidas(), ["mi_alcance", "ventas_resumen"]);
    assert.deepEqual(r.cuerpo, {
      estado: "VENTAS",
      alcance: "LOCAL",
      periodo: { tipo: "hoy", desde: DATOS_ERP.periodo.desde, hasta: DATOS_ERP.periodo.hasta },
      ventas: {
        local: { id: 3, nombre: "Local Centro" },
        cantidadVentas: 2,
        totalVendido: "1500.00",
        mediosDePago: DATOS_ERP.mediosDePago.map((m) => ({ ...m })),
        advertencias: DATOS_ERP.advertencias.map((a) => ({ ...a })),
      },
      noSeparaPor: [],
    });
    const pedido = erp.cuerposA("consultar").find((c) => c.capacidad === "ventas_resumen")!;
    assert.deepEqual(pedido.alcance, { grupoId: 1, localId: 3 });
    assert.deepEqual(pedido.parametros, { periodo: { tipo: "hoy" } });
  });

  it("un rango: el ERP recibe el rango que validó el código", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "rango", desde: "2026-10-01", hasta: "2026-10-07" });
    erp.respuestasVentas.push(ventasDe({ id: 3, nombre: "Casiano" }, "900.00", [["EFECTIVO", "Efectivo", "900.00"]], { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-07" }));
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió Casiano la semana pasada?" });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.cuerpo.estado, "VENTAS");
    const pedido = erp.cuerposA("consultar").find((c) => c.capacidad === "ventas_resumen")!;
    assert.deepEqual(pedido.parametros, { periodo: { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-07" } });
  });

  it("todos: 1 + N consultas, y la suma (total, cantidad y cada medio) la hace el código, centavo por centavo", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "todos", periodo: "hoy" });
    // En el orden de mi_alcance: Belgrano, Casiano, Depósito, Centro (otro grupo).
    erp.respuestasVentas.push(
      ventasDe({ id: 5, nombre: "Belgrano" }, "0.01", [["EFECTIVO", "Efectivo", "0.01"]]),
      ventasDe({ id: 3, nombre: "Casiano" }, "1000.20", [["EFECTIVO", "Efectivo", "600.00"], ["MERCADOPAGO", "Mercado Pago", "400.20"]]),
      ventasDe({ id: 9, nombre: "Depósito Central" }, "0.00", []),
      // Con coma flotante este total daría …673.75: el centavo exacto es …673.66.
      ventasDe({ id: 20, nombre: "Centro", grupoId: 2 }, "635114363014673.45", [["TARJETA", "Tarjeta", "635114363014673.45"]]),
    );
    erp.recibidas.length = 0;
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendieron todos hoy?" });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(capacidadesPedidas(), ["mi_alcance", "ventas_resumen", "ventas_resumen", "ventas_resumen", "ventas_resumen"]);
    assert.equal(r.cuerpo.estado, "VENTAS");
    if (r.cuerpo.estado !== "VENTAS" || r.cuerpo.alcance !== "TODOS") throw new Error("no es TODOS");
    assert.deepEqual(r.cuerpo.fallidos, []);
    assert.deepEqual(r.cuerpo.total, {
      cantidadVentas: 4,
      totalVendido: "635114363015673.66",
      mediosDePago: [
        { medio: "EFECTIVO", etiqueta: "Efectivo", total: "600.01", cantidadPagos: 2 },
        { medio: "MERCADOPAGO", etiqueta: "Mercado Pago", total: "400.20", cantidadPagos: 1 },
        { medio: "TARJETA", etiqueta: "Tarjeta", total: "635114363014673.45", cantidadPagos: 1 },
      ],
    });
    assert.deepEqual(
      r.cuerpo.locales.map((l) => [l.local.nombre, l.totalVendido]),
      [["Belgrano", "0.01"], ["Casiano", "1000.20"], ["Depósito Central", "0.00"], ["Centro", "635114363014673.45"]],
    );
  });

  it("todos con uno caído: se dice cuál y NO hay total; los demás se muestran", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "todos", periodo: "hoy" });
    erp.respuestasVentas.push(
      ventasDe({ id: 5, nombre: "Belgrano" }, "10.00", [["EFECTIVO", "Efectivo", "10.00"]]),
      FIXTURES_ERP.errores.INTEGRACION_NO_DISPONIBLE!,
      ventasDe({ id: 9, nombre: "Depósito Central" }, "20.00", [["EFECTIVO", "Efectivo", "20.00"]]),
      ventasDe({ id: 20, nombre: "Centro", grupoId: 2 }, "30.00", [["EFECTIVO", "Efectivo", "30.00"]]),
    );
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendieron todos hoy?" });
    if (r.cuerpo.estado !== "VENTAS" || r.cuerpo.alcance !== "TODOS") throw new Error(r.texto);
    assert.equal(r.cuerpo.total, null, "un total parcial no se muestra como si fuera completo");
    assert.deepEqual(r.cuerpo.fallidos, [{ id: 3, nombre: "Casiano" }]);
    assert.deepEqual(r.cuerpo.locales.map((l) => l.local.id), [5, 9, 20]);
  });

  it("todos con el cupo del ERP lleno a mitad: no se sigue gastando; los que faltaban, fallidos", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "todos", periodo: "hoy" });
    erp.respuestasVentas.push(ventasDe({ id: 5, nombre: "Belgrano" }, "10.00", [["EFECTIVO", "Efectivo", "10.00"]]), FIXTURES_ERP.errores.LIMITE_EXCEDIDO!);
    erp.recibidas.length = 0;
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendieron todos hoy?" });
    if (r.cuerpo.estado !== "VENTAS" || r.cuerpo.alcance !== "TODOS") throw new Error(r.texto);
    assert.deepEqual(capacidadesPedidas(), ["mi_alcance", "ventas_resumen", "ventas_resumen"], "después del 429, ni una consulta más");
    assert.equal(r.cuerpo.total, null);
    assert.deepEqual(r.cuerpo.fallidos.map((f) => f.id), [3, 9, 20]);
  });

  it("un local y el ERP caído o con el cupo lleno: la falla de siempre, sin datos", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy" });
    erp.respuestasVentas.push(FIXTURES_ERP.errores.INTEGRACION_NO_DISPONIBLE!);
    const caido = await preguntar(cookie, { pregunta: "¿Cuánto vendió?", localId: 3 });
    assert.equal(caido.status, 503);
    assert.deepEqual(caido.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    erp.respuestasVentas.push(FIXTURES_ERP.errores.LIMITE_EXCEDIDO!);
    const cupo = await preguntar(cookie, { pregunta: "¿Cuánto vendió?", localId: 3 });
    assert.equal(cupo.status, 429);
    assert.deepEqual(cupo.cuerpo, { estado: "ERP_CUPO_EXCEDIDO" });
    erp.respuestasVentas.push(FIXTURES_ERP.errores.PERIODO_INVALIDO!);
    const periodo = await preguntar(cookie, { pregunta: "¿Cuánto vendió mañana?", localId: 3 });
    assert.equal(periodo.cuerpo.estado, "NO_ENTIENDO", "el futuro lo decide el ERP");
  });
});

describe("6B. lo que no se puede separar se dice: la respuesta lleva noSeparaPor", () => {
  const SABADO = "2026-10-03";

  it("ventas de un local con turno: el total del día del ERP, con noSeparaPor [turno]", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "rango", desde: SABADO, hasta: SABADO, restriccionesNoSoportadas: ["turno"] });
    erp.respuestasVentas.push(ventasDe(CASIANO, "2098250.00", [["EFECTIVO", "Efectivo", "2098250.00"]], { tipo: "rango", desde: SABADO, hasta: SABADO }));
    erp.recibidas.length = 0;
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió el sábado pasado el turno tarde?", localId: CASIANO.id });
    if (r.cuerpo.estado !== "VENTAS" || r.cuerpo.alcance !== "LOCAL") throw new Error(r.texto);
    assert.deepEqual(r.cuerpo.noSeparaPor, ["turno"]);
    assert.equal(r.cuerpo.ventas.totalVendido, "2098250.00");
    // Se pidió el día completo: el ERP no recibe nada del turno.
    const pedido = erp.cuerposA("consultar").find((c) => c.capacidad === "ventas_resumen")!;
    assert.deepEqual(pedido.parametros, { periodo: { tipo: "rango", desde: SABADO, hasta: SABADO } });
  });

  it("ventas de todos con hora y vendedor: noSeparaPor en el orden del catálogo", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "todos", periodo: "hoy", restriccionesNoSoportadas: ["vendedor", "hora", "vendedor"] });
    erp.respuestasVentas.push(
      ventasDe({ id: 5, nombre: "Belgrano" }, "10.00", [["EFECTIVO", "Efectivo", "10.00"]]),
      ventasDe(CASIANO, "20.00", [["EFECTIVO", "Efectivo", "20.00"]]),
      ventasDe({ id: 9, nombre: "Depósito Central" }, "0.00", []),
      ventasDe({ id: 20, nombre: "Centro", grupoId: 2 }, "30.00", [["EFECTIVO", "Efectivo", "30.00"]]),
    );
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió cada vendedor por hora?" });
    if (r.cuerpo.estado !== "VENTAS" || r.cuerpo.alcance !== "TODOS") throw new Error(r.texto);
    assert.deepEqual(r.cuerpo.noSeparaPor, ["hora", "vendedor"]);
    assert.equal(r.cuerpo.total?.totalVendido, "60.00");
  });

  it("ventas por medio de pago: sin aviso, el desglose ya lo muestra; con otra más, solo la otra", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy", restriccionesNoSoportadas: ["medio_de_pago"] });
    const solo = await preguntar(cookie, { pregunta: "¿Cuánto entró en efectivo?", localId: CASIANO.id });
    if (solo.cuerpo.estado !== "VENTAS") throw new Error(solo.texto);
    assert.deepEqual(solo.cuerpo.noSeparaPor, []);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy", restriccionesNoSoportadas: ["medio_de_pago", "cliente"] });
    const mas = await preguntar(cookie, { pregunta: "¿Cuánto pagó en efectivo cada cliente?", localId: CASIANO.id });
    if (mas.cuerpo.estado !== "VENTAS") throw new Error(mas.texto);
    assert.deepEqual(mas.cuerpo.noSeparaPor, ["cliente"]);
  });

  it("eventos con producto (o medio de pago): aviso; sin restricciones, noSeparaPor vacío", async () => {
    const cookie = await vincular(ADMIN);
    await fondo();
    for (const [pedidas, esperado] of [
      [["producto"], ["producto"]],
      [["medio_de_pago"], ["medio_de_pago"]],
      [[], []],
    ] as const) {
      respuestaIa = () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "Casiano", periodo: "ayer", restriccionesNoSoportadas: pedidas });
      const r = await preguntar(cookie, { pregunta: "¿Qué llegó ayer de gaseosas?", localId: CASIANO.id });
      if (r.cuerpo.estado !== "EVENTOS") throw new Error(r.texto);
      assert.deepEqual(r.cuerpo.noSeparaPor, esperado);
    }
  });

  it("CANDADO: ninguna respuesta de ventas o eventos sale sin noSeparaPor cuando la intención trae una restricción que no separa", async () => {
    const cookie = await vincular(ADMIN);
    for (const restriccion of RESTRICCIONES_NO_SOPORTADAS) {
      for (const intencion of ["ventas", "eventos"] as const) {
        respuestaIa = () =>
          respuestaGemini({
            intencion,
            tipoEvento: intencion === "eventos" ? "recibidas" : null,
            local: "Casiano",
            periodo: "hoy",
            restriccionesNoSoportadas: [restriccion],
          });
        const r = await preguntar(cookie, { pregunta: `¿Y por ${restriccion}?`, localId: CASIANO.id });
        if (r.cuerpo.estado !== "VENTAS" && r.cuerpo.estado !== "EVENTOS") throw new Error(`${intencion}/${restriccion}: ${r.texto}`);
        const separaElDesglose = intencion === "ventas" && restriccion === "medio_de_pago";
        assert.deepEqual(r.cuerpo.noSeparaPor, separaElDesglose ? [] : [restriccion], `${intencion}/${restriccion}`);
      }
    }
  });

  it("a la IA le llega el catálogo cerrado de restricciones, obligatorio", () => {
    const e = esquemaDeIntencion(["Casiano"]);
    assert.deepEqual(e.properties.restriccionesNoSoportadas, { type: "ARRAY", items: { type: "STRING", enum: [...RESTRICCIONES_NO_SOPORTADAS] } });
    assert.ok((e.required as readonly string[]).includes("restriccionesNoSoportadas"));
    assert.deepEqual([...RESTRICCIONES_NO_SOPORTADAS], ["turno", "hora", "vendedor", "producto", "categoria", "medio_de_pago", "cliente"]);
  });
});

describe("eventos: la base propia, por día de Argentina", () => {
  it("por tipo y día: el límite es la medianoche de Argentina (03:00 UTC); la historia cuenta; solo 1 mi_alcance", async () => {
    // Uno a las 23:59:59 de AYER en Argentina y otro a las 00:00:00 de HOY.
    erp.eventosPorLocal.get(CASIANO.id)!.push(
      recepcion({ local: CASIANO, transferenciaId: 190, fecha: "2026-10-08T02:59:59.999Z" }),
      recepcion({ local: CASIANO, transferenciaId: 191, fecha: "2026-10-08T03:00:00.000Z", tieneDiferencias: true, lineasConDiferencia: 1 }),
    );
    const cookie = await vincular(ADMIN);
    await fondo();
    assert.equal(await base.db.evento.count({ where: { historico: true } }), 7, "todo entró como historia (backfill)");

    respuestaIa = () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "Casiano", periodo: "ayer" });
    erp.recibidas.length = 0;
    const ayer = await preguntar(cookie, { pregunta: "¿Qué llegó ayer?", localId: CASIANO.id });
    assert.equal(ayer.status, 200, ayer.texto);
    assert.deepEqual(capacidadesPedidas(), ["mi_alcance"], "eventos: solo la autorización");
    if (ayer.cuerpo.estado !== "EVENTOS") throw new Error(ayer.texto);
    assert.equal(ayer.cuerpo.cantidad, 5);
    assert.deepEqual(ayer.cuerpo.periodo, { tipo: "ayer", desde: AYER, hasta: AYER });
    assert.deepEqual(ayer.cuerpo.local, { localId: 3, nombre: "Casiano" });
    assert.deepEqual(
      ayer.cuerpo.eventos.map((e) => (e.tipo === "TRANSFERENCIA_RECIBIDA" ? e.transferenciaId : null)),
      [190, 183, 182, 181, 180],
      "del más reciente al más antiguo",
    );
    assert.ok(ayer.cuerpo.eventos.every((e) => e.local.localId === 3 && e.historico === true));

    respuestaIa = () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "Casiano", periodo: "hoy" });
    const hoy = await preguntar(cookie, { pregunta: "¿Y hoy?", localId: CASIANO.id });
    if (hoy.cuerpo.estado !== "EVENTOS") throw new Error(hoy.texto);
    assert.equal(hoy.cuerpo.cantidad, 1);

    respuestaIa = () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas_con_diferencias", local: "todos", periodo: "rango", desde: AYER, hasta: HOY });
    const dif = await preguntar(cookie, { pregunta: "¿Qué llegó con diferencias?" });
    if (dif.cuerpo.estado !== "EVENTOS") throw new Error(dif.texto);
    assert.equal(dif.cuerpo.local, null);
    assert.deepEqual(dif.cuerpo.eventos.map((e) => (e.tipo === "TRANSFERENCIA_RECIBIDA" ? e.transferenciaId : null)).sort(), [181, 182, 191]);
  });

  it("todos: solo los locales autorizados hoy con esa capacidad; hasta 10 y 'restantes'", async () => {
    for (let i = 0; i < 12; i++) erp.eventosPorLocal.get(DEPOSITO.id)!.push(recepcion({ local: DEPOSITO, transferenciaId: 400 + i, fecha: `2026-10-07T1${i % 10}:0${i % 6}:00.000Z` }));
    const cookie = await vincular(ADMIN);
    await fondo();
    // Hoy, Depósito ya no anuncia la capacidad: no entra en "todos" aunque sus eventos estén guardados.
    const a = erp.alcances.get(ADMIN) as Rompible<DatosMiAlcance>;
    respuestaIa = () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "todos", periodo: "ayer" });
    const con = await preguntar(cookie, { pregunta: "¿Qué llegó ayer?" });
    if (con.cuerpo.estado !== "EVENTOS") throw new Error(con.texto);
    assert.equal(con.cuerpo.cantidad, 4 + 1 + 12);
    assert.equal(con.cuerpo.eventos.length, 10);
    assert.equal(con.cuerpo.restantes, 7);
    a.locales.find((l) => l.id === DEPOSITO.id)!.capacidades = ["ventas_resumen"] as never;
    const sin = await preguntar(cookie, { pregunta: "¿Qué llegó ayer?" });
    if (sin.cuerpo.estado !== "EVENTOS") throw new Error(sin.texto);
    assert.equal(sin.cuerpo.cantidad, 4);
    assert.ok(sin.cuerpo.eventos.every((e) => e.local.localId === CASIANO.id));
  });
});

describe("el tope del mes", () => {
  it("se reserva antes y se ajusta al uso real: tokens, costo con la tarifa y preguntas", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" }, { uso: { promptTokenCount: 800, candidatesTokenCount: 50, thoughtsTokenCount: 150 } });
    await preguntar(cookie, { pregunta: "hola" });
    const c = await consumo();
    assert.equal(c!.preguntas, 1);
    assert.equal(c!.tokensEntrada, 800n);
    assert.equal(c!.tokensSalida, 200n, "el razonamiento se cobra como salida");
    // 800 × 0,75 + 200 × 3,75 = 600 + 750 = 1350 millonésimas de dólar.
    assert.equal(c!.costoMicroUsd, 1350n);
    assert.equal(costoMicroUsd(800, 200, new Date(reloj)), 1350n);
    assert.ok(registros.some((r) => r.evento === "ia.pregunta" && r.costoMicroUsd === 1350));
    assert.ok(!JSON.stringify(registros).includes("hola"), "la pregunta no va al log");
  });

  it("alcanzado: SALDO_AGOTADO y la IA no se llama", async () => {
    const cookie = await vincular(ADMIN);
    const d = deps({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA, AZUL_CHAT_IA_TOPE_USD: "0.01" });
    assert.ok(reservaPorPregunta(new Date(reloj)) > 10_000n, "la reserva de una pregunta no entra en 1 centavo");
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió hoy?" }, { d });
    assert.equal(r.status, 200);
    assert.deepEqual(r.cuerpo, { estado: "SALDO_AGOTADO" });
    assert.equal(llamadasIa.length, 0);
    assert.equal(await consumo(), null, "nada reservado");
  });

  it("atómico: dos preguntas a la vez con lugar para una sola → una llega a la IA y la otra es SALDO_AGOTADO", async () => {
    const cookie = await vincular(ADMIN);
    const reserva = reservaPorPregunta(new Date(reloj));
    // Tope de 2 centavos: entra UNA reserva y no dos, mientras la primera está en curso.
    assert.ok(reserva <= 20_000n && 2n * reserva > 20_000n, `reserva ${reserva}`);
    const d = deps({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA, AZUL_CHAT_IA_TOPE_USD: "0.02" });
    assert.ok(d.ia?.ok);
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    respuestaIa = async () => {
      await espera; // la primera queda "pensando" mientras llega la segunda
      return respuestaGemini({ intencion: "no_entiendo" });
    };
    const ambas = Promise.all([preguntar(cookie, { pregunta: "una" }, { d }), preguntar(cookie, { pregunta: "dos" }, { d })]);
    // Las dos ya reservaron (o no) cuando la IA contesta.
    while (llamadasIa.length < 1) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 100));
    soltar();
    const estados = (await ambas).map((r) => r.cuerpo.estado).sort();
    assert.deepEqual(estados, ["NO_ENTIENDO", "SALDO_AGOTADO"]);
    assert.equal(llamadasIa.length, 1);
    assert.equal((await consumo())!.preguntas, 1);
  });

  it("si la IA no contesta, la reserva queda entera (no se sabe qué cobró) y la respuesta es IA_NO_DISPONIBLE", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => {
      throw new TypeError("fetch failed");
    };
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió?" });
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "IA_NO_DISPONIBLE" });
    assert.equal((await consumo())!.costoMicroUsd, reservaPorPregunta(new Date(reloj)));
    respuestaIa = () => new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }), { status: 429 });
    const cuota = await preguntar(cookie, { pregunta: "¿Cuánto vendió?" });
    assert.deepEqual(cuota.cuerpo, { estado: "IA_NO_DISPONIBLE" });
    assert.ok(registros.some((x) => x.evento === "ia.pregunta" && x.resultado === "HTTP_429"));
  });
});

describe("forma, sesión y origen", () => {
  it("lo mal formado no gasta nada: ni el ERP ni la IA", async () => {
    const cookie = await vincular(ADMIN);
    erp.recibidas.length = 0;
    for (const malo of [{}, { pregunta: "" }, { pregunta: "   " }, { pregunta: "x".repeat(301) }, { pregunta: 3 }, { pregunta: "hola", localId: "3" }, { pregunta: "hola", otra: 1 }, { pregunta: "hola", localId: 0 }]) {
      const r = await preguntar(cookie, malo);
      assert.equal(r.status, 400, JSON.stringify(malo));
      assert.deepEqual(r.cuerpo, { estado: "SOLICITUD_INVALIDA" });
    }
    for (const origen of [null, "https://otro.invalid"]) {
      const r = await preguntar(cookie, { pregunta: "hola" }, { origen });
      assert.equal(r.status, 403);
    }
    const sin = await preguntar(null, { pregunta: "hola" });
    assert.equal(sin.status, 401);
    assert.deepEqual(capacidadesPedidas(), []);
    assert.equal(llamadasIa.length, 0);
    assert.equal(await consumo(), null);
  });

  it("desde un Local que no está hoy: NO_AUTORIZADO, sin llamar a la IA", async () => {
    const cookie = await vincular(ENCARGADO);
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió?", localId: DEPOSITO.id });
    assert.equal(r.status, 403);
    assert.deepEqual(r.cuerpo, { estado: "NO_AUTORIZADO" });
    assert.equal(llamadasIa.length, 0);
  });

  it("300 caracteres entran justos; la respuesta y lo guardado no llevan la pregunta", async () => {
    const cookie = await vincular(ADMIN);
    reloj += FRECUENCIA_MINIMA_INGESTA_MS;
    const r = await preguntar(cookie, { pregunta: "ñ".repeat(300) });
    assert.equal(r.status, 200, r.texto);
    const [fila] = await base.db.$queryRawUnsafe<{ x: string }[]>(`SELECT row_to_json(c)::text AS x FROM "ConsumoIa" c`);
    assert.ok(!fila!.x.includes("ñ"), "la pregunta no se guarda");
  });
});

// ── Tanda 6C: las preguntas guardadas ───────────────────────────────────────

describe("6C. las preguntas se guardan con su respuesta y vuelven en el historial", () => {
  type Local = Extract<RespuestaLocal, { estado: "OK" }>;
  type General = Extract<RespuestaGeneral, { estado: "OK" }>;
  const verLocal = async (cookie: string, localId = CASIANO.id, cursor?: string) => {
    const q = cursor ? `localId=${localId}&cursor=${cursor}` : `localId=${localId}`;
    const res = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?${q}`, { headers: conCookie(cookie) }), deps());
    return { status: res.status, cuerpo: JSON.parse(await res.text()) as Local };
  };
  const verGeneral = async (cookie: string) =>
    JSON.parse(await (await manejarGeneral(new Request(`${ORIGEN}/api/chats/general`, { headers: conCookie(cookie) }), deps())).text()) as General;

  it("guardar y volver a ver: la misma respuesta, con cuándo se preguntó, solo en su chat", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy" });
    const r = await preguntar(cookie, { pregunta: "¿Cuánto vendió hoy?", localId: CASIANO.id });
    assert.equal(r.cuerpo.estado, "VENTAS");
    assert.ok(r.guardadaId, "la respuesta dice con qué id se guardó");

    // "Salgo y vuelvo a entrar": otra solicitud, sin nada en el navegador.
    const local = await verLocal(cookie);
    assert.equal(local.status, 200);
    assert.deepEqual(local.cuerpo.guardadas, [{ id: r.guardadaId, pregunta: "¿Cuánto vendió hoy?", creadaEn: new Date(reloj).toISOString(), respuesta: r.cuerpo }]);
    assert.deepEqual((await verGeneral(cookie)).guardadas, [], "la del Local no aparece en General");

    respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
    const g = await preguntar(cookie, { pregunta: "¿Qué temperatura va a hacer mañana?" });
    assert.deepEqual(
      (await verGeneral(cookie)).guardadas.map((x) => [x.id, x.pregunta, x.respuesta.estado]),
      [[g.guardadaId, "¿Qué temperatura va a hacer mañana?", "NO_ENTIENDO"]],
    );
    assert.equal((await verLocal(cookie)).cuerpo.guardadas.length, 1, "la de General no aparece en el Local");
  });

  it("es por persona: otra persona no ve las preguntas de la primera", async () => {
    // El encargado se vincula PRIMERO: así un guardado que no use el vínculo de quien pregunta se nota.
    const encargado = await vincular(ENCARGADO);
    const admin = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
    await preguntar(admin, { pregunta: "hola", localId: CASIANO.id });
    assert.deepEqual((await verLocal(admin)).cuerpo.guardadas.map((g) => g.pregunta), ["hola"]);
    const otro = await verLocal(encargado);
    assert.equal(otro.status, 200, JSON.stringify(otro.cuerpo));
    assert.deepEqual(otro.cuerpo.guardadas, []);
  });

  it("se guardan las respuestas que vio la pantalla (también el ERP caído y la IA que no cierra); lo que no es de la persona, no", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "Casiano", periodo: "hoy" });
    erp.respuestasVentas.push(FIXTURES_ERP.errores.INTEGRACION_NO_DISPONIBLE!);
    const caido = await preguntar(cookie, { pregunta: "¿Y ahora?", localId: CASIANO.id });
    assert.equal(caido.cuerpo.estado, "ERP_NO_DISPONIBLE");
    respuestaIa = () => respuestaGemini({}, { finishReason: "SAFETY" });
    llamadasIa.length = 0;
    const iaRara = await preguntar(cookie, { pregunta: "¿Y la IA?", localId: CASIANO.id });
    const fuera = await preguntar(cookie, { pregunta: "¿Y en otro?", localId: 999 });
    assert.equal(fuera.cuerpo.estado, "NO_AUTORIZADO");
    const filas = await base.db.pregunta.findMany({ orderBy: { id: "asc" }, select: { texto: true, erpLocalId: true, resultado: true } });
    assert.deepEqual(
      filas.map((f) => [f.texto, f.erpLocalId, (f.resultado as { estado: string }).estado]),
      [
        ["¿Y ahora?", CASIANO.id, "ERP_NO_DISPONIBLE"],
        ["¿Y la IA?", CASIANO.id, iaRara.cuerpo.estado],
      ],
      "NO_AUTORIZADO no se guarda: ese local no es de la persona",
    );
  });

  it("no cuentan como no leídos y no marcan leído", async () => {
    const cookie = await vincular(ADMIN);
    await fondo();
    const antes = await verLocal(cookie);
    const lecturaAntes = await base.db.lecturaLocal.findMany({ orderBy: { erpLocalId: "asc" } });
    respuestaIa = () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "Casiano", periodo: "ayer" });
    await preguntar(cookie, { pregunta: "¿Qué llegó ayer?", localId: CASIANO.id });
    const despues = await verLocal(cookie);
    assert.equal(despues.cuerpo.guardadas.length, 1);
    assert.equal(despues.cuerpo.noLeidos, antes.cuerpo.noLeidos);
    assert.equal(despues.cuerpo.leidoHasta, antes.cuerpo.leidoHasta);
    assert.deepEqual(await base.db.lecturaLocal.findMany({ orderBy: { erpLocalId: "asc" } }), lecturaAntes);
  });

  it("FALLO CERRADO: si hoy uno de los locales de la respuesta ya no se puede ver, la pregunta no se muestra", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "ventas", local: "todos", periodo: "hoy" });
    erp.respuestasVentas.push(
      ventasDe({ id: 5, nombre: "Belgrano" }, "10.00", [["EFECTIVO", "Efectivo", "10.00"]]),
      ventasDe(CASIANO, "20.00", [["EFECTIVO", "Efectivo", "20.00"]]),
      ventasDe({ id: 9, nombre: "Depósito Central" }, "0.00", []),
      ventasDe({ id: 20, nombre: "Centro", grupoId: 2 }, "30.00", [["EFECTIVO", "Efectivo", "30.00"]]),
    );
    await preguntar(cookie, { pregunta: "¿Cuánto vendimos entre todos?" });
    respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
    await preguntar(cookie, { pregunta: "¿Qué temperatura hace?" });
    assert.deepEqual((await verGeneral(cookie)).guardadas.map((g) => g.pregunta), ["¿Qué temperatura hace?", "¿Cuánto vendimos entre todos?"]);

    // Hoy Belgrano ya no anuncia ventas_resumen: la de "todos" trae sus ventas y se oculta. La otra no trae datos de nadie.
    const a = erp.alcances.get(ADMIN) as Rompible<DatosMiAlcance>;
    a.locales.find((l) => l.id === 5)!.capacidades = ["transferencias_eventos"] as never;
    assert.deepEqual((await verGeneral(cookie)).guardadas.map((g) => g.pregunta), ["¿Qué temperatura hace?"]);
    // Y vuelve a verse si mañana el ERP la anuncia otra vez: no se borró, se ocultó.
    a.locales.find((l) => l.id === 5)!.capacidades = ["ventas_resumen", "transferencias_eventos"] as never;
    assert.equal((await verGeneral(cookie)).guardadas.length, 2);
  });

  it("FALLO CERRADO, en un Local: eventos guardados de una capacidad que hoy ya no tiene, no se muestran", async () => {
    const cookie = await vincular(ADMIN);
    await fondo();
    respuestaIa = () => respuestaGemini({ intencion: "eventos", tipoEvento: "recibidas", local: "Casiano", periodo: "ayer" });
    await preguntar(cookie, { pregunta: "¿Qué llegó ayer?", localId: CASIANO.id });
    assert.equal((await verLocal(cookie)).cuerpo.guardadas.length, 1);
    const a = erp.alcances.get(ADMIN) as Rompible<DatosMiAlcance>;
    a.locales.find((l) => l.id === CASIANO.id)!.capacidades = ["ventas_resumen", "pedidos_eventos"] as never;
    const sin = await verLocal(cookie);
    assert.equal(sin.status, 200, JSON.stringify(sin.cuerpo));
    assert.deepEqual(sin.cuerpo.guardadas, []);
  });

  it("CONTRAPRUEBA: un requisito ilegible también la oculta (no se muestra lo que no se puede comprobar)", async () => {
    const cookie = await vincular(ADMIN);
    respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
    await preguntar(cookie, { pregunta: "hola", localId: CASIANO.id });
    assert.equal((await verLocal(cookie)).cuerpo.guardadas.length, 1);
    await base.db.pregunta.updateMany({ data: { requisitos: [{ localId: "3", capacidad: "transferencias_eventos" }] } });
    assert.equal((await verLocal(cookie)).cuerpo.guardadas.length, 0);
  });

  it("retención: a los 90 días la lectura ya no la muestra, y la corrida de fondo la borra sin tocar nada más", async () => {
    const cookie = await vincular(ADMIN);
    await fondo();
    respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
    await preguntar(cookie, { pregunta: "vieja", localId: CASIANO.id });
    reloj += 60_000;
    await preguntar(cookie, { pregunta: "nueva", localId: CASIANO.id });
    const vinculo = (await base.db.vinculo.findFirst({ select: { id: true } }))!;
    const hoy = { autorizados: [{ localId: CASIANO.id, capacidades: ["transferencias_eventos"] }], conVentas: [] };
    const aLos = (ms: number) => fuenteDePreguntas(base.db, { vinculoId: vinculo.id, erpLocalId: CASIANO.id, hoy, ahora: new Date(ms) })(null, 10);
    const NOVENTA = DIAS_DE_RETENCION * 24 * 60 * 60 * 1000;
    assert.deepEqual((await aLos(reloj - 60_000 + NOVENTA)).map((p) => p.pregunta.pregunta), ["nueva", "vieja"], "el día 90 todavía está");
    assert.deepEqual((await aLos(reloj - 60_000 + NOVENTA + 1)).map((p) => p.pregunta.pregunta), ["nueva"], "pasado el día 90 ya no se muestra");

    const eventos = await base.db.evento.count();
    const lecturas = await base.db.lecturaLocal.count();
    reloj = reloj - 60_000 + NOVENTA + 1;
    await fondo();
    assert.deepEqual((await base.db.pregunta.findMany({ select: { texto: true } })).map((p) => p.texto), ["nueva"]);
    assert.equal(await base.db.evento.count(), eventos, "no toca eventos");
    assert.equal(await base.db.lecturaLocal.count(), lecturas, "no toca lecturas");
  });
});

describe("6C. la paginación intercala preguntas y eventos sin repetir ni perder ninguno", () => {
  /** Arma un historial: los eventos reales de Casiano (ayer) y preguntas en el medio, con empates a propósito. */
  async function armar() {
    await vincular(ADMIN);
    await fondo();
    const vinculo = (await base.db.vinculo.findFirst({ select: { id: true } }))!;
    const eventos = await base.db.evento.findMany({ where: { erpLocalId: CASIANO.id }, orderBy: [{ fechaOperacion: "asc" }, { id: "asc" }] });
    assert.ok(eventos.length >= 3, "hacen falta eventos de Casiano");
    const t = (ms: number) => new Date(ms);
    const primero = eventos[0]!.fechaOperacion.getTime();
    const segundo = eventos[1]!.fechaOperacion.getTime();
    const ultimo = eventos.at(-1)!.fechaOperacion.getTime();
    const momentos = [
      t(primero - 60_000), // antes de todo
      t(primero), // empate con un evento: la pregunta va antes (más reciente) que él
      t(Math.floor((primero + segundo) / 2)), // entre dos eventos
      t(Math.floor((primero + segundo) / 2)), // empate entre dos preguntas: por id
      t(ultimo + 60_000), // después de todo
    ];
    const respuesta = { estado: "NO_ENTIENDO", ejemplos: [] } as const;
    for (const [i, creadaEn] of momentos.entries()) {
      await guardarPregunta(base.db, { vinculoId: vinculo.id, erpLocalId: CASIANO.id, texto: `p${i}`, creadaEn, respuesta, intencion: null });
    }
    const hoy = { autorizados: [{ localId: CASIANO.id, capacidades: ["transferencias_eventos"] }], conVentas: [] };
    const fuente = fuenteDePreguntas(base.db, { vinculoId: vinculo.id, erpLocalId: CASIANO.id, hoy, ahora: new Date(reloj) });
    const locales = [{ localId: CASIANO.id, tipos: ["TRANSFERENCIA_RECIBIDA" as const] }];
    return { fuente, locales };
  }

  const clave = (p: { filas: { evento: { id: string; fecha: string } }[]; preguntas: { id: string; creadaEn: string }[] }) => [
    ...p.filas.map((f) => ({ k: `e${f.evento.id}`, fecha: f.evento.fecha, p: 0, id: BigInt(f.evento.id) })),
    ...p.preguntas.map((q) => ({ k: `p${q.id}`, fecha: q.creadaEn, p: 1, id: BigInt(q.id) })),
  ];
  /** El orden del historial: más reciente primero; a igual instante, la pregunta; después, el id mayor. */
  const ordenar = <T extends { fecha: string; p: number; id: bigint }>(xs: T[]) =>
    [...xs].sort((a, b) => (a.fecha !== b.fecha ? (a.fecha > b.fecha ? -1 : 1) : a.p !== b.p ? b.p - a.p : a.id > b.id ? -1 : 1));

  it("de a 2 por página, recorrer todo da exactamente la misma secuencia que una sola página, en el orden del historial", async () => {
    const { fuente, locales } = await armar();
    const todo = await paginaDeHistorial(base.db, INSTALACION, locales, null, 100, fuente);
    assert.equal(todo.siguiente, null);
    const esperado = ordenar(clave(todo)).map((x) => x.k);
    assert.equal(esperado.filter((k) => k.startsWith("p")).length, 5);

    for (const porPagina of [1, 2, 3]) {
      const visto: string[] = [];
      let cursor: PosicionHistorial | null = null;
      for (let vuelta = 0; vuelta < 50; vuelta++) {
        const p = await paginaDeHistorial(base.db, INSTALACION, locales, cursor, porPagina, fuente);
        const k = ordenar(clave(p)).map((x) => x.k);
        assert.ok(k.length <= porPagina);
        visto.push(...k);
        if (!p.siguiente) break;
        cursor = decodificarCursor(p.siguiente);
        assert.ok(cursor, "el cursor que se emite se puede leer");
      }
      assert.deepEqual(visto, esperado, `de a ${porPagina}: ni repetidos ni perdidos, y en orden`);
    }
  });

  it("el cursor de siempre (de un evento, dos claves) sigue valiendo; el de una pregunta lleva t: p", async () => {
    const pos = { fecha: new Date("2026-10-07T12:00:00.000Z"), id: 7n };
    const viejo = Buffer.from(JSON.stringify({ f: pos.fecha.toISOString(), i: "7" }), "utf8").toString("base64url");
    assert.equal(codificarCursor(pos), viejo, "un evento se codifica exactamente como antes");
    assert.deepEqual(decodificarCursor(viejo), pos);
    const deUnaPregunta = codificarCursor({ ...pos, pregunta: true });
    assert.deepEqual(JSON.parse(Buffer.from(deUnaPregunta, "base64url").toString("utf8")), { f: pos.fecha.toISOString(), i: "7", t: "p" });
    assert.deepEqual(decodificarCursor(deUnaPregunta), { ...pos, pregunta: true });
    for (const malo of [{ f: pos.fecha.toISOString(), i: "7", t: "e" }, { f: pos.fecha.toISOString(), i: "7", t: "p", x: 1 }]) {
      assert.equal(decodificarCursor(Buffer.from(JSON.stringify(malo), "utf8").toString("base64url")), null, JSON.stringify(malo));
    }
  });

  it("por la ruta: las páginas de GET local traen eventos y preguntas, y el cursor encadena", async () => {
    const { locales } = await armar();
    void locales;
    const cookie = await vincular(ADMIN);
    const res = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${CASIANO.id}`, { headers: conCookie(cookie) }), deps());
    const r = JSON.parse(await res.text()) as Extract<RespuestaLocal, { estado: "OK" }>;
    assert.equal(r.guardadas.length, 5);
    assert.ok(r.eventos.length > 0);
    assert.deepEqual(r.guardadas.map((g) => g.pregunta), ["p4", "p3", "p2", "p1", "p0"], "del más reciente al más antiguo; a igual hora, el id mayor");
  });
});
