// CANDADOS DE LA SINCRONIZACIÓN EN SEGUNDO PLANO Y LOS AVISOS PUSH (Tanda 5A),
// DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// La ruta interna se ejerce por su manejador —el archivo de src/app solo
// delega (test/frontera/rutas.test.ts)— con las cabeceras que de verdad le
// llegan: las del curl del timer (con las x-forwarded-* que Next agrega por su
// cuenta, comprobado con el servidor compilado) y las de nginx.
//
// El ERP es el de mentira con estado (test/ayuda/erpConEstado.ts): firma,
// vínculos, `mi_alcance` de los fixtures reales y el portón por capacidad. El
// servicio de push es un `fetch` de mentira que DESCIFRA lo que recibe con
// http_ece (RFC 8188/8291), con la clave privada del "teléfono": así se ve lo
// que de verdad le llegaría. Ningún test llama al ERP ni a un servicio de push
// reales.

import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import ece from "http_ece";
import webpush from "web-push";

import { manejarSincronizar, type DependenciasTarea } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import { FRECUENCIA_MINIMA_INGESTA_MS } from "../../src/server/chats/sincronizacion.ts";
import { manejarChats, manejarLeido, manejarLocal } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { leerConfigPush } from "../../src/server/push/config.ts";
import { avisarNovedades } from "../../src/server/push/avisos.ts";
import { manejarBaja, manejarClave, manejarSuscribir, type DependenciasPush } from "../../src/server/push/manejadores.ts";
import { manejarCerrar } from "../../src/server/sesion/cerrar.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { DatosMiAlcance, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { pedido, recepcion } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const VAPID = webpush.generateVAPIDKeys();
const ADMIN = 9;
const ENCARGADO = 11;
const CASIANO = { id: 3, nombre: "Casiano" };
const DEPOSITO = { id: 9, nombre: "Depósito Central" };
const MA = FIXTURES_ERP_25172FE.miAlcance;
const HISTORIA_CASIANO = structuredClone((FIXTURES_ERP_25172FE.transferenciasEventos.sinDesde.respuesta.cuerpo.datos as { eventos: EventoTransferenciaRecibida[] }).eventos);

/** Las cabeceras con las que llega el curl del timer: Next agrega las x-forwarded-* por su cuenta. */
const DEL_TIMER = {
  host: "127.0.0.1:3100",
  "x-forwarded-for": "172.18.0.1",
  "x-forwarded-host": "127.0.0.1:3100",
  "x-forwarded-port": "3100",
  "x-forwarded-proto": "http",
  [CABECERA_SECRETO_TAREA]: SECRETO_TAREA,
};

let base: BaseDescartable;
let erp: ErpConEstado;
let registros: Registro[];
let reloj: number;
/** Lo que recibió el servicio de push de mentira, ya descifrado. */
let enviados: { endpoint: string; aviso: Record<string, unknown>; headers: Record<string, string> }[];
/** Lo que contesta el servicio de push, por endpoint (por defecto 201). */
let respuestaPush: Map<string, number>;
/** Las claves privadas de los "teléfonos", por endpoint. */
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
  erp.respuestasEventos.length = 0;
  erp.respuestaParaLocal.clear();
  erp.eventosPorLocal.clear();
  erp.eventosPorCapacidad.clear();
  erp.respuestaParaCapacidad.clear();
  erp.ponerModo("normal");
  erp.alcances.clear();
  erp.alcances.set(ADMIN, structuredClone(MA.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  erp.eventosPorLocal.set(CASIANO.id, structuredClone(HISTORIA_CASIANO));
  erp.eventosPorLocal.set(DEPOSITO.id, [recepcion({ local: DEPOSITO, transferenciaId: 300, fecha: "2026-10-07T08:00:00.000Z" })]);
  registros = [];
  enviados = [];
  respuestaPush = new Map();
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
});

const ENTORNO = {
  AZUL_CHAT_INSTALACION_ID: INSTALACION,
  AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN,
  AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE,
  AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA,
  AZUL_CHAT_TAREA_SECRET: SECRETO_TAREA,
  AZUL_CHAT_VAPID_PUBLICA: VAPID.publicKey,
  AZUL_CHAT_VAPID_PRIVADA: VAPID.privateKey,
  AZUL_CHAT_VAPID_CONTACTO: "mailto:prueba@ejemplo.invalid",
};

