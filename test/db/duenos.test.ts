// CANDADOS DE VARIAS PERSONAS (Tanda 14): OTROS DUEÑOS COMO USUARIOS, DE PUNTA
// A PUNTA, CONTRA POSTGRESQL.
//
// Dos personas del ERP con alcances distintos, vinculadas a la MISMA
// instalación:
//
//   · A (id 9) ve solo Casiano;
//   · B (id 11) ve Casiano y Depósito Central;
//   · C (id 12) no tiene ningún local (se vincula y ve el estado vacío).
//
// Cada `mi_alcance` es el real de adminGlobal (25172fe) con los locales
// recortados y todas las capacidades que hoy existen anunciadas en cada uno,
// para que lo que A no ve lo deje de ver por ALCANCE y no porque al local le
// falte una capacidad. Las rutas se ejercen por sus manejadores, con la cookie
// de una sesión de verdad; la IA y el servicio de push son de mentira (como en
// preguntas.test.ts e interno.test.ts). Ningún test llama al ERP real.
//
// La última parte (la ingesta con 2, 5 y 10 personas) prende el cupo del ERP
// de mentira con los números de HOY del ERP (120 por persona, 240 por
// aplicación, ventana fija de 60 s; erpmanual limitador.js) y un reloj fijo
// para que "el mismo minuto" sea exacto. Ahí las personas tienen 5 locales
// propios cada una, con la forma del local real del fixture y otro id: así
// cada una gasta su presupuesto entero y el tope de la corrida se ejerce.

import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import ece from "http_ece";
import webpush from "web-push";

