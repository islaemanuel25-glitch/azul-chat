// CANDADOS DE BUSCAR EN EL HISTORIAL (Tanda 10), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// sesión real → `mi_alcance` vivo (la ÚNICA consulta al ERP) → locales y tipos
// de HOY → Evento y Pregunta de la base propia → respuesta. Los eventos los
// trae la sincronización de fondo desde el ERP de mentira con estado
// (test/ayuda/erpConEstado.ts), con la forma de los reales de los fixtures:
// los cuatro de Casiano son los de erp-25172fe.json (180, 181 y 182 con
// diferencias en el mismo milisegundo, 183 desde Belgrano). Las preguntas
// guardadas se escriben como las escribe guardarPregunta, con la forma de una
// respuesta real. Ningún test llama al ERP ni a Gemini reales.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { manejarBuscar } from "../../src/server/chats/manejadores.ts";
import { manejarSincronizar } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { VERSION_RESULTADO } from "../../src/server/preguntas/guardadas.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { RespuestaBuscar, ResultadoBusqueda } from "../../src/shared/chats/buscar.ts";
import { EJEMPLOS_DE_PREGUNTAS } from "../../src/shared/chats/preguntas.ts";
import type { DatosMiAlcance, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { ADMINISTRADORES_DE_PRUEBA } from "../ayuda/accesos.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { pedido, recepcion } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const MA = FIXTURES_ERP_25172FE.miAlcance;
const alcance = (n: "adminGlobal" | "encargado") => structuredClone(MA[n].respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>;
const HISTORIA_CASIANO = structuredClone((FIXTURES_ERP_25172FE.transferenciasEventos.sinDesde.respuesta.cuerpo.datos as { eventos: EventoTransferenciaRecibida[] }).eventos);

const ADMIN = 9;
const ENCARGADO = 11;
const CASIANO = { id: 3, nombre: "Casiano" };
const DEPOSITO = { id: 9, nombre: "Depósito Central" };

let base: BaseDescartable;
let erp: ErpConEstado;
let reloj: number;

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
  erp.ponerModo("normal");
  erp.alcances.clear();
  erp.alcances.set(ADMIN, alcance("adminGlobal"));
  erp.alcances.set(ENCARGADO, alcance("encargado"));
  erp.eventosPorLocal.set(CASIANO.id, structuredClone(HISTORIA_CASIANO));
  erp.eventosPorLocal.set(DEPOSITO.id, [recepcion({ local: DEPOSITO, transferenciaId: 300, fecha: "2026-10-07T08:00:00.000Z" })]);
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
});

function deps(): DependenciasSesion {
  const registrar: (r: Registro) => void = () => {};
  return {
    config: leerConfigAzulChat({ AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE, AZUL_CHAT_ADMINISTRADORES: ADMINISTRADORES_DE_PRUEBA }),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 2000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
  };
}

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

/** La sincronización de fondo, como la llama el timer: lo único que trae del ERP. */
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

function capacidadesDe(usuarioId: number, localId: number, capacidades: string[]) {
  const l = (erp.alcances.get(usuarioId) as Rompible<DatosMiAlcance>).locales.find((x) => x.id === localId);
  assert.ok(l);
  l.capacidades = capacidades as never;
}

type Ok = Extract<RespuestaBuscar, { estado: "OK" }>;

/** GET /api/chats/buscar con esos parámetros, tal cual. */
async function buscarCon(cookie: string | null, consulta: string): Promise<{ status: number; cuerpo: Ok & Record<string, unknown> }> {
  const res = await manejarBuscar(new Request(`${ORIGEN}/api/chats/buscar?${consulta}`, { headers: cookie ? { cookie: `${NOMBRE_COOKIE}=${cookie}` } : {} }), deps());
  return { status: res.status, cuerpo: JSON.parse(await res.text()) as Ok & Record<string, unknown> };
}

/** Buscar en un Local (`localId`) o en General (null). */
async function buscar(cookie: string, texto: string, donde: number | null, filtro = "todos", cursor?: string) {
  const q = new URLSearchParams({ texto, filtro, ...(donde === null ? { general: "1" } : { localId: String(donde) }), ...(cursor ? { cursor } : {}) });
  const r = await buscarCon(cookie, q.toString());
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  return r.cuerpo;
}

/** Cada resultado, en una palabra: "E182" un evento con ese número, "P<texto>" una pregunta. */
const resumen = (r: readonly ResultadoBusqueda[]) =>
  r.map((x) => (x.tipo === "EVENTO" ? `${x.evento.tipo === "PEDIDO_SOLICITADO" ? "Pedido" : "T"}${x.evento.tipo === "PEDIDO_SOLICITADO" ? x.evento.pedidoId : x.evento.transferenciaId}` : `P:${x.guardada.pregunta}`));

