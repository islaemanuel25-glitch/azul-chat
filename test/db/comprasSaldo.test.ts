// CANDADOS DE `compras_saldo_eventos` → COMPRA_CON_SALDO (2026-10-15), DE PUNTA
// A PUNTA, CONTRA POSTGRESQL.
//
// El aviso de "Pago parcial al proveedor" del ERP llega a Azul Chat por la MISMA
// corrida de fondo que los otros eventos (POST /api/interno/sincronizar, el
// timer de cada 2 minutos): `mi_alcance` vivo, la ingesta con su cursor por
// local y capacidad en la base de Chat, y los avisos push con su marca de agua.
// Lo que se afirma acá es el recorrido entero con los datos REALES del ERP: las
// compras y los `mi_alcance` salen de test/fixtures/erp-fd1bca1.json, generado
// ejecutando la puerta del ERP. Ninguna compra está escrita a mano.
//
//   · un evento nuevo aparece UNA vez en la conversación de su local y genera
//     UN push con su texto;
//   · repetir la consulta (la misma página otra vez) no lo duplica;
//   · Chat caído y vuelto (otro proceso, la misma base) retoma del cursor
//     guardado: no pierde ni repite;
//   · un evento de otro local no aparece en la conversación equivocada, y una
//     respuesta del ERP con el local cambiado no se guarda;
//   · ERP caído o colgado: la corrida contesta 200 y anota el código; Chat no
//     se cae;
//   · solo lo ve quien el ERP autoriza (el cajero sin `finanzas.ver`, no);
//   · el horario de silencio también vale para estos avisos.

import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import ece from "http_ece";
import webpush from "web-push";

import { manejarSincronizar, type DependenciasTarea } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import { FRECUENCIA_MINIMA_INGESTA_MS } from "../../src/server/chats/sincronizacion.ts";
import { manejarChats, manejarLocal } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { leerConfigPush } from "../../src/server/push/config.ts";
import { manejarSuscribir, type DependenciasPush } from "../../src/server/push/manejadores.ts";
import { manejarSilencio } from "../../src/server/sesion/configuracion.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { EventoPublico } from "../../src/shared/chats/api.ts";
import type { DatosMiAlcance, EventoCompraConSaldo } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { ADMINISTRADORES_DE_PRUEBA } from "../ayuda/accesos.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { COMPRAS_DE_CASIANO, COMPRAS_DE_CENTRO } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_FD1BCA1, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const VAPID = webpush.generateVAPIDKeys();
const CAPACIDAD = "compras_saldo_eventos";
const MA = FIXTURES_ERP_FD1BCA1.miAlcance;
/** Las personas del fixture: con `finanzas.ver` en Casiano, el cajero sin él, y el admin global. */
const TESORERIA = 7;
const CAJERO = 8;
const ADMIN = 9;
const CASIANO = 3;
const CENTRO = 20;
const [C11, C12, C13] = COMPRAS_DE_CASIANO as [EventoCompraConSaldo, EventoCompraConSaldo, EventoCompraConSaldo];
const [C14] = COMPRAS_DE_CENTRO as [EventoCompraConSaldo];

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
  erp.eventosPorCapacidad.clear();
  erp.respuestaParaCapacidad.clear();
  erp.ponerModo("normal");
  erp.alcances.clear();
  for (const [id, caso] of [
    [TESORERIA, MA.tesoreria],
    [CAJERO, MA.cajero],
    [ADMIN, MA.adminGlobal],
  ] as const) {
    erp.alcances.set(id, structuredClone(caso.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
  }
  registros = [];
  enviados = [];
  reloj = Date.parse(FIXTURES_ERP_FD1BCA1.ahora);
});

const ENTORNO = {
  AZUL_CHAT_INSTALACION_ID: INSTALACION,
  AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN,
  AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE,
  AZUL_CHAT_ADMINISTRADORES: ADMINISTRADORES_DE_PRUEBA,
  AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA,
  AZUL_CHAT_TAREA_SECRET: SECRETO_TAREA,
  AZUL_CHAT_VAPID_PUBLICA: VAPID.publicKey,
  AZUL_CHAT_VAPID_PRIVADA: VAPID.privateKey,
  AZUL_CHAT_VAPID_CONTACTO: "mailto:prueba@ejemplo.invalid",
};

/**
 * Las dependencias de UN proceso de Azul Chat: cliente del ERP, limitador y
 * reloj propios. Llamarla de nuevo es "otro proceso" sobre la MISMA base: lo
 * que sobrevive a una caída es lo que está en PostgreSQL.
 */
