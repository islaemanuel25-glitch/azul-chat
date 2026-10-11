// CANDADOS DE LA API DE CHATS (Tanda 2B), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// sesión real (vincular con un código del ERP de mentira) → `mi_alcance` vivo →
// capacidades de AHORA → sincronización → Evento → LecturaLocal → respuesta.
//
// El ERP es test/ayuda/erpConEstado.ts: firma HMAC, vínculos, `mi_alcance` de
// los fixtures generados ejecutando el ERP 25172fe (encargado, cajero,
// adminGlobal) y, para `transferencias_eventos`, el mismo portón que el ERP —
// solo un local cuyo `mi_alcance` anuncia la capacidad— y su paginación. Los
// eventos de Casiano son los REALES del fixture (180, 181, 182 en el mismo
// milisegundo, 183); los de otros locales tienen esa misma forma
// (test/ayuda/paginadorErp.ts). Ningún test llama al ERP real.
//
// Las rutas se ejercen por sus manejadores —lo único que hacen los archivos de
// src/app es delegar en ellos, y test/frontera/rutas.test.ts lo exige— con un
// Request HTTP y la cookie de una sesión de verdad.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { manejarChats, manejarGeneral, manejarLeido, manejarLocal } from "../../src/server/chats/manejadores.ts";
import { FRECUENCIA_MINIMA_INGESTA_MS } from "../../src/server/chats/sincronizacion.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import type { Registro } from "../../src/server/log.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { EventoPublico, RespuestaChats, RespuestaGeneral, RespuestaLeido, RespuestaLocal } from "../../src/shared/chats/api.ts";
import type { DatosMiAlcance, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { cancelacion, envio, pedido, recepcion } from "../ayuda/paginadorErp.ts";
import { decidirLecturaLocal, reducirConversacion, type EstadoConversacion, type InfoLocal } from "../../src/components/chats/logica.ts";
import { FIXTURES_ERP, FIXTURES_ERP_25172FE, FIXTURES_ERP_76B9A71, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const MA = FIXTURES_ERP_25172FE.miAlcance;
const TE = FIXTURES_ERP_25172FE.transferenciasEventos;
const alcance = (n: "adminGlobal" | "encargado" | "cajero") => structuredClone(MA[n].respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>;

/** Personas del ERP de mentira. */
const ADMIN = 9;
const ENCARGADO = 11;
const CAJERO = 12;

/** Los locales del `mi_alcance` real de adminGlobal: Belgrano (5, inactivo), Casiano (3), Depósito Central (9), Centro (20, otro grupo). */
const CASIANO = { id: 3, nombre: "Casiano" };
const DEPOSITO = { id: 9, nombre: "Depósito Central" };
/** Un evento que tiene que ser una recepción: el tipo se comprueba, no se supone. */
function recibida<E extends EventoPublico>(e: E): Extract<E, { tipo: "TRANSFERENCIA_RECIBIDA" }> {
  assert.equal(e.tipo, "TRANSFERENCIA_RECIBIDA");
  return e as Extract<E, { tipo: "TRANSFERENCIA_RECIBIDA" }>;
}

/** Los cuatro eventos REALES de Casiano en el fixture. */
const HISTORIA_CASIANO = structuredClone((TE.sinDesde.respuesta.cuerpo.datos as { eventos: EventoTransferenciaRecibida[] }).eventos);

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
  erp.respuestasEventos.length = 0;
  erp.respuestaParaLocal.clear();
  erp.eventosPorLocal.clear();
  erp.eventosPorCapacidad.clear();
  erp.respuestaParaCapacidad.clear();
  erp.ponerModo("normal");
  erp.alcances.clear();
  erp.alcances.set(ADMIN, alcance("adminGlobal"));
  erp.alcances.set(ENCARGADO, alcance("encargado"));
  erp.alcances.set(CAJERO, alcance("cajero"));
  erp.eventosPorLocal.set(CASIANO.id, structuredClone(HISTORIA_CASIANO));
  erp.eventosPorLocal.set(DEPOSITO.id, [recepcion({ local: DEPOSITO, transferenciaId: 300, fecha: "2026-10-07T08:00:00.000Z" })]);
  registros = [];
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
});

function deps(timeoutMs = 2000): DependenciasSesion {
  const registrar = (r: Registro) => registros.push(r);
  return {
    config: leerConfigAzulChat({ AZUL_CHAT_INSTALACION_ID: INSTALACION, AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE }),
    db: base.db,
    erp: crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, timeoutMs, registrar }),
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: () => reloj,
    registrar,
    generarRequestId: randomUUID,
  };
}

const conCookie = (cookie: string | null): Record<string, string> => (cookie ? { cookie: `${NOMBRE_COOKIE}=${cookie}` } : {});

/** Vincula a la persona con un código recién emitido; devuelve el id de la cookie. */
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

/** El cuerpo se tipa como la respuesta buena; las fallas se comparan enteras con deepEqual. */
type Respuesta<T> = { status: number; texto: string; cuerpo: Extract<T, { estado: "OK" }>; res: Response };

async function pedir<T>(manejar: (r: Request, d: DependenciasSesion) => Promise<Response>, request: Request, d: DependenciasSesion): Promise<Respuesta<T>> {
  const res = await manejar(request, d);
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: JSON.parse(texto) as Extract<T, { estado: "OK" }>, res };
}
const chats = (cookie: string | null, d = deps()) => pedir<RespuestaChats>(manejarChats, new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), d);
const local = (cookie: string | null, localId: number | string, cursor?: string, d = deps()) =>
  pedir<RespuestaLocal>(
    manejarLocal,
    new Request(`${ORIGEN}/api/chats/local?localId=${localId}${cursor === undefined ? "" : `&cursor=${cursor}`}`, { headers: conCookie(cookie) }),
    d,
  );
const general = (cookie: string | null, cursor?: string, d = deps()) =>
  pedir<RespuestaGeneral>(manejarGeneral, new Request(`${ORIGEN}/api/chats/general${cursor === undefined ? "" : `?cursor=${cursor}`}`, { headers: conCookie(cookie) }), d);
const leido = (cookie: string | null, cuerpo: unknown, origen: string | null = ORIGEN) => {
  const headers: Record<string, string> = { "content-type": "application/json", ...conCookie(cookie) };
  if (origen !== null) headers.origin = origen;
  return pedir<RespuestaLeido>(manejarLeido, new Request(`${ORIGEN}/api/chats/leido`, { method: "POST", headers, body: JSON.stringify(cuerpo) }), deps());
};

/** Las consultas que llegaron al ERP con esa capacidad. */
const consultas = (capacidad: string) => erp.cuerposA("consultar").filter((c) => c.capacidad === capacidad);
const llamadasMiAlcance = () => consultas("mi_alcance").length;
/** Los locales (en orden) para los que se pidió `transferencias_eventos`. */
const localesSincronizados = () => consultas("transferencias_eventos").map((c) => (c.alcance as { localId: number }).localId);

const idsDeLocales = (r: Extract<RespuestaChats, { estado: "OK" }>) => r.locales.map((l) => l.localId);
const delLocal = (r: Extract<RespuestaChats, { estado: "OK" }>, id: number) => r.locales.find((l) => l.localId === id);

/** Cambia las capacidades de un local en el `mi_alcance` de la persona. */
function capacidadesDe(usuarioId: number, localId: number, capacidades: unknown) {
  const a = erp.alcances.get(usuarioId) as Rompible<DatosMiAlcance>;
  const l = a.locales.find((x) => x.id === localId);
  assert.ok(l, `el alcance no tiene el local ${localId}`);
  l.capacidades = capacidades as never;
}

/** Una recepción nueva en el ERP para ese local. */
function recibir(l: { id: number; nombre: string }, transferenciaId: number, fecha: string, extra: { tieneDiferencias?: boolean; lineasConDiferencia?: number } = {}) {
  const lista = erp.eventosPorLocal.get(l.id) ?? [];
  lista.push(recepcion({ local: l, transferenciaId, fecha, ...extra }));
  erp.eventosPorLocal.set(l.id, lista);
}

/** Pasa la frecuencia mínima de ingesta. */
const vencer = () => {
  reloj += FRECUENCIA_MINIMA_INGESTA_MS;
};

