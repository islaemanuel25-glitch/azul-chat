// CANDADOS DE LOS ACCESOS (Tanda 15), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// Un administrador y dos personas comunes, vinculadas a la misma instalación:
//
//   · ADMIN (id 9): administrador por AZUL_CHAT_ADMINISTRADORES. Todo, siempre.
//   · ENCARGADO (id 11) y CAJERO (id 12): comunes. Lo que pueden lo dice su
//     fila de AccesoPersona; sin fila, nada.
//
// Los tres tienen en el ERP de mentira el `mi_alcance` real de adminGlobal
// (25172fe) recortado a Casiano, con todas las capacidades: así lo que una
// persona no ve, no lo ve por su ACCESO en Azul Chat y no porque el ERP no se
// lo dé (salvo en el caso que prueba justo eso). Las rutas se ejercen por sus
// manejadores con la cookie de una sesión de verdad. Ningún test llama al ERP
// ni a una IA reales.

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
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { leerConfigIa } from "../../src/server/ia/config.ts";
import { manejarSincronizar, type DependenciasTarea, type ResumenTarea } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import type { Registro } from "../../src/server/log.ts";
import { manejarPreguntar } from "../../src/server/preguntas/manejador.ts";
import { leerConfigPush } from "../../src/server/push/config.ts";
import { manejarSuscribir } from "../../src/server/push/manejadores.ts";
import { manejarAccesos, manejarGuardarAccesos } from "../../src/server/sesion/accesos.ts";
import { manejarCerrarOtras, manejarConfiguracion, manejarSilencio } from "../../src/server/sesion/configuracion.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarEstado } from "../../src/server/sesion/estado.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import { PERMISOS, TODOS_LOS_PERMISOS, type Permiso, type Permisos } from "../../src/shared/sesion/accesos.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { recepcion } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const CLAVE_IA = `ia-${randomBytes(16).toString("hex")}`;
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const VAPID = webpush.generateVAPIDKeys();
const ADMIN = 9;
const ENCARGADO = 11;
const CAJERO = 12;
const CASIANO = { id: 3, nombre: "Casiano" };
const TODAS = ["ventas_resumen", "transferencias_eventos", "pedidos_eventos", "envios_eventos", "cancelaciones_eventos", "cajas_resumen", "stock_consulta", "pedidos_pendientes"];

/** `null`: sin la variable. */
const entorno = (administradores: string | null = String(ADMIN)) => ({
  AZUL_CHAT_INSTALACION_ID: INSTALACION,
  AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN,
  AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE,
  AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA,
  AZUL_CHAT_TAREA_SECRET: SECRETO_TAREA,
  AZUL_CHAT_VAPID_PUBLICA: VAPID.publicKey,
  AZUL_CHAT_VAPID_PRIVADA: VAPID.privateKey,
  AZUL_CHAT_VAPID_CONTACTO: "mailto:prueba@ejemplo.invalid",
  ...(administradores === null ? {} : { AZUL_CHAT_ADMINISTRADORES: administradores }),
});

/** El `mi_alcance` real de adminGlobal, de esa persona, solo con Casiano y esas capacidades. */
function alcanceDe(usuarioId: number, nombre: string, capacidades: readonly string[] = TODAS): Rompible<DatosMiAlcance> {
  const a = structuredClone(FIXTURES_ERP_25172FE.miAlcance.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>;
  (a as { usuario: unknown }).usuario = { id: usuarioId, nombre };
  a.locales = a.locales.filter((l) => l.id === CASIANO.id) as never;
  for (const l of a.locales) l.capacidades = [...capacidades] as never;
  return a;
}

let base: BaseDescartable;
let erp: ErpConEstado;
let reloj: number;
let registros: Registro[];
let administradores: string | null;
let enviados: { endpoint: string }[];
const telefonos = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();

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
  erp.eventosPorLocal.clear();
  erp.eventosPorCapacidad.clear();
  erp.respuestaParaCapacidad.clear();
  erp.respuestasVentas.length = 0;
  erp.respuestasCajas.length = 0;
  erp.respuestasStock.length = 0;
  erp.ponerModo("normal");
  erp.cupo.desactivar();
  erp.alcances.clear();
  erp.alcances.set(ADMIN, alcanceDe(ADMIN, "Emanuel"));
  erp.alcances.set(ENCARGADO, alcanceDe(ENCARGADO, "Encargada Casiano"));
  erp.alcances.set(CAJERO, alcanceDe(CAJERO, "Cajero Casiano"));
  erp.eventosPorLocal.set(CASIANO.id, [recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-07T10:00:00.000Z" })]);
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
  registros = [];
  administradores = String(ADMIN);
  enviados = [];
});

function deps(): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  const ia = leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA });
  assert.ok(ia.ok);
  return {
    config: leerConfigAzulChat(entorno(administradores)),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 2000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
    ia,
    transporteIa: async () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify({ intencion: "no_entiendo", tipoEvento: null, local: null, periodo: null, desde: null, hasta: null, turno: null, modoStock: null, producto: null, restriccionesNoSoportadas: [] }) }] } }],
          usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 40, thoughtsTokenCount: 120, totalTokenCount: 760 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  };
}

