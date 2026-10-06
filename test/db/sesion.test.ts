// CANDADO DE PUNTA A PUNTA: código → vincular → canje firmado → token cifrado
// en la base → sesión → mi_alcance → cerrar. Con una base PostgreSQL
// descartable (test/ayuda/baseDescartable.ts) y un ERP de mentira con estado
// (test/ayuda/erpConEstado.ts). Ningún test llama al ERP real.

import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { manejarCerrar } from "../../src/server/sesion/cerrar.ts";
import { DURACION_SESION_MS, NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarEstado } from "../../src/server/sesion/estado.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import { ventasResumenDeSesion } from "../../src/server/ventas/ventasResumen.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { DATOS_ERP, ENTRADA_HOY, FIXTURES_ERP, SECRETO_PRUEBA } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const ALCANCE_EMANUEL = FIXTURES_ERP.miAlcance.datos; // usuario 7, GLOBAL
const ALCANCE_GRUPO = FIXTURES_ERP.miAlcanceGrupo.datos; // usuario 8, GRUPO 2

let base: BaseDescartable;
let erp: ErpConEstado;
let registros: Registro[];
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
  erp.ponerModo("normal");
  erp.alcances.clear();
  erp.alcances.set(7, ALCANCE_EMANUEL);
  erp.alcances.set(8, ALCANCE_GRUPO);
  registros = [];
  reloj = Date.parse("2026-10-06T15:00:00Z");
});

type Opciones = { db?: PrismaClient | null; entorno?: Record<string, string | undefined>; timeoutMs?: number; limitador?: ReturnType<typeof crearLimitador> };

function deps(o: Opciones = {}): DependenciasSesion {
  const entorno = o.entorno ?? { AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE };
  const registrar = (r: Registro) => registros.push(r);
  return {
    config: leerConfigAzulChat(entorno),
    db: o.db === undefined ? base.db : o.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs: o.timeoutMs ?? 2000, registrar }),
    limitador: o.limitador ?? crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
  };
}

function pedidoVincular(cuerpo: unknown, { origen = ORIGEN as string | null, cookie = null as string | null, ip = "203.0.113.1" } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (origen !== null) headers.origin = origen;
  if (cookie) headers.cookie = `${NOMBRE_COOKIE}=${cookie}`;
  return new Request(`${ORIGEN}/api/sesion/vincular`, { method: "POST", headers, body: JSON.stringify(cuerpo) });
}

const pedidoEstado = (cookie: string | null) =>
  new Request(`${ORIGEN}/api/sesion`, { headers: cookie ? { cookie: `${NOMBRE_COOKIE}=${cookie}` } : {} });

const pedidoCerrar = (cookie: string | null, origen: string | null = ORIGEN) => {
  const headers: Record<string, string> = {};
  if (origen !== null) headers.origin = origen;
  if (cookie) headers.cookie = `${NOMBRE_COOKIE}=${cookie}`;
  return new Request(`${ORIGEN}/api/sesion`, { method: "DELETE", headers });
};

function idDeCookie(res: Response): string | null {
  const c = res.headers.get("set-cookie");
  const m = c && new RegExp(`^${NOMBRE_COOKIE}=([^;]*)`).exec(c);
  return m && m[1] ? m[1] : null;
}

/** Vincula a la persona con un código recién emitido y devuelve el id de la cookie. */
async function vincular(usuarioId = 7, opciones: Parameters<typeof pedidoVincular>[1] = {}): Promise<string> {
  const res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(usuarioId) }, opciones), deps());
  assert.equal(res.status, 200, await res.clone().text());
  const id = idDeCookie(res);
  assert.ok(id);
  return id;
}

async function estado(cookie: string | null, d = deps()) {
  const res = await manejarEstado(pedidoEstado(cookie), d);
  return { res, cuerpo: (await res.json()) as Record<string, unknown> };
}

