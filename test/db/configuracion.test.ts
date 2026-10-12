// CANDADOS DE LA CONFIGURACIÓN (Tanda 11), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// El estado REAL del push (¿el servidor tiene la suscripción de este
// navegador?), reactivarla después de cerrar sesión, el horario de silencio en
// la sincronización de fondo (sin ráfaga al salir, los eventos igual sin
// leer), cerrar las otras sesiones con sus suscripciones y el saldo de IA del
// mes. Sesión real con el ERP de mentira con estado; el servicio de push es
// uno de mentira que descifra lo que recibe (como en interno.test.ts). Ningún
// test llama al ERP, a Gemini ni a un servicio de push reales.

import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import ece from "http_ece";
import webpush from "web-push";

import { manejarChats, manejarLocal } from "../../src/server/chats/manejadores.ts";
import { FRECUENCIA_MINIMA_INGESTA_MS } from "../../src/server/chats/sincronizacion.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { leerConfigIa } from "../../src/server/ia/config.ts";
import { reservaPorPregunta } from "../../src/server/ia/tarifa.ts";
import { manejarSincronizar, type DependenciasTarea } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import type { Registro } from "../../src/server/log.ts";
import { leerConfigPush } from "../../src/server/push/config.ts";
import { manejarEstadoPush, manejarSuscribir, type DependenciasPush } from "../../src/server/push/manejadores.ts";
import { manejarCerrar } from "../../src/server/sesion/cerrar.ts";
import { manejarCerrarOtras, manejarConfiguracion, manejarSilencio } from "../../src/server/sesion/configuracion.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { RespuestaLocal } from "../../src/shared/chats/api.ts";
import type { RespuestaConfiguracion } from "../../src/shared/sesion/configuracion.ts";
import type { DatosMiAlcance, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { recepcion } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const CLAVE_IA = `AIza${randomBytes(18).toString("hex")}`;
const VAPID = webpush.generateVAPIDKeys();
const ADMIN = 9;
const ENCARGADO = 11;
const CASIANO = { id: 3, nombre: "Casiano" };
const MA = FIXTURES_ERP_25172FE.miAlcance;
const HISTORIA_CASIANO = structuredClone((FIXTURES_ERP_25172FE.transferenciasEventos.sinDesde.respuesta.cuerpo.datos as { eventos: EventoTransferenciaRecibida[] }).eventos);
/** "Ahora" del fixture: 2026-10-08 12:00 UTC, las 09:00 en Argentina. */
const AHORA = Date.parse(FIXTURES_ERP_25172FE.ahora);
const UNA_HORA = 60 * 60 * 1000;

const DEL_TIMER = { host: "127.0.0.1:3100", "x-forwarded-proto": "http", [CABECERA_SECRETO_TAREA]: SECRETO_TAREA };
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

let base: BaseDescartable;
let erp: ErpConEstado;
let reloj: number;
let enviados: { endpoint: string; aviso: Record<string, unknown> }[];
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
  erp.alcances.set(ENCARGADO, structuredClone(MA.encargado.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  erp.eventosPorLocal.set(CASIANO.id, structuredClone(HISTORIA_CASIANO));
  enviados = [];
  reloj = AHORA;
});

function deps(conIa = false): DependenciasSesion {
  const registrar: (r: Registro) => void = () => {};
  const ia = conIa ? leerConfigIa({ AZUL_CHAT_GEMINI_API_KEY: CLAVE_IA, AZUL_CHAT_IA_TOPE_USD: "5" }) : null;
  return {
    config: leerConfigAzulChat(ENTORNO),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 2000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
    ...(ia ? { ia: ia.ok ? ia : { ok: false } } : {}),
  };
}

/** El servicio de push de mentira: descifra con la clave del teléfono y contesta 201. */
const servicioPush: typeof fetch = async (url, init) => {
  const endpoint = String(url);
  const t = telefonos.get(endpoint);
  assert.ok(t, `push a un endpoint desconocido: ${endpoint}`);
  const plano = ece.decrypt(Buffer.from(init!.body as Uint8Array), { version: "aes128gcm", privateKey: t.ecdh, authSecret: t.auth.toString("base64url") });
  enviados.push({ endpoint, aviso: JSON.parse(plano.toString("utf8")) });
  return new Response(null, { status: 201 });
};

function depsPush(): DependenciasPush {
  const push = leerConfigPush(ENTORNO);
  assert.ok(push.ok);
  return { ...deps(), push };
}
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

function nuevaSuscripcion(nombre = "a") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/prueba-${nombre}-${randomBytes(6).toString("hex")}`;
  telefonos.set(endpoint, { ecdh, auth });
  return { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
}

async function suscribir(cookie: string, cuerpo: unknown) {
  const res = await manejarSuscribir(
    new Request(`${ORIGEN}/api/push/suscribir`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) }, body: JSON.stringify(cuerpo) }),
    depsPush(),
  );
  return res.status;
}

/** GET /api/push/estado?endpoint=… */
async function estadoPush(cookie: string | null, consulta: string) {
  const res = await manejarEstadoPush(new Request(`${ORIGEN}/api/push/estado?${consulta}`, { headers: cookie ? conCookie(cookie) : {} }), depsPush());
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
}
const registrada = async (cookie: string, endpoint: string) => (await estadoPush(cookie, new URLSearchParams({ endpoint }).toString())).cuerpo;

async function cerrar(cookie: string) {
  await manejarCerrar(new Request(`${ORIGEN}/api/sesion`, { method: "DELETE", headers: { origin: ORIGEN, ...conCookie(cookie) } }), deps());
}

async function configuracion(cookie: string, conIa = false) {
  const res = await manejarConfiguracion(new Request(`${ORIGEN}/api/sesion/configuracion`, { headers: conCookie(cookie) }), deps(conIa));
  return { status: res.status, cuerpo: (await res.json()) as Extract<RespuestaConfiguracion, { estado: "OK" }> & Record<string, unknown> };
}

async function silencio(cookie: string | null, cuerpo: unknown, origen: string | null = ORIGEN) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(cookie ? conCookie(cookie) : {}) };
  if (origen) headers.origin = origen;
  const res = await manejarSilencio(new Request(`${ORIGEN}/api/sesion/silencio`, { method: "PUT", headers, body: JSON.stringify(cuerpo) }), deps());
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
}

async function cerrarOtras(cookie: string, origen: string | null = ORIGEN) {
  const headers: Record<string, string> = conCookie(cookie);
  if (origen) headers.origin = origen;
  const res = await manejarCerrarOtras(new Request(`${ORIGEN}/api/sesion/otras`, { method: "DELETE", headers }), deps());
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
}

async function sincronizar() {
  const res = await manejarSincronizar(new Request("http://127.0.0.1:3100/api/interno/sincronizar", { method: "POST", headers: DEL_TIMER }), depsTarea());
  const texto = await res.text();
  assert.equal(res.status, 200, texto);
  return JSON.parse(texto) as Record<string, number>;
}
const vencer = () => {
  reloj += FRECUENCIA_MINIMA_INGESTA_MS;
};
/** Una recepción nueva en Casiano, con fecha anterior al "ahora" del ERP de mentira (como en interno.test.ts). */
const recibir = (transferenciaId: number) =>
  erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId, fecha: new Date(Date.parse("2026-10-08T10:00:00.000Z") + transferenciaId * 1000).toISOString() }));

// ─────────────────────────────────────────────────────────────────────────────

describe("Tanda 11: el estado REAL de las notificaciones", () => {
  it("el servidor la tiene para esta sesión: registrada; no la tiene, o es de otra sesión u otra persona: no", async () => {
    const cookie = await vincular(ADMIN);
    const s = nuevaSuscripcion();
    assert.deepEqual(await registrada(cookie, s.endpoint), { estado: "OK", registrada: false }, "el navegador la tiene, el servidor todavía no");
    assert.equal(await suscribir(cookie, s), 200);
    assert.deepEqual(await registrada(cookie, s.endpoint), { estado: "OK", registrada: true });
    // Otro teléfono de la misma persona: su sesión no es esta.
    const otro = await vincular(ADMIN);
    assert.deepEqual(await registrada(otro, s.endpoint), { estado: "OK", registrada: false });
    // Otra persona no ve la de esta.
    const encargado = await vincular(ENCARGADO);
    assert.deepEqual(await registrada(encargado, s.endpoint), { estado: "OK", registrada: false });
    assert.equal(erp.cuerposA("consultar").length, 0, "no le pregunta nada al ERP");
  });

  it("el caso del 11/10: cerrar sesión borra la del servidor aunque el navegador la siga teniendo; al volver, 'no registrada', y Reactivar (POST de la misma) la vuelve a dejar", async () => {
    const cookie = await vincular(ADMIN);
    const s = nuevaSuscripcion();
    assert.equal(await suscribir(cookie, s), 200);
    await cerrar(cookie);
    await sincronizar(); // la corrida borra las suscripciones sin sesión
    assert.equal(await base.db.pushSuscripcion.count(), 0);
    const nueva = await vincular(ADMIN);
    assert.deepEqual(await registrada(nueva, s.endpoint), { estado: "OK", registrada: false }, "antes el panel decía Activadas");
    assert.equal(await suscribir(nueva, s), 200, "Reactivar: la misma suscripción, sin permiso nuevo");
    assert.deepEqual(await registrada(nueva, s.endpoint), { estado: "OK", registrada: true });
  });

  it("parámetros exactos y sesión: endpoint de un servicio conocido, uno solo; sin sesión, 401", async () => {
    const cookie = await vincular(ADMIN);
    const s = nuevaSuscripcion();
    for (const q of ["", "endpoint=https%3A%2F%2Fevil.example%2Fx", `endpoint=${encodeURIComponent(s.endpoint)}&otra=1`, "otra=1"]) {
      assert.deepEqual(await estadoPush(cookie, q), { status: 400, cuerpo: { estado: "SOLICITUD_INVALIDA" } }, q);
    }
    assert.deepEqual(await estadoPush(null, new URLSearchParams({ endpoint: s.endpoint }).toString()), { status: 401, cuerpo: { estado: "SIN_SESION" } });
  });
});

describe("Tanda 11: el horario de silencio", () => {
  /** Vincula, abre la app, suscribe un teléfono y deja hecho el backfill y la marca de avisos. */
  async function preparado() {
    const cookie = await vincular(ADMIN);
    await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps());
    vencer();
    assert.equal(await suscribir(cookie, nuevaSuscripcion()), 200);
    await sincronizar();
    assert.equal(enviados.length, 0);
    vencer();
    return cookie;
  }
  const noLeidosCasiano = async (cookie: string) => {
    const res = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${CASIANO.id}`, { headers: conCookie(cookie) }), deps());
    return ((await res.json()) as Extract<RespuestaLocal, { estado: "OK" }>).noLeidos;
  };

  it("apagado por defecto; se guarda con sesión y Origin, completo y válido", async () => {
    const cookie = await vincular(ADMIN);
    assert.deepEqual((await configuracion(cookie)).cuerpo.silencio, { activo: false, desde: 0, hasta: 7 });
    assert.deepEqual(await silencio(cookie, { activo: true, desde: 22, hasta: 7 }), { status: 200, cuerpo: { estado: "OK", silencio: { activo: true, desde: 22, hasta: 7 } } });
    assert.deepEqual((await configuracion(cookie)).cuerpo.silencio, { activo: true, desde: 22, hasta: 7 });
    for (const malo of [
      { activo: true, desde: 7, hasta: 7 },
      { activo: true, desde: 24, hasta: 7 },
      { activo: true, desde: -1, hasta: 7 },
      { activo: true, desde: 1.5, hasta: 7 },
      { activo: "si", desde: 1, hasta: 7 },
      { activo: true, desde: 1 },
      { activo: true, desde: 1, hasta: 7, vinculoId: "x" },
    ]) {
      assert.deepEqual(await silencio(cookie, malo), { status: 400, cuerpo: { estado: "SOLICITUD_INVALIDA" } }, JSON.stringify(malo));
    }
    assert.deepEqual(await silencio(cookie, { activo: false, desde: 0, hasta: 7 }, null), { status: 403, cuerpo: { estado: "ORIGEN_NO_PERMITIDO" } });
    assert.deepEqual(await silencio(cookie, { activo: false, desde: 0, hasta: 7 }, "https://otro.invalid"), { status: 403, cuerpo: { estado: "ORIGEN_NO_PERMITIDO" } });
    assert.deepEqual(await silencio(null, { activo: false, desde: 0, hasta: 7 }), { status: 401, cuerpo: { estado: "SIN_SESION" } });
    assert.deepEqual((await configuracion(cookie)).cuerpo.silencio, { activo: true, desde: 22, hasta: 7 }, "lo inválido no tocó nada");
  });

  it("dentro del horario no se manda push, el evento se ingiere igual y queda sin leer; al salir NO llega el atraso; lo nuevo de después, sí", async () => {
    const cookie = await preparado();
    // Las 09:xx de Argentina: dentro de 8 a 10.
    assert.equal((await silencio(cookie, { activo: true, desde: 8, hasta: 10 })).status, 200);
    const antes = await noLeidosCasiano(cookie);
    recibir(404);
    const r = await sincronizar();
    assert.equal(r.enviados, 0);
    assert.equal(enviados.length, 0);
    assert.equal(await base.db.evento.count({ where: { erpReferenciaId: 404 } }), 1, "se ingirió igual");
    assert.equal(await noLeidosCasiano(cookie), antes + 1, "y quedó sin leer");
    // Las 10:xx: fuera del horario. Lo del silencio no se manda: nada de ráfagas.
    reloj += UNA_HORA;
    await sincronizar();
    assert.equal(enviados.length, 0, "sin ráfaga al salir");
    // Lo que llega después, sí.
    vencer();
    recibir(405);
    await sincronizar();
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo), ["Casiano: Transferencia #405 recibida"]);
  });

  it("cruzando la medianoche: 22 a 7 calla a la 01:00 y no a las 09:00; apagado, nunca calla (CONTRAPRUEBA)", async () => {
    const cookie = await preparado();
    assert.equal((await silencio(cookie, { activo: true, desde: 22, hasta: 7 })).status, 200);
    recibir(500);
    await sincronizar(); // 09:xx: fuera
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo), ["Casiano: Transferencia #500 recibida"]);
    reloj = Date.parse("2026-10-09T04:00:00.000Z"); // 01:00 de Argentina
    recibir(501);
    await sincronizar();
    assert.equal(enviados.length, 1, "a la 01:00, callado");
    assert.equal((await silencio(cookie, { activo: false, desde: 22, hasta: 7 })).status, 200);
    vencer();
    recibir(502);
    await sincronizar();
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo).slice(1), ["Casiano: Transferencia #502 recibida"], "apagado: avisa aunque sea la 01:00");
  });

  it("el horario es de la persona: el de otra no la calla", async () => {
    const cookie = await preparado();
    const encargado = await vincular(ENCARGADO);
    assert.equal((await silencio(encargado, { activo: true, desde: 8, hasta: 10 })).status, 200);
    recibir(600);
    await sincronizar();
    assert.ok(enviados.some((e) => e.aviso.cuerpo === "Casiano: Transferencia #600 recibida"));
    assert.ok(cookie);
  });
});