/** Lo que guardan las tablas de eventos y lectura, como texto (sin sesiones). */
async function volcado(): Promise<string> {
  const [fila] = await base.db.$queryRawUnsafe<{ x: string }[]>(
    `SELECT json_build_object(
       'e', (SELECT json_agg(t ORDER BY t.id) FROM "Evento" t),
       'c', (SELECT json_agg(t ORDER BY t.id) FROM "CursorIngesta" t),
       'l', (SELECT json_agg(t ORDER BY t."vinculoId", t."erpLocalId") FROM "LecturaLocal" t))::text AS x`,
  );
  return fila!.x;
}

const leidoHastaEnBase = async (localId: number) =>
  (await base.db.lecturaLocal.findMany({ where: { erpLocalId: localId }, select: { leidoHastaEventoId: true } })).map((l) => l.leidoHastaEventoId.toString());

/** Todas las páginas de un historial, siguiendo `siguiente`. */
async function todasLasPaginas<E>(
  pedirPagina: (cursor?: string) => Promise<{ status: number; texto: string; cuerpo: { readonly eventos: readonly E[]; readonly siguiente: string | null } }>,
) {
  const paginas: (readonly E[])[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await pedirPagina(cursor);
    assert.equal(r.status, 200, r.texto);
    paginas.push(r.cuerpo.eventos);
    if (!r.cuerpo.siguiente) return paginas;
    cursor = r.cuerpo.siguiente;
  }
  throw new Error("la paginación no termina");
}

// ─────────────────────────────────────────────────────────────────────────────

describe("autorización viva por capacidad", () => {
  it("A/B/L. aparece el local que anuncia transferencias_eventos; el territorial sin ella no aparece ni se sincroniza", async () => {
    // El encargado real: Casiano con la capacidad.
    const enc = await vincular(ENCARGADO);
    const r = await chats(enc);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(idsDeLocales(r.cuerpo), [CASIANO.id]);
    assert.deepEqual(localesSincronizados(), [CASIANO.id]);

    // El cajero real: Casiano está en su territorio, con `capacidades: []`.
    erp.recibidas.length = 0;
    const caj = await vincular(CAJERO);
    const c = await chats(caj);
    assert.equal(c.status, 200, c.texto);
    assert.deepEqual(c.cuerpo.locales, []);
    assert.deepEqual(c.cuerpo.general, { noLeidos: 0, ultimoEvento: null });
    assert.deepEqual(localesSincronizados(), [], "un local sin la capacidad no se pide al ERP");
    assert.equal((await local(caj, CASIANO.id)).status, 403);
    assert.deepEqual((await general(caj)).cuerpo.eventos, []);
    assert.deepEqual(localesSincronizados(), []);

    // En el alcance global, Depósito sin la capacidad: los otros tres sí, Depósito nunca.
    capacidadesDe(ADMIN, DEPOSITO.id, ["ventas_resumen"]);
    erp.recibidas.length = 0;
    const adm = await vincular(ADMIN);
    const a = await chats(adm);
    assert.deepEqual(idsDeLocales(a.cuerpo).sort((x, y) => x - y), [3, 5, 20]);
    // Casiano no se vuelve a pedir: el encargado lo sincronizó recién, y la
    // ingesta es de la instalación, no de la persona. Lo que sí es de la persona
    // —la autorización— se pidió de nuevo.
    assert.deepEqual(localesSincronizados().sort((x, y) => x - y), [5, 20]);
    assert.equal(llamadasMiAlcance(), 1);
    vencer();
    await chats(adm);
    await general(adm);
    assert.ok(!localesSincronizados().includes(DEPOSITO.id), "L: Depósito no se sincroniza nunca");
  });

  it("C/D. quitar la capacidad saca el local en la siguiente solicitud; devolverla lo restaura sin revincular, con su lectura", async () => {
    const adm = await vincular(ADMIN);
    assert.ok(delLocal((await chats(adm)).cuerpo, CASIANO.id));
    // Llegan dos recepciones a Casiano y se marca leída la primera.
    vencer();
    recibir(CASIANO, 410, "2026-10-08T10:00:00.000Z");
    recibir(CASIANO, 411, "2026-10-08T10:05:00.000Z");
    const pagina = (await local(adm, CASIANO.id)).cuerpo;
    assert.equal(pagina.noLeidos, 2);
    const hasta = pagina.eventos[1]!.id;
    assert.equal((await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: hasta }] })).status, 200);

    capacidadesDe(ADMIN, CASIANO.id, ["ventas_resumen"]);
    const sin = await chats(adm);
    assert.equal(sin.status, 200);
    assert.equal(delLocal(sin.cuerpo, CASIANO.id), undefined, "C: sale en la misma solicitud siguiente, sin esperar nada");
    assert.equal((await local(adm, CASIANO.id)).status, 403);

    capacidadesDe(ADMIN, CASIANO.id, ["ventas_resumen", "transferencias_eventos"]);
    const con = await chats(adm);
    assert.ok(delLocal(con.cuerpo, CASIANO.id), "D: vuelve sin revincular");
    const vuelta = (await local(adm, CASIANO.id)).cuerpo;
    assert.equal(vuelta.leidoHasta, hasta, "D: la lectura de la persona se conserva");
    assert.equal(vuelta.noLeidos, 1);
  });

  it("E/AI. los eventos guardados NO autorizan: sin la capacidad hoy, ni Local, ni General, ni marcar leído", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    const guardados = await base.db.evento.count({ where: { erpLocalId: CASIANO.id } });
    assert.equal(guardados, 4);
    const leidoAntes = await leidoHastaEnBase(CASIANO.id);

    capacidadesDe(ADMIN, CASIANO.id, []);
    const l = await local(adm, CASIANO.id);
    assert.equal(l.status, 403);
    assert.deepEqual(l.cuerpo, { estado: "NO_AUTORIZADO" });
    const g = await general(adm);
    assert.equal(g.status, 200);
    assert.ok(g.cuerpo.eventos.every((e) => e.local.localId !== CASIANO.id), "General no muestra a Casiano");
    assert.ok(!g.texto.includes('"Casiano"') || g.cuerpo.eventos.every((e) => recibida(e).destino.id !== CASIANO.id));
    const m = await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: "1" }] });
    assert.equal(m.status, 403);
    assert.deepEqual(await leidoHastaEnBase(CASIANO.id), leidoAntes);
    assert.equal(await base.db.evento.count({ where: { erpLocalId: CASIANO.id } }), 4, "los eventos siguen guardados: no se borran, no se muestran");

    // AI: tampoco hay autorización guardada que sirva a otra persona del mismo local.
    const caj = await vincular(CAJERO);
    assert.equal((await local(caj, CASIANO.id)).status, 403);
  });

  it("AJ. capacidades desconocidas no rompen y no autorizan; AK. un mi_alcance sin `capacidades` (ERP anterior) no autoriza ningún local", async () => {
    const adm = await vincular(ADMIN);
    capacidadesDe(ADMIN, CASIANO.id, ["transferencias_eventos", "capacidad_del_futuro", "otra_mas"]);
    capacidadesDe(ADMIN, DEPOSITO.id, ["capacidad_del_futuro"]);
    const r = await chats(adm);
    assert.equal(r.status, 200, r.texto);
    assert.ok(delLocal(r.cuerpo, CASIANO.id));
    assert.equal(delLocal(r.cuerpo, DEPOSITO.id), undefined);

    // La respuesta real del ERP 8920516: locales sin `capacidades`.
    erp.alcances.set(ADMIN, structuredClone(FIXTURES_ERP.miAlcance.datos));
    erp.recibidas.length = 0;
    const viejo = await chats(adm);
    assert.equal(viejo.status, 200, viejo.texto);
    assert.deepEqual(viejo.cuerpo.locales, []);
    assert.deepEqual(localesSincronizados(), []);
    assert.equal((await local(adm, CASIANO.id)).status, 403);
  });

  it("si el ERP niega transferencias_eventos a un local anunciado, ese local sale de la respuesta (fallo cerrado por local)", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    vencer();
    erp.respuestaParaLocal.set(CASIANO.id, TE.cajeroSinPermiso.respuesta);
    const r = await chats(adm);
    assert.equal(r.status, 200);
    assert.equal(delLocal(r.cuerpo, CASIANO.id), undefined);
    assert.ok(delLocal(r.cuerpo, DEPOSITO.id));
    vencer();
    assert.equal((await local(adm, CASIANO.id)).status, 403);
    vencer();
    assert.ok((await general(adm)).cuerpo.eventos.every((e) => e.local.localId !== CASIANO.id));
  });
});