function deps(): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  return {
    config: leerConfigAzulChat(ENTORNO),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: 1000, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
  };
}

const servicioPush: typeof fetch = async (url, init) => {
  const endpoint = String(url);
  const t = telefonos.get(endpoint);
  assert.ok(t, `push a un endpoint desconocido: ${endpoint}`);
  const plano = ece.decrypt(Buffer.from(init!.body as Uint8Array), { version: "aes128gcm", privateKey: t.ecdh, authSecret: t.auth.toString("base64url") });
  enviados.push({ endpoint, aviso: JSON.parse(plano.toString("utf8")) });
  return new Response(null, { status: 201 });
};

function depsTarea(): DependenciasTarea {
  const puerta = leerPuertaTarea(ENTORNO);
  const push = leerConfigPush(ENTORNO);
  assert.ok(puerta.ok && push.ok);
  return { ...deps(), puerta, push, transportePush: servicioPush };
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

/** Una corrida del timer. Cada una con dependencias nuevas, como un proceso que arranca. */
async function sincronizar() {
  const res = await manejarSincronizar(new Request("http://127.0.0.1:3100/api/interno/sincronizar", { method: "POST", headers: DEL_TIMER }), depsTarea());
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: texto ? (JSON.parse(texto) as Record<string, number | string>) : null };
}

const vencer = () => {
  reloj += FRECUENCIA_MINIMA_INGESTA_MS;
};

async function suscribir(cookie: string): Promise<string> {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/prueba-${randomBytes(6).toString("hex")}`;
  telefonos.set(endpoint, { ecdh, auth });
  const cuerpo = { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  const res = await manejarSuscribir(
    new Request(`${ORIGEN}/api/push/suscribir`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) }, body: JSON.stringify(cuerpo) }),
    depsPush(),
  );
  assert.equal(res.status, 200);
  return endpoint;
}

/** La conversación de un local, como la pide la app: la lista de eventos, o el estado si no hay. */
async function conversacion(cookie: string, localId: number): Promise<{ status: number; estado: string | undefined; eventos: EventoPublico[] }> {
  const res = await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${localId}`, { headers: conCookie(cookie) }), deps());
  const c = (await res.json()) as { estado?: string; eventos?: EventoPublico[] };
  return { status: res.status, estado: c.estado, eventos: c.eventos ?? [] };
}

const comprasEn = (eventos: readonly EventoPublico[]) => eventos.filter((e) => e.tipo === "COMPRA_CON_SALDO").map((e) => (e.tipo === "COMPRA_CON_SALDO" ? e.texto : ""));
const comprasGuardadas = (localId: number) => base.db.evento.count({ where: { tipo: "COMPRA_CON_SALDO", erpLocalId: localId } });
const universo = (localId: number, compras: readonly EventoCompraConSaldo[]) => erp.eventosPorCapacidad.set(`${CAPACIDAD}:${localId}`, structuredClone([...compras]));
const agregar = (localId: number, c: EventoCompraConSaldo) => erp.eventosPorCapacidad.get(`${CAPACIDAD}:${localId}`)!.push(structuredClone(c));

/**
 * Tesorería de Casiano vinculada, con la app abierta una vez (su línea de base
 * de lectura), un teléfono suscripto y el backfill hecho con la compra 11: lo
 * que había antes es historia y no se avisa.
 */