/** Todo lo que hay en la base, como texto. */
async function volcado(): Promise<string> {
  const filas = await base.db.$queryRawUnsafe<unknown[]>(
    `SELECT json_build_object('i', (SELECT json_agg(t) FROM "Instalacion" t), 'v', (SELECT json_agg(t) FROM "Vinculo" t), 's', (SELECT json_agg(t) FROM "Sesion" t))::text AS x`,
  );
  return JSON.stringify(filas);
}

describe("vincular", () => {
  it("1/4/5/12/18. canje firmado con solo el código; token cifrado en la base; sesión con cookie HttpOnly", async () => {
    const codigo = erp.emitirCodigo(7);
    const res = await manejarVincular(pedidoVincular({ codigo }), deps());
    const texto = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(texto), { ok: true });
    assert.equal(res.headers.get("cache-control"), "no-store");

    // El ERP recibió UN canje, firmado, con exactamente { codigo }.
    assert.deepEqual(erp.cuerposA("canjear"), [{ codigo }]);
    assert.equal(erp.firmasInvalidas(), 0);

    // La cookie: identificador opaco, HttpOnly, Lax, Path, Max-Age; sin Secure fuera de producción.
    const cookie = res.headers.get("set-cookie")!;
    const id = idDeCookie(res)!;
    assert.match(id, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(cookie.split("; ").slice(1), ["Path=/", `Max-Age=${DURACION_SESION_MS / 1000}`, "HttpOnly", "SameSite=Lax"]);

    // La base: una persona, el token cifrado, la sesión por hash.
    const token = erp.tokenVigente(7)!;
    const v = await base.db.vinculo.findFirstOrThrow();
    assert.equal(v.erpUsuarioId, 7);
    assert.equal(v.erpVinculoId, 41);
    assert.match(v.tokenCifrado, /^v1\./);
    const s = await base.db.sesion.findFirstOrThrow();
    assert.equal(s.idHash, createHash("sha256").update(id).digest("hex"));
    assert.equal(s.expiraEn.getTime() - s.creadaEn.getTime(), DURACION_SESION_MS);

    // 3/12/21. Ni el código, ni el token, ni el id de la sesión: en la base, la respuesta o los logs.
    const todo = (await volcado()) + texto + cookie.replace(id, "") + JSON.stringify(registros);
    for (const secreto of [codigo, token, id, token.slice(5, 25), codigo.slice(5, 25)]) {
      assert.equal(todo.includes(secreto), false);
    }
    assert.equal(JSON.stringify(registros).includes(id), false);
  });

  it("18. en producción la cookie lleva Secure", async () => {
    const d = deps({ entorno: { AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE, NODE_ENV: "production" } });
    const res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }), d);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("set-cookie")!.split("; ").includes("Secure"));
  });

  it("10/11. el navegador no elige la identidad: usuarioId, vinculoId o cualquier clave extra rechazan sin llamar al ERP", async () => {
    const codigo = erp.emitirCodigo(7);
    for (const cuerpo of [{ codigo, usuarioId: 8 }, { codigo, vinculoId: 1 }, { codigo, token: "del1_x" }, { usuarioId: 8 }, [codigo], codigo]) {
      const res = await manejarVincular(pedidoVincular(cuerpo), deps());
      assert.equal(res.status, 400, JSON.stringify(cuerpo));
      assert.equal(((await res.json()) as { codigo: string }).codigo, "SOLICITUD_INVALIDA");
    }
    assert.equal(erp.recibidas.length, 0);
    assert.equal(await base.db.vinculo.count(), 0);
  });

  it("2. un código con otra forma no llega al ERP; uno que el ERP no reconoce devuelve CODIGO_NO_VALIDO", async () => {
    let res = await manejarVincular(pedidoVincular({ codigo: "vin1_corto" }), deps());
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { codigo: string }).codigo, "CODIGO_NO_VALIDO");
    assert.equal(erp.recibidas.length, 0);

    res = await manejarVincular(pedidoVincular({ codigo: `vin1_${"A".repeat(43)}` }), deps());
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { codigo: string }).codigo, "CODIGO_NO_VALIDO");
    assert.equal(erp.cuerposA("canjear").length, 1);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("2. un código usado no sirve dos veces", async () => {
    const codigo = erp.emitirCodigo(7);
    assert.equal((await manejarVincular(pedidoVincular({ codigo }), deps())).status, 200);
    const res = await manejarVincular(pedidoVincular({ codigo }), deps());
    assert.equal(((await res.json()) as { codigo: string }).codigo, "CODIGO_NO_VALIDO");
  });

  it("23. un Origin ajeno, ausente o null se rechaza antes de todo", async () => {
    for (const origen of ["https://malo.ejemplo.invalid", null, "null", `${ORIGEN}.malo.invalid`]) {
      const res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }, { origen }), deps());
      assert.equal(res.status, 403, String(origen));
      assert.equal(((await res.json()) as { codigo: string }).codigo, "ORIGEN_NO_PERMITIDO");
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    }
    assert.equal(erp.recibidas.length, 0);
  });

  it("24. el cupo corta antes del ERP y dice cuándo reintentar", async () => {
    const d = deps({ limitador: crearLimitador({ maxPorIp: 2, maxPorProceso: 100 }) });
    const r = [];
    for (let i = 0; i < 3; i++) r.push(await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }), d));
    assert.deepEqual(r.map((x) => x.status), [200, 200, 429]);
    assert.equal(r[2]!.headers.get("retry-after"), "60");
    assert.equal(erp.cuerposA("canjear").length, 2);
  });

  it("16. sin la clave de cifrado (o sin base) no se gasta el código: no se llama al ERP", async () => {
    const sinClave = deps({ entorno: { AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN } });
    let res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }), sinClave);
    assert.equal(res.status, 503);
    res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }), deps({ db: null }));
    assert.equal(res.status, 503);
    assert.equal(erp.recibidas.length, 0);
  });

  it("17. con la clave igual al secreto de la integración, no arranca", async () => {
    const igual = randomBytes(32).toString("base64url");
    const d = deps({ entorno: { AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: igual, AZUL_CHAT_INTEGRACION_SECRET: igual } });
    assert.deepEqual(d.config, { ok: false, motivo: "CLAVE_ES_EL_SECRETO_DE_INTEGRACION" });
    const res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }), d);
    assert.equal(res.status, 503);
    assert.equal(erp.recibidas.length, 0);
  });

  it("si la base no anda ANTES del canje, el código no se gasta", async () => {
    const rota = conFalla(base.db, "instalacion");
    const codigo = erp.emitirCodigo(7);
    const res = await manejarVincular(pedidoVincular({ codigo }), deps({ db: rota }));
    assert.equal(res.status, 503);
    assert.equal(erp.recibidas.length, 0);
    // El mismo código sigue sirviendo.
    assert.equal((await manejarVincular(pedidoVincular({ codigo }), deps())).status, 200);
  });

  it("35/36. si el guardado local falla DESPUÉS del canje: error seguro, un solo canje, nada a medias, sin código ni token en el log", async () => {
    const rota = conFalla(base.db, "$transaction");
    const codigo = erp.emitirCodigo(7);
    const res = await manejarVincular(pedidoVincular({ codigo }), deps({ db: rota }));
    const cuerpo = (await res.json()) as { codigo: string; mensaje: string };
    assert.equal(res.status, 500);
    assert.equal(cuerpo.codigo, "VINCULACION_NO_COMPLETADA");
    assert.match(cuerpo.mensaje, /generá uno nuevo/);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(erp.cuerposA("canjear").length, 1, "no se reintenta el canje");
    assert.equal(await base.db.vinculo.count(), 0);
    assert.equal(await base.db.sesion.count(), 0);
    assert.deepEqual(
      registros.filter((r) => r.evento === "sesion.vincular").map((r) => ({ ...r, requestId: "-" })),
      [{ evento: "sesion.vincular", requestId: "-", resultado: "VINCULACION_NO_COMPLETADA", etapa: "persistencia" }],
    );
    const logs = JSON.stringify(registros);
    assert.equal(logs.includes(codigo) || logs.includes(erp.tokenVigente(7)!), false);
  });

  it("36. un canje que se corta por tiempo no se reintenta y avisa que el código puede estar gastado", async () => {
    erp.ponerModo("colgado");
    const res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }), deps({ timeoutMs: 150 }));
    const cuerpo = (await res.json()) as { codigo: string; mensaje: string };
    assert.equal(res.status, 503);
    assert.equal(cuerpo.codigo, "ERP_NO_DISPONIBLE");
    assert.match(cuerpo.mensaje, /generá uno nuevo/);
    assert.equal(erp.recibidas.length, 1);
    assert.equal(await base.db.vinculo.count(), 0);
  });

  it("la base de otra instalación no se adopta, y no se gasta el código", async () => {
    await base.db.instalacion.create({ data: { id: "otra-instalacion" } });
    const res = await manejarVincular(pedidoVincular({ codigo: erp.emitirCodigo(7) }), deps());
    assert.equal(res.status, 503);
    assert.equal(erp.recibidas.length, 0);
  });
});