import {
  manejarBuscar,
  manejarCaja,
  manejarChats,
  manejarGeneral,
  manejarLeido,
  manejarLocal,
  manejarPendientes,
  manejarPendientesGeneral,
  manejarStock,
  manejarVentas,
} from "../../src/server/chats/manejadores.ts";
import { PRESUPUESTO_FONDO_POR_CORRIDA, PRESUPUESTO_FONDO_POR_PERSONA } from "../../src/server/chats/sincronizacion.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { leerConfigIa } from "../../src/server/ia/config.ts";
import { reservaPorPregunta } from "../../src/server/ia/tarifa.ts";
import { manejarSincronizar, type DependenciasTarea, type ResumenTarea } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import type { Registro } from "../../src/server/log.ts";
import { manejarPreguntar } from "../../src/server/preguntas/manejador.ts";
import { leerConfigPush } from "../../src/server/push/config.ts";
import { manejarSuscribir } from "../../src/server/push/manejadores.ts";
import { manejarConfiguracion, manejarSilencio } from "../../src/server/sesion/configuracion.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { ADMINISTRADORES_DE_PRUEBA } from "../ayuda/accesos.ts";
import { CUPO_ERP_DE_HOY, levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { recepcion } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const CLAVE_IA = `ia-${randomBytes(16).toString("hex")}`;
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const VAPID = webpush.generateVAPIDKeys();
const A = 9;
const B = 11;
const C = 12;
const CASIANO = { id: 3, nombre: "Casiano" };
const DEPOSITO = { id: 9, nombre: "Depósito Central" };
/** Todas las capacidades que un local anuncia hoy (src/shared/erp/contrato.ts). */
const TODAS = [
  "ventas_resumen",
  "transferencias_eventos",
  "pedidos_eventos",
  "envios_eventos",
  "cancelaciones_eventos",
  "cajas_resumen",
  "stock_consulta",
  "pedidos_pendientes",
] as const;
const LAS_CUATRO = ["transferencias_eventos", "pedidos_eventos", "envios_eventos", "cancelaciones_eventos"] as const;

const ENTORNO = {
  AZUL_CHAT_INSTALACION_ID: INSTALACION,
  AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN,
  AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE, AZUL_CHAT_ADMINISTRADORES: ADMINISTRADORES_DE_PRUEBA,
  AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA,
  AZUL_CHAT_TAREA_SECRET: SECRETO_TAREA,
  AZUL_CHAT_VAPID_PUBLICA: VAPID.publicKey,
  AZUL_CHAT_VAPID_PRIVADA: VAPID.privateKey,
  AZUL_CHAT_VAPID_CONTACTO: "mailto:prueba@ejemplo.invalid",
};

/** El `mi_alcance` real de adminGlobal, de esa persona, con solo esos locales y todas las capacidades. */
function alcanceDe(usuarioId: number, nombre: string, ids: readonly number[]): Rompible<DatosMiAlcance> {
  const a = structuredClone(FIXTURES_ERP_25172FE.miAlcance.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>;
  (a as { usuario: unknown }).usuario = { id: usuarioId, nombre };
  a.locales = a.locales.filter((l) => ids.includes(l.id as number)) as never;
  for (const l of a.locales) l.capacidades = [...TODAS] as never;
  return a;
}

let base: BaseDescartable;
let erp: ErpConEstado;
let reloj: number;
let registros: Registro[];
let enviados: { endpoint: string; aviso: Record<string, unknown> }[];
const telefonos = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();
/** Lo que contesta la IA de mentira. */
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
  erp.respuestasEventos.length = 0;
  erp.respuestaParaLocal.clear();
  erp.eventosPorLocal.clear();
  erp.eventosPorCapacidad.clear();
  erp.respuestaParaCapacidad.clear();
  erp.respuestasVentas.length = 0;
  erp.respuestasCajas.length = 0;
  erp.respuestasStock.length = 0;
  erp.ponerModo("normal");
  erp.cupo.desactivar();
  erp.alcances.clear();
  erp.alcances.set(A, alcanceDe(A, "Dueño A", [CASIANO.id]));
  erp.alcances.set(B, alcanceDe(B, "Dueño B", [CASIANO.id, DEPOSITO.id]));
  erp.alcances.set(C, alcanceDe(C, "Dueño C", []));
  erp.eventosPorLocal.set(CASIANO.id, [recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-07T10:00:00.000Z" })]);
  erp.eventosPorLocal.set(DEPOSITO.id, [recepcion({ local: DEPOSITO, transferenciaId: 300, fecha: "2026-10-07T08:00:00.000Z" })]);
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
  registros = [];
  enviados = [];
  respuestaIa = () => respuestaGemini({ intencion: "no_entiendo" });
});

/** Una respuesta de `generateContent` con esa intención (los campos que faltan, en null). Como en preguntas.test.ts. */
function respuestaGemini(salida: Record<string, unknown>): Response {
  const completa = { intencion: null, tipoEvento: null, local: null, periodo: null, desde: null, hasta: null, turno: null, modoStock: null, producto: null, restriccionesNoSoportadas: [], ...salida };
  const uso = { promptTokenCount: 600, candidatesTokenCount: 40, thoughtsTokenCount: 120 };
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(completa) }] } }],
      usageMetadata: { ...uso, totalTokenCount: 760 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function deps(topeUsd = "5"): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  const ia = leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA, AZUL_CHAT_IA_TOPE_USD: topeUsd });
  assert.ok(ia.ok);
  return {
    config: leerConfigAzulChat(ENTORNO),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 2000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
    ia,
    transporteIa: async () => respuestaIa(),
  };
}

/** El servicio de push de mentira: descifra con la clave del teléfono (como interno.test.ts). */
const servicioPush: typeof fetch = async (url, init) => {
  const endpoint = String(url);
  const t = telefonos.get(endpoint);
  assert.ok(t, `push a un endpoint desconocido: ${endpoint}`);
  const plano = ece.decrypt(Buffer.from(init!.body as Uint8Array), { version: "aes128gcm", privateKey: t.ecdh, authSecret: t.auth.toString("base64url") });
  enviados.push({ endpoint, aviso: JSON.parse(plano.toString("utf8")) as Record<string, unknown> });
  return new Response(null, { status: 201 });
};