function deps(): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  return {
    config: leerConfigAzulChat(ENTORNO),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 2000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
  };
}

/** El servicio de push de mentira: descifra con la clave del teléfono y contesta lo que diga `respuestaPush`. */
const servicioPush: typeof fetch = async (url, init) => {
  const endpoint = String(url);
  const t = telefonos.get(endpoint);
  assert.ok(t, `push a un endpoint desconocido: ${endpoint}`);
  const cuerpo = Buffer.from(init!.body as Uint8Array);
  const plano = ece.decrypt(cuerpo, { version: "aes128gcm", privateKey: t.ecdh, authSecret: t.auth.toString("base64url") });
  const headers = Object.fromEntries(Object.entries(init!.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  enviados.push({ endpoint, aviso: JSON.parse(plano.toString("utf8")), headers });
  return new Response(null, { status: respuestaPush.get(endpoint) ?? 201 });
};

function depsTarea(extra: Partial<DependenciasTarea> = {}): DependenciasTarea {
  const puerta = leerPuertaTarea(ENTORNO);
  const push = leerConfigPush(ENTORNO);
  assert.ok(puerta.ok && push.ok);
  return { ...deps(), puerta, push, transportePush: servicioPush, ...extra };
}
function depsPush(): DependenciasPush {
  const push = leerConfigPush(ENTORNO);
  assert.ok(push.ok);
  return { ...deps(), push };
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

async function sincronizar(cabeceras: Record<string, string> = DEL_TIMER, d = depsTarea(), metodo = "POST") {
  const res = await manejarSincronizar(new Request("http://127.0.0.1:3100/api/interno/sincronizar", { method: metodo, headers: cabeceras }), d);
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: texto ? (JSON.parse(texto) as Record<string, number | string>) : null };
}

const vencer = () => {
  reloj += FRECUENCIA_MINIMA_INGESTA_MS;
};
const consultas = (capacidad: string) => erp.cuerposA("consultar").filter((c) => c.capacidad === capacidad);
const sql = (q: string) => base.db.$executeRawUnsafe(q);

/** Una suscripción con la forma de `PushSubscription.toJSON()`, con claves de verdad de un "teléfono". */
function nuevaSuscripcion(nombre = "a") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/prueba-${nombre}-${randomBytes(6).toString("hex")}`;
  telefonos.set(endpoint, { ecdh, auth });
  return { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
}

async function suscribir(cookie: string, cuerpo: unknown, origen = ORIGEN) {
  const res = await manejarSuscribir(
    new Request(`${ORIGEN}/api/push/suscribir`, { method: "POST", headers: { "content-type": "application/json", origin: origen, ...conCookie(cookie) }, body: JSON.stringify(cuerpo) }),
    depsPush(),
  );
  return { status: res.status, cuerpo: (await res.json()) as { estado: string } };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("la puerta de la ruta interna", () => {
  it("con el secreto, por 127.0.0.1 y sin nginx: 200", async () => {
    const r = await sincronizar();
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.cuerpo!.estado, "OK");
  });

  it("CONTRAPRUEBA: sin secreto, con otro, por nginx, desde el navegador, por GET o sin la variable: 404 vacío, sin tocar el ERP ni la base", async () => {
    await vincular(ADMIN);
    erp.recibidas.length = 0;
    const casos: [string, Record<string, string>, (DependenciasTarea | undefined)?, string?][] = [
      ["sin secreto", { ...DEL_TIMER, [CABECERA_SECRETO_TAREA]: "" }],
      ["sin la cabecera", Object.fromEntries(Object.entries(DEL_TIMER).filter(([k]) => k !== CABECERA_SECRETO_TAREA))],
      ["otro secreto", { ...DEL_TIMER, [CABECERA_SECRETO_TAREA]: `${SECRETO_TAREA}x` }],
      // nginx: Host público, X-Real-IP y proto https, aunque traiga el secreto.
      ["por nginx", { ...DEL_TIMER, host: "chat.operix.cloud", "x-forwarded-host": "chat.operix.cloud", "x-forwarded-proto": "https", "x-real-ip": "203.0.113.9" }],
      ["por nginx con Host local", { ...DEL_TIMER, "x-real-ip": "203.0.113.9" }],
      ["con Forwarded", { ...DEL_TIMER, forwarded: "for=203.0.113.9" }],
      ["https", { ...DEL_TIMER, "x-forwarded-proto": "https" }],
      ["host reenviado público", { ...DEL_TIMER, "x-forwarded-host": "chat.operix.cloud" }],
      ["desde el navegador", { host: "chat.operix.cloud", origin: ORIGEN, cookie: "x=1", "x-forwarded-proto": "https", "x-real-ip": "203.0.113.9" }],
      ["GET", DEL_TIMER, undefined, "GET"],
      ["sin la variable", DEL_TIMER, { ...depsTarea(), puerta: { ok: false } }],
    ];
    for (const [nombre, cabeceras, d, metodo] of casos) {
      const r = await sincronizar(cabeceras, d ?? depsTarea(), metodo ?? "POST");
      assert.equal(r.status, 404, nombre);
      assert.equal(r.texto, "", `${nombre}: el 404 no dice nada`);
    }
    assert.equal(erp.recibidas.length, 0, "ninguna llamó al ERP");
    assert.equal(await base.db.cursorIngesta.count(), 0, "ni tocó la base");
  });

  it("el secreto de la tarea: 32 caracteres o más y distinto de los demás secretos, o la ruta no existe", () => {
    assert.deepEqual(leerPuertaTarea({}), { ok: false, motivo: "SECRETO_TAREA_AUSENTE" });
    assert.deepEqual(leerPuertaTarea({ AZUL_CHAT_TAREA_SECRET: "x".repeat(31) }), { ok: false, motivo: "SECRETO_TAREA_CORTO" });
    for (const otro of ["AZUL_CHAT_INTEGRACION_SECRET", "AZUL_CHAT_TOKEN_ENCRYPTION_KEY", "AZUL_CHAT_VAPID_PRIVADA"]) {
      const igual = "y".repeat(43);
      assert.deepEqual(leerPuertaTarea({ AZUL_CHAT_TAREA_SECRET: igual, [otro]: igual }), { ok: false, motivo: "SECRETO_TAREA_COMPARTIDO" }, otro);
    }
  });
});

describe("la sincronización de fondo dispara lo que ya existe", () => {
  it("con la app cerrada, trae lo de cada local anunciado; dos corridas seguidas no repiten nada", async () => {
    await vincular(ADMIN);
    erp.recibidas.length = 0;
    const r1 = await sincronizar();
    assert.equal(r1.status, 200, r1.texto);
    assert.equal(r1.cuerpo!.personas, 1);
    assert.equal(consultas("mi_alcance").length, 1, "mi_alcance vivo, una vez por persona");
    assert.ok(consultas("transferencias_eventos").length >= 2, "la misma ingesta, por local");
    assert.equal(await base.db.evento.count({ where: { erpLocalId: CASIANO.id } }), 4);
    // Otra corrida enseguida: todo fresco (frecuencia mínima). Solo mi_alcance.
    const antes = consultas("transferencias_eventos").length;
    const r2 = await sincronizar();
    assert.equal(r2.status, 200);
    assert.equal(consultas("transferencias_eventos").length, antes, "dentro de 30 s no se vuelve a pedir");
    assert.equal(consultas("mi_alcance").length, 2);
    assert.equal(await base.db.evento.count(), 5, "ni un evento de más");
    assert.ok(registros.some((x) => x.evento === "tarea.sincronizar"), "deja un renglón con cuentas");
  });

  it("respeta el arriendo: un cursor tomado por otra ejecución no se pide", async () => {
    await vincular(ADMIN);
    await sql(`INSERT INTO "CursorIngesta" (id, "instalacionId", "erpLocalId", capacidad, "arrendadoHasta", "arrendadoPor")
               VALUES (gen_random_uuid(), '${INSTALACION}', ${CASIANO.id}, 'transferencias_eventos', '${new Date(reloj + 20_000).toISOString()}', 'otra')`);
    erp.recibidas.length = 0;
    const r = await sincronizar();
    assert.equal(r.status, 200);
    assert.ok(!consultas("transferencias_eventos").some((c) => (c.alcance as { localId: number }).localId === CASIANO.id), "Casiano estaba arrendado");
    assert.equal(await base.db.evento.count({ where: { erpLocalId: CASIANO.id } }), 0);
  });

  it("VINCULO_NO_VALIDO invalida el vínculo y revoca sus sesiones; caído o NO_AUTORIZADO no", async () => {
    await vincular(ADMIN);
    erp.ponerModo("caido");
    const caido = await sincronizar();
    assert.equal(caido.cuerpo!.conFalla, 1);
    assert.equal(caido.cuerpo!.revocadas, 0);
    erp.ponerModo("normal");
    erp.alcances.delete(ADMIN); // mi_alcance → NO_AUTORIZADO
    const negado = await sincronizar();
    assert.equal(negado.cuerpo!.conFalla, 1);
    assert.equal((await base.db.vinculo.findFirstOrThrow()).invalidadoEn, null, "ni caído ni NO_AUTORIZADO desvinculan");
    erp.alcances.set(ADMIN, structuredClone(MA.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
    erp.revocar(ADMIN);
    const revocado = await sincronizar();
    assert.equal(revocado.cuerpo!.revocadas, 1);
    const v = await base.db.vinculo.findFirstOrThrow();
    assert.ok(v.invalidadoEn, "el vínculo quedó invalidado");
    assert.equal(await base.db.sesion.count({ where: { revocadaEn: null } }), 0, "y sus sesiones revocadas");
    const siguiente = await sincronizar();
    assert.equal(siguiente.cuerpo!.personas, 0, "una persona invalidada ya no se sincroniza");
  });

  it("quien cerró sesión en todos lados no se sincroniza", async () => {
    const cookie = await vincular(ADMIN);
    await manejarCerrar(new Request(`${ORIGEN}/api/sesion`, { method: "DELETE", headers: { origin: ORIGEN, ...conCookie(cookie) } }), deps());
    erp.recibidas.length = 0;
    const r = await sincronizar();
    assert.equal(r.cuerpo!.personas, 0);
    assert.equal(erp.recibidas.length, 0);
  });
});

describe("los avisos push", () => {
  /**
   * Vincula, abre la app una vez (la línea de base de lectura, como siempre:
   * lo que había al abrir por primera vez es historia para la persona),
   * suscribe un teléfono y deja hecho el backfill y la línea de base de avisos.
   */
  async function preparado() {
    const cookie = await vincular(ADMIN);
    await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps());
    vencer();
    const s = nuevaSuscripcion();
    assert.equal((await suscribir(cookie, s)).status, 200);
    await sincronizar(); // la corrida trae el backfill (abrir la app no ingiere, Tanda 5B) y fija la marca de avisos
    assert.equal(enviados.length, 0, "el backfill no se avisa");
    vencer();
    return { cookie, s };
  }

  it("un evento nuevo: un aviso con el texto de la interfaz, cifrado, que abre el local; la corrida siguiente no lo repite", async () => {
    const { s } = await preparado();
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z", tieneDiferencias: true, lineasConDiferencia: 2 }));
    const r = await sincronizar();
    assert.equal(r.cuerpo!.enviados, 1, r.texto);
    assert.deepEqual(enviados.map((e) => e.endpoint), [s.endpoint]);
    assert.deepEqual(enviados[0]!.aviso, {
      titulo: "Azul Chat",
      cuerpo: "Casiano: Transferencia #404 recibida con diferencias",
      url: "/?vista=local&localId=3",
      etiqueta: "local-3",
      // Tanda 13: la hora de la corrida, para que el teléfono no muestre uno viejo encima.
      creadoEn: reloj,
    });
    // Lo que viaja: cifrado (aes128gcm), firmado con VAPID, con vencimiento.
    assert.equal(enviados[0]!.headers["content-encoding"], "aes128gcm");
    assert.match(enviados[0]!.headers["authorization"] ?? "", /^vapid t=.+, k=/);
    // Tanda 13: los de eventos conservan sus 12 h, y salen con urgencia alta
    // (con "normal" Android los retenía en reposo).
    assert.equal(enviados[0]!.headers["ttl"], String(12 * 60 * 60));
    assert.equal(enviados[0]!.headers["urgency"], "high");
    vencer();
    await sincronizar();
    assert.equal(enviados.length, 1, "una sola vez por evento");
  });

  it("dos o más del mismo local en una corrida: 'N novedades'; cada local, su aviso", async () => {
    await preparado();
    for (const id of [501, 502, 503]) erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: id, fecha: `2026-10-08T10:0${id - 500}:00.000Z` }));
    erp.eventosPorLocal.get(DEPOSITO.id)!.push(recepcion({ local: DEPOSITO, transferenciaId: 600, fecha: "2026-10-08T10:00:00.000Z" }));
    await sincronizar();
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo).sort(), ["Casiano: 3 novedades", "Depósito Central: Transferencia #600 recibida"]);
  });

  it("los demás tipos usan los mismos textos de la interfaz; el backfill de una capacidad recién anunciada no se avisa", async () => {
    await preparado();
    // Desde hoy el ERP anuncia pedidos en Casiano, que ya tiene un pedido viejo: es historia.
    capacidadesDe(["transferencias_eventos", "pedidos_eventos"]);
    erp.eventosPorCapacidad.set(`pedidos_eventos:${CASIANO.id}`, [pedido({ pedidoId: 91, fecha: "2026-10-08T10:00:00.000Z" })]);
    await sincronizar();
    assert.equal(enviados.length, 0);
    vencer();
    erp.eventosPorCapacidad.get(`pedidos_eventos:${CASIANO.id}`)!.push(pedido({ pedidoId: 92, fecha: "2026-10-08T11:00:00.000Z" }));
    await sincronizar();
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo), ["Casiano: Pedido #92 solicitado"]);
  });

  it("sin suscripción no se manda nada, y activarlas después no trae lo de antes", async () => {
    const cookie = await vincular(ADMIN);
    await sincronizar();
    vencer();
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    const r = await sincronizar();
    assert.equal(r.cuerpo!.enviados, 0);
    assert.equal(enviados.length, 0);
    assert.equal((await suscribir(cookie, nuevaSuscripcion())).status, 200);
    vencer();
    await sincronizar();
    assert.equal(enviados.length, 0, "el 404 ya se consideró: no llega tarde");
  });

  it("lo que la persona ya leyó en la app no se avisa", async () => {
    const { cookie } = await preparado();
    // Desde la Tanda 5B solo la corrida ingiere, y avisa en la misma pasada. Para
    // que la persona lea ANTES de que se le avise, lo trae la corrida de OTRA
    // persona (el encargado, sin teléfono) mientras la suya no pudo completarse
    // (su mi_alcance falló esa vez). Pasa así con cualquier orden de personas.
    await vincular(ENCARGADO);
    erp.alcances.set(ENCARGADO, structuredClone(MA.encargado.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
    const alcanceAdmin = erp.alcances.get(ADMIN)!;
    erp.alcances.delete(ADMIN);
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    const r = await sincronizar();
    assert.equal(r.cuerpo!.conFalla, 1, "la corrida del admin no se completó");
    assert.equal(await base.db.evento.count({ where: { erpReferenciaId: 404 } }), 1, "el 404 lo trajo la del encargado");
    assert.equal(enviados.length, 0);
    erp.alcances.set(ADMIN, alcanceAdmin);
    // Abre la app: lo ve, y lo marca leído.
    const l = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${CASIANO.id}`, { headers: conCookie(cookie) }), deps());
    const datos = (await l.json()) as { eventos: { id: string }[] };
    const hasta = datos.eventos.map((e) => BigInt(e.id)).reduce((a, b) => (a > b ? a : b)).toString();
    await manejarLeido(
      new Request(`${ORIGEN}/api/chats/leido`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) },
        body: JSON.stringify({ marcas: [{ localId: CASIANO.id, hastaEventoId: hasta }] }),
      }),
      deps(),
    );
    vencer();
    await sincronizar();
    assert.equal(enviados.length, 0);
  });

  it("abrir la app no trae nada del ERP (Tanda 5B): lo nuevo lo trae la corrida, y lo avisa una vez", async () => {
    const { cookie } = await preparado();
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    erp.recibidas.length = 0;
    await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps());
    assert.deepEqual(erp.cuerposA("consultar").map((c) => c.capacidad), ["mi_alcance"], "solo autoriza");
    assert.equal(await base.db.evento.count({ where: { erpReferenciaId: 404 } }), 0);
    await sincronizar();
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo), ["Casiano: Transferencia #404 recibida"]);
    vencer();
    await sincronizar();
    assert.equal(enviados.length, 1);
  });

  it("un local que mi_alcance ya no autoriza no se avisa", async () => {
    await preparado();
    capacidadesDe([], CASIANO.id);
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    await sincronizar();
    assert.equal(enviados.length, 0);
  });

  it("404 o 410 del servicio de push: la suscripción se borra; otro error se anota y la suscripción queda", async () => {
    const { cookie, s } = await preparado();
    const otra = nuevaSuscripcion("b");
    assert.equal((await suscribir(cookie, otra)).status, 200);
    respuestaPush.set(s.endpoint, 410);
    respuestaPush.set(otra.endpoint, 500);
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    const r = await sincronizar();
    assert.equal(r.cuerpo!.suscripcionesBorradas, 1);
    assert.equal(r.cuerpo!.fallidos, 1);
    const quedan = await base.db.pushSuscripcion.findMany();
    assert.deepEqual(quedan.map((q) => q.endpoint), [otra.endpoint]);
    assert.equal(quedan[0]!.ultimoErrorCodigo, "HTTP_500");
    assert.ok(quedan[0]!.ultimoErrorEn);
    // Y no se reintenta: la corrida siguiente no lo vuelve a mandar.
    respuestaPush.clear();
    vencer();
    const antes = enviados.length;
    await sincronizar();
    assert.equal(enviados.length, antes);
  });

  it("cerrar la sesión de ese teléfono corta sus avisos y la próxima corrida borra la suscripción", async () => {
    const { cookie } = await preparado();
    await vincular(ADMIN); // otro dispositivo de la misma persona sigue con sesión: la persona se sincroniza igual
    await manejarCerrar(new Request(`${ORIGEN}/api/sesion`, { method: "DELETE", headers: { origin: ORIGEN, ...conCookie(cookie) } }), deps());
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    const r = await sincronizar();
    assert.equal(enviados.length, 0);
    assert.equal(r.cuerpo!.suscripcionesBorradas, 1);
    assert.equal(await base.db.pushSuscripcion.count(), 0);
  });

  it("dos corridas a la vez no mandan el mismo aviso dos veces", async () => {
    await preparado();
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    await Promise.all([sincronizar(), sincronizar()]);
    assert.equal(enviados.length, 1);
  });

  it("la carrera, forzada: si otra corrida mueve la marca después de leerla, esta no avisa nada de ese local", async () => {
    await preparado();
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    // La ingesta, sin avisar todavía (sin configuración de push la marca avanza: se la vuelve atrás).
    const sinPush = await sincronizar(DEL_TIMER, { ...depsTarea(), push: { ok: false } });
    assert.equal(sinPush.status, 200);
    await sql(`UPDATE "AvisoLocal" SET "avisadoHastaEventoId" = "avisadoHastaEventoId" - 1 WHERE "erpLocalId" = ${CASIANO.id}`);
    const vinculo = await base.db.vinculo.findFirstOrThrow();
    // Una base que, apenas se lee la marca, deja que "otra corrida" la mueva.
    const conCarrera = new Proxy(base.db, {
      get(objetivo, propiedad, receptor) {
        if (propiedad !== "$queryRaw") return Reflect.get(objetivo, propiedad, receptor);
        return async (...args: Parameters<typeof objetivo.$queryRaw>) => {
          const leido = await objetivo.$queryRaw(...args);
          await objetivo.$executeRawUnsafe(`UPDATE "AvisoLocal" SET "avisadoHastaEventoId" = "avisadoHastaEventoId" + 1000`);
          return leido;
        };
      },
    });
    const push = leerConfigPush(ENTORNO);
    assert.ok(push.ok);
    const r = await avisarNovedades(conCarrera, vinculo.id, [{ localId: CASIANO.id, nombre: "Casiano", tipos: ["TRANSFERENCIA_RECIBIDA"] }], { config: push.config, transporte: servicioPush }, new Date(reloj));
    assert.equal(r.avisos, 0);
    assert.equal(enviados.length, 0);
  });
});