describe("Tanda 11: dispositivos y cerrar las otras sesiones", () => {
  it("lista las sesiones vigentes, esta primero y marcada; cerrar las otras revoca todas menos esta y borra SUS suscripciones", async () => {
    const a = await vincular(ADMIN);
    reloj += 60_000;
    const b = await vincular(ADMIN);
    reloj += 60_000;
    const c = await vincular(ADMIN);
    const [sa, sb, sc] = [nuevaSuscripcion("a"), nuevaSuscripcion("b"), nuevaSuscripcion("c")];
    for (const [cookie, s] of [[a, sa], [b, sb], [c, sc]] as const) assert.equal(await suscribir(cookie, s), 200);
    const enc = await vincular(ENCARGADO);
    assert.equal(await suscribir(enc, nuevaSuscripcion("enc")), 200);

    const cfg = (await configuracion(b)).cuerpo;
    assert.deepEqual(
      cfg.dispositivos.map((d) => d.esEste),
      [true, false, false],
    );
    assert.equal(cfg.dispositivos[0]!.creadaEn, new Date(AHORA + 60_000).toISOString());
    assert.ok(!JSON.stringify(cfg).match(/"id"|vinculo|sesionId|token/i), "sin ids ni datos internos");

    assert.deepEqual(await cerrarOtras(b, null), { status: 403, cuerpo: { estado: "ORIGEN_NO_PERMITIDO" } });
    assert.equal((await configuracion(b)).cuerpo.dispositivos.length, 3, "sin Origin no cerró nada");

    assert.deepEqual(await cerrarOtras(b), { status: 200, cuerpo: { estado: "OK", cerradas: 2 } });
    assert.deepEqual((await configuracion(b)).cuerpo.dispositivos.map((d) => d.esEste), [true]);
    assert.equal((await configuracion(a)).status, 401, "la sesión de a ya no vale");
    assert.equal((await configuracion(c)).status, 401);
    const quedan = await base.db.pushSuscripcion.findMany({ select: { endpoint: true } });
    assert.deepEqual(quedan.map((q) => q.endpoint).sort(), [sb.endpoint, ...[...telefonos.keys()].filter((e) => e.includes("prueba-enc-"))].sort());
    assert.deepEqual(await registrada(b, sb.endpoint), { estado: "OK", registrada: true }, "la de este teléfono sigue");
    assert.equal((await configuracion(enc)).status, 200, "las de otra persona, ni se tocan");
    // Otra vez: no hay otras.
    assert.deepEqual(await cerrarOtras(b), { status: 200, cuerpo: { estado: "OK", cerradas: 0 } });
  });
});