describe("P1: sin mi_alcance comprobado, sin historial", () => {
  it("F. ERP caído: 503 ERP_NO_DISPONIBLE en las cuatro rutas, sin un solo evento, aunque haya eventos guardados", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    const antes = await volcado();
    erp.ponerModo("caido");
    for (const r of [await chats(adm), await local(adm, CASIANO.id), await general(adm), await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: "1" }] })]) {
      assert.equal(r.status, 503);
      assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    }
    assert.equal(await volcado(), antes, "nada se escribió");
  });

  it("G. ERP colgado: se corta por tiempo y es lo mismo que caído", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    erp.ponerModo("colgado");
    const d = deps(200);
    for (const r of [await chats(adm, d), await local(adm, CASIANO.id, undefined, d), await general(adm, undefined, d)]) {
      assert.equal(r.status, 503);
      assert.deepEqual(r.cuerpo, { estado: "ERP_NO_DISPONIBLE" });
    }
  });

  it("H. VINCULO_NO_VALIDO en mi_alcance: 401 con motivo, cookie borrada, vínculo invalidado; igual si llega al sincronizar", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    erp.revocar(ADMIN);
    const r = await chats(adm);
    assert.equal(r.status, 401);
    assert.deepEqual(r.cuerpo, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" });
    assert.match(r.res.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.ok((await base.db.vinculo.findFirstOrThrow()).invalidadoEn);
    // Ya invalidado: sin sesión, sin consultar al ERP.
    erp.recibidas.length = 0;
    assert.equal((await general(adm)).status, 401);
    assert.equal(llamadasMiAlcance(), 0);

    // El ERP lo dice recién en transferencias_eventos (mi_alcance pasó).
    const otra = await vincular(ADMIN);
    vencer();
    erp.respuestasEventos.push(FIXTURES_ERP.errores.VINCULO_NO_VALIDO!);
    const s = await local(otra, CASIANO.id);
    assert.equal(s.status, 401);
    assert.deepEqual(s.cuerpo, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" });
    assert.ok((await base.db.vinculo.findFirstOrThrow()).invalidadoEn);
  });

  it("sin cookie o con una cookie que no existe: 401 sin tocar el ERP", async () => {
    for (const r of [await chats(null), await local("x".repeat(43), 3), await general(null), await leido(null, { marcas: [{ localId: 3, hastaEventoId: "1" }] })]) {
      assert.equal(r.status, 401);
      assert.deepEqual(r.cuerpo, { estado: "SIN_SESION" });
    }
    assert.equal(erp.cuerposA("consultar").length, 0);
  });
});

describe("llamadas al ERP: autorización siempre viva, ingesta con frecuencia mínima", () => {
  it("I/J/K/AH. cada GET hace UNA mi_alcance; dentro de 30 s no se repite transferencias_eventos; vencido, sí", async () => {
    const adm = await vincular(ADMIN);
    erp.recibidas.length = 0;
    await chats(adm);
    assert.equal(llamadasMiAlcance(), 1, "I: una sola mi_alcance, no una por local");
    assert.deepEqual(localesSincronizados(), [5, 3, 9, 20], "cada local autorizado, una vez, en el orden del ERP");

    for (const pedido of [() => chats(adm), () => local(adm, CASIANO.id), () => general(adm)]) {
      erp.recibidas.length = 0;
      reloj += 1_000;
      assert.equal((await pedido()).status, 200);
      assert.equal(llamadasMiAlcance(), 1, "AH: mi_alcance otra vez, aunque la ingesta esté fresca");
      assert.deepEqual(localesSincronizados(), [], "J: fresco, sin transferencias_eventos");
    }

    // K: vencido (≥ 30 s desde la última sincronización buena) sí sincroniza.
    reloj = Date.parse(FIXTURES_ERP_25172FE.ahora) + FRECUENCIA_MINIMA_INGESTA_MS;
    erp.recibidas.length = 0;
    await local(adm, CASIANO.id);
    assert.deepEqual(localesSincronizados(), [CASIANO.id], "GET local sincroniza solo ese local");
    erp.recibidas.length = 0;
    await chats(adm);
    assert.deepEqual(localesSincronizados(), [5, 9, 20], "Casiano quedó fresco por la solicitud anterior");
    assert.equal(llamadasMiAlcance(), 1);

    // POST leído: una mi_alcance, ninguna sincronización.
    erp.recibidas.length = 0;
    await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: "1" }] });
    assert.equal(llamadasMiAlcance(), 1);
    assert.deepEqual(localesSincronizados(), []);
  });

  it("M. si falla la ingesta de un local, ese local queda DEMORADA con lo guardado y los demás siguen AL_DIA", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    vencer();
    erp.respuestaParaLocal.set(DEPOSITO.id, FIXTURES_ERP.errores.INTEGRACION_NO_DISPONIBLE!);
    recibir(CASIANO, 400, "2026-10-08T10:00:00.000Z");
    const r = await chats(adm);
    assert.equal(r.status, 200, r.texto);
    const dep = delLocal(r.cuerpo, DEPOSITO.id)!;
    assert.equal(dep.sincronizacion, "DEMORADA");
    assert.ok(dep.ultimoEvento, "se muestra lo que ya estaba guardado");
    assert.equal(delLocal(r.cuerpo, CASIANO.id)!.sincronizacion, "AL_DIA");
    assert.equal(delLocal(r.cuerpo, CASIANO.id)!.noLeidos, 1, "Casiano siguió sincronizando");

    // El fallo no deja fresco al local: la próxima solicitud lo vuelve a intentar.
    erp.recibidas.length = 0;
    const l = await local(adm, DEPOSITO.id);
    assert.equal(l.status, 200);
    assert.equal(l.cuerpo.sincronizacion, "DEMORADA");
    assert.equal(l.cuerpo.eventos.length, 1);
    assert.deepEqual(localesSincronizados(), [DEPOSITO.id]);
    const g = await general(adm);
    assert.deepEqual(g.cuerpo.localesDemorados, [DEPOSITO.id]);

    // Se recupera solo, sin que nadie revincule.
    erp.respuestaParaLocal.clear();
    assert.equal((await local(adm, DEPOSITO.id)).cuerpo.sincronizacion, "AL_DIA");
  });
});

describe("GET /api/chats", () => {
  it("usuario, General derivado y locales ordenados por el último evento; sin eventos al final, por nombre", async () => {
    const adm = await vincular(ADMIN);
    const r = await chats(adm);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    assert.equal(r.cuerpo.estado, "OK");
    assert.deepEqual(r.cuerpo.usuario, { nombre: "Emanuel" });
    // Casiano (último 2026-10-07T14:10) antes que Depósito (08:00); Belgrano y Centro sin eventos, por nombre.
    assert.deepEqual(idsDeLocales(r.cuerpo), [3, 9, 5, 20]);
    const casiano = delLocal(r.cuerpo, CASIANO.id)!;
    assert.deepEqual(Object.keys(casiano).sort(), ["esDeposito", "localId", "noLeidos", "nombre", "sincronizacion", "ultimoEvento"]);
    assert.equal(recibida(casiano.ultimoEvento!).transferenciaId, 183);
    assert.equal(delLocal(r.cuerpo, DEPOSITO.id)!.esDeposito, true);
    assert.equal(recibida(r.cuerpo.general.ultimoEvento!).transferenciaId, 183);
    assert.deepEqual(r.cuerpo.general.ultimoEvento!.local, { localId: 3, nombre: "Casiano" });

    // No ordena por no leídos: un no leído en Depósito con fecha vieja no lo sube.
    vencer();
    recibir(DEPOSITO, 301, "2026-10-07T09:00:00.000Z");
    const s = await chats(adm);
    assert.equal(delLocal(s.cuerpo, DEPOSITO.id)!.noLeidos, 1);
    assert.deepEqual(idsDeLocales(s.cuerpo), [3, 9, 5, 20]);
  });

  it("acepta solo GET sin parámetros", async () => {
    const adm = await vincular(ADMIN);
    const r = await pedir(manejarChats, new Request(`${ORIGEN}/api/chats?localId=3`, { headers: conCookie(adm) }), deps());
    assert.equal(r.status, 400);
    assert.deepEqual(r.cuerpo, { estado: "SOLICITUD_INVALIDA" });
  });
});