const capacidadesPedidas = () => erp.cuerposA("consultar").map((c) => c.capacidad as string);

/** Una pregunta guardada como la guarda guardarPregunta: un "no entendí", que no trae datos de locales. */
async function guardada(vinculoId: string, texto: string, erpLocalId: number | null, segundosAntes: number, requisitos: unknown[] = []) {
  await base.db.pregunta.create({
    data: {
      vinculoId,
      erpLocalId,
      texto,
      creadaEn: new Date(reloj - segundosAntes * 1000),
      resultadoVersion: VERSION_RESULTADO,
      resultado: { estado: "NO_ENTIENDO", ejemplos: [...EJEMPLOS_DE_PREGUNTAS] },
      requisitos: requisitos as never,
    },
  });
}
const vinculoDe = async (usuarioId: number) => (await base.db.vinculo.findFirst({ where: { erpUsuarioId: usuarioId }, select: { id: true } }))!.id;

/** Casiano con pedidos; el pedido #182 al Depósito, del mismo número que la transferencia 182. */
async function armar() {
  capacidadesDe(ADMIN, CASIANO.id, ["ventas_resumen", "transferencias_eventos", "pedidos_eventos"]);
  erp.eventosPorCapacidad.set(`pedidos_eventos:${CASIANO.id}`, [pedido({ pedidoId: 182, fecha: "2026-10-07T16:00:00.000Z", origen: DEPOSITO, lineas: 3 })]);
  const cookie = await vincular(ADMIN);
  await fondo();
  const vinculo = await vinculoDe(ADMIN);
  await guardada(vinculo, "¿Qué pasó con la transferencia 182?", CASIANO.id, 60);
  await guardada(vinculo, "¿Cuánto vendió Casiano en Depósito?", null, 120);
  await guardada(vinculo, "¿Llegó la 1820?", CASIANO.id, 180);
  erp.recibidas.length = 0;
  return { cookie, vinculo };
}