describe("las rutas de push del navegador", () => {
  it("GET clave: la pública VAPID; sin configuración, 503", async () => {
    const ok = manejarClave(new Request(`${ORIGEN}/api/push/clave`), depsPush());
    const texto = await ok.text();
    assert.deepEqual(JSON.parse(texto), { estado: "OK", clave: VAPID.publicKey });
    assert.ok(!texto.includes(VAPID.privateKey), "la privada no sale nunca");
    const sin = manejarClave(new Request(`${ORIGEN}/api/push/clave`), { ...depsPush(), push: { ok: false } });
    assert.equal(sin.status, 503);
  });

  it("suscribir: sesión, Origin y un servicio de push conocido; la suscripción queda de esa sesión", async () => {
    const cookie = await vincular(ADMIN);
    const s = nuevaSuscripcion();
    assert.equal((await suscribir(cookie, s, "https://otro.ejemplo.invalid")).status, 403);
    const sinSesion = await manejarSuscribir(
      new Request(`${ORIGEN}/api/push/suscribir`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGEN }, body: JSON.stringify(s) }),
      depsPush(),
    );
    assert.equal(sinSesion.status, 401);
    // Endpoints que harían que el servidor le pegue a cualquier lado: no.
    for (const endpoint of ["https://evil.ejemplo.invalid/x", "http://fcm.googleapis.com/fcm/send/x", "https://127.0.0.1/x", "https://fcm.googleapis.com:8443/x", "https://u:p@fcm.googleapis.com/x"]) {
      assert.equal((await suscribir(cookie, { ...s, endpoint })).status, 400, endpoint);
    }
    assert.equal((await suscribir(cookie, { ...s, keys: { ...s.keys, auth: "corta" } })).status, 400);
    assert.equal((await suscribir(cookie, { ...s, extra: 1 })).status, 400);
    assert.equal((await suscribir(cookie, s)).status, 200);
    assert.equal((await suscribir(cookie, s)).status, 200, "idempotente");
    const filas = await base.db.pushSuscripcion.findMany({ include: { sesion: true } });
    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.sesion.revocadaEn, null);
  });

  it("dar de baja: solo una suscripción propia", async () => {
    const cookie = await vincular(ADMIN);
    const s = nuevaSuscripcion();
    await suscribir(cookie, s);
    const baja = (c: string, endpoint: string) =>
      manejarBaja(
        new Request(`${ORIGEN}/api/push/suscribir`, { method: "DELETE", headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(c) }, body: JSON.stringify({ endpoint }) }),
        depsPush(),
      );
    // Otra persona no puede borrarla.
    erp.alcances.set(11, structuredClone(MA.encargado.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
    const ajena = await vincular(11);
    assert.equal((await baja(ajena, s.endpoint)).status, 200);
    assert.equal(await base.db.pushSuscripcion.count(), 1);
    assert.equal((await baja(cookie, s.endpoint)).status, 200);
    assert.equal(await base.db.pushSuscripcion.count(), 0);
  });
});

/** Cambia las capacidades de un local (Casiano por defecto) en el `mi_alcance` de ADMIN. */
function capacidadesDe(capacidades: string[], localId = CASIANO.id) {
  const a = erp.alcances.get(ADMIN) as Rompible<DatosMiAlcance>;
  const l = a.locales.find((x) => x.id === localId);
  assert.ok(l);
  l.capacidades = capacidades as never;
}