describe("GET local y General: forma pública y proyección", () => {
  it("Z. la forma pública del evento: id como texto aunque supere Number, sin datos internos", async () => {
    await base.db.$executeRawUnsafe(`ALTER SEQUENCE "Evento_id_seq" RESTART WITH 9007199254740993`);
    const adm = await vincular(ADMIN);
    const r = await local(adm, CASIANO.id);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(Object.keys(r.cuerpo).sort(), ["estado", "eventos", "leidoHasta", "local", "noLeidos", "siguiente", "sincronizacion"]);
    // Tanda 3A: `ventas` es el anuncio de `ventas_resumen` del mi_alcance de ahora (adminGlobal lo trae en Casiano).
    assert.deepEqual(r.cuerpo.local, { localId: 3, nombre: "Casiano", esDeposito: false, ventas: true });
    const ids = r.cuerpo.eventos.map((e) => e.id);
    // Los cuatro, del más reciente al más antiguo; 181 y 182 en el mismo milisegundo, por id descendente.
    assert.deepEqual(r.cuerpo.eventos.map((e) => recibida(e).transferenciaId), [183, 182, 181, 180]);
    assert.deepEqual(ids, ["9007199254740996", "9007199254740995", "9007199254740994", "9007199254740993"], "exacto: ningún id pasó por Number");
    assert.equal(r.cuerpo.leidoHasta, "9007199254740996");
    const e = r.cuerpo.eventos[2]!;
    // Tanda 4B: `historico` sale, como booleano y nada más, para que la
    // interfaz cuente los no leídos con la misma regla que el servidor. Estos
    // cuatro entraron con el backfill: son historia.
    assert.deepEqual(e, {
      id: "9007199254740994",
      tipo: "TRANSFERENCIA_RECIBIDA",
      fecha: "2026-10-07T13:30:15.250Z",
      historico: true,
      transferenciaId: 181,
      origen: { id: 9, nombre: "Depósito Central", esDeposito: true },
      destino: { id: 3, nombre: "Casiano" },
      tieneDiferencias: true,
      lineasConDiferencia: 2,
    } satisfies EventoPublico);
    assert.ok(r.cuerpo.eventos.every((x) => typeof x.historico === "boolean"));
    for (const prohibido of ["instalacion", "claveExterna", "eventoId", "ingeridoEn", "payload", "version", "erpLocalId", "vinculo", "token"]) {
      assert.ok(!r.texto.includes(prohibido), `la respuesta no lleva ${prohibido}`);
    }
    const g = await general(adm);
    assert.ok(g.cuerpo.eventos.some((x) => x.id === "9007199254740996"));
  });

  it("N/O/P/Q. General es una proyección: no persiste nada, el mismo Evento.id que en Local, solo locales autorizados, badge = suma", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    vencer();
    recibir(CASIANO, 401, "2026-10-08T09:00:00.000Z");
    recibir(DEPOSITO, 302, "2026-10-08T09:30:00.000Z");
    const lista = await chats(adm);
    const antes = await volcado();
    const eventosAntes = await base.db.evento.count();

    const g = await general(adm);
    assert.equal(g.status, 200, g.texto);
    assert.equal(await volcado(), antes, "N: General no escribe nada (todo fresco)");
    assert.equal(await base.db.evento.count(), eventosAntes);
    assert.equal(await base.db.evento.count({ where: { erpLocalId: { notIn: [CASIANO.id, DEPOSITO.id] } } }), 0, "no hay un 'local General' guardado");

    // O: cada evento de General es el mismo Evento.id que el del Local, y con su local.
    const porLocal = new Map<number, readonly EventoPublico[]>();
    for (const id of [CASIANO.id, DEPOSITO.id]) porLocal.set(id, (await local(adm, id)).cuerpo.eventos);
    assert.equal(g.cuerpo.eventos.length, 4 + 2 + 1);
    for (const e of g.cuerpo.eventos) {
      const { local: deQuien, ...publico } = e;
      assert.deepEqual(
        porLocal.get(deQuien.localId)!.find((x) => x.id === e.id),
        publico,
        `el evento ${e.id} es el mismo en General y en ${deQuien.nombre}`,
      );
      assert.equal(recibida(e).destino.id, deQuien.localId);
    }
    assert.equal(new Set(g.cuerpo.eventos.map((e) => e.id)).size, g.cuerpo.eventos.length, "sin duplicados");

    // Q: el badge de General es la suma de los locales.
    assert.equal(g.cuerpo.noLeidos, 2);
    assert.equal(lista.cuerpo.general.noLeidos, lista.cuerpo.locales.reduce((n, l) => n + l.noLeidos, 0));
    assert.equal(lista.cuerpo.general.noLeidos, 2);

    // P: sin la capacidad en Depósito, General no lo muestra ni lo cuenta.
    capacidadesDe(ADMIN, DEPOSITO.id, []);
    const sin = await general(adm);
    assert.ok(sin.cuerpo.eventos.every((e) => e.local.localId === CASIANO.id));
    assert.equal(sin.cuerpo.noLeidos, 1);
  });

  it("solicitudes inválidas: localId mal formado, parámetros de más o repetidos, cursor ajeno", async () => {
    const adm = await vincular(ADMIN);
    erp.recibidas.length = 0;
    const malos = [
      `${ORIGEN}/api/chats/local`,
      `${ORIGEN}/api/chats/local?localId=0`,
      `${ORIGEN}/api/chats/local?localId=03`,
      `${ORIGEN}/api/chats/local?localId=3.0`,
      `${ORIGEN}/api/chats/local?localId=-3`,
      `${ORIGEN}/api/chats/local?localId=3&localId=9`,
      `${ORIGEN}/api/chats/local?localId=3&instalacion=x`,
      `${ORIGEN}/api/chats/local?localId=3&cursor=`,
      `${ORIGEN}/api/chats/local?localId=3&cursor=no-es-un-cursor`,
    ];
    for (const url of malos) {
      const r = await pedir(manejarLocal, new Request(url, { headers: conCookie(adm) }), deps());
      assert.equal(r.status, 400, url);
      assert.deepEqual(r.cuerpo, { estado: "SOLICITUD_INVALIDA" });
    }
    const cursorConLocal = Buffer.from(JSON.stringify({ f: "2026-10-07T12:00:00.000Z", i: "5", l: 9 })).toString("base64url");
    for (const url of [`${ORIGEN}/api/chats/general?cursor=${cursorConLocal}`, `${ORIGEN}/api/chats/general?local=9`]) {
      assert.equal((await pedir(manejarGeneral, new Request(url, { headers: conCookie(adm) }), deps())).status, 400, url);
    }
    assert.equal(erp.cuerposA("consultar").length, 0, "lo mal formado se rechaza antes de tocar el ERP");
    // Un local que no existe en el alcance: 403, igual que uno sin permiso.
    const otro = await local(adm, 777);
    assert.equal(otro.status, 403);
    assert.deepEqual(otro.cuerpo, { estado: "NO_AUTORIZADO" });
  });
});

describe("paginación", () => {
  /** 70 recepciones en Casiano, de a tres por instante: muchas comparten fechaOperacion. */
  function muchas() {
    const lista: EventoTransferenciaRecibida[] = [];
    for (let i = 0; i < 70; i++) {
      const fecha = new Date(Date.parse("2026-10-06T00:00:00.000Z") + Math.floor(i / 3) * 60_000).toISOString();
      lista.push(recepcion({ local: CASIANO, transferenciaId: 1000 + i, fecha }));
    }
    erp.eventosPorLocal.set(CASIANO.id, lista);
  }

  it("AA/AC. Local: páginas de 30, sin duplicados ni saltos, en orden (fecha desc, id desc), con fechas repetidas", async () => {
    muchas();
    const adm = await vincular(ADMIN);
    const paginas = await todasLasPaginas((c) => local(adm, CASIANO.id, c));
    assert.deepEqual(paginas.map((p) => p.length), [30, 30, 10]);
    const todos = paginas.flat();
    assert.equal(new Set(todos.map((e) => e.id)).size, 70);
    const enBase = await base.db.evento.findMany({ where: { erpLocalId: CASIANO.id }, orderBy: [{ fechaOperacion: "desc" }, { id: "desc" }], select: { id: true } });
    assert.deepEqual(todos.map((e) => e.id), enBase.map((e) => e.id.toString()), "el mismo orden total que la base, sin huecos");
    // La frontera de página cae dentro de un mismo instante y no se pierde ni repite nada.
    assert.equal(paginas[0]!.at(-1)!.fecha, paginas[1]![0]!.fecha);
  });

  it("AB. General: páginas de 30 sobre varios locales, sin duplicados ni saltos", async () => {
    muchas();
    for (let i = 0; i < 20; i++) recibir(DEPOSITO, 500 + i, new Date(Date.parse("2026-10-06T00:00:30.000Z") + i * 60_000).toISOString());
    const adm = await vincular(ADMIN);
    const paginas = await todasLasPaginas((c) => general(adm, c));
    const todos = paginas.flat();
    assert.equal(todos.length, 70 + 1 + 20);
    assert.equal(new Set(todos.map((e) => e.id)).size, todos.length);
    for (let i = 1; i < todos.length; i++) {
      const a = todos[i - 1]!;
      const b = todos[i]!;
      assert.ok(a.fecha > b.fecha || (a.fecha === b.fecha && BigInt(a.id) > BigInt(b.id)), `orden en ${i}`);
    }
  });

  it("un cursor no saca a nadie de sus locales: el de Local, usado en otro local o en General, solo filtra por posición", async () => {
    muchas();
    const adm = await vincular(ADMIN);
    const c = (await local(adm, CASIANO.id)).cuerpo.siguiente!;
    capacidadesDe(ADMIN, CASIANO.id, []);
    const g = await general(adm, c);
    assert.equal(g.status, 200);
    assert.ok(g.cuerpo.eventos.every((e) => e.local.localId !== CASIANO.id));
    assert.equal((await local(adm, CASIANO.id, c)).status, 403);
  });
});