const servicioPush: typeof fetch = async (url, init) => {
  const endpoint = String(url);
  const t = telefonos.get(endpoint);
  assert.ok(t);
  ece.decrypt(Buffer.from(init!.body as Uint8Array), { version: "aes128gcm", privateKey: t.ecdh, authSecret: t.auth.toString("base64url") });
  enviados.push({ endpoint });
  return new Response(null, { status: 201 });
};

function depsTarea(): DependenciasTarea {
  const puerta = leerPuertaTarea(entorno());
  const push = leerConfigPush(entorno());
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

type Cuerpo = Record<string, unknown> & { estado: string; motivo?: string };
type Manejador = (r: Request, d: DependenciasSesion) => Promise<Response>;
async function pedir(manejar: Manejador, ruta: string, cookie: string, metodo = "GET", cuerpo?: unknown, origen: string | null = ORIGEN) {
  const headers: Record<string, string> = { ...conCookie(cookie) };
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  if (origen !== null && metodo !== "GET") headers.origin = origen;
  const res = await manejar(new Request(`${ORIGEN}${ruta}`, { method: metodo, headers, ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }) }), deps());
  return { status: res.status, cuerpo: (await res.json()) as Cuerpo };
}

/** Todas las rutas de datos de Azul Chat, con un pedido válido y el permiso que piden. */
const RUTAS: readonly { nombre: string; permiso: Permiso; manejar: Manejador; ruta: string; metodo?: string; cuerpo?: unknown }[] = [
  { nombre: "la lista", permiso: "entrar", manejar: manejarChats, ruta: "/api/chats" },
  { nombre: "un local", permiso: "entrar", manejar: manejarLocal, ruta: `/api/chats/local?localId=${CASIANO.id}` },
  { nombre: "General", permiso: "entrar", manejar: manejarGeneral, ruta: "/api/chats/general" },
  { nombre: "marcar leído", permiso: "entrar", manejar: manejarLeido, ruta: "/api/chats/leido", metodo: "POST", cuerpo: { marcas: [{ localId: CASIANO.id, hastaEventoId: "1" }] } },
  { nombre: "buscar", permiso: "entrar", manejar: manejarBuscar, ruta: "/api/chats/buscar?texto=404&filtro=todos&general=1" },
  { nombre: "ventas", permiso: "ventas", manejar: manejarVentas, ruta: `/api/chats/ventas?localId=${CASIANO.id}` },
  { nombre: "caja", permiso: "caja", manejar: manejarCaja, ruta: `/api/chats/caja?localId=${CASIANO.id}` },
  { nombre: "stock", permiso: "stock", manejar: manejarStock, ruta: `/api/chats/stock?localId=${CASIANO.id}` },
  { nombre: "pendientes", permiso: "pendientes", manejar: manejarPendientes, ruta: `/api/chats/pendientes?localId=${CASIANO.id}` },
  { nombre: "pendientes de todos", permiso: "pendientes", manejar: manejarPendientesGeneral, ruta: "/api/chats/pendientes/general" },
  { nombre: "preguntar", permiso: "ia", manejar: manejarPreguntar, ruta: "/api/chats/preguntar", metodo: "POST", cuerpo: { pregunta: "hola" } },
];
const correr = (r: (typeof RUTAS)[number], cookie: string) => pedir(r.manejar, r.ruta, cookie, r.metodo, r.cuerpo);