describe("Tanda 11: el saldo de IA del mes", () => {
  it("sin IA configurada, null; con IA, lo gastado del mes de Argentina contra el tope y las preguntas; agotado cuando la próxima reserva ya no entra", async () => {
    const cookie = await vincular(ADMIN);
    assert.equal((await configuracion(cookie)).cuerpo.ia, null);
    assert.deepEqual((await configuracion(cookie, true)).cuerpo.ia, { gastadoCentavos: 0, topeCentavos: 500, preguntas: 0, agotado: false, reiniciaEl: "2026-11-01" });
    await base.db.consumoIa.create({ data: { mes: "2026-10", costoMicroUsd: 1_234_567n, preguntas: 12 } });
    // El mes de otro año no cuenta.
    await base.db.consumoIa.create({ data: { mes: "2025-10", costoMicroUsd: 4_999_999n, preguntas: 99 } });
    assert.deepEqual((await configuracion(cookie, true)).cuerpo.ia, { gastadoCentavos: 124, topeCentavos: 500, preguntas: 12, agotado: false, reiniciaEl: "2026-11-01" });
    // Justo donde una pregunta más ya no entra: agotado (lo mismo que decide reservarPregunta).
    const reserva = reservaPorPregunta(new Date(reloj));
    await base.db.consumoIa.update({ where: { mes: "2026-10" }, data: { costoMicroUsd: 5_000_000n - reserva + 1n } });
    assert.equal((await configuracion(cookie, true)).cuerpo.ia!.agotado, true);
    await base.db.consumoIa.update({ where: { mes: "2026-10" }, data: { costoMicroUsd: 5_000_000n - reserva } });
    assert.equal((await configuracion(cookie, true)).cuerpo.ia!.agotado, false, "CONTRAPRUEBA: si entra justo, no");
  });

  it("el mes es el de Argentina: el 31/12 a las 22 de Argentina ya es 1/1 en UTC, y sigue siendo diciembre", async () => {
    reloj = Date.parse("2027-01-01T01:00:00.000Z");
    const cookie = await vincular(ADMIN);
    await base.db.consumoIa.create({ data: { mes: "2026-12", costoMicroUsd: 10_000n, preguntas: 1 } });
    assert.deepEqual((await configuracion(cookie, true)).cuerpo.ia, { gastadoCentavos: 1, topeCentavos: 500, preguntas: 1, agotado: false, reiniciaEl: "2027-01-01" });
  });
});
