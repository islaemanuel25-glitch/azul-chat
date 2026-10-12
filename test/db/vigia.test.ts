// CANDADOS DEL VIGÍA DE LA SINCRONIZACIÓN (Tanda 12), DE PUNTA A PUNTA, CONTRA
// POSTGRESQL.
//
// Las corridas de sincronizar se ejercen por su manejador, con la puerta de
// verdad, contra el ERP de mentira con estado (test/ayuda/erpConEstado.ts):
// cuando el ERP anda, la corrida es un éxito; con el ERP caído, una falla. El
// vigía se ejerce por su manejador con la misma puerta. El servicio de push es
// uno de mentira que descifra con la clave del "teléfono" (como en
// interno.test.ts). Ningún test llama al ERP ni a un servicio de push reales.
//
// "Ahora" es el del fixture: 2026-10-08 12:00 UTC, las 09:00 en Argentina.

import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import ece from "http_ece";
import webpush from "web-push";

import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { manejarSincronizar } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import { leerDestinatarios, manejarVigia, type Destinatarios, type DependenciasVigia } from "../../src/server/interno/vigia.ts";
import type { Registro } from "../../src/server/log.ts";
import { leerConfigPush } from "../../src/server/push/config.ts";
import { manejarSuscribir } from "../../src/server/push/manejadores.ts";
import { manejarSilencio } from "../../src/server/sesion/configuracion.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { FIXTURES_ERP_25172FE, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const CLAVE = randomBytes(32).toString("base64");
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const VAPID = webpush.generateVAPIDKeys();
const ADMIN = 9;
const ENCARGADO = 11;
const MA = FIXTURES_ERP_25172FE.miAlcance;
const AHORA = Date.parse(FIXTURES_ERP_25172FE.ahora);
const MIN = 60_000;