describe("lectura: explícita, por vínculo y local", () => {
  it("AE/AF/AG/R/S. el backfill no da badge, una persona nueva no hereda historia como no leída, lo nuevo sí; los GET nunca marcan", async () => {
    const adm = await vincular(ADMIN);
    const r = await chats(adm);
    assert.ok(r.cuerpo.locales.every((l) => l.noLeidos === 0), "AE: lo traído por el backfill no es nuevo");
    assert.equal(r.cuerpo.general.noLeidos, 0);
    assert.ok((await base.db.evento.count({ where: { historico: true } })) === 5);

    vencer();
    recibir(CASIANO, 402, "2026-10-08T10:00:00.000Z");
    const nuevo = await chats(adm);
    assert.equal(delLocal(nuevo.cuerpo, CASIANO.id)!.noLeidos, 1, "AG: la recepción posterior es no leída");

    // AF: el encargado se vincula después; la historia ya existe y no es nueva para él.
    // Y lo que su PRIMERA vista trae del ERP (posterior al backfill, así que no
    // es histórico) tampoco: la línea de base se toma después de sincronizar.
    vencer();
    recibir(CASIANO, 408, "2026-10-08T10:30:00.000Z");
    const enc = await vincular(ENCARGADO);
    const suya = await chats(enc);
    assert.deepEqual(localesSincronizados().slice(-1), [CASIANO.id], "la primera vista del encargado trajo el 408");
    assert.equal(delLocal(suya.cuerpo, CASIANO.id)!.noLeidos, 0);
    assert.equal(delLocal((await chats(adm)).cuerpo, CASIANO.id)!.noLeidos, 2, "para quien ya miraba, el 402 y el 408 son nuevos");

    // R/S: GET local, GET General y GET /api/chats, muchas veces, no tocan la lectura.
    const antes = await leidoHastaEnBase(CASIANO.id);
    for (let i = 0; i < 3; i++) {
      assert.equal((await local(adm, CASIANO.id)).cuerpo.noLeidos, 2);
      assert.equal((await general(adm)).cuerpo.noLeidos, 2);
      assert.equal((await chats(adm)).cuerpo.general.noLeidos, 2);
      assert.equal((await local(enc, CASIANO.id)).cuerpo.noLeidos, 0);
      reloj += FRECUENCIA_MINIMA_INGESTA_MS;
    }
    assert.deepEqual(await leidoHastaEnBase(CASIANO.id), antes);
  });

  it("AD. un evento ingerido tarde va en su lugar por fecha y sigue siendo nuevo por id", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    vencer();
    // Depósito recibe algo con fecha ANTERIOR a todo Casiano; se conoce ahora.
    recibir(DEPOSITO, 303, "2026-10-07T09:00:00.000Z");
    const g = await general(adm);
    const posicion = g.cuerpo.eventos.findIndex((e) => recibida(e).transferenciaId === 303);
    assert.deepEqual(g.cuerpo.eventos.map((e) => recibida(e).transferenciaId), [183, 182, 181, 180, 303, 300], "por fecha, no por llegada");
    const tarde = g.cuerpo.eventos[posicion]!;
    assert.ok(g.cuerpo.eventos.every((e) => e === tarde || BigInt(e.id) < BigInt(tarde.id)), "es el de mayor id");
    assert.equal(g.cuerpo.noLeidos, 1, "y es el único nuevo");
    assert.equal((await local(adm, DEPOSITO.id)).cuerpo.noLeidos, 1);
  });

  it("T/U/V. POST leído avanza, nunca retrocede, y un id de otro local no adelanta este", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    vencer();
    recibir(CASIANO, 403, "2026-10-08T10:00:00.000Z");
    recibir(CASIANO, 404, "2026-10-08T10:05:00.000Z");
    recibir(DEPOSITO, 304, "2026-10-08T10:10:00.000Z");
    await chats(adm);
    const ev = (await local(adm, CASIANO.id)).cuerpo.eventos;
    const [n404, n403] = [ev[0]!, ev[1]!];

    const t = await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: n403.id }] });
    assert.equal(t.status, 200, t.texto);
    assert.deepEqual(t.cuerpo, { estado: "OK", lecturas: [{ localId: CASIANO.id, leidoHasta: n403.id, noLeidos: 1 }] });

    const u = await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: "1" }] });
    assert.deepEqual(u.cuerpo.lecturas, [{ localId: CASIANO.id, leidoHasta: n403.id, noLeidos: 1 }], "U: no retrocede");

    // V: el id de Depósito (mayor que todo Casiano) se recorta al máximo de Casiano.
    const dep = (await local(adm, DEPOSITO.id)).cuerpo.eventos[0]!;
    assert.ok(BigInt(dep.id) > BigInt(n404.id));
    const v = await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: dep.id }] });
    assert.deepEqual(v.cuerpo.lecturas, [{ localId: CASIANO.id, leidoHasta: n404.id, noLeidos: 0 }]);
    const enorme = await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: "9223372036854775807" }] });
    assert.equal(enorme.cuerpo.lecturas[0]!.leidoHasta, n404.id);
    assert.equal((await local(adm, DEPOSITO.id)).cuerpo.noLeidos, 1, "Depósito no se tocó");
    // Lo que llegue después a Casiano es nuevo, aunque se haya pedido un id enorme.
    vencer();
    recibir(CASIANO, 405, "2026-10-08T11:00:00.000Z");
    assert.equal((await local(adm, CASIANO.id)).cuerpo.noLeidos, 1);

    // Varias marcas en un pedido: General leído entero.
    const todo = await leido(adm, {
      marcas: [
        { localId: CASIANO.id, hastaEventoId: "9223372036854775807" },
        { localId: DEPOSITO.id, hastaEventoId: "9223372036854775807" },
      ],
    });
    assert.deepEqual(todo.cuerpo.lecturas.map((l) => l.noLeidos), [0, 0]);
    assert.equal((await general(adm)).cuerpo.noLeidos, 0);
  });

  it("W. si UN local del pedido no está autorizado ahora, no se marca ninguno", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    vencer();
    recibir(CASIANO, 406, "2026-10-08T10:00:00.000Z");
    recibir(DEPOSITO, 305, "2026-10-08T10:00:00.000Z");
    await chats(adm);
    capacidadesDe(ADMIN, DEPOSITO.id, ["ventas_resumen"]);
    const antes = await volcado();
    for (const otro of [DEPOSITO.id, 777]) {
      const r = await leido(adm, {
        marcas: [
          { localId: CASIANO.id, hastaEventoId: "9223372036854775807" },
          { localId: otro, hastaEventoId: "9223372036854775807" },
        ],
      });
      assert.equal(r.status, 403);
      assert.deepEqual(r.cuerpo, { estado: "NO_AUTORIZADO" });
    }
    assert.equal(await volcado(), antes);
    assert.equal((await local(adm, CASIANO.id)).cuerpo.noLeidos, 1);
  });

  it("X/Y. dos sesiones del mismo vínculo comparten la lectura; otro vínculo no", async () => {
    const celular = await vincular(ADMIN);
    const compu = await vincular(ADMIN); // otro dispositivo: misma persona, mismo Vinculo
    assert.equal(await base.db.vinculo.count({ where: { erpUsuarioId: ADMIN } }), 1);
    assert.equal(await base.db.sesion.count(), 2);
    const enc = await vincular(ENCARGADO);
    await chats(celular);
    await chats(enc);
    vencer();
    recibir(CASIANO, 407, "2026-10-08T10:00:00.000Z");
    assert.equal((await local(compu, CASIANO.id)).cuerpo.noLeidos, 1);
    assert.equal((await local(enc, CASIANO.id)).cuerpo.noLeidos, 1);

    await leido(celular, { marcas: [{ localId: CASIANO.id, hastaEventoId: "9223372036854775807" }] });
    assert.equal((await local(compu, CASIANO.id)).cuerpo.noLeidos, 0, "X: la otra sesión de la misma persona lo ve leído");
    assert.equal((await local(enc, CASIANO.id)).cuerpo.noLeidos, 1, "Y: el encargado no");
  });

  it("el pedido de leído se valida entero: forma exacta, ids como texto, sin repetidos, origen propio", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    const malos: unknown[] = [
      {},
      { marcas: [] },
      { marcas: {} },
      { marcas: [{ localId: 3 }] },
      { marcas: [{ localId: 3, hastaEventoId: 5 }] },
      { marcas: [{ localId: 3, hastaEventoId: "05" }] },
      { marcas: [{ localId: 3, hastaEventoId: "-1" }] },
      { marcas: [{ localId: 3, hastaEventoId: "9223372036854775808" }] },
      { marcas: [{ localId: "3", hastaEventoId: "1" }] },
      { marcas: [{ localId: 3, hastaEventoId: "1", vinculoId: "x" }] },
      { marcas: [{ localId: 3, hastaEventoId: "1" }], usuarioId: 9 },
      { marcas: [{ localId: 3, hastaEventoId: "1" }, { localId: 3, hastaEventoId: "2" }] },
      { marcas: Array.from({ length: 51 }, (_, i) => ({ localId: i + 1, hastaEventoId: "1" })) },
    ];
    erp.recibidas.length = 0;
    for (const m of malos) {
      const r = await leido(adm, m);
      assert.equal(r.status, 400, JSON.stringify(m));
      assert.deepEqual(r.cuerpo, { estado: "SOLICITUD_INVALIDA" });
    }
    for (const origen of [null, "https://otro.invalid"]) {
      const r = await leido(adm, { marcas: [{ localId: 3, hastaEventoId: "1" }] }, origen);
      assert.equal(r.status, 403);
      assert.deepEqual(r.cuerpo, { estado: "ORIGEN_NO_PERMITIDO" });
    }
    assert.equal(erp.cuerposA("consultar").length, 0, "nada de eso llegó al ERP");
  });
});