describe("el estado de la sesión y mi_alcance", () => {
  it("22/13. con sesión: nombre y locales de mi_alcance, pedidos con el token descifrado en el servidor; nada sensible baja", async () => {
    const id = await vincular(7);
    const { res, cuerpo } = await estado(id);
    assert.equal(res.status, 200);
    assert.deepEqual(cuerpo, {
      estado: "VINCULADO",
      usuario: { nombre: ALCANCE_EMANUEL.usuario && (ALCANCE_EMANUEL.usuario as { nombre: string }).nombre },
      alcance: ALCANCE_EMANUEL.alcance,
      locales: ALCANCE_EMANUEL.locales,
    });
    const token = erp.tokenVigente(7)!;
    assert.deepEqual(erp.cuerposA("consultar"), [{ capacidad: "mi_alcance", delegacion: { token }, parametros: {} }]);
    assert.equal(erp.firmasInvalidas(), 0);
    const texto = JSON.stringify(cuerpo);
    for (const x of [token, "del1_", id, "vinculoId", "usuarioId", "tokenCifrado"]) assert.equal(texto.includes(x), false, x);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("sin cookie: SIN_SESION sin llamar al ERP; con una cookie que no existe, además se borra", async () => {
    let r = await estado(null);
    assert.deepEqual(r.cuerpo, { estado: "SIN_SESION" });
    assert.equal(r.res.headers.get("set-cookie"), null);
    r = await estado(randomBytes(32).toString("base64url"));
    assert.deepEqual(r.cuerpo, { estado: "SIN_SESION" });
    assert.match(r.res.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal(erp.recibidas.length, 0);
  });

  it("25. un cambio de alcance en el ERP se ve en la consulta siguiente: no hay caché ni copia local", async () => {
    const id = await vincular(7);
    assert.equal(((await estado(id)).cuerpo.alcance as { modo: string }).modo, "GLOBAL");
    // Mismas respuestas reales del ERP: a la persona 7 le queda el alcance que el fixture tiene para un GRUPO.
    erp.alcances.set(7, { ...ALCANCE_GRUPO, usuario: ALCANCE_EMANUEL.usuario });
    const { cuerpo } = await estado(id);
    assert.deepEqual(cuerpo.alcance, { modo: "GRUPO", grupoId: 2 });
    assert.deepEqual(cuerpo.locales, ALCANCE_GRUPO.locales);
    assert.equal((await volcado()).includes("GRUPO"), false);
  });

  it("26. el ERP rechaza el token (VINCULO_NO_VALIDO): el vínculo se invalida y TODAS sus sesiones se revocan", async () => {
    const a = await vincular(7, { ip: "203.0.113.1" });
    const b = await vincular(7, { ip: "203.0.113.2" });
    erp.revocar(7);
    const { res, cuerpo } = await estado(a);
    assert.deepEqual(cuerpo, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" });
    assert.match(res.headers.get("set-cookie")!, /Max-Age=0/);
    const v = await base.db.vinculo.findFirstOrThrow();
    assert.ok(v.invalidadoEn);
    assert.equal(v.motivoInvalidacion, "TOKEN_RECHAZADO_POR_ERP");
    assert.equal(await base.db.sesion.count({ where: { revocadaEn: null } }), 0);
    assert.ok(registros.some((r) => r.evento === "vinculo.invalidado" && r.sesionesRevocadas === 2));
    // El otro dispositivo ya no tiene sesión, y no hace falta preguntarle al ERP.
    const llamadas = erp.recibidas.length;
    assert.deepEqual((await estado(b)).cuerpo, { estado: "SIN_SESION" });
    assert.equal(erp.recibidas.length, llamadas);
    // Un código nuevo vuelve a habilitar a la persona.
    const c = await vincular(7);
    assert.equal((await estado(c)).cuerpo.estado, "VINCULADO");
  });

  it("27. un ERP caído (503) o colgado NO revoca nada; cuando vuelve, la sesión sigue", async () => {
    const id = await vincular(7);
    erp.ponerModo("caido");
    assert.deepEqual((await estado(id)).cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    erp.ponerModo("colgado");
    const r = await estado(id, deps({ timeoutMs: 150 }));
    assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    assert.equal(r.res.headers.get("set-cookie"), null);
    assert.equal((await base.db.vinculo.findFirstOrThrow()).invalidadoEn, null);
    assert.equal(await base.db.sesion.count({ where: { revocadaEn: null } }), 1);
    erp.ponerModo("normal");
    assert.equal((await estado(id)).cuerpo.estado, "VINCULADO");
  });

  it("NO_AUTORIZADO no revoca: la persona sigue vinculada aunque hoy no pueda", async () => {
    const id = await vincular(7);
    erp.alcances.delete(7);
    assert.deepEqual((await estado(id)).cuerpo, { estado: "NO_AUTORIZADO" });
    assert.equal(await base.db.sesion.count({ where: { revocadaEn: null } }), 1);
    erp.alcances.set(7, ALCANCE_EMANUEL);
    assert.equal((await estado(id)).cuerpo.estado, "VINCULADO");
  });

  it("15. un token cifrado que no se autentica no se manda ni invalida: servicio no disponible", async () => {
    const id = await vincular(7);
    const v = await base.db.vinculo.findFirstOrThrow();
    // El cifrado de OTRA persona copiado a esta fila: el contexto (AAD) no coincide.
    const config = leerConfigAzulChat({ AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE });
    assert.ok(config.ok);
    const ajeno = config.config.cifrador.cifrar(erp.tokenVigente(7)!, { instalacionId: INSTALACION, erpUsuarioId: 8, erpVinculoId: v.erpVinculoId });
    await base.db.vinculo.update({ where: { id: v.id }, data: { tokenCifrado: ajeno } });
    const llamadas = erp.recibidas.length;
    assert.deepEqual((await estado(id)).cuerpo, { estado: "SERVICIO_NO_DISPONIBLE" });
    assert.equal(erp.recibidas.length, llamadas);
    assert.equal((await base.db.vinculo.findFirstOrThrow()).invalidadoEn, null);
    assert.ok(registros.some((r) => r.evento === "sesion.falla_local" && r.etapa === "descifrado"));
  });

  it("16. otra clave de cifrado (perdida o rotada sin migrar): no se descifra y no se llama al ERP", async () => {
    const id = await vincular(7);
    const otra = deps({ entorno: { AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") } });
    const llamadas = erp.recibidas.length;
    assert.deepEqual((await estado(id, otra)).cuerpo, { estado: "SERVICIO_NO_DISPONIBLE" });
    assert.equal(erp.recibidas.length, llamadas);
  });
});

describe("vida de la sesión", () => {
  it("20. vencida: no vale, y no se pregunta al ERP", async () => {
    const id = await vincular(7);
    reloj += DURACION_SESION_MS;
    const llamadas = erp.recibidas.length;
    assert.deepEqual((await estado(id)).cuerpo, { estado: "SIN_SESION" });
    assert.equal(erp.recibidas.length, llamadas);
  });

  it("un segundo antes de vencer, vale", async () => {
    const id = await vincular(7);
    reloj += DURACION_SESION_MS - 1000;
    assert.equal((await estado(id)).cuerpo.estado, "VINCULADO");
  });

  it("21/22. varias sesiones por persona; cerrar revoca SOLO la de este dispositivo y no toca el vínculo", async () => {
    const a = await vincular(7, { ip: "203.0.113.1" });
    const b = await vincular(7, { ip: "203.0.113.2" });
    assert.notEqual(a, b);
    assert.equal(await base.db.vinculo.count(), 1);
    assert.equal(await base.db.sesion.count(), 2);
    // El segundo canje revocó el token viejo EN EL ERP; el dispositivo A usa el nuevo.
    assert.equal((await estado(a)).cuerpo.estado, "VINCULADO");
    assert.equal(erp.cuerposA("consultar").at(-1)!.delegacion && (erp.cuerposA("consultar").at(-1)!.delegacion as { token: string }).token, erp.tokenVigente(7));

    const llamadas = erp.recibidas.length;
    const res = await manejarCerrar(pedidoCerrar(a), deps());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.match(res.headers.get("set-cookie")!, new RegExp(`^${NOMBRE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax$`));
    assert.equal(erp.recibidas.length, llamadas, "cerrar no le avisa al ERP: no desvincula");

    assert.deepEqual((await estado(a)).cuerpo, { estado: "SIN_SESION" });
    assert.equal((await estado(b)).cuerpo.estado, "VINCULADO");
    assert.equal((await base.db.vinculo.findFirstOrThrow()).invalidadoEn, null);
  });

  it("un código viejo, generado antes que otro, ya no canjea (el ERP revocó su vínculo al generar el nuevo)", async () => {
    const viejo = erp.emitirCodigo(7);
    const nuevo = erp.emitirCodigo(7);
    const res = await manejarVincular(pedidoVincular({ codigo: viejo }), deps());
    assert.equal(((await res.json()) as { codigo: string }).codigo, "CODIGO_NO_VALIDO");
    assert.equal((await manejarVincular(pedidoVincular({ codigo: nuevo }), deps())).status, 200);
  });

  it("la ventana entre generar un código y canjearlo: si el otro dispositivo consulta en ese momento, pierde su sesión", async () => {
    // Así funciona el ERP desplegado: generar el código revoca el vínculo vigente
    // en ese instante. El dispositivo A, si consulta antes de que B canjee, recibe
    // VINCULO_NO_VALIDO y sus sesiones se revocan. B se vincula igual.
    const a = await vincular(7, { ip: "203.0.113.1" });
    const codigoB = erp.emitirCodigo(7);
    assert.deepEqual((await estado(a)).cuerpo, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" });
    const resB = await manejarVincular(pedidoVincular({ codigo: codigoB }, { ip: "203.0.113.2" }), deps());
    assert.equal(resB.status, 200);
    assert.equal((await estado(idDeCookie(resB))).cuerpo.estado, "VINCULADO");
    assert.deepEqual((await estado(a)).cuerpo, { estado: "SIN_SESION" });
    assert.equal((await base.db.vinculo.findFirstOrThrow()).invalidadoEn, null);
  });

  it("19. revocada: no vale aunque la cookie siga en el navegador", async () => {
    const id = await vincular(7);
    await manejarCerrar(pedidoCerrar(id), deps());
    const llamadas = erp.recibidas.length;
    assert.deepEqual((await estado(id)).cuerpo, { estado: "SIN_SESION" });
    assert.equal(erp.recibidas.length, llamadas);
  });

  it("23. cerrar desde otro origen no revoca nada", async () => {
    const id = await vincular(7);
    for (const origen of ["https://malo.ejemplo.invalid", null]) {
      const res = await manejarCerrar(pedidoCerrar(id, origen), deps());
      assert.equal(res.status, 403);
    }
    assert.equal((await estado(id)).cuerpo.estado, "VINCULADO");
  });

  it("volver a vincular desde el mismo dispositivo revoca la sesión que traía", async () => {
    const vieja = await vincular(7);
    const nueva = await vincular(7, { cookie: vieja });
    assert.deepEqual((await estado(vieja)).cuerpo, { estado: "SIN_SESION" });
    assert.equal((await estado(nueva)).cuerpo.estado, "VINCULADO");
  });

  it("dos personas: cada sesión ve lo suyo", async () => {
    const emanuel = await vincular(7);
    const encargada = await vincular(8);
    assert.equal(((await estado(emanuel)).cuerpo.usuario as { nombre: string }).nombre, "Emanuel");
    assert.equal(((await estado(encargada)).cuerpo.usuario as { nombre: string }).nombre, "Encargada");
    assert.equal(await base.db.vinculo.count(), 2);
  });
});

describe("ventas_resumen desde una sesión (servicio interno, sin ruta)", () => {
  const conCookie = (id: string) => new Headers({ cookie: `${NOMBRE_COOKIE}=${id}` });

  it("28/29. viaja con delegacion.token y sin usuarioId; devuelve los datos del ERP", async () => {
    const id = await vincular(7);
    const r = await ventasResumenDeSesion(conCookie(id), ENTRADA_HOY, deps());
    assert.deepEqual(r, { tipo: "OK", datos: DATOS_ERP });
    const cuerpo = erp.cuerposA("consultar").at(-1)!;
    assert.deepEqual(cuerpo, {
      capacidad: "ventas_resumen",
      delegacion: { token: erp.tokenVigente(7) },
      alcance: ENTRADA_HOY.alcance,
      parametros: { periodo: ENTRADA_HOY.periodo },
    });
    assert.equal(/usuarioId|vinculoId/.test(JSON.stringify(cuerpo)), false);
  });

  it("37. sin sesión no se llama; con el ERP caído se llama UNA vez y no se reintenta", async () => {
    assert.deepEqual(await ventasResumenDeSesion(new Headers(), ENTRADA_HOY, deps()), { tipo: "SIN_SESION", vinculoInvalidado: false });
    assert.equal(erp.recibidas.length, 0);
    const id = await vincular(7);
    erp.ponerModo("caido");
    const antes = erp.recibidas.length;
    const r = await ventasResumenDeSesion(conCookie(id), ENTRADA_HOY, deps());
    assert.equal(r.tipo, "RECHAZO_ERP");
    assert.equal(erp.recibidas.length, antes + 1);
  });

  it("una entrada que intenta elegir la persona no sale del servidor", async () => {
    const id = await vincular(7);
    const antes = erp.recibidas.length;
    const r = await ventasResumenDeSesion(conCookie(id), { ...ENTRADA_HOY, usuarioId: 8 }, deps());
    assert.equal(r.tipo, "RECHAZO_ERP");
    assert.equal(erp.recibidas.length, antes);
  });
});

/** Un cliente de base al que se le rompe UNA operación, para simular una falla local. */
function conFalla(db: PrismaClient, que: "$transaction" | "instalacion"): PrismaClient {
  return new Proxy(db, {
    get(objetivo, prop, receptor) {
      if (prop === que) {
        if (que === "$transaction") return () => Promise.reject(new Error("falla simulada"));
        return new Proxy({}, { get: () => () => Promise.reject(new Error("falla simulada")) });
      }
      const v = Reflect.get(objetivo, prop, receptor);
      return typeof v === "function" ? v.bind(objetivo) : v;
    },
  });
}