const DEL_TIMER = { host: "127.0.0.1:3100", "x-forwarded-proto": "http", [CABECERA_SECRETO_TAREA]: SECRETO_TAREA };
const ENTORNO = {
  AZUL_CHAT_INSTALACION_ID: "instalacion-prueba",
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
let registros: Registro[];
let enviados: { endpoint: string; aviso: Record<string, unknown>; headers: Record<string, string> }[];
/** Lo que contesta el servicio de push: un status, o "TIRA" para que el fetch falle. */
let respuestaPush: number | "TIRA";
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
  erp.ponerModo("normal");
  erp.alcances.clear();
  erp.alcances.set(ADMIN, structuredClone(MA.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  erp.alcances.set(ENCARGADO, structuredClone(MA.encargado.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  reloj = AHORA;
  registros = [];
  enviados = [];
  respuestaPush = 201;
});

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

const servicioPush: typeof fetch = async (url, init) => {
  if (respuestaPush === "TIRA") throw new TypeError("el servicio de push no contesta");
  const endpoint = String(url);
  const t = telefonos.get(endpoint);
  assert.ok(t, `push a un endpoint desconocido: ${endpoint}`);
  const plano = ece.decrypt(Buffer.from(init!.body as Uint8Array), { version: "aes128gcm", privateKey: t.ecdh, authSecret: t.auth.toString("base64url") });
  const headers = Object.fromEntries(Object.entries(init!.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  if (respuestaPush >= 200 && respuestaPush < 300) enviados.push({ endpoint, aviso: JSON.parse(plano.toString("utf8")), headers });
  return new Response(null, { status: respuestaPush });
};

function depsVigia(destinatarios: Destinatarios = leerDestinatarios({ AZUL_CHAT_AVISOS_SISTEMA: String(ADMIN) })): DependenciasVigia {
  const puerta = leerPuertaTarea(ENTORNO);
  const push = leerConfigPush(ENTORNO);
  assert.ok(puerta.ok && push.ok);
  return { ...deps(), puerta, push, transportePush: servicioPush, destinatarios };
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

/** Vincula a la persona y le suscribe un "teléfono". Devuelve su cookie y el endpoint. */
async function conTelefono(usuarioId: number): Promise<{ cookie: string; endpoint: string }> {
  const cookie = await vincular(usuarioId);
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/vigia-${usuarioId}-${randomBytes(6).toString("hex")}`;
  telefonos.set(endpoint, { ecdh, auth });
  const push = leerConfigPush(ENTORNO);
  assert.ok(push.ok);
  const res = await manejarSuscribir(
    new Request(`${ORIGEN}/api/push/suscribir`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) },
      body: JSON.stringify({ endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }),
    }),
    { ...deps(), push },
  );
  assert.equal(res.status, 200);
  return { cookie, endpoint };
}

/** Una corrida de sincronizar por la puerta de verdad. */
async function sincronizar() {
  const puerta = leerPuertaTarea(ENTORNO);
  assert.ok(puerta.ok);
  const res = await manejarSincronizar(new Request("http://127.0.0.1:3100/api/interno/sincronizar", { method: "POST", headers: DEL_TIMER }), {
    ...deps(),
    puerta,
    push: { ok: false },
  });
  assert.equal(res.status, 200, await res.text());
}

/** Una corrida del vigía. */
async function vigia(d = depsVigia(), cabeceras: Record<string, string> = DEL_TIMER, metodo = "POST") {
  const res = await manejarVigia(new Request("http://127.0.0.1:3100/api/interno/vigia", { method: metodo, headers: cabeceras }), d);
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : null };
}

const salud = () => base.db.saludSincronizacion.findUnique({ where: { unica: true } });
const cuerpos = () => enviados.map((e) => e.aviso.cuerpo);
const ultimoRegistroVigia = () => registros.filter((r) => r.evento === "tarea.vigia").at(-1) as Extract<Registro, { evento: "tarea.vigia" }> | undefined;
const silencio = (cookie: string, desde: number, hasta: number) =>
  manejarSilencio(
    new Request(`${ORIGEN}/api/sesion/silencio`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) },
      body: JSON.stringify({ activo: true, desde, hasta }),
    }),
    deps(),
  );

// ─────────────────────────────────────────────────────────────────────────────

describe("Tanda 12: la puerta del vigía es la de sincronizar", () => {
  it("con el secreto, por 127.0.0.1: 200", async () => {
    assert.equal((await vigia()).status, 200);
  });

  it("CONTRAPRUEBA: sin secreto, con otro, desde el navegador, por nginx, por GET o sin la variable: 404 vacío y sin tocar la base", async () => {
    const casos: [string, Record<string, string>, (DependenciasVigia | undefined)?, string?][] = [
      ["sin secreto", { host: "127.0.0.1:3100", "x-forwarded-proto": "http" }],
      ["secreto vacío", { ...DEL_TIMER, [CABECERA_SECRETO_TAREA]: "" }],
      ["otro secreto", { ...DEL_TIMER, [CABECERA_SECRETO_TAREA]: `${SECRETO_TAREA}x` }],
      ["desde el navegador", { host: "chat.operix.cloud", origin: ORIGEN, cookie: "x=1", "x-forwarded-proto": "https", "x-real-ip": "203.0.113.9" }],
      ["por nginx con el secreto", { ...DEL_TIMER, host: "chat.operix.cloud", "x-forwarded-proto": "https", "x-real-ip": "203.0.113.9" }],
      ["GET", DEL_TIMER, undefined, "GET"],
      ["sin la variable", DEL_TIMER, { ...depsVigia(), puerta: { ok: false } }],
    ];
    for (const [nombre, cabeceras, d, metodo] of casos) {
      const r = await vigia(d ?? depsVigia(), cabeceras, metodo ?? "POST");
      assert.equal(r.status, 404, nombre);
      assert.equal(r.texto, "", `${nombre}: el 404 no dice nada`);
    }
    assert.equal(await salud(), null, "ni tocó la base");
  });
});

describe("Tanda 12: cada corrida de sincronizar anota su salud", () => {
  it("un éxito pone la hora y las fallas en cero; con el ERP caído, una falla con su motivo; una sola fila", async () => {
    await vincular(ADMIN);
    await sincronizar();
    assert.deepEqual(
      (({ ultimoExitoEn, fallasSeguidas, ultimaFallaEn }) => ({ ultimoExitoEn, fallasSeguidas, ultimaFallaEn }))((await salud())!),
      { ultimoExitoEn: new Date(AHORA), fallasSeguidas: 0, ultimaFallaEn: null },
    );
    erp.ponerModo("caido");
    reloj += 2 * MIN;
    await sincronizar();
    reloj += 2 * MIN;
    await sincronizar();
    const s = (await salud())!;
    assert.equal(s.fallasSeguidas, 2);
    assert.equal(s.ultimaFallaMotivo, "ERP_NO_DISPONIBLE");
    assert.deepEqual(s.ultimaFallaEn, new Date(AHORA + 4 * MIN));
    assert.deepEqual(s.ultimoExitoEn, new Date(AHORA), "el último éxito no se toca");
    erp.ponerModo("normal");
    reloj += 2 * MIN;
    await sincronizar();
    assert.equal((await salud())!.fallasSeguidas, 0);
    assert.equal(await base.db.saludSincronizacion.count(), 1);
  });

  it("sin nadie con sesión, la corrida es un éxito: corrió y no había nada que hacer", async () => {
    await sincronizar();
    assert.deepEqual((await salud())!.ultimoExitoEn, new Date(AHORA));
  });
});

describe("Tanda 12: el incidente y sus avisos", () => {
  it("por tiempo: más de 10 minutos sin éxito abre, UN aviso con la hora y el motivo, sin repetir; al volver, UN aviso de recuperación", async () => {
    const { endpoint } = await conTelefono(ADMIN);
    await conTelefono(ENCARGADO); // no es destinatario: no recibe nada
    await sincronizar(); // éxito a las 09:00
    reloj += 10 * MIN;
    assert.equal((await vigia()).cuerpo!.incidente, "SIN_INCIDENTE", "10 minutos justos todavía no");
    reloj += 1 * MIN;
    const r = await vigia();
    assert.equal(r.cuerpo!.incidente, "ABIERTO");
    assert.deepEqual(enviados.map((e) => e.endpoint), [endpoint], "solo a los destinatarios");
    assert.deepEqual(enviados[0]!.aviso, {
      titulo: "Azul Chat",
      cuerpo: "Azul Chat no se está actualizando desde las 09:00. La actualización automática no está corriendo.",
      url: "/",
      etiqueta: "sistema",
      // Tanda 13: el id del incidente (desde cuándo no se actualiza) y la hora del vigía.
      incidente: new Date(AHORA).toISOString(),
      creadoEn: reloj,
    });
    // Tanda 13: urgencia alta y 6 horas de vida en el servicio de push.
    assert.equal(enviados[0]!.headers["urgency"], "high");
    assert.equal(enviados[0]!.headers["ttl"], String(6 * 60 * 60));
    for (let i = 0; i < 3; i++) {
      reloj += 5 * MIN;
      assert.equal((await vigia()).cuerpo!.incidente, "SIGUE");
    }
    assert.equal(enviados.length, 1, "nada de repetir cada 5 minutos");
    await sincronizar(); // vuelve
    const c = await vigia();
    assert.equal(c.cuerpo!.incidente, "CERRADO");
    assert.deepEqual(cuerpos(), [enviados[0]!.aviso.cuerpo, "Azul Chat volvió a actualizarse."]);
    // Tanda 13: misma etiqueta (reemplaza en la bandeja), hora más nueva (el teléfono descarta la apertura si llega después).
    const recuperacion = enviados[1]!;
    assert.deepEqual(recuperacion.aviso, { titulo: "Azul Chat", cuerpo: "Azul Chat volvió a actualizarse.", url: "/", etiqueta: "sistema", creadoEn: reloj });
    assert.ok((recuperacion.aviso.creadoEn as number) > (enviados[0]!.aviso.creadoEn as number));
    assert.equal(recuperacion.headers["urgency"], "high");
    assert.equal(recuperacion.headers["ttl"], String(6 * 60 * 60));
    reloj += 5 * MIN;
    assert.equal((await vigia()).cuerpo!.incidente, "SIN_INCIDENTE");
    assert.equal(enviados.length, 2);
  });

  it("por 3 fallas seguidas, aunque el último éxito sea reciente; el motivo en palabras simples", async () => {
    await conTelefono(ADMIN);
    await sincronizar(); // éxito a las 09:00
    erp.ponerModo("caido");
    for (let i = 0; i < 2; i++) {
      reloj += 2 * MIN;
      await sincronizar();
    }
    assert.equal((await vigia()).cuerpo!.incidente, "SIN_INCIDENTE", "2 fallas todavía no");
    reloj += 2 * MIN;
    await sincronizar(); // la tercera, a las 09:06
    const r = await vigia();
    assert.equal(r.cuerpo!.incidente, "ABIERTO");
    assert.deepEqual(cuerpos(), ["Azul Chat no se está actualizando desde las 09:00. El ERP no responde."]);
    assert.equal((await salud())!.incidenteMotivo, "ERP_NO_DISPONIBLE");
  });

  it("base sin corridas: no hay incidente hasta 10 minutos después de que el vigía la ve por primera vez", async () => {
    await conTelefono(ADMIN);
    assert.equal((await vigia()).cuerpo!.incidente, "SIN_INCIDENTE");
    assert.deepEqual((await salud())!.vigiaDesdeEn, new Date(AHORA));
    reloj += 5 * MIN;
    assert.equal((await vigia()).cuerpo!.incidente, "SIN_INCIDENTE");
    reloj += 6 * MIN;
    assert.equal((await vigia()).cuerpo!.incidente, "ABIERTO");
    assert.deepEqual(cuerpos(), ["Azul Chat no se está actualizando desde las 09:00. La actualización automática no está corriendo."]);
  });

  it("si el incidente viene de otro día, dice el día", async () => {
    await conTelefono(ADMIN);
    await sincronizar(); // 8/10 09:00
    reloj = Date.parse("2026-10-09T13:00:00.000Z"); // 9/10 10:00
    // La sesión del teléfono sigue valiendo un día después.
    await vigia();
    assert.deepEqual(cuerpos(), ["Azul Chat no se está actualizando desde el 8/10 a las 09:00. La actualización automática no está corriendo."]);
  });

  it("sin destinatarios, o con la variable mal escrita: el incidente se abre, no se manda nada y queda en el log", async () => {
    await conTelefono(ADMIN);
    await sincronizar();
    reloj += 11 * MIN;
    const sin = await vigia(depsVigia(leerDestinatarios({})));
    assert.equal(sin.cuerpo!.incidente, "ABIERTO");
    assert.equal(enviados.length, 0);
    assert.equal(ultimoRegistroVigia()!.sinEnvio, "SIN_DESTINATARIOS");
    reloj += 5 * MIN;
    await vigia(depsVigia(leerDestinatarios({ AZUL_CHAT_AVISOS_SISTEMA: "nueve" })));
    assert.equal(enviados.length, 0);
    assert.equal(ultimoRegistroVigia()!.sinEnvio, "DESTINATARIOS_INVALIDOS");
    // Al ponerla bien, el incidente sigue abierto: se avisa una vez.
    reloj += 5 * MIN;
    await vigia();
    assert.equal(enviados.length, 1);
  });

  it("un error del push nunca es un 500, y no se reintenta cada 5 minutos; una suscripción vencida se borra", async () => {
    await conTelefono(ADMIN);
    await sincronizar();
    reloj += 11 * MIN;
    respuestaPush = "TIRA";
    const r = await vigia();
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.cuerpo!.incidente, "ABIERTO");
    respuestaPush = 201;
    reloj += 5 * MIN;
    await vigia();
    assert.equal(enviados.length, 0, "ya se le intentó avisar: no se repite");
    // Otra persona-destinataria con la suscripción vencida (410): se borra, y el vigía sigue en 200.
    const { endpoint } = await conTelefono(ENCARGADO);
    respuestaPush = 410;
    reloj += 5 * MIN;
    const r2 = await vigia(depsVigia(leerDestinatarios({ AZUL_CHAT_AVISOS_SISTEMA: `${ADMIN},${ENCARGADO}` })));
    assert.equal(r2.status, 200);
    assert.equal(await base.db.pushSuscripcion.count({ where: { endpoint } }), 0);
  });

  it("si la base falla a mitad del envío: 200, el incidente queda guardado y el aviso no se reintenta", async () => {
    // El transporte nunca tira (enviarAviso lo absorbe): lo que sí puede tirar
    // en la fase de envío es la base. Acá falla justo al buscar los teléfonos,
    // DESPUÉS de anotar a la persona como avisada.
    await conTelefono(ADMIN);
    await sincronizar();
    reloj += 11 * MIN;
    const rota = new Proxy(base.db, {
      get(blanco, prop, receptor) {
        if (prop === "pushSuscripcion") return { ...blanco.pushSuscripcion, findMany: () => Promise.reject(new Error("base caída")) };
        return Reflect.get(blanco, prop, receptor);
      },
    });
    const r = await vigia({ ...depsVigia(), db: rota as typeof base.db });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.cuerpo!.incidente, "ABIERTO");
    assert.ok(registros.some((x) => x.evento === "sesion.falla_local"), "la falla queda en el log");
    assert.deepEqual((await salud())!.avisadosApertura, [ADMIN]);
    reloj += 5 * MIN;
    await vigia();
    assert.equal(enviados.length, 0, "ya se le intentó avisar: no se repite cada 5 minutos");
  });
});

describe("Tanda 12: el horario de silencio", () => {
  it("se abre y se cierra dentro del silencio: cero avisos", async () => {
    const { cookie } = await conTelefono(ADMIN);
    assert.equal((await silencio(cookie, 8, 11)).status, 200); // 08 a 11 de Argentina
    await sincronizar(); // 09:00
    reloj += 11 * MIN;
    assert.equal((await vigia()).cuerpo!.incidente, "ABIERTO");
    assert.equal(ultimoRegistroVigia()!.enSilencio, 1);
    await sincronizar();
    assert.equal((await vigia()).cuerpo!.incidente, "CERRADO");
    reloj = AHORA + 3 * 60 * MIN; // las 12:00, fuera del silencio
    await sincronizar();
    await vigia();
    assert.equal(enviados.length, 0, "ni el de apertura ni el de recuperación");
  });

  it("se abre dentro y sigue abierto al salir: UN aviso, al terminar el silencio", async () => {
    const { cookie } = await conTelefono(ADMIN);
    assert.equal((await silencio(cookie, 8, 10)).status, 200);
    await sincronizar(); // 09:00
    reloj += 11 * MIN; // 09:11, adentro
    await vigia();
    assert.equal(enviados.length, 0);
    reloj = AHORA + 60 * MIN; // 10:00, afuera; sigue sin éxito
    await vigia();
    assert.deepEqual(cuerpos(), ["Azul Chat no se está actualizando desde las 09:00. La actualización automática no está corriendo."]);
    reloj += 5 * MIN;
    await vigia();
    assert.equal(enviados.length, 1, "una sola vez");
  });

  it("la recuperación de quien recibió la apertura y ahora está en silencio sale cuando termina", async () => {
    const { cookie } = await conTelefono(ADMIN);
    await sincronizar(); // 09:00
    reloj += 11 * MIN;
    await vigia(); // apertura, sin silencio
    assert.equal(enviados.length, 1);
    assert.equal((await silencio(cookie, 9, 10)).status, 200);
    await sincronizar(); // vuelve a las 09:11, en silencio
    assert.equal((await vigia()).cuerpo!.incidente, "CERRADO");
    assert.equal(enviados.length, 1, "en silencio no se manda");
    reloj = AHORA + 61 * MIN; // 10:01
    await sincronizar();
    await vigia();
    assert.deepEqual(cuerpos().at(-1), "Azul Chat volvió a actualizarse.");
    assert.equal(enviados.length, 2);
  });
});