describe("lo que ve el navegador", () => {
  it("AL. ninguna respuesta lleva el token, la delegación, el vínculo, la URL del ERP ni la respuesta cruda del ERP", async () => {
    const adm = await vincular(ADMIN);
    const token = erp.tokenVigente(ADMIN)!;
    const v = await base.db.vinculo.findFirstOrThrow();
    const textos: string[] = [];
    textos.push((await chats(adm)).texto, (await local(adm, CASIANO.id)).texto, (await general(adm)).texto);
    textos.push((await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: "1" }] })).texto);
    erp.ponerModo("caido");
    textos.push((await chats(adm)).texto);
    erp.ponerModo("normal");
    erp.revocar(ADMIN);
    textos.push((await chats(adm)).texto);
    for (const t of textos) {
      for (const prohibido of [token, v.id, v.tokenCifrado, String(v.erpVinculoId), "delegacion", "tokenDelegacion", erp.origen, "requestId", "codigo", "error", "stack", "integraciones"]) {
        assert.ok(!t.includes(prohibido), `una respuesta incluye ${prohibido}: ${t.slice(0, 200)}`);
      }
    }
    // Y los logs tampoco llevan el token.
    assert.ok(!JSON.stringify(registros).includes(token));
  });
});

describe("la lectura que decide la interfaz, contra el servidor (Tanda 2C)", () => {
  /** El estado de la conversación como lo arma la interfaz con la primera respuesta del Local. */
  const estadoDe = (r: Extract<RespuestaLocal, { estado: "OK" }>): EstadoConversacion<EventoPublico, InfoLocal> => ({
    fase: "LISTA",
    eventos: r.eventos,
    siguiente: r.siguiente,
    anteriores: "QUIETO",
    info: {
      tipo: "LOCAL",
      localId: r.local.localId,
      nombre: r.local.nombre,
      sincronizacion: r.sincronizacion,
      leidoHasta: r.leidoHasta,
      noLeidos: r.noLeidos,
      ventas: r.local.ventas,
    },
  });

  it("AL/AC/AD/AP. 40 nuevos y 30 en la primera página: no marca; con las anteriores cargadas marca hasta el mayor mostrado; lo que llegó después sigue sin leer", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm); // backfill y línea de base
    vencer();
    for (let i = 0; i < 40; i++) recibir(CASIANO, 1000 + i, new Date(Date.parse("2026-10-08T00:00:00.000Z") + i * 60_000).toISOString());
    const p1 = await local(adm, CASIANO.id);
    assert.equal(p1.cuerpo.noLeidos, 40);
    assert.equal(p1.cuerpo.eventos.length, 30);
    let e = estadoDe(p1.cuerpo);
    const decision = decidirLecturaLocal(e);
    assert.equal(decision.tipo, "FALTAN", "con 10 nuevos sin cargar, la interfaz no manda nada");
    const nuevos = await base.db.evento.findMany({ where: { erpLocalId: CASIANO.id, historico: false }, select: { id: true }, orderBy: { id: "asc" } });
    assert.equal(nuevos.length, 40);

    // Mientras tanto llega otra recepción (más nueva que todo).
    vencer();
    recibir(CASIANO, 2000, "2026-10-08T11:00:00.000Z");
    const p2 = await local(adm, CASIANO.id, p1.cuerpo.siguiente!);
    e = reducirConversacion(e, { tipo: "ANTERIORES", eventos: p2.cuerpo.eventos, siguiente: p2.cuerpo.siguiente });
    const mostrados = new Set(e.fase === "LISTA" ? e.eventos.map((x) => x.id) : []);
    for (const n of nuevos) assert.ok(mostrados.has(n.id.toString()), `el ${n.id} está a la vista antes de marcar`);
    const d = decidirLecturaLocal(e);
    assert.equal(d.tipo, "MARCAR");
    if (d.tipo !== "MARCAR") return;
    assert.equal(d.marca.hastaEventoId, nuevos.at(-1)!.id.toString());

    const r = await leido(adm, { marcas: [d.marca] });
    assert.equal(r.status, 200, r.texto);
    // Los 40 que se vieron, leídos; el que llegó después, no.
    assert.equal(r.cuerpo.lecturas[0]!.noLeidos, 1);
    const ultimo = await base.db.evento.findFirstOrThrow({ where: { erpLocalId: CASIANO.id, erpReferenciaId: 2000 }, select: { id: true } });
    assert.ok(ultimo.id > BigInt(d.marca.hastaEventoId));
    assert.ok(!mostrados.has(ultimo.id.toString()));
  });

  it("CONTRA: la marca de antes (mayor id de la primera página) habría dejado leídos 10 que no se vieron", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    vencer();
    for (let i = 0; i < 40; i++) recibir(CASIANO, 1000 + i, new Date(Date.parse("2026-10-08T00:00:00.000Z") + i * 60_000).toISOString());
    const p1 = await local(adm, CASIANO.id);
    const mayor = p1.cuerpo.eventos.map((x) => BigInt(x.id)).reduce((a, b) => (a > b ? a : b));
    const r = await leido(adm, { marcas: [{ localId: CASIANO.id, hastaEventoId: mayor.toString() }] });
    assert.equal(r.cuerpo.lecturas[0]!.noLeidos, 0, "así quedaba: 0 no leídos con 10 nunca mostrados (lo que la regla nueva impide)");
  });
});

// ── Tanda 4B: pedidos, envíos y cancelaciones ───────────────────────────────
//
// Las tres capacidades de eventos nuevas del ERP 76b9a71, de punta a punta: el
// doble del ERP aplica el MISMO portón por capacidad que el ERP (sin el anuncio
// en ese local, el NO_AUTORIZADO real de `sinPermiso` de erp-76b9a71.json) y
// pagina con sus mismas reglas; los eventos tienen la forma de los reales de
// ese fixture (test/ayuda/paginadorErp.ts).

const TODAS_LAS_DE_EVENTOS = ["ventas_resumen", "transferencias_eventos", "pedidos_eventos", "envios_eventos", "cancelaciones_eventos"];
const DEPOSITO_ORIGEN = { id: 9, nombre: "Depósito Central" };