function depsTarea(): DependenciasTarea {
  const puerta = leerPuertaTarea(ENTORNO);
  const push = leerConfigPush(ENTORNO);
  assert.ok(puerta.ok && push.ok);
  return { ...deps(), puerta, push, transportePush: servicioPush };
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

/** Un teléfono suscripto a los avisos de esa sesión. */
async function telefono(cookie: string, nombre: string): Promise<string> {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/prueba-${nombre}-${randomBytes(6).toString("hex")}`;
  telefonos.set(endpoint, { ecdh, auth });
  const res = await manejarSuscribir(
    new Request(`${ORIGEN}/api/push/suscribir`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) },
      body: JSON.stringify({ endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }),
    }),
    { ...deps(), push: leerConfigPush(ENTORNO) as never },
  );
  assert.equal(res.status, 200, await res.clone().text());
  return endpoint;
}

/** La corrida de fondo, como la llama el timer. */
async function fondo(d: DependenciasTarea = depsTarea()): Promise<ResumenTarea> {
  const res = await manejarSincronizar(
    new Request("http://127.0.0.1:3100/api/interno/sincronizar", {
      method: "POST",
      headers: { host: "127.0.0.1:3100", "x-forwarded-proto": "http", [CABECERA_SECRETO_TAREA]: SECRETO_TAREA },
    }),
    d,
  );
  const texto = await res.text();
  assert.equal(res.status, 200, texto);
  return JSON.parse(texto) as ResumenTarea;
}

type Cuerpo = Record<string, unknown> & { estado: string };
async function get(manejar: (r: Request, d: DependenciasSesion) => Promise<Response>, ruta: string, cookie: string): Promise<{ status: number; cuerpo: Cuerpo }> {
  const res = await manejar(new Request(`${ORIGEN}${ruta}`, { headers: conCookie(cookie) }), deps());
  return { status: res.status, cuerpo: (await res.json()) as Cuerpo };
}
async function post(manejar: (r: Request, d: DependenciasSesion) => Promise<Response>, ruta: string, cookie: string, cuerpo: unknown, d = deps(), metodo = "POST") {
  const res = await manejar(
    new Request(`${ORIGEN}${ruta}`, { method: metodo, headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) }, body: JSON.stringify(cuerpo) }),
    d,
  );
  return { status: res.status, cuerpo: (await res.json()) as Cuerpo };
}

const localesDe = async (cookie: string) => ((await get(manejarChats, "/api/chats", cookie)).cuerpo.locales as { localId: number }[]).map((l) => l.localId);
const localesDeEventos = (eventos: unknown) => [...new Set((eventos as { local: { localId: number } }[]).map((e) => e.local.localId))].sort();
const preguntar = (cookie: string, pregunta: string, localId?: number, d = deps()) =>
  post(manejarPreguntar, "/api/chats/preguntar", cookie, localId === undefined ? { pregunta } : { pregunta, localId }, d);

// ─────────────────────────────────────────────────────────────────────────────

describe("Tanda 14: cada persona ve solo lo que el ERP le permite", () => {
  it("la lista y General: A solo Casiano; B Casiano y Depósito; C, ninguno (sin error)", async () => {
    const a = await vincular(A);
    const b = await vincular(B);
    const c = await vincular(C);
    await fondo();
    assert.deepEqual(await localesDe(a), [CASIANO.id]);
    assert.deepEqual((await localesDe(b)).sort(), [CASIANO.id, DEPOSITO.id]);
    const vacia = await get(manejarChats, "/api/chats", c);
    assert.equal(vacia.status, 200, "sin locales no es un error");
    assert.deepEqual(vacia.cuerpo.locales, []);
    assert.deepEqual(localesDeEventos((await get(manejarGeneral, "/api/chats/general", a)).cuerpo.eventos), [CASIANO.id]);
    assert.deepEqual(localesDeEventos((await get(manejarGeneral, "/api/chats/general", b)).cuerpo.eventos), [CASIANO.id, DEPOSITO.id]);
    assert.deepEqual((await get(manejarGeneral, "/api/chats/general", c)).cuerpo.eventos, []);
  });

  it("manipulando el id: A pide Depósito en cada ruta y en todas es NO_AUTORIZADO, sin datos", async () => {
    const a = await vincular(A);
    await vincular(B);
    await fondo();
    const rutas: [string, (r: Request, d: DependenciasSesion) => Promise<Response>, string][] = [
      ["local", manejarLocal, `/api/chats/local?localId=${DEPOSITO.id}`],
      ["ventas", manejarVentas, `/api/chats/ventas?localId=${DEPOSITO.id}`],
      ["caja", manejarCaja, `/api/chats/caja?localId=${DEPOSITO.id}`],
      ["stock", manejarStock, `/api/chats/stock?localId=${DEPOSITO.id}`],
      ["pendientes", manejarPendientes, `/api/chats/pendientes?localId=${DEPOSITO.id}`],
      ["buscar", manejarBuscar, `/api/chats/buscar?texto=300&filtro=todos&localId=${DEPOSITO.id}`],
    ];
    for (const [nombre, manejar, ruta] of rutas) {
      const r = await get(manejar, ruta, a);
      assert.equal(r.cuerpo.estado, "NO_AUTORIZADO", `${nombre}: ${JSON.stringify(r.cuerpo)}`);
      assert.equal(r.status, 403, nombre);
    }
    // Marcar leído un local ajeno: nada se marca, ni el propio que va al lado.
    const leido = await post(manejarLeido, "/api/chats/leido", a, { marcas: [{ localId: CASIANO.id, hastaEventoId: "999999" }, { localId: DEPOSITO.id, hastaEventoId: "999999" }] });
    assert.notEqual(leido.cuerpo.estado, "OK");
    assert.equal(await base.db.lecturaLocal.count(), 0);
    // Buscar en todos y Pendientes de todos: solo lo suyo.
    const busqueda = await get(manejarBuscar, "/api/chats/buscar?texto=Transferencia&filtro=todos&general=1", a);
    assert.equal(busqueda.cuerpo.estado, "OK");
    assert.deepEqual([...new Set((busqueda.cuerpo.resultados as { local: { localId: number } }[]).map((x) => x.local.localId))], [CASIANO.id]);
    const pendientes = await get(manejarPendientesGeneral, "/api/chats/pendientes/general", a);
    assert.equal(pendientes.cuerpo.estado, "OK", JSON.stringify(pendientes.cuerpo));
    assert.ok(!JSON.stringify(pendientes.cuerpo).includes(DEPOSITO.nombre), "Pendientes de A no nombra Depósito");
  });

  it("CONTRAPRUEBA: B, que sí tiene Depósito, lo ve por las mismas rutas", async () => {
    await vincular(A);
    const b = await vincular(B);
    await fondo();
    assert.equal((await get(manejarLocal, `/api/chats/local?localId=${DEPOSITO.id}`, b)).cuerpo.estado, "OK");
    assert.equal((await get(manejarCaja, `/api/chats/caja?localId=${DEPOSITO.id}`, b)).cuerpo.estado, "OK");
    assert.equal((await get(manejarStock, `/api/chats/stock?localId=${DEPOSITO.id}`, b)).cuerpo.estado, "OK");
  });

  it("las preguntas guardadas son de quien las hizo: A no ve las de B, ni en Casiano (que comparten), ni en General, ni buscando", async () => {
    const a = await vincular(A);
    const b = await vincular(B);
    await fondo();
    const rango = { intencion: "eventos", tipoEvento: "recibidas", periodo: "rango", desde: "2026-10-01", hasta: "2026-10-08" };
    respuestaIa = () => respuestaGemini({ ...rango, local: "Casiano" });
    assert.equal((await preguntar(b, "¿Qué le llegó a Casiano de B?", CASIANO.id)).cuerpo.estado, "EVENTOS");
    respuestaIa = () => respuestaGemini({ ...rango, local: "todos" });
    assert.equal((await preguntar(b, "¿Qué llegó a todos de B?")).cuerpo.estado, "EVENTOS");
    respuestaIa = () => respuestaGemini({ ...rango, local: "Casiano" });
    assert.equal((await preguntar(a, "¿Qué le llegó a Casiano de A?", CASIANO.id)).cuerpo.estado, "EVENTOS");
    const textos = (g: unknown) => (g as { pregunta: string }[]).map((x) => x.pregunta).sort();
    assert.deepEqual(textos((await get(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, a)).cuerpo.guardadas), ["¿Qué le llegó a Casiano de A?"]);
    assert.deepEqual(textos((await get(manejarGeneral, "/api/chats/general", a)).cuerpo.guardadas), []);
    assert.deepEqual(textos((await get(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, b)).cuerpo.guardadas), ["¿Qué le llegó a Casiano de B?"]);
    assert.deepEqual(textos((await get(manejarGeneral, "/api/chats/general", b)).cuerpo.guardadas), ["¿Qué llegó a todos de B?"]);
    const buscada = await get(manejarBuscar, "/api/chats/buscar?texto=llegó&filtro=preguntas&general=1", a);
    assert.deepEqual(
      (buscada.cuerpo.resultados as { guardada: { pregunta: string } }[]).map((x) => x.guardada.pregunta),
      ["¿Qué le llegó a Casiano de A?"],
      "buscar en todos trae solo las de A",
    );
  });

  it("la configuración es de cada uno: el silencio de A no cambia el de B, y cada uno ve solo sus dispositivos", async () => {
    const a = await vincular(A);
    const b = await vincular(B);
    const d = deps();
    assert.equal((await post(manejarSilencio, "/api/sesion/silencio", a, { activo: true, desde: 22, hasta: 7 }, d, "PUT")).cuerpo.estado, "OK");
    const conf = async (cookie: string) => (await get(manejarConfiguracion, "/api/sesion/configuracion", cookie)).cuerpo;
    assert.deepEqual((await conf(a)).silencio, { activo: true, desde: 22, hasta: 7 });
    assert.deepEqual((await conf(b)).silencio, { activo: false, desde: 0, hasta: 7 });
    assert.equal(((await conf(b)).dispositivos as unknown[]).length, 1);
  });
});

describe("Tanda 14: avisos y leído, por persona", () => {
  it("un evento de Depósito avisa solo a B; uno de Casiano, a los dos; cada uno con su teléfono", async () => {
    const a = await vincular(A);
    const b = await vincular(B);
    const ta = await telefono(a, "a");
    const tb = await telefono(b, "b");
    await fondo(); // el backfill no se avisa
    assert.equal(enviados.length, 0);
    reloj += 2 * 60_000;
    erp.eventosPorLocal.get(DEPOSITO.id)!.push(recepcion({ local: DEPOSITO, transferenciaId: 301, fecha: "2026-10-08T11:00:00.000Z" }));
    await fondo();
    assert.deepEqual(
      enviados.map((e) => [e.endpoint, e.aviso.cuerpo]),
      [[tb, "Depósito Central: Transferencia #301 recibida"]],
    );
    enviados.length = 0;
    reloj += 2 * 60_000;
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 405, fecha: "2026-10-08T11:30:00.000Z" }));
    await fondo();
    assert.deepEqual(enviados.map((e) => e.endpoint).sort(), [ta, tb].sort());
  });

  it("lo leído por A no marca leído a B, en el local que comparten", async () => {
    const a = await vincular(A);
    const b = await vincular(B);
    await fondo();
    // La primera vista fija la base de lo leído de cada uno (eventos/lectura.ts).
    await localesDe(a);
    await localesDe(b);
    reloj += 2 * 60_000;
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 405, fecha: "2026-10-08T11:30:00.000Z" }));
    await fondo();
    const noLeidos = async (cookie: string) => ((await get(manejarChats, "/api/chats", cookie)).cuerpo.locales as { localId: number; noLeidos: number }[]).find((l) => l.localId === CASIANO.id)!.noLeidos;
    assert.equal(await noLeidos(a), 1);
    assert.equal(await noLeidos(b), 1);
    const r = await post(manejarLeido, "/api/chats/leido", a, { marcas: [{ localId: CASIANO.id, hastaEventoId: "999999" }] });
    assert.equal(r.cuerpo.estado, "OK", JSON.stringify(r.cuerpo));
    assert.equal(await noLeidos(a), 0);
    assert.equal(await noLeidos(b), 1, "B sigue sin leerlo");
  });

  it("cuando el ERP le saca Casiano a A, en el pedido siguiente deja de verlo (fail closed), y deja de recibir sus avisos", async () => {
    const a = await vincular(A);
    const b = await vincular(B);
    const ta = await telefono(a, "a");
    const tb = await telefono(b, "b");
    await fondo();
    assert.equal((await get(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, a)).cuerpo.estado, "OK");
    erp.alcances.set(A, alcanceDe(A, "Dueño A", []));
    assert.equal((await get(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, a)).cuerpo.estado, "NO_AUTORIZADO");
    assert.deepEqual(await localesDe(a), []);
    assert.deepEqual((await get(manejarGeneral, "/api/chats/general", a)).cuerpo.eventos, [], "ni en General: lo guardado no es un permiso");
    reloj += 2 * 60_000;
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 406, fecha: "2026-10-08T11:40:00.000Z" }));
    await fondo();
    assert.deepEqual(enviados.map((e) => e.endpoint), [tb], `A (${ta}) ya no recibe avisos de Casiano`);
  });
});

describe("Tanda 14: el tope de IA es uno solo para todo el negocio", () => {
  it("con lugar para una sola pregunta más: la hace A, y después se corta igual para B y para A", async () => {
    const a = await vincular(A);
    const b = await vincular(B);
    const reserva = reservaPorPregunta(new Date(reloj));
    // Lo gastado deja lugar justo para UNA reserva más.
    await base.db.consumoIa.create({ data: { mes: "2026-10", costoMicroUsd: 5_000_000n - reserva, preguntas: 7 } });
    assert.equal((await preguntar(a, "hola")).cuerpo.estado, "NO_ENTIENDO");
    assert.equal((await preguntar(b, "hola")).cuerpo.estado, "SALDO_AGOTADO", "lo que gastó A cuenta para B");
    assert.equal((await preguntar(a, "hola")).cuerpo.estado, "SALDO_AGOTADO");
    const ia = async (cookie: string) => (await get(manejarConfiguracion, "/api/sesion/configuracion", cookie)).cuerpo.ia as { gastadoCentavos: number; agotado: boolean };
    assert.deepEqual([(await ia(a)).agotado, (await ia(b)).agotado], [true, true]);
    assert.equal((await ia(a)).gastadoCentavos, (await ia(b)).gastadoCentavos);
  });
});

// ── La ingesta con varias personas ──────────────────────────────────────────

/** 5 locales propios de la persona n, con la forma del local real (Casiano) y otros ids. */
function cincoPropios(usuarioId: number, n: number): Rompible<DatosMiAlcance> {
  const a = alcanceDe(usuarioId, `Dueño ${n}`, [CASIANO.id]);
  const molde = a.locales[0]!;
  a.locales = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(molde), id: 100 + n * 10 + i, nombre: `Local ${n}-${i}`, capacidades: [...LAS_CUATRO] })) as never;
  return a;
}

describe("Tanda 14: la ingesta con 2, 5 y 10 personas entra en el cupo del ERP", () => {
  let relojErp: number;
  const personas = (n: number) => Array.from({ length: n }, (_, i) => 1000 + i);
  async function prepararPersonas(n: number): Promise<Map<number, string>> {
    const cookies = new Map<number, string>();
    for (const [i, u] of personas(n).entries()) {
      erp.alcances.set(u, cincoPropios(u, i));
      cookies.set(u, await vincular(u));
    }
    erp.recibidas.length = 0;
    relojErp = 5_000_000;
    erp.cupo.activar({ ...CUPO_ERP_DE_HOY, ahora: () => relojErp });
    return cookies;
  }
  /** Consultas al ERP por persona, de lo que llegó desde la última limpieza. */
  function porPersona(n: number): Map<number, number> {
    const cuenta = new Map<number, number>();
    const deToken = new Map(personas(n).map((u) => [erp.tokenVigente(u), u] as const));
    for (const c of erp.cuerposA("consultar")) {
      const u = deToken.get((c.delegacion as { token: string }).token)!;
      cuenta.set(u, (cuenta.get(u) ?? 0) + 1);
    }
    return cuenta;
  }

  for (const n of [2, 5]) {
    it(`${n} personas: una corrida las atiende a todas, ninguna pasa de ${PRESUPUESTO_FONDO_POR_PERSONA} y el ERP no rechaza nada`, async () => {
      await prepararPersonas(n);
      const r = await fondo();
      assert.equal(r.personas, n);
      assert.equal(r.personasPospuestas, 0);
      const cuenta = porPersona(n);
      assert.equal(cuenta.size, n);
      for (const [u, k] of cuenta) assert.ok(k <= PRESUPUESTO_FONDO_POR_PERSONA, `persona ${u}: ${k}`);
      assert.equal(r.consultasErp, [...cuenta.values()].reduce((x, y) => x + y, 0));
      assert.ok(r.consultasErp <= PRESUPUESTO_FONDO_POR_CORRIDA);
      assert.equal(erp.cupo.rechazos(), 0);
    });
  }

  it("10 personas: la corrida no pasa del tope total; las que no entran van primero en la siguiente, y en dos corridas se atiende a todas", async () => {
    await prepararPersonas(10);
    const r1 = await fondo();
    const primera = porPersona(10);
    assert.ok(r1.consultasErp <= PRESUPUESTO_FONDO_POR_CORRIDA, `${r1.consultasErp}`);
    assert.equal(r1.personas, Math.floor(PRESUPUESTO_FONDO_POR_CORRIDA / PRESUPUESTO_FONDO_POR_PERSONA));
    assert.equal(r1.personasPospuestas, 10 - r1.personas);
    for (const k of primera.values()) assert.ok(k <= PRESUPUESTO_FONDO_POR_PERSONA);
    // La siguiente: otro minuto del ERP, 2 minutos de reloj.
    erp.recibidas.length = 0;
    relojErp += 61_000;
    reloj += 2 * 60_000;
    const r2 = await fondo();
    const segunda = porPersona(10);
    assert.ok(r2.consultasErp <= PRESUPUESTO_FONDO_POR_CORRIDA);
    const pospuestas = personas(10).filter((u) => !primera.has(u));
    for (const u of pospuestas) assert.ok(segunda.has(u), `la persona ${u}, que quedó afuera, va en la siguiente`);
    assert.deepEqual(new Set([...primera.keys(), ...segunda.keys()]).size, 10);
    assert.equal(erp.cupo.rechazos(), 0);
  });

  it("10 personas navegando a fondo en el MISMO minuto que la corrida: el cupo por aplicación (240) alcanza, cero rechazos", async () => {
    const cookies = await prepararPersonas(10);
    await fondo();
    for (const [u, cookie] of cookies) {
      const propios = (erp.alcances.get(u) as unknown as DatosMiAlcance).locales.map((l) => l.id);
      // La navegación intensa de un minuto: lista, 5 locales, General, Ventas (2), Actualizar ×3 = 12.
      await get(manejarChats, "/api/chats", cookie);
      for (const id of propios) await get(manejarLocal, `/api/chats/local?localId=${id}`, cookie);
      await get(manejarGeneral, "/api/chats/general", cookie);
      await get(manejarVentas, `/api/chats/ventas?localId=${propios[0]}`, cookie);
      for (let i = 0; i < 3; i++) await get(manejarChats, "/api/chats", cookie);
    }
    assert.ok(erp.cuerposA("consultar").length <= CUPO_ERP_DE_HOY.maxPorAplicacion, `${erp.cuerposA("consultar").length}`);
    assert.equal(erp.cupo.rechazos(), 0);
  });
});
