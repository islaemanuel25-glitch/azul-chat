// CANDADOS DEL CUPO DEL ERP (Tanda 5B), DE PUNTA A PUNTA, CONTRA POSTGRESQL.
//
// El incidente del 11/10: la app abierta (22 a 27 consultas al abrir, porque
// ingería) y la corrida de fondo (21) compartían el cupo del ERP —30 por
// persona en una ventana fija de 60 s— y la persona vio "ERP Azul no
// responde". Acá el ERP de mentira aplica ESE cupo, copiado de erpmanual
// lib/integraciones/azul-chat/limitador.js (test/ayuda/erpConEstado.ts), con
// un reloj fijo para que "el mismo minuto" sea exacto.
//
//   (b) corrida de fondo + navegación intensa en el mismo minuto, en
//       cualquier orden: cero 429;
//   (c) un LIMITE_EXCEDIDO a mitad de la corrida la corta: ni una consulta
//       más, el error queda en lo no procesado, y la siguiente retoma por ahí;
//   (f) la línea de base de lectura sin ingesta en el pedido.
//
// La persona tiene 5 locales con las 4 capacidades de eventos: los 4 del
// `mi_alcance` real de adminGlobal (25172fe) más "Local A" del de 76b9a71.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { conAutorizacionViva } from "../../src/server/chats/autorizacion.ts";
import { manejarChats, manejarGeneral, manejarLocal, manejarVentas } from "../../src/server/chats/manejadores.ts";
import {
  FRECUENCIA_MINIMA_INGESTA_MS,
  PRESUPUESTO_FONDO_POR_PERSONA,
  RESERVA_PARA_LA_APP,
  sincronizarAutorizados,
} from "../../src/server/chats/sincronizacion.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { manejarSincronizar, type ResumenTarea } from "../../src/server/interno/sincronizar.ts";
import { CABECERA_SECRETO_TAREA, leerPuertaTarea } from "../../src/server/interno/tarea.ts";
import type { Registro } from "../../src/server/log.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { manejarVincular } from "../../src/server/sesion/vincular.ts";
import type { DatosMiAlcance, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { ADMINISTRADORES_DE_PRUEBA } from "../ayuda/accesos.ts";
import { levantarErpConEstado, type ErpConEstado } from "../ayuda/erpConEstado.ts";
import { recepcion } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, FIXTURES_ERP_76B9A71, SECRETO_PRUEBA, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const INSTALACION = "instalacion-prueba";
const CLAVE = randomBytes(32).toString("base64");
const SECRETO_TAREA = `tarea-${randomBytes(24).toString("base64url")}`;
const ADMIN = 9;
const ENCARGADO = 11;
const CASIANO = { id: 3, nombre: "Casiano" };
const DEPOSITO = { id: 9, nombre: "Depósito Central" };
const LAS_CUATRO = ["transferencias_eventos", "pedidos_eventos", "envios_eventos", "cancelaciones_eventos"] as const;
const HISTORIA_CASIANO = structuredClone(
  (FIXTURES_ERP_25172FE.transferenciasEventos.sinDesde.respuesta.cuerpo.datos as { eventos: EventoTransferenciaRecibida[] }).eventos,
);

/** adminGlobal real con las 4 capacidades en sus 4 locales, más "Local A" (el local real de 76b9a71): 5 locales. */
function cincoLocales(): Rompible<DatosMiAlcance> {
  const a = structuredClone(FIXTURES_ERP_25172FE.miAlcance.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>;
  const localA = structuredClone((FIXTURES_ERP_76B9A71.miAlcance.encargado.respuesta.cuerpo as { datos: DatosMiAlcance }).datos.locales[0]!);
  a.locales.push(localA as never);
  for (const l of a.locales) l.capacidades = ["ventas_resumen", ...LAS_CUATRO] as never;
  return a;
}
/** Los ids, en el orden de `mi_alcance`: Belgrano, Casiano, Depósito, Centro, Local A. */
const LOCALES = [5, 3, 9, 20, 2];

let base: BaseDescartable;
let erp: ErpConEstado;
let reloj: number;
/** El reloj del cupo del ERP: fijo dentro de un "minuto", se adelanta a mano. */
let relojErp: number;

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
  erp.alcances.clear();
  erp.alcances.set(ADMIN, cincoLocales());
  erp.eventosPorLocal.set(CASIANO.id, structuredClone(HISTORIA_CASIANO));
  erp.eventosPorLocal.set(DEPOSITO.id, [recepcion({ local: DEPOSITO, transferenciaId: 300, fecha: "2026-10-07T08:00:00.000Z" })]);
  erp.cupo.desactivar();
  reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
  relojErp = 1_000_000;
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

/** La corrida de fondo, como la llama el timer. */
async function fondo(): Promise<ResumenTarea> {
  const puerta = leerPuertaTarea({ AZUL_CHAT_TAREA_SECRET: SECRETO_TAREA });
  assert.ok(puerta.ok);
  const res = await manejarSincronizar(
    new Request("http://127.0.0.1:3100/api/interno/sincronizar", {
      method: "POST",
      headers: { host: "127.0.0.1:3100", "x-forwarded-proto": "http", [CABECERA_SECRETO_TAREA]: SECRETO_TAREA },
    }),
    { ...deps(), puerta, push: { ok: false } },
  );
  const texto = await res.text();
  assert.equal(res.status, 200, texto);
  return JSON.parse(texto) as ResumenTarea;
}

type Pedido = { nombre: string; hacer: () => Promise<Response>; consultas: number };

/** La navegación intensa de un minuto: lista, 5 locales, General, Ventas, Actualizar ×3. */
function navegacion(cookie: string): Pedido[] {
  const get = (ruta: string, manejar: (r: Request, d: DependenciasSesion) => Promise<Response>) => () =>
    manejar(new Request(`${ORIGEN}${ruta}`, { headers: conCookie(cookie) }), deps());
  return [
    { nombre: "abrir la lista", hacer: get("/api/chats", manejarChats), consultas: 1 },
    ...LOCALES.map((id) => ({ nombre: `local ${id}`, hacer: get(`/api/chats/local?localId=${id}`, manejarLocal), consultas: 1 })),
    { nombre: "General", hacer: get("/api/chats/general", manejarGeneral), consultas: 1 },
    { nombre: "Ventas", hacer: get(`/api/chats/ventas?localId=${CASIANO.id}`, manejarVentas), consultas: 2 },
    ...[1, 2, 3].map((n) => ({ nombre: `Actualizar ${n}`, hacer: get("/api/chats", manejarChats), consultas: 1 })),
  ];
}

const consultasAlErp = () => erp.cuerposA("consultar");
/** El local de cada consulta de ingesta, en orden, sin repetir seguidos. */
const localesEnOrden = () => {
  const ids = consultasAlErp()
    .filter((c) => c.capacidad !== "mi_alcance" && c.capacidad !== "ventas_resumen")
    .map((c) => (c.alcance as { localId: number }).localId);
  return ids.filter((id, i) => i === 0 || ids[i - 1] !== id);
};
const cursores = () =>
  base.db.cursorIngesta.findMany({ select: { erpLocalId: true, capacidad: true, ultimoErrorCodigo: true, ultimaSincronizacionEn: true } });
/** Una ventana del cupo nueva, y todo lo guardado más viejo que la frecuencia mínima. */
const otroMinuto = () => {
  relojErp += 61_000;
  reloj += 2 * 60_000;
};

// ─────────────────────────────────────────────────────────────────────────────

describe("(b) la app no compite con el fondo por el cupo del ERP", () => {
  it("las cuentas: la navegación intensa son 12 consultas, y el fondo gasta como mucho 30 − 12 = 18 por persona", () => {
    const n = navegacion("x").reduce((t, p) => t + p.consultas, 0);
    assert.equal(n, 12);
    assert.equal(RESERVA_PARA_LA_APP, n, "la reserva es esta navegación, contada");
    assert.equal(PRESUPUESTO_FONDO_POR_PERSONA, 30 - n);
  });

  for (const orden of ["fondo primero", "navegación primero", "fondo en el medio"] as const) {
    it(`corrida de fondo + navegación intensa en el mismo minuto (${orden}): cero 429, todo 200`, async () => {
      const cookie = await vincular(ADMIN);
      erp.cupo.activar({ ahora: () => relojErp });
      const pedidos = navegacion(cookie);
      const corte = orden === "fondo primero" ? 0 : orden === "navegación primero" ? pedidos.length : 1;
      const resultados: { nombre: string; status: number }[] = [];
      for (const p of pedidos.slice(0, corte)) resultados.push({ nombre: p.nombre, status: (await p.hacer()).status });
      erp.recibidas.length = 0;
      const r = await fondo();
      const delFondo = consultasAlErp().length;
      for (const p of pedidos.slice(corte)) resultados.push({ nombre: p.nombre, status: (await p.hacer()).status });

      assert.equal(erp.cupo.rechazos(), 0, "ni un LIMITE_EXCEDIDO del ERP");
      for (const x of resultados) assert.equal(x.status, 200, x.nombre);
      assert.equal(delFondo, PRESUPUESTO_FONDO_POR_PERSONA, "el fondo gastó su presupuesto y nada más");
      assert.equal(r.consultasErp, PRESUPUESTO_FONDO_POR_PERSONA);
      assert.equal(r.cortadaPorCupo, false);
      assert.equal(r.personasConPendientes, 1, "con 5 locales no entra todo en una corrida: lo que falta, en la siguiente");
    });
  }

  it("CONTRAPRUEBA: con el fondo de antes (21: sin presupuesto) y la misma navegación en el mismo minuto, el ERP rechaza 3 y la app lo dice como cupo", async () => {
    const cookie = await vincular(ADMIN);
    erp.cupo.activar({ ahora: () => relojErp });
    // La corrida de antes de la Tanda 5B: mi_alcance + las 20 capacidades, sin tope.
    await conAutorizacionViva(new Headers(conCookie(cookie)), deps(), "entrar", async (a) => {
      await sincronizarAutorizados(deps(), a, a.autorizados, Number.POSITIVE_INFINITY);
      return { ok: true, datos: null, requestId: "" };
    });
    assert.equal(consultasAlErp().length, 21);
    const statuses: number[] = [];
    let ultimo: unknown = null;
    for (const p of navegacion(cookie)) {
      const res = await p.hacer();
      statuses.push(res.status);
      ultimo = await res.json();
    }
    assert.equal(erp.cupo.rechazos(), 3, "21 + 12 = 33: tres de más");
    assert.deepEqual(statuses.slice(-2), [429, 429]);
    assert.deepEqual(ultimo, { estado: "ERP_CUPO_EXCEDIDO" }, "no 'ERP Azul no responde': el código propio del cupo");
  });

  it("con el presupuesto, cada capacidad se trae al menos cada dos corridas y ningún local queda 'Actualización demorada'", async () => {
    const cookie = await vincular(ADMIN);
    const vistas: string[][] = [];
    for (let corrida = 0; corrida < 5; corrida++) {
      erp.recibidas.length = 0;
      const r = await fondo();
      assert.ok(r.consultasErp <= PRESUPUESTO_FONDO_POR_PERSONA);
      vistas.push(localesEnOrden().map(String));
      if (corrida >= 1) {
        const lista = (await (await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps())).json()) as {
          locales: { localId: number; sincronizacion: string }[];
        };
        assert.ok(lista.locales.every((l) => l.sincronizacion === "AL_DIA"), `corrida ${corrida + 1}: ${JSON.stringify(lista.locales)}`);
      }
      otroMinuto();
    }
    // Lo que una corrida no alcanzó va primero en la siguiente: ningún local queda siempre último.
    const ultimos = new Set(vistas.map((v) => v.at(-1)));
    assert.ok(ultimos.size > 1, `el último cambia: ${JSON.stringify(vistas)}`);
    assert.equal(vistas[1]![0], vistas[0]!.at(-1), "la segunda empieza por el que la primera dejó a medias");
  });
});

describe("(c) LIMITE_EXCEDIDO a mitad de la corrida", () => {
  it("corta ahí, no sigue consultando, deja el error en lo no procesado y la siguiente retoma por los pendientes", async () => {
    const cookie = await vincular(ADMIN);
    // 7 consultas pasan: mi_alcance + Belgrano (4) + 2 de Casiano. La 8.ª, rechazada.
    erp.cupo.activar({ maxPorUsuario: 7, ahora: () => relojErp });
    const r = await fondo();
    assert.equal(r.cortadaPorCupo, true);
    assert.equal(consultasAlErp().length, 8, "7 que pasaron + la rechazada; ni una más");
    assert.equal(erp.cupo.rechazos(), 1);
    assert.deepEqual(localesEnOrden(), [5, 3]);

    const porLocal = new Map<number, (string | null)[]>();
    for (const c of await cursores()) porLocal.set(c.erpLocalId, [...(porLocal.get(c.erpLocalId) ?? []), c.ultimoErrorCodigo]);
    assert.deepEqual(porLocal.get(5), [null, null, null, null], "Belgrano: completo");
    assert.deepEqual(
      (await cursores()).filter((c) => c.erpLocalId === CASIANO.id).sort((a, b) => LAS_CUATRO.indexOf(a.capacidad as never) - LAS_CUATRO.indexOf(b.capacidad as never)).map((c) => c.ultimoErrorCodigo),
      [null, null, "LIMITE_EXCEDIDO", "LIMITE_EXCEDIDO"],
      "Casiano: las dos primeras sí; la rechazada y la que seguía, con el código",
    );
    for (const id of [9, 20, 2]) assert.deepEqual(porLocal.get(id), Array(4).fill("LIMITE_EXCEDIDO"), `local ${id}: no procesado, con el código`);

    // La app lo muestra como demora, con lo que hay (un minuto después: en este, el cupo está lleno).
    relojErp += 61_000;
    const lista = (await (await manejarChats(new Request(`${ORIGEN}/api/chats`, { headers: conCookie(cookie) }), deps())).json()) as {
      locales: { localId: number; sincronizacion: string }[];
    };
    const estado = Object.fromEntries(lista.locales.map((l) => [l.localId, l.sincronizacion]));
    assert.deepEqual(estado, { 5: "AL_DIA", 3: "DEMORADA", 9: "DEMORADA", 20: "DEMORADA", 2: "DEMORADA" });

    // La siguiente corrida, en otro minuto: empieza por los pendientes y Belgrano, completo, va último.
    otroMinuto();
    erp.cupo.activar({ ahora: () => relojErp });
    erp.recibidas.length = 0;
    const r2 = await fondo();
    assert.equal(r2.cortadaPorCupo, false);
    assert.equal(erp.cupo.rechazos(), 0);
    const orden = localesEnOrden();
    assert.equal(orden.at(-1), 5, `Belgrano último: ${JSON.stringify(orden)}`);
    assert.deepEqual(new Set(orden.slice(0, 4)), new Set([3, 9, 20, 2]), "los cuatro pendientes primero");
    assert.ok((await cursores()).filter((c) => c.erpLocalId !== 5).every((c) => c.ultimoErrorCodigo === null), "los pendientes se trajeron y el código se limpió");
  });

  it("si el que dice LIMITE_EXCEDIDO es mi_alcance, la corrida se corta antes de la siguiente persona", async () => {
    await vincular(ADMIN);
    erp.alcances.set(ENCARGADO, cincoLocales());
    await vincular(ENCARGADO);
    erp.cupo.activar({ maxPorUsuario: 0, ahora: () => relojErp });
    const r = await fondo();
    assert.equal(r.cortadaPorCupo, true);
    assert.equal(r.personas, 1, "la segunda persona no se intentó");
    assert.equal(consultasAlErp().length, 1, "solo el mi_alcance rechazado");
  });

  it("CONTRAPRUEBA: sin el cupo, la misma corrida sigue hasta el presupuesto", async () => {
    await vincular(ADMIN);
    const r = await fondo();
    assert.equal(r.cortadaPorCupo, false);
    assert.equal(consultasAlErp().length, PRESUPUESTO_FONDO_POR_PERSONA);
    assert.ok(localesEnOrden().length >= 4);
  });
});

describe("(f) la lectura inicial de un local, sin ingesta en el pedido", () => {
  const leerLocal = async (cookie: string, id = CASIANO.id) =>
    (await (await manejarLocal(new Request(`${ORIGEN}/api/chats/local?localId=${id}`, { headers: conCookie(cookie) }), deps())).json()) as {
      noLeidos: number;
      leidoHasta: string;
      eventos: { id: string; historico: boolean }[];
    };
  const maxId = async (localId: number) => (await base.db.evento.aggregate({ where: { erpLocalId: localId }, _max: { id: true } }))._max.id ?? 0n;

  it("la primera vista fija la lectura en el mayor Evento.id QUE YA ESTÁ en la base; lo que el fondo trae después, si no es historia, es nuevo", async () => {
    erp.alcances.set(ADMIN, structuredClone(FIXTURES_ERP_25172FE.miAlcance.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
    const cookie = await vincular(ADMIN);
    await fondo(); // el backfill: historia
    reloj += FRECUENCIA_MINIMA_INGESTA_MS;
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 404, fecha: "2026-10-08T10:00:00.000Z" }));
    await fondo(); // el 404 entra ANTES de que la persona mire: no histórico
    const id404 = await maxId(CASIANO.id);
    const primera = await leerLocal(cookie);
    assert.equal(primera.leidoHasta, id404.toString(), "la línea de base es lo que había en la base al mirar");
    assert.equal(primera.noLeidos, 0, "lo anterior a la primera vista es historia para la persona, aunque no sea `historico`");
    assert.ok(primera.eventos.some((e) => e.id === id404.toString() && !e.historico));

    reloj += FRECUENCIA_MINIMA_INGESTA_MS;
    erp.eventosPorLocal.get(CASIANO.id)!.push(recepcion({ local: CASIANO, transferenciaId: 405, fecha: "2026-10-08T11:00:00.000Z" }));
    await fondo();
    const segunda = await leerLocal(cookie);
    assert.equal(segunda.leidoHasta, id404.toString(), "mirar no marca leído");
    assert.equal(segunda.noLeidos, 1, "lo que el fondo trajo después de la primera vista, sí es nuevo");
  });

  it("si la persona mira antes de que el fondo traiga nada, la base es 0 y el backfill que llega después no cuenta (es historia)", async () => {
    erp.alcances.set(ADMIN, structuredClone(FIXTURES_ERP_25172FE.miAlcance.adminGlobal.respuesta.cuerpo.datos) as Rompible<DatosMiAlcance>);
    const cookie = await vincular(ADMIN);
    const vacia = await leerLocal(cookie);
    assert.deepEqual([vacia.leidoHasta, vacia.noLeidos, vacia.eventos.length], ["0", 0, 0]);
    await fondo();
    const despues = await leerLocal(cookie);
    assert.equal(despues.eventos.length, 4);
    assert.ok(despues.eventos.every((e) => e.historico));
    assert.equal(despues.noLeidos, 0);
    assert.equal(despues.leidoHasta, "0", "la línea de base no se movió");
  });
});