/** Carga eventos de una capacidad nueva en el ERP de mentira, para ese local. */
function cargar(capacidad: "pedidos_eventos" | "envios_eventos" | "cancelaciones_eventos", localId: number, eventos: readonly object[]) {
  const clave = `${capacidad}:${localId}`;
  erp.eventosPorCapacidad.set(clave, [...(erp.eventosPorCapacidad.get(clave) ?? []), ...eventos]);
}
const cursorDe = (capacidad: string, localId = CASIANO.id) =>
  base.db.cursorIngesta.findUnique({ where: { instalacionId_erpLocalId_capacidad: { instalacionId: INSTALACION, erpLocalId: localId, capacidad } } });
const tiposDe = (eventos: readonly EventoPublico[]) => [...new Set(eventos.map((e) => e.tipo))].sort();
const sql = (q: string) => base.db.$executeRawUnsafe(q);

describe("Tanda 4B: las tres capacidades nuevas, de punta a punta", () => {
  it("pedido, envío y cancelación llegan con su forma pública, en Local y en General con su local, sin duplicar", async () => {
    capacidadesDe(ADMIN, CASIANO.id, TODAS_LAS_DE_EVENTOS);
    cargar("pedidos_eventos", CASIANO.id, [pedido({ pedidoId: 91, fecha: "2026-10-07T15:00:00.000Z", origen: DEPOSITO_ORIGEN, lineas: 3 })]);
    cargar("envios_eventos", CASIANO.id, [envio({ transferenciaId: 184, fecha: "2026-10-07T16:00:00.000Z", origen: DEPOSITO_ORIGEN, lineas: 12, pedidoId: 91 })]);
    cargar("cancelaciones_eventos", CASIANO.id, [cancelacion({ transferenciaId: 185, fecha: "2026-10-07T17:00:00.000Z", origen: DEPOSITO_ORIGEN, pedidoId: null })]);
    const adm = await vincular(ADMIN);

    const l = await local(adm, CASIANO.id);
    assert.equal(l.status, 200, l.texto);
    const [cancelada, enviada, pedida] = l.cuerpo.eventos;
    // Entraron con el backfill de cada capacidad: son historia. Del ERP, solo lo que se muestra.
    assert.deepEqual(pedida && { ...pedida, id: "x" }, {
      id: "x",
      tipo: "PEDIDO_SOLICITADO",
      fecha: "2026-10-07T15:00:00.000Z",
      historico: true,
      pedidoId: 91,
      origen: DEPOSITO_ORIGEN,
      lineas: 3,
    } satisfies EventoPublico);
    assert.deepEqual(enviada && { ...enviada, id: "x" }, {
      id: "x",
      tipo: "TRANSFERENCIA_ENVIADA",
      fecha: "2026-10-07T16:00:00.000Z",
      historico: true,
      transferenciaId: 184,
      origen: DEPOSITO_ORIGEN,
      lineas: 12,
    } satisfies EventoPublico);
    assert.deepEqual(cancelada && { ...cancelada, id: "x" }, {
      id: "x",
      tipo: "TRANSFERENCIA_CANCELADA",
      fecha: "2026-10-07T17:00:00.000Z",
      historico: true,
      transferenciaId: 185,
      origen: DEPOSITO_ORIGEN,
    } satisfies EventoPublico);
    assert.equal(l.cuerpo.eventos.length, 3 + 4, "los tres nuevos y las cuatro recepciones reales");
    for (const prohibido of ["claveExterna", "payload", "erpLocalId"]) assert.ok(!l.texto.includes(prohibido), prohibido);

    const c = await chats(adm);
    assert.equal(delLocal(c.cuerpo, CASIANO.id)!.ultimoEvento!.tipo, "TRANSFERENCIA_CANCELADA", "el último por fecha, sea del tipo que sea");
    const g = await general(adm);
    const deCasiano = g.cuerpo.eventos.filter((e) => e.local.localId === CASIANO.id);
    assert.deepEqual(tiposDe(deCasiano), ["PEDIDO_SOLICITADO", "TRANSFERENCIA_CANCELADA", "TRANSFERENCIA_ENVIADA", "TRANSFERENCIA_RECIBIDA"]);
    assert.equal(new Set(g.cuerpo.eventos.map((e) => e.id)).size, g.cuerpo.eventos.length, "sin duplicados");
    for (const e of deCasiano) {
      const { local: deQuien, ...publico } = e;
      assert.deepEqual(l.cuerpo.eventos.find((x) => x.id === e.id), publico, `el ${e.id} es el mismo en General y en Casiano`);
      assert.deepEqual(deQuien, { localId: CASIANO.id, nombre: "Casiano" });
    }
  });

  it("una capacidad que mi_alcance no anuncia en ese local no se ingiere ni se muestra, aunque otra persona la haya traído", async () => {
    cargar("pedidos_eventos", CASIANO.id, [pedido({ pedidoId: 91, fecha: "2026-10-07T15:00:00.000Z" })]);
    // El encargado real (25172fe): Casiano con transferencias_eventos y ventas, sin pedidos_eventos.
    const enc = await vincular(ENCARGADO);
    const r = await local(enc, CASIANO.id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(consultas("pedidos_eventos").length, 0, "no se le pidió al ERP");
    assert.equal(await cursorDe("pedidos_eventos"), null, "ni se creó su cursor");
    assert.deepEqual(tiposDe(r.cuerpo.eventos), ["TRANSFERENCIA_RECIBIDA"]);

    // El admin sí la tiene: la trae. Lo guardado no autoriza al encargado.
    capacidadesDe(ADMIN, CASIANO.id, TODAS_LAS_DE_EVENTOS);
    const adm = await vincular(ADMIN);
    assert.deepEqual(tiposDe((await local(adm, CASIANO.id)).cuerpo.eventos), ["PEDIDO_SOLICITADO", "TRANSFERENCIA_RECIBIDA"]);
    assert.equal(await base.db.evento.count({ where: { tipo: "PEDIDO_SOLICITADO" } }), 1);
    vencer();
    await sql(`UPDATE "Evento" SET historico = false WHERE tipo = 'PEDIDO_SOLICITADO'`);
    await sql(`UPDATE "LecturaLocal" SET "leidoHastaEventoId" = 0`);
    const otra = await local(enc, CASIANO.id);
    assert.deepEqual(tiposDe(otra.cuerpo.eventos), ["TRANSFERENCIA_RECIBIDA"], "ni en Local");
    assert.equal(otra.cuerpo.noLeidos, 0, "ni en la cuenta de no leídos");
    const g = await general(enc);
    assert.deepEqual(tiposDe(g.cuerpo.eventos), ["TRANSFERENCIA_RECIBIDA"], "ni en General");
    assert.equal(g.cuerpo.noLeidos, 0);
    assert.equal(delLocal((await chats(enc)).cuerpo, CASIANO.id)!.ultimoEvento!.tipo, "TRANSFERENCIA_RECIBIDA", "ni como último de la lista");
  });

  it("un local que anuncia solo una capacidad nueva es un chat, con solo sus tipos", async () => {
    capacidadesDe(ENCARGADO, CASIANO.id, ["pedidos_eventos"]);
    cargar("pedidos_eventos", CASIANO.id, [pedido({ pedidoId: 91, fecha: "2026-10-07T15:00:00.000Z" })]);
    const enc = await vincular(ENCARGADO);
    const c = await chats(enc);
    assert.deepEqual(idsDeLocales(c.cuerpo), [CASIANO.id]);
    assert.equal(consultas("transferencias_eventos").length, 0);
    assert.deepEqual(tiposDe((await local(enc, CASIANO.id)).cuerpo.eventos), ["PEDIDO_SOLICITADO"]);
  });

  it("si una capacidad falla en un local, las otras siguen y el local queda DEMORADA con lo guardado", async () => {
    capacidadesDe(ADMIN, CASIANO.id, TODAS_LAS_DE_EVENTOS);
    cargar("pedidos_eventos", CASIANO.id, [pedido({ pedidoId: 91, fecha: "2026-10-07T15:00:00.000Z" })]);
    cargar("envios_eventos", CASIANO.id, [envio({ transferenciaId: 184, fecha: "2026-10-07T16:00:00.000Z" })]);
    cargar("cancelaciones_eventos", CASIANO.id, [cancelacion({ transferenciaId: 185, fecha: "2026-10-07T17:00:00.000Z" })]);
    erp.respuestaParaCapacidad.set(`envios_eventos:${CASIANO.id}`, FIXTURES_ERP.errores.INTEGRACION_NO_DISPONIBLE!);
    const adm = await vincular(ADMIN);
    const c = await chats(adm);
    assert.equal(c.status, 200, c.texto);
    assert.equal(delLocal(c.cuerpo, CASIANO.id)!.sincronizacion, "DEMORADA");
    assert.equal(delLocal(c.cuerpo, DEPOSITO.id)!.sincronizacion, "AL_DIA", "los otros locales siguen");
    // Las demás capacidades de Casiano se trajeron igual, después de la que falló.
    assert.deepEqual(tiposDe((await general(adm)).cuerpo.eventos.filter((e) => e.local.localId === CASIANO.id)), [
      "PEDIDO_SOLICITADO",
      "TRANSFERENCIA_CANCELADA",
      "TRANSFERENCIA_RECIBIDA",
    ]);
    const envios = await cursorDe("envios_eventos");
    assert.equal(envios!.ultimoErrorCodigo, "INTEGRACION_NO_DISPONIBLE");
    assert.equal(envios!.cursor, null, "el cursor de la que falló no se movió");
    assert.equal((await cursorDe("cancelaciones_eventos"))!.ultimoErrorCodigo, null);

    // Se arregla: la siguiente visita la trae y el local vuelve a estar al día.
    erp.respuestaParaCapacidad.clear();
    vencer();
    const d = await chats(adm);
    assert.equal(delLocal(d.cuerpo, CASIANO.id)!.sincronizacion, "AL_DIA");
    assert.equal(await base.db.evento.count({ where: { tipo: "TRANSFERENCIA_ENVIADA" } }), 1);
  });

  it("si el ERP niega UNA capacidad, sus tipos salen de esta respuesta y el local sigue con las otras", async () => {
    capacidadesDe(ADMIN, CASIANO.id, TODAS_LAS_DE_EVENTOS);
    cargar("pedidos_eventos", CASIANO.id, [pedido({ pedidoId: 91, fecha: "2026-10-07T15:00:00.000Z" })]);
    const adm = await vincular(ADMIN);
    assert.deepEqual(tiposDe((await local(adm, CASIANO.id)).cuerpo.eventos), ["PEDIDO_SOLICITADO", "TRANSFERENCIA_RECIBIDA"]);
    vencer();
    const negado = FIXTURES_ERP_76B9A71.pedidos_eventos.sinPermiso.respuesta;
    erp.respuestaParaCapacidad.set(`pedidos_eventos:${CASIANO.id}`, negado);
    const r = await local(adm, CASIANO.id);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(tiposDe(r.cuerpo.eventos), ["TRANSFERENCIA_RECIBIDA"], "fallo cerrado para esa capacidad");
    assert.equal(r.cuerpo.sincronizacion, "AL_DIA", "un NO_AUTORIZADO no es una demora");
  });

  it("VINCULO_NO_VALIDO en una capacidad nueva corta todo e invalida el vínculo, como siempre", async () => {
    capacidadesDe(ADMIN, CASIANO.id, TODAS_LAS_DE_EVENTOS);
    erp.respuestaParaCapacidad.set(`cancelaciones_eventos:${CASIANO.id}`, FIXTURES_ERP.errores.VINCULO_NO_VALIDO!);
    const adm = await vincular(ADMIN);
    const r = await chats(adm);
    assert.equal(r.status, 401);
    assert.deepEqual(r.cuerpo, { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" });
  });

  it("frecuencia mínima por (local, capacidad): una capacidad recién anunciada se trae aunque las otras estén frescas", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm);
    const antes = consultas("transferencias_eventos").length;
    capacidadesDe(ADMIN, CASIANO.id, TODAS_LAS_DE_EVENTOS);
    cargar("pedidos_eventos", CASIANO.id, [pedido({ pedidoId: 91, fecha: "2026-10-07T15:00:00.000Z" })]);
    await chats(adm);
    assert.equal(consultas("transferencias_eventos").length, antes, "las recepciones estaban frescas");
    assert.equal(consultas("pedidos_eventos").length, 1, "los pedidos, recién anunciados, no");
    await chats(adm);
    assert.equal(consultas("pedidos_eventos").length, 1, "y dentro de 30 s no se repite");
  });
});

describe("Tanda 4B: la lectura con varios tipos y backfills intercalados", () => {
  const estadoDe = (r: Extract<RespuestaLocal, { estado: "OK" }>): EstadoConversacion<EventoPublico, InfoLocal> => ({
    fase: "LISTA",
    eventos: r.eventos,
    siguiente: r.siguiente,
    anteriores: "QUIETO",
    info: {
      tipo: "LOCAL",
      localId: r.local.localId,
      nombre: r.local.nombre,
      sincronizacion: r.sincronizacion,
      leidoHasta: r.leidoHasta,
      noLeidos: r.noLeidos,
      ventas: r.local.ventas,
    },
  });

  it("backfill de una capacidad nueva con muchos ids altos + 2 nuevos reales: noLeidos = 2, y no se marca hasta que esos 2 estén a la vista", async () => {
    const adm = await vincular(ADMIN);
    await chats(adm); // backfill de recepciones y línea de base
    vencer();
    // Dos recepciones nuevas de verdad, con fecha anterior a todos los pedidos…
    recibir(CASIANO, 500, "2026-10-07T20:00:00.000Z");
    recibir(CASIANO, 501, "2026-10-07T20:01:00.000Z");
    // …y la capacidad de pedidos anunciada desde hoy, con 45 pedidos viejos y más recientes que esas dos.
    capacidadesDe(ADMIN, CASIANO.id, TODAS_LAS_DE_EVENTOS);
    cargar(
      "pedidos_eventos",
      CASIANO.id,
      Array.from({ length: 45 }, (_, i) => pedido({ pedidoId: 100 + i, fecha: new Date(Date.parse("2026-10-08T01:00:00.000Z") + i * 60_000).toISOString() })),
    );

    const p1 = await local(adm, CASIANO.id);
    assert.equal(p1.status, 200, p1.texto);
    assert.equal(p1.cuerpo.noLeidos, 2);
    assert.equal(delLocal((await chats(adm)).cuerpo, CASIANO.id)!.noLeidos, 2, "en la lista, lo mismo");
    // La trampa es real: los pedidos del backfill entraron DESPUÉS, con ids mayores que lo leído y que las dos nuevas.
    const nuevas = await base.db.evento.findMany({ where: { erpLocalId: CASIANO.id, historico: false }, select: { id: true }, orderBy: { id: "asc" } });
    assert.equal(nuevas.length, 2);
    const leidoHasta = BigInt(p1.cuerpo.leidoHasta);
    const altos = p1.cuerpo.eventos.filter((e) => BigInt(e.id) > leidoHasta);
    assert.equal(altos.length, 30, "la primera página entera tiene ids por encima de lo leído…");
    assert.ok(altos.every((e) => e.historico && e.tipo === "PEDIDO_SOLICITADO"), "…y son todos historia");
    assert.ok(altos.every((e) => BigInt(e.id) > nuevas.at(-1)!.id));

    let e = estadoDe(p1.cuerpo);
    assert.deepEqual(decidirLecturaLocal(e), { tipo: "FALTAN", nuevosMostrados: 0, noLeidos: 2 }, "no se marca: las 2 nuevas no están a la vista");

    // Se cargan las anteriores hasta que aparecen las dos.
    let siguiente = p1.cuerpo.siguiente;
    while (siguiente && decidirLecturaLocal(e).tipo === "FALTAN") {
      const p = await local(adm, CASIANO.id, siguiente);
      e = reducirConversacion(e, { tipo: "ANTERIORES", eventos: p.cuerpo.eventos, siguiente: p.cuerpo.siguiente });
      siguiente = p.cuerpo.siguiente;
    }
    const mostrados = new Set(e.fase === "LISTA" ? e.eventos.map((x) => x.id) : []);
    for (const n of nuevas) assert.ok(mostrados.has(n.id.toString()), `la ${n.id} está a la vista antes de marcar`);
    const d = decidirLecturaLocal(e);
    assert.equal(d.tipo, "MARCAR");
    if (d.tipo !== "MARCAR") return;
    assert.equal(d.marca.hastaEventoId, nuevas.at(-1)!.id.toString(), "hasta la mayor de las nuevas, no hasta un pedido histórico");
    const r = await leido(adm, { marcas: [d.marca] });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.cuerpo.lecturas[0]!.noLeidos, 0);
  });
});