async function preparado() {
  universo(CASIANO, [C11]);
  const cookie = await vincular(TESORERIA);
  await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps());
  vencer();
  const endpoint = await suscribir(cookie);
  const r = await sincronizar();
  assert.equal(r.status, 200, r.texto);
  assert.equal(enviados.length, 0, "el backfill no se avisa");
  assert.equal(await comprasGuardadas(CASIANO), 1);
  vencer();
  return { cookie, endpoint };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("compras_saldo_eventos: el aviso de pago parcial al proveedor", () => {
  it("un evento nuevo aparece UNA vez en la conversación de su local y genera UN push con el texto del ERP", async () => {
    const { cookie, endpoint } = await preparado();
    agregar(CASIANO, C12);
    const r = await sincronizar();
    assert.equal(r.cuerpo!.enviados, 1, r.texto);
    assert.deepEqual(enviados, [
      {
        endpoint,
        aviso: { titulo: "Azul Chat", cuerpo: `Casiano: ${C12.texto}`, url: `/?vista=local&localId=${CASIANO}`, etiqueta: `local-${CASIANO}`, creadoEn: reloj },
      },
    ]);
    assert.match(C12.texto, /^Bebidas Norte: pedido \$80\.250,50 · pagado \$30\.000,00 · quedan \$50\.250,50 a deber$/, "el texto es el del ERP, tal cual");

    const c = await conversacion(cookie, CASIANO);
    assert.equal(c.status, 200);
    assert.deepEqual(comprasEn(c.eventos).sort(), [C11.texto, C12.texto].sort(), "en su conversación, cada una una vez");
    const doce = c.eventos.find((e) => e.tipo === "COMPRA_CON_SALDO" && e.pedidoId === C12.pedidoId);
    assert.deepEqual(doce && { ...doce, id: "x" }, {
      id: "x",
      fecha: C12.confirmadoEn,
      historico: false,
      tipo: "COMPRA_CON_SALDO",
      pedidoId: C12.pedidoId,
      proveedor: C12.proveedor,
      texto: C12.texto,
    });

    // La corrida siguiente no lo repite: ni en la base, ni en el teléfono.
    vencer();
    await sincronizar();
    assert.equal(enviados.length, 1, "una sola vez por evento");
    assert.equal(await comprasGuardadas(CASIANO), 2);
  });

  it("repetir la consulta no lo duplica: la misma página otra vez no agrega filas ni avisos", async () => {
    await preparado();
    agregar(CASIANO, C12);
    await sincronizar();
    assert.equal(enviados.length, 1);
    // El cursor retrocede a la 11 (páginas solapadas, una corrida que repite):
    // el ERP vuelve a entregar la 12, que ya está guardada y ya se avisó.
    await base.db.cursorIngesta.updateMany({
      where: { capacidad: CAPACIDAD },
      data: { cursor: { confirmadoEn: C11.confirmadoEn, compraConSaldoId: C11.compraConSaldoId } },
    });
    vencer();
    const r = await sincronizar();
    assert.equal(r.status, 200, r.texto);
    assert.ok(erp.cuerposA("consultar").filter((x) => x.capacidad === CAPACIDAD).length >= 3, "la consulta se repitió de verdad");
    assert.equal(await comprasGuardadas(CASIANO), 2, "una fila por evento");
    assert.equal(enviados.length, 1, "ni un aviso de más");
  });

  it("Chat caído y vuelto: retoma desde el cursor guardado, sin perder ni repetir", async () => {
    await preparado();
    agregar(CASIANO, C12);
    await sincronizar();
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo), [`Casiano: ${C12.texto}`]);
    const guardado = await base.db.cursorIngesta.findFirstOrThrow({ where: { capacidad: CAPACIDAD, erpLocalId: CASIANO } });
    assert.deepEqual(guardado.cursor, { confirmadoEn: C12.confirmadoEn, compraConSaldoId: C12.compraConSaldoId }, "el último procesado queda en la base de Chat");

    // Chat no corre: en el ERP aparece la 13. Vuelve, otro proceso (deps nuevas) sobre la misma base.
    agregar(CASIANO, C13);
    reloj += 10 * 60_000;
    erp.recibidas.length = 0;
    const r = await sincronizar();
    assert.equal(r.status, 200, r.texto);
    const pedido = erp.cuerposA("consultar").find((x) => x.capacidad === CAPACIDAD) as { parametros: { desde?: unknown } } | undefined;
    assert.deepEqual(pedido?.parametros.desde, guardado.cursor, "pregunta desde donde quedó, no desde el principio");
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo), [`Casiano: ${C12.texto}`, `Casiano: ${C13.texto}`], "la 13 una vez, la 12 no se repite");
    assert.equal(await comprasGuardadas(CASIANO), 3);
  });

  it("un evento de otro local no aparece en la conversación equivocada, y una respuesta con el local cambiado no se guarda", async () => {
    universo(CASIANO, [C11, C12, C13]);
    universo(CENTRO, [C14]);
    const cookie = await vincular(ADMIN);
    const r = await sincronizar();
    assert.equal(r.status, 200, r.texto);
    assert.equal(await comprasGuardadas(CASIANO), 3);
    assert.equal(await comprasGuardadas(CENTRO), 1);
    const deCasiano = comprasEn((await conversacion(cookie, CASIANO)).eventos);
    const deCentro = comprasEn((await conversacion(cookie, CENTRO)).eventos);
    assert.deepEqual(deCasiano.sort(), [C11.texto, C12.texto, C13.texto].sort());
    assert.deepEqual(deCentro, [C14.texto]);
    assert.ok(!deCasiano.includes(C14.texto), "la de Centro no está en Casiano");

    // El ERP contesta, para Casiano, la página de Centro: el local no es el pedido. Nada se guarda en ningún lado.
    await base.vaciar();
    erp.respuestaParaCapacidad.set(`${CAPACIDAD}:${CASIANO}`, FIXTURES_ERP_FD1BCA1.compras_saldo_eventos.deCentro.respuesta);
    await vincular(ADMIN);
    await sincronizar();
    assert.equal(await comprasGuardadas(CASIANO), 0);
    assert.equal(await comprasGuardadas(CENTRO), 1, "lo de Centro entra solo por la consulta de Centro");
    const cursor = await base.db.cursorIngesta.findFirstOrThrow({ where: { capacidad: CAPACIDAD, erpLocalId: CASIANO } });
    assert.equal(cursor.ultimoErrorCodigo, "RESPUESTA_INVALIDA");
    assert.equal(cursor.cursor, null, "el cursor no se movió");
  });

  it("solo lo ve quien el ERP autoriza: el cajero sin finanzas.ver no lo ve ni recibe el aviso", async () => {
    const { cookie } = await preparado();
    const cajero = await vincular(CAJERO);
    const delCajero = await suscribir(cajero);
    await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cajero) }), deps());
    agregar(CASIANO, C12);
    vencer();
    await sincronizar();
    assert.ok(enviados.length >= 1);
    assert.ok(enviados.every((e) => e.endpoint !== delCajero), "al cajero no le llega");
    assert.ok(!erp.cuerposA("consultar").some((x) => x.capacidad === CAPACIDAD && (x.delegacion as { token: string }).token === erp.tokenVigente(CAJERO)), "ni se le pide al ERP con su token");
    const c = await conversacion(cajero, CASIANO);
    assert.deepEqual(comprasEn(c.eventos), [], `el cajero no ve compras (${c.status} ${c.estado ?? ""})`);
    assert.deepEqual(comprasEn((await conversacion(cookie, CASIANO)).eventos).sort(), [C11.texto, C12.texto].sort(), "tesorería sí");
  });

  it("si el ERP no responde (caído o colgado), la corrida contesta 200, anota el código y Chat sigue; al volver, entra todo una vez", async () => {
    await preparado();
    agregar(CASIANO, C12);
    for (const modo of ["caido", "colgado"] as const) {
      erp.ponerModo(modo);
      vencer();
      const r = await sincronizar();
      assert.equal(r.status, 200, `${modo}: ${r.texto}`);
      assert.equal(enviados.length, 0, modo);
      assert.equal(await comprasGuardadas(CASIANO), 1, modo);
    }
    erp.ponerModo("normal");
    // Solo la capacidad nueva falla (503 del ERP para ella): las demás corridas no se cortan.
    erp.respuestaParaCapacidad.set(`${CAPACIDAD}:${CASIANO}`, { status: 503, cuerpo: { ok: false, codigo: "ERP_NO_DISPONIBLE", error: "x" } });
    vencer();
    assert.equal((await sincronizar()).status, 200);
    const conError = await base.db.cursorIngesta.findFirstOrThrow({ where: { capacidad: CAPACIDAD, erpLocalId: CASIANO } });
    assert.ok(conError.ultimoErrorCodigo, "el fallo queda anotado por código");
    erp.respuestaParaCapacidad.clear();
    vencer();
    await sincronizar();
    assert.deepEqual(enviados.map((e) => e.aviso.cuerpo), [`Casiano: ${C12.texto}`]);
    assert.equal(await comprasGuardadas(CASIANO), 2);
    assert.equal((await base.db.cursorIngesta.findFirstOrThrow({ where: { capacidad: CAPACIDAD, erpLocalId: CASIANO } })).ultimoErrorCodigo, null);
  });

  it("el horario de silencio también vale: no se avisa, la marca avanza y al salir no llega el atraso", async () => {
    const { cookie } = await preparado();
    // 12:00 UTC del fixture son las 9 en Argentina: silencio de 9 a 10.
    const res = await manejarSilencio(
      new Request(`${ORIGEN}/api/sesion/silencio`, {
        method: "PUT",
        headers: { "content-type": "application/json", origin: ORIGEN, ...conCookie(cookie) },
        body: JSON.stringify({ activo: true, desde: 9, hasta: 10 }),
      }),
      deps(),
    );
    assert.equal(res.status, 200);
    agregar(CASIANO, C12);
    await sincronizar();
    assert.equal(enviados.length, 0, "en silencio no se avisa");
    assert.equal(await comprasGuardadas(CASIANO), 2, "pero el evento entra y queda en la conversación");
    reloj += 60 * 60_000; // las 10: terminó el silencio
    await sincronizar();
    assert.equal(enviados.length, 0, "al salir no llega lo de durante el silencio");
  });
});