describe("Tanda 10: buscar en el historial", () => {
  it("un número, con y sin #: la transferencia y el pedido con ese número, y las preguntas que lo contienen como número entero; 1 sola consulta al ERP, mi_alcance", async () => {
    const { cookie } = await armar();
    const sin = await buscar(cookie, "182", CASIANO.id);
    assert.deepEqual(resumen(sin.resultados), ["P:¿Qué pasó con la transferencia 182?", "Pedido182", "T182"]);
    assert.equal(sin.total, 3);
    assert.equal(sin.siguiente, null);
    assert.deepEqual(capacidadesPedidas(), ["mi_alcance"]);
    const con = await buscar(cookie, "#182", CASIANO.id);
    assert.deepEqual(con, sin);
    // "18" no es 180, ni 182, ni 1820: como número, entero.
    assert.deepEqual(resumen((await buscar(cookie, "18", CASIANO.id)).resultados), []);
    assert.deepEqual(resumen((await buscar(cookie, "# 1820", CASIANO.id)).resultados), ["P:¿Llegó la 1820?"]);
  });

  it("un texto, sin mayúsculas ni acentos: el título que se ve (sin el número), 'con diferencias', el origen y el destino, y el texto de la pregunta", async () => {
    const { cookie } = await armar();
    assert.deepEqual(resumen((await buscar(cookie, "CON DIFERENCIAS", CASIANO.id)).resultados), ["T182", "T181"]);
    assert.deepEqual(resumen((await buscar(cookie, "belgrano", CASIANO.id)).resultados), ["T183"]);
    assert.deepEqual(resumen((await buscar(cookie, "Transferencia recibida", CASIANO.id)).resultados), ["T183", "T182", "T181", "T180"]);
    assert.deepEqual(resumen((await buscar(cookie, "solicitado", CASIANO.id)).resultados), ["Pedido182"]);
    // "deposito" sin acento: el origen de 180, 181, 182 y el pedido; la pregunta de Casiano que no lo dice, no.
    assert.deepEqual(resumen((await buscar(cookie, "deposito", CASIANO.id)).resultados), ["Pedido182", "T182", "T181", "T180"]);
    // El destino de una recepción es el local: "casiano" la encuentra.
    assert.deepEqual(resumen((await buscar(cookie, "casiano", CASIANO.id)).resultados), ["T183", "T182", "T181", "T180"]);
    assert.deepEqual(resumen((await buscar(cookie, "QUÉ PASO", CASIANO.id)).resultados), ["P:¿Qué pasó con la transferencia 182?"]);
    assert.deepEqual(resumen((await buscar(cookie, "nada de esto", CASIANO.id)).resultados), []);
    assert.equal((await buscar(cookie, "nada de esto", CASIANO.id)).total, 0);
  });

  it("los filtros: Transferencias (recibidas, enviadas, canceladas), Pedidos, Preguntas; Todos junta todo", async () => {
    const { cookie } = await armar();
    assert.deepEqual(resumen((await buscar(cookie, "182", CASIANO.id, "transferencias")).resultados), ["T182"]);
    assert.deepEqual(resumen((await buscar(cookie, "182", CASIANO.id, "pedidos")).resultados), ["Pedido182"]);
    assert.deepEqual(resumen((await buscar(cookie, "182", CASIANO.id, "preguntas")).resultados), ["P:¿Qué pasó con la transferencia 182?"]);
    assert.equal((await buscar(cookie, "182", CASIANO.id, "preguntas")).total, 1);
    assert.equal((await buscar(cookie, "182", CASIANO.id, "todos")).total, 3);
  });

  it("Local contra General: el Local, solo ese local y sus preguntas; General, todos los de hoy con su local, y las preguntas de General y de cada local", async () => {
    const { cookie } = await armar();
    assert.deepEqual(resumen((await buscar(cookie, "300", CASIANO.id)).resultados), []);
    const g = await buscar(cookie, "300", null);
    assert.deepEqual(resumen(g.resultados), ["T300"]);
    assert.deepEqual(g.resultados[0]!.local, { localId: DEPOSITO.id, nombre: DEPOSITO.nombre });
    // La pregunta hecha en General no está en el Local; en General, sí, sin local.
    assert.deepEqual(resumen((await buscar(cookie, "cuanto vendio", CASIANO.id)).resultados), []);
    const gp = await buscar(cookie, "cuanto vendio", null);
    assert.deepEqual(resumen(gp.resultados), ["P:¿Cuánto vendió Casiano en Depósito?"]);
    assert.equal(gp.resultados[0]!.local, null);
    // La del Local, en General con su local.
    const gl = await buscar(cookie, "182", null);
    assert.deepEqual(resumen(gl.resultados), ["P:¿Qué pasó con la transferencia 182?", "Pedido182", "T182"]);
    assert.deepEqual(
      gl.resultados.map((r) => r.local),
      [CASIANO, CASIANO, CASIANO].map((l) => ({ localId: l.id, nombre: l.nombre })),
    );
  });

  it("un local que HOY no está autorizado no aparece: ni sus eventos en General, ni sus preguntas, y buscar en él es NO_AUTORIZADO (CONTRAPRUEBA del mismo dato)", async () => {
    const { cookie, vinculo } = await armar();
    await guardada(vinculo, "¿Y la 300 del depósito?", DEPOSITO.id, 30);
    assert.deepEqual(resumen((await buscar(cookie, "300", null)).resultados), ["P:¿Y la 300 del depósito?", "T300"]);
    capacidadesDe(ADMIN, DEPOSITO.id, ["ventas_resumen"]);
    const g = await buscar(cookie, "300", null);
    assert.deepEqual(resumen(g.resultados), []);
    assert.equal(g.total, 0);
    const r = await buscarCon(cookie, `texto=300&filtro=todos&localId=${DEPOSITO.id}`);
    assert.equal(r.status, 403);
    assert.deepEqual(r.cuerpo, { estado: "NO_AUTORIZADO" });
  });

  it("de un local con transferencias pero sin pedidos_eventos hoy, el pedido guardado no aparece", async () => {
    const { cookie } = await armar();
    capacidadesDe(ADMIN, CASIANO.id, ["ventas_resumen", "transferencias_eventos"]);
    assert.deepEqual(resumen((await buscar(cookie, "182", CASIANO.id)).resultados), ["P:¿Qué pasó con la transferencia 182?", "T182"]);
  });

  it("las preguntas de otra persona no aparecen, y una pregunta cuyos requisitos ya no se cumplen tampoco", async () => {
    const { cookie, vinculo } = await armar();
    await vincular(ENCARGADO);
    await guardada(await vinculoDe(ENCARGADO), "La 182 del encargado", CASIANO.id, 10);
    await guardada(vinculo, "La 182 con ventas de Belgrano", CASIANO.id, 20, [{ localId: 5, capacidad: "ventas_resumen" }]);
    assert.deepEqual(resumen((await buscar(cookie, "182", CASIANO.id, "preguntas")).resultados), ["P:La 182 con ventas de Belgrano", "P:¿Qué pasó con la transferencia 182?"]);
    capacidadesDe(ADMIN, 5, ["transferencias_eventos"]);
    assert.deepEqual(resumen((await buscar(cookie, "182", CASIANO.id, "preguntas")).resultados), ["P:¿Qué pasó con la transferencia 182?"]);
  });

  it("paginación: 50 por página con un cursor estable; sin repetidos ni faltantes, en orden, con el mismo total", async () => {
    const recepciones = Array.from({ length: 70 }, (_, i) =>
      recepcion({ local: CASIANO, transferenciaId: 500 + i, fecha: new Date(Date.parse("2026-10-06T10:00:00.000Z") + Math.floor(i / 3) * 60_000).toISOString() }),
    );
    erp.eventosPorLocal.set(CASIANO.id, recepciones);
    const cookie = await vincular(ADMIN);
    await fondo();
    const vinculo = await vinculoDe(ADMIN);
    // Preguntas en el mismo instante que eventos: el orden las pone primero.
    for (let i = 0; i < 6; i++) {
      await base.db.pregunta.create({
        data: {
          vinculoId: vinculo,
          erpLocalId: CASIANO.id,
          texto: `Algo de Casiano ${i}`,
          creadaEn: new Date(Date.parse("2026-10-06T10:00:00.000Z") + i * 4 * 60_000),
          resultadoVersion: VERSION_RESULTADO,
          resultado: { estado: "NO_ENTIENDO", ejemplos: [...EJEMPLOS_DE_PREGUNTAS] },
          requisitos: [],
        },
      });
    }
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    for (;;) {
      const p = await buscar(cookie, "casiano", CASIANO.id, "todos", cursor);
      assert.equal(p.total, 76);
      assert.ok(p.resultados.length <= 50);
      vistos.push(...p.resultados.map((r) => (r.tipo === "EVENTO" ? `e${r.evento.id}` : `p${r.guardada.id}`)));
      paginas++;
      if (!p.siguiente) break;
      cursor = p.siguiente;
    }
    assert.equal(paginas, 2);
    assert.equal(vistos.length, 76);
    assert.equal(new Set(vistos).size, 76, "sin repetidos");
    // El orden total de todo junto es el de una sola página enorme: del más nuevo al más viejo, la pregunta primero.
    const fechas: number[] = [];
    let c2: string | undefined;
    for (;;) {
      const p = await buscar(cookie, "casiano", CASIANO.id, "todos", c2);
      fechas.push(...p.resultados.map((r) => Date.parse(r.tipo === "EVENTO" ? r.evento.fecha : r.guardada.creadaEn)));
      if (!p.siguiente) break;
      c2 = p.siguiente;
    }
    assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a));
  });

  it("parámetros exactos: sin texto, largo, vacío, filtro raro, Local y General juntos o ninguno, general distinto de 1, cursor malo o una clave de más: 400 sin tocar el ERP", async () => {
    const cookie = await vincular(ADMIN);
    erp.recibidas.length = 0;
    for (const q of [
      "filtro=todos&localId=3",
      `texto=${"a".repeat(61)}&filtro=todos&localId=3`,
      "texto=%20%20&filtro=todos&localId=3",
      "texto=182&filtro=caja&localId=3",
      "texto=182&localId=3",
      "texto=182&filtro=todos&localId=3&general=1",
      "texto=182&filtro=todos",
      "texto=182&filtro=todos&general=2",
      "texto=182&filtro=todos&localId=0",
      "texto=182&filtro=todos&localId=3&cursor=no-es-un-cursor",
      "texto=182&filtro=todos&localId=3&capacidad=stock_consulta",
      "texto=182&texto=183&filtro=todos&localId=3",
    ]) {
      const r = await buscarCon(cookie, q);
      assert.equal(r.status, 400, q);
      assert.deepEqual(r.cuerpo, { estado: "SOLICITUD_INVALIDA" }, q);
    }
    assert.equal(erp.cuerposA("consultar").length, 0);
    // 60 justos, sí.
    assert.equal((await buscarCon(cookie, `texto=${"a".repeat(60)}&filtro=todos&localId=3`)).status, 200);
  });

  it("fallo cerrado: sin sesión 401; con el ERP caído, 503 sin un solo resultado aunque estén guardados", async () => {
    const { cookie } = await armar();
    const sin = await buscarCon(null, "texto=182&filtro=todos&localId=3");
    assert.equal(sin.status, 401);
    assert.deepEqual(sin.cuerpo, { estado: "SIN_SESION" });
    erp.ponerModo("caido");
    const r = await buscarCon(cookie, "texto=182&filtro=todos&localId=3");
    assert.equal(r.status, 503);
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
  });
});