/** Guarda los accesos de una persona como lo hace la pantalla del administrador. */
async function darAcceso(cookieAdmin: string, personaId: number, permisos: Partial<Permisos>) {
  const todos = Object.fromEntries(PERMISOS.map((p) => [p, permisos[p] ?? false]));
  return pedir(manejarGuardarAccesos, "/api/sesion/accesos", cookieAdmin, "PUT", { personaId, ...todos });
}

/** Consultas al ERP hechas con el token de esa persona, desde la última limpieza. */
const consultasDe = (usuarioId: number) => erp.cuerposA("consultar").filter((c) => (c.delegacion as { token: string }).token === erp.tokenVigente(usuarioId)).length;

async function fondo(): Promise<ResumenTarea> {
  const res = await manejarSincronizar(
    new Request("http://127.0.0.1:3100/api/interno/sincronizar", {
      method: "POST",
      headers: { host: "127.0.0.1:3100", "x-forwarded-proto": "http", [CABECERA_SECRETO_TAREA]: SECRETO_TAREA },
    }),
    depsTarea(),
  );
  const texto = await res.text();
  assert.equal(res.status, 200, texto);
  return JSON.parse(texto) as ResumenTarea;
}

async function telefono(cookie: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/prueba-${randomBytes(6).toString("hex")}`;
  telefonos.set(endpoint, { ecdh, auth });
  const res = await manejarSuscribir(
    new Request(`${ORIGEN}/api/push/suscribir`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) },
      body: JSON.stringify({ endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }),
    }),
    { ...deps(), push: leerConfigPush(entorno()) as never },
  );
  return { endpoint, status: res.status, cuerpo: (await res.json()) as Cuerpo };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Tanda 15: sin \"entrar\"", () => {
  it("canjea su código igual, y la sesión dice SIN_ACCESO con su nombre y ningún local", async () => {
    const c = await vincular(CAJERO);
    const r = await pedir(manejarEstado, "/api/sesion", c);
    assert.deepEqual(r.cuerpo, { estado: "SIN_ACCESO", usuario: { nombre: "Cajero Casiano" } });
  });

  it("todas las rutas de datos, la configuración y los avisos: 403 SIN_ACCESO, sin preguntarle nada al ERP", async () => {
    const c = await vincular(CAJERO);
    erp.recibidas.length = 0;
    for (const r of RUTAS) {
      const x = await correr(r, c);
      assert.equal(x.status, 403, r.nombre);
      assert.deepEqual(x.cuerpo, { estado: "SIN_ACCESO", motivo: "ENTRAR" }, r.nombre);
    }
    for (const [nombre, manejar, ruta, metodo, cuerpo] of [
      ["configuración", manejarConfiguracion, "/api/sesion/configuracion", "GET", undefined],
      ["silencio", manejarSilencio, "/api/sesion/silencio", "PUT", { activo: true, desde: 22, hasta: 7 }],
      ["cerrar otras", manejarCerrarOtras, "/api/sesion/otras", "DELETE", undefined],
    ] as const) {
      const x = await pedir(manejar, ruta, c, metodo, cuerpo);
      assert.deepEqual([x.status, x.cuerpo], [403, { estado: "SIN_ACCESO" }], nombre);
    }
    const t = await telefono(c);
    assert.deepEqual([t.status, t.cuerpo], [403, { estado: "SIN_ACCESO" }], "no se suscribe a avisos");
    assert.equal(consultasDe(CAJERO), 0, "ni una consulta al ERP con su token");
  });

  it("la ingesta de fondo no gasta consultas en ella ni le manda avisos, aunque tenga un teléfono de antes", async () => {
    const a = await vincular(ADMIN);
    const c = await vincular(CAJERO);
    assert.equal((await darAcceso(a, CAJERO, { entrar: true })).cuerpo.estado, "OK");
    const t = await telefono(c);
    assert.equal(t.status, 200);
    await darAcceso(a, CAJERO, {}); // le saca todo
    erp.recibidas.length = 0;
    const r = await fondo();
    assert.equal(r.personasSinAcceso, 1);
    assert.equal(consultasDe(CAJERO), 0);
    assert.ok(consultasDe(ADMIN) > 0, "CONTRAPRUEBA: al administrador sí");
    reloj += 2 * 60_000;
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 405, fecha: "2026-10-08T11:00:00.000Z" }));
    await fondo();
    assert.deepEqual(enviados.filter((e) => e.endpoint === t.endpoint), [], "sin avisos");
  });
});

describe("Tanda 15: cada sección con su permiso", () => {
  for (const seccion of ["ventas", "caja", "stock", "pendientes", "ia"] as const) {
    it(`con "entrar" y sin "${seccion}": solo lo de ${seccion} da 403 SIN_ACCESO; el resto anda`, async () => {
      const a = await vincular(ADMIN);
      const c = await vincular(ENCARGADO);
      await darAcceso(a, ENCARGADO, { ...TODOS_LOS_PERMISOS, [seccion]: false });
      for (const r of RUTAS) {
        const x = await correr(r, c);
        if (r.permiso === seccion) assert.deepEqual([x.status, x.cuerpo], [403, { estado: "SIN_ACCESO" }], r.nombre);
        else assert.notEqual(x.cuerpo.estado, "SIN_ACCESO", `${r.nombre}: ${JSON.stringify(x.cuerpo)}`);
      }
      // La interfaz además lo oculta: el local no anuncia esa sección.
      const local = (await pedir(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, c)).cuerpo.local as Record<string, boolean>;
      const chip = { ventas: "ventas", caja: "caja", stock: "stock", pendientes: "pendientes" } as const;
      if (seccion === "ia") assert.equal((await pedir(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, c)).cuerpo.preguntas, false);
      else assert.equal(local[chip[seccion]], false);
    });
  }

  it("sin \"ia\", tampoco ve sus preguntas guardadas, ni buscándolas", async () => {
    const a = await vincular(ADMIN);
    const c = await vincular(ENCARGADO);
    await darAcceso(a, ENCARGADO, TODOS_LOS_PERMISOS);
    assert.equal((await pedir(manejarPreguntar, "/api/chats/preguntar", c, "POST", { pregunta: "hola", localId: CASIANO.id })).cuerpo.estado, "NO_ENTIENDO");
    const guardadas = async () => ((await pedir(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, c)).cuerpo.guardadas as unknown[]).length;
    const buscadas = async () => ((await pedir(manejarBuscar, "/api/chats/buscar?texto=hola&filtro=preguntas&general=1", c)).cuerpo.resultados as unknown[]).length;
    assert.deepEqual([await guardadas(), await buscadas()], [1, 1]);
    await darAcceso(a, ENCARGADO, { ...TODOS_LOS_PERMISOS, ia: false });
    assert.deepEqual([await guardadas(), await buscadas()], [0, 0]);
  });

  it("con \"pendientes\" y sin \"caja\", Pendientes no consulta cajas (esa parte es de Caja); con \"caja\", sí", async () => {
    const a = await vincular(ADMIN);
    const c = await vincular(ENCARGADO);
    const cajas = () => erp.cuerposA("consultar").filter((x) => x.capacidad === "cajas_resumen").length;
    await darAcceso(a, ENCARGADO, { entrar: true, pendientes: true });
    erp.recibidas.length = 0;
    assert.equal((await pedir(manejarPendientes, `/api/chats/pendientes?localId=${CASIANO.id}`, c)).cuerpo.estado, "OK");
    assert.equal(cajas(), 0);
    await darAcceso(a, ENCARGADO, { entrar: true, pendientes: true, caja: true });
    erp.recibidas.length = 0;
    assert.equal((await pedir(manejarPendientes, `/api/chats/pendientes?localId=${CASIANO.id}`, c)).cuerpo.estado, "OK");
    assert.ok(cajas() > 0, "CONTRAPRUEBA");
  });

  it("prender \"caja\" a quien el ERP no le da Caja no le da Caja", async () => {
    erp.alcances.set(ENCARGADO, alcanceDe(ENCARGADO, "Encargada Casiano", TODAS.filter((x) => x !== "cajas_resumen")));
    const a = await vincular(ADMIN);
    const c = await vincular(ENCARGADO);
    await darAcceso(a, ENCARGADO, TODOS_LOS_PERMISOS);
    const caja = await pedir(manejarCaja, `/api/chats/caja?localId=${CASIANO.id}`, c);
    assert.deepEqual([caja.status, caja.cuerpo], [403, { estado: "NO_AUTORIZADO" }]);
    assert.equal(((await pedir(manejarLocal, `/api/chats/local?localId=${CASIANO.id}`, c)).cuerpo.local as Record<string, boolean>).caja, false);
  });

  it("apagar un permiso rige en el pedido siguiente, sin cerrar la sesión", async () => {
    const a = await vincular(ADMIN);
    const c = await vincular(ENCARGADO);
    await darAcceso(a, ENCARGADO, TODOS_LOS_PERMISOS);
    assert.equal((await pedir(manejarVentas, `/api/chats/ventas?localId=${CASIANO.id}`, c)).cuerpo.estado, "OK");
    await darAcceso(a, ENCARGADO, { ...TODOS_LOS_PERMISOS, ventas: false });
    assert.equal((await pedir(manejarVentas, `/api/chats/ventas?localId=${CASIANO.id}`, c)).cuerpo.estado, "SIN_ACCESO");
    assert.equal((await pedir(manejarEstado, "/api/sesion", c)).cuerpo.estado, "VINCULADO", "la sesión sigue");
    await darAcceso(a, ENCARGADO, { ...TODOS_LOS_PERMISOS, entrar: false });
    assert.equal((await pedir(manejarChats, "/api/chats", c)).cuerpo.estado, "SIN_ACCESO");
    assert.equal((await pedir(manejarEstado, "/api/sesion", c)).cuerpo.estado, "SIN_ACCESO", "la misma sesión, ahora sin acceso");
  });

  it("volver a vincularse conserva los accesos (son de la persona, no del vínculo)", async () => {
    const a = await vincular(ADMIN);
    await vincular(ENCARGADO);
    await darAcceso(a, ENCARGADO, { entrar: true, ventas: true });
    const otra = await vincular(ENCARGADO);
    assert.equal((await pedir(manejarVentas, `/api/chats/ventas?localId=${CASIANO.id}`, otra)).cuerpo.estado, "OK");
    assert.equal((await pedir(manejarCaja, `/api/chats/caja?localId=${CASIANO.id}`, otra)).cuerpo.estado, "SIN_ACCESO");
  });
});

describe("Tanda 15: la sección Accesos, solo para administradores", () => {
  it("el administrador ve a todos los que se vincularon, con su nombre, su último vínculo y sus permisos", async () => {
    const a = await vincular(ADMIN);
    const e = await vincular(ENCARGADO);
    await vincular(CAJERO);
    await pedir(manejarEstado, "/api/sesion", e); // el ERP le dice el nombre
    await darAcceso(a, ENCARGADO, { entrar: true, caja: true });
    const r = await pedir(manejarAccesos, "/api/sesion/accesos", a);
    assert.equal(r.status, 200);
    const personas = r.cuerpo.personas as { personaId: number; nombre: string; administrador: boolean; permisos: Permisos; vinculadoEn: string }[];
    const de = (id: number) => personas.find((p) => p.personaId === id)!;
    assert.deepEqual(personas.map((p) => p.personaId).sort(), [ADMIN, ENCARGADO, CAJERO].sort());
    assert.deepEqual(de(ADMIN).permisos, TODOS_LOS_PERMISOS);
    assert.equal(de(ADMIN).administrador, true);
    assert.equal(de(ENCARGADO).nombre, "Encargada Casiano");
    assert.deepEqual(de(ENCARGADO).permisos, { entrar: true, ventas: false, caja: true, stock: false, pendientes: false, ia: false });
    assert.equal(de(CAJERO).nombre, `Persona ${CAJERO}`, "sin nombre del ERP todavía");
    assert.equal(de(CAJERO).vinculadoEn, new Date(reloj).toISOString());
    const fila = await base.db.accesoPersona.findFirstOrThrow({ where: { erpUsuarioId: ENCARGADO } });
    assert.deepEqual([fila.cambiadoPorErpUsuarioId, fila.cambiadoEn?.toISOString()], [ADMIN, new Date(reloj).toISOString()], "quién y cuándo");
  });

  it("a una persona común: 403, aunque tenga todos los accesos y manipule el pedido (a sí misma, a otro, al administrador)", async () => {
    const a = await vincular(ADMIN);
    const c = await vincular(ENCARGADO);
    await darAcceso(a, ENCARGADO, TODOS_LOS_PERMISOS);
    assert.deepEqual(await pedir(manejarAccesos, "/api/sesion/accesos", c), { status: 403, cuerpo: { estado: "SIN_ACCESO" } });
    for (const personaId of [ENCARGADO, CAJERO, ADMIN]) {
      const r = await pedir(manejarGuardarAccesos, "/api/sesion/accesos", c, "PUT", { personaId, ...TODOS_LOS_PERMISOS });
      assert.deepEqual([r.status, r.cuerpo], [403, { estado: "SIN_ACCESO" }], String(personaId));
    }
    assert.equal((await base.db.accesoPersona.findFirstOrThrow({ where: { erpUsuarioId: ENCARGADO } })).cambiadoPorErpUsuarioId, ADMIN, "nada cambió");
  });

  it("un administrador no se puede quitar acceso (ni a otro administrador); un id que no se vinculó, tampoco; sin Origin o con otra forma, no", async () => {
    administradores = `${ADMIN},${CAJERO}`;
    const a = await vincular(ADMIN);
    await vincular(ENCARGADO);
    for (const personaId of [ADMIN, CAJERO]) {
      const r = await darAcceso(a, personaId, {});
      assert.deepEqual([r.status, r.cuerpo], [409, { estado: "ES_ADMINISTRADOR" }]);
    }
    assert.deepEqual((await darAcceso(a, 4242, { entrar: true })).cuerpo, { estado: "PERSONA_DESCONOCIDA" });
    const sinOrigen = await pedir(manejarGuardarAccesos, "/api/sesion/accesos", a, "PUT", { personaId: ENCARGADO, ...TODOS_LOS_PERMISOS }, null);
    assert.deepEqual([sinOrigen.status, sinOrigen.cuerpo], [403, { estado: "ORIGEN_NO_PERMITIDO" }]);
    for (const malo of [{ personaId: ENCARGADO, entrar: true }, { personaId: ENCARGADO, ...TODOS_LOS_PERMISOS, admin: true }, { personaId: "11", ...TODOS_LOS_PERMISOS }, { personaId: ENCARGADO, ...TODOS_LOS_PERMISOS, caja: "si" }]) {
      assert.deepEqual((await pedir(manejarGuardarAccesos, "/api/sesion/accesos", a, "PUT", malo)).cuerpo, { estado: "SOLICITUD_INVALIDA" }, JSON.stringify(malo));
    }
    assert.equal(await base.db.accesoPersona.count(), 0);
    // Su propia app sigue con todo.
    assert.equal((await pedir(manejarCaja, `/api/chats/caja?localId=${CASIANO.id}`, a)).cuerpo.estado, "OK");
  });

  for (const [caso, valor] of [
    ["vacía", null],
    ["mal escrita", "nueve"],
  ] as const) {
    it(`con la variable ${caso}, nadie administra y todo queda cerrado (con una línea en el log)`, async () => {
      administradores = valor;
      const a = await vincular(ADMIN);
      assert.deepEqual(await pedir(manejarAccesos, "/api/sesion/accesos", a), { status: 403, cuerpo: { estado: "SIN_ACCESO" } });
      assert.equal((await pedir(manejarChats, "/api/chats", a)).cuerpo.estado, "SIN_ACCESO");
      assert.equal((await pedir(manejarEstado, "/api/sesion", a)).cuerpo.estado, "SIN_ACCESO");
      // Una línea por proceso (cada archivo de tests es uno): la deja el primero de estos dos, y no se repite.
      const lineas = registros.filter((r) => r.evento === "accesos.sin_administradores");
      assert.deepEqual(lineas, caso === "vacía" ? [{ evento: "accesos.sin_administradores", motivo: "VACIA" }] : []);
    });
  }

  it("CONTRAPRUEBA: con la variable bien, el mismo pedido del administrador anda", async () => {
    const a = await vincular(ADMIN);
    assert.equal((await pedir(manejarAccesos, "/api/sesion/accesos", a)).status, 200);
    assert.equal((await pedir(manejarChats, "/api/chats", a)).cuerpo.estado, "OK");
    assert.equal((await pedir(manejarConfiguracion, "/api/sesion/configuracion", a)).cuerpo.administrador, true);
  });
});
