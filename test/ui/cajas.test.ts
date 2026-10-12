// CANDADOS DE LA INTERFAZ DE CAJAS (Tanda 7B), SIN NAVEGADOR.
//
// La tarjeta, el chip "Caja", las respuestas de preguntas de caja y de ventas
// por turno, y el cliente HTTP. Los componentes se dibujan con
// react-dom/server (el primer render, sin efectos). Los datos son los del
// fixture del ERP 14ae247 en la forma pública (test/ayuda/cajas.ts, atada a
// `cajasPublicas` por test/unidad/cajasChats.test.ts). Donde un caso no está
// en el fixture (una caja sin retiros), se arma QUITANDO de una caja real.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FilaDeCaja, ResultadoCaja, TarjetaCajas } from "../../src/components/chats/Cajas.tsx";
import { pedirCaja } from "../../src/components/chats/clienteChats.ts";
import { AccionesDelLocal } from "../../src/components/chats/Conversacion.tsx";
import { avisoTurnoNoEncontrado, estadoDeCaja, filaDeCaja, lineaDeRetiro, tituloDeCajas } from "../../src/components/chats/formato.ts";
import { reducirCaja, type EstadoCaja } from "../../src/components/chats/logica.ts";
import { PreguntaGuardadaVista, RespuestaDePreguntaVista } from "../../src/components/chats/Preguntas.tsx";
import { TEXTO_CUPO_ERP } from "../../src/components/chats/Piezas.tsx";
import type { CajaPublica, CajasDelDia, RespuestaCaja } from "../../src/shared/chats/api.ts";
import type { PreguntaGuardada } from "../../src/shared/chats/preguntas.ts";
import { cajasDelDiaDelFixture } from "../ayuda/cajas.ts";

const ZONA = "America/Argentina/Buenos_Aires";
const nada = () => {};
const dibujar = (e: ReactElement) => renderToStaticMarkup(e);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const HOY: CajasDelDia = cajasDelDiaDelFixture("hoy", "Casiano");
const PERIODO = { tipo: "hoy" as const, desde: HOY.fecha, hasta: HOY.fecha };
const cajaDe = (operador: string): CajaPublica => HOY.turnos.flatMap((t) => t.cajas).find((c) => c.operador === operador)!;
const tarjeta = (c: CajasDelDia = HOY, extra: Partial<Parameters<typeof TarjetaCajas>[0]> = {}) =>
  dibujar(createElement(TarjetaCajas, { cajas: c, titulo: tituloDeCajas(PERIODO, c.local.nombre), zona: ZONA, ...extra }));
const fila = (c: CajaPublica) => dibujar(createElement(FilaDeCaja, { caja: c, zona: ZONA }));
/** Lo que se ve al desplegar: el contenido del <details>, sin la fila. */
const detalle = (c: CajaPublica) => texto(fila(c).split("</summary>")[1]!);

describe("la tarjeta de cajas: por turno, sin turno al final, cada caja plegada", () => {
  it("una sección por turno con su nombre y su total; 'Sin turno asignado' al final y en el tono secundario", () => {
    const html = tarjeta();
    const secciones = [...html.matchAll(/<section class="([^"]+)" aria-label="([^"]+)"/g)].map((m) => [m[2], m[1]]);
    assert.deepEqual(secciones, [
      ["Mañana", "ac-turno"],
      ["Tarde", "ac-turno"],
      ["Sin turno asignado", "ac-turno ac-turno--sin-turno"],
    ]);
    const t = texto(html);
    assert.ok(t.startsWith("Cajas de hoy · Casiano"));
    assert.ok(t.includes("Mañana · $ 83.000,00") && t.includes("Tarde · $ 26.000,00") && t.includes("Sin turno asignado · $ 23.000,00"), t);
  });

  it("cada caja es una fila PLEGADA: operador, estado y total; el detalle se abre al tocar", () => {
    const html = tarjeta();
    const filas = [...html.matchAll(/<summary class="ac-caja__fila">(.*?)<\/summary>/g)].map((m) => texto(m[1]!));
    assert.deepEqual(filas, [
      "Ana · Correcta $ 68.000,00",
      "Bruno · Falta $ 1.000,00 $ 10.000,00",
      "Carla · Sobra $ 1.000,00 $ 5.000,00",
      "Diego · Falta $ 500,00 $ 16.000,00",
      "Eva · Abierta $ 10.000,00",
      "Sofía · Correcta $ 23.000,00",
    ]);
    assert.equal((html.match(/<details/g) ?? []).length, 6);
    assert.ok(!/<details[^>]* open/.test(html), "ninguna abierta de entrada");
  });

  it("las diferencias NO se compensan: Bruno falta y Carla sobra, cada uno en su caja; el turno no muestra ninguna", () => {
    const manana = texto(tarjeta()).split("Tarde · ")[0]!;
    assert.ok(manana.includes("Falta $ 1.000,00") && manana.includes("Sobra $ 1.000,00"));
    const titulo = /<p class="ac-turno__titulo">(.*?)<\/p>/.exec(tarjeta())![1]!;
    assert.equal(texto(titulo), "Mañana · $ 83.000,00", "el título del turno es solo el total vendido");
  });

  it("desplegada: efectivo, débito y cada medio; el fiado aparte y 'no cobrado'; el cierre; Tesorería verificada", () => {
    const ana = detalle(cajaDe("Ana"));
    for (const t of [
      "4 ventas",
      "Efectivo · $ 50.000,00",
      "Débito · $ 8.000,00",
      "Mercado Pago · $ 7.000,00",
      "Fiado · $ 3.000,00 · no cobrado",
      "Efectivo esperado · $ 16.000,00",
      "Efectivo contado · $ 16.000,00",
      "Retirado al cierre · $ 15.000,00",
      "Fondo que quedó · $ 1.000,00",
      "Tesorería: Verificada",
    ]) {
      assert.ok(ana.includes(t), `falta "${t}" en: ${ana}`);
    }
    assert.ok(detalle(cajaDe("Bruno")).includes("Tesorería: Falta verificar"));
  });

  it("retiros: monto · motivo · a quién (si viene) · hora; sin a quién no se escribe nada en su lugar", () => {
    const diego = cajaDe("Diego").retiros[0]!;
    assert.equal(lineaDeRetiro(diego, ZONA), `$ 11.500,00 · Retiro de cierre del turno #5 — Caja fuerte · Caja fuerte · 20:39`);
    const recaudacion = cajaDe("Ana").retiros[0]!;
    assert.equal(recaudacion.aQuien, null);
    assert.equal(lineaDeRetiro(recaudacion, ZONA), "$ 30.000,00 · Retiro de recaudación #1 · 20:39");
    assert.ok(detalle(cajaDe("Ana")).includes("Panadería La Espiga"), "el proveedor del pago es el a quién");
    assert.ok(detalle(cajaDe("Bruno")).includes("$ 2.000,00 · Compra de bolsas · 20:39"));
  });

  it("sin retiros: 'Sin retiros'", () => {
    const sinRetiros = { ...cajaDe("Ana"), retiros: [] };
    assert.ok(detalle(sinRetiros).includes("Retiros Sin retiros"));
  });

  it("caja abierta: 'Caja abierta' y sin datos de cierre ni de Tesorería", () => {
    const eva = detalle(cajaDe("Eva"));
    assert.ok(eva.includes("Caja abierta"));
    for (const t of ["Efectivo esperado", "Efectivo contado", "Retirado al cierre", "Fondo que quedó", "Tesorería"]) assert.ok(!eva.includes(t), t);
  });

  it("los textos del estado, de uno en uno", () => {
    assert.equal(estadoDeCaja({ estado: "SIN_CONTEO", diferencia: null }), "Cerrada sin contar");
    assert.equal(estadoDeCaja({ estado: "ANULADA", diferencia: null }), "Anulada");
    assert.equal(filaDeCaja({ estado: "ABIERTA", diferencia: null, operador: null, etiqueta: "Caja del turno #4" }), "Caja del turno #4 · Abierta");
    assert.equal(avisoTurnoNoEncontrado("noche"), "No encontré el turno «noche». Estos son los turnos del día.");
  });

  it("un día sin cajas lo dice", () => {
    assert.ok(texto(tarjeta(cajasDelDiaDelFixture("ayerSinCajas", "Casiano"))).includes("No hubo cajas."));
  });
});

describe("el chip 'Caja' y la tarjeta al final del chat", () => {
  const LISTA: EstadoCaja = { fase: "LISTA", cajas: { estado: "OK", ...HOY } };
  const acciones = (caja: NonNullable<Parameters<typeof AccionesDelLocal>[0]["caja"]> | null, enEspera = false) =>
    dibujar(createElement(AccionesDelLocal, { anuncia: true, estado: { fase: "QUIETO" }, alPedir: nada, caja, enEspera }));

  it("con cajas_resumen: el chip al lado de 'Ventas'; sin ella, no hay chip ni tarjeta", () => {
    const con = acciones({ estado: { fase: "QUIETO" }, alPedir: nada });
    assert.deepEqual([...con.matchAll(/class="ac-chip ac-chip--accion"[^>]*>([^<]+)</g)].map((m) => m[1]), ["Ventas", "Caja"]);
    const sin = acciones(null);
    assert.ok(!texto(sin).includes("Caja"));
  });

  it("mientras consulta, el chip dice que consulta y no se puede tocar; con la respuesta, la tarjeta al final", () => {
    const cargando = acciones({ estado: { fase: "CARGANDO" }, alPedir: nada });
    assert.match(cargando, /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Consultando cajas…<\/button>/);
    assert.ok(texto(acciones({ estado: LISTA, alPedir: nada })).includes("Cajas de hoy · Casiano"));
  });

  it("falla: 'No se pudo consultar ERP Azul.' con Reintentar a mano; por cupo, su texto y Reintentar en espera", () => {
    const falla = dibujar(createElement(ResultadoCaja, { estado: { fase: "FALLA", cupo: false }, alReintentar: nada }));
    assert.ok(texto(falla).includes("No se pudo consultar ERP Azul. Reintentar"));
    const cupo = dibujar(createElement(ResultadoCaja, { estado: { fase: "FALLA", cupo: true }, alReintentar: nada, enEspera: true }));
    assert.ok(texto(cupo).includes(TEXTO_CUPO_ERP));
    assert.match(cupo, /<button[^>]*disabled=""[^>]*>Reintentar<\/button>/);
  });

  it("el estado: pedir, la respuesta, la falla; cancelada no es falla; sin pedido en curso, nada cambia", () => {
    const ok = { estado: "OK" as const, ...HOY };
    let e = reducirCaja({ fase: "QUIETO" }, { tipo: "PEDIR" });
    assert.deepEqual(e, { fase: "CARGANDO" });
    assert.deepEqual(reducirCaja(e, { tipo: "RESPUESTA", resultado: { ok: true, datos: ok } }), { fase: "LISTA", cajas: ok });
    assert.deepEqual(reducirCaja(e, { tipo: "RESPUESTA", resultado: { ok: false, falla: { estado: "ERP_CUPO_EXCEDIDO" } } }), { fase: "FALLA", cupo: true });
    assert.deepEqual(reducirCaja(e, { tipo: "RESPUESTA", resultado: { ok: false, falla: { estado: "CANCELADA" } } }), { fase: "QUIETO" });
    e = { fase: "QUIETO" };
    assert.deepEqual(reducirCaja(e, { tipo: "RESPUESTA", resultado: { ok: true, datos: ok } }), e);
  });

  it("el cliente: GET /api/chats/caja?localId=N, mismo origen y sin caché", async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    const inits: RequestInit[] = [];
    globalThis.fetch = (async (u: string, init: RequestInit) => {
      urls.push(u);
      inits.push(init);
      return new Response(JSON.stringify({ estado: "OK", ...HOY } satisfies RespuestaCaja), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await pedirCaja(3);
      assert.ok(r.ok && r.datos.turnos.length === 3);
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(urls, ["/api/chats/caja?localId=3"]);
    assert.deepEqual([inits[0]?.method, inits[0]?.credentials, inits[0]?.cache], [undefined, "same-origin", "no-store"]);
  });
});

describe("preguntas de caja y de ventas por turno", () => {
  const ver = (r: Parameters<typeof RespuestaDePreguntaVista>[0]["respuesta"]) => texto(dibujar(createElement(RespuestaDePreguntaVista, { respuesta: r, alReintentar: nada, zona: ZONA })));
  const tarde = { ...HOY, turnos: [HOY.turnos[1]!] };

  it("caja de un turno que no está: el aviso fijo arriba y todos los turnos", () => {
    const t = ver({ estado: "CAJA", alcance: "LOCAL", periodo: PERIODO, turnoPedido: "noche", turnoNoEncontrado: true, cajas: HOY });
    assert.ok(t.startsWith("No encontré el turno «noche». Estos son los turnos del día. Cajas de hoy · Casiano"), t);
    assert.ok(t.includes("Mañana") && t.includes("Sin turno asignado"));
  });

  it("caja de todos: una tarjeta por local y los que no se pudieron consultar", () => {
    const t = ver({ estado: "CAJA", alcance: "TODOS", periodo: PERIODO, turnoPedido: null, turnoNoEncontrado: false, locales: [HOY], fallidos: [{ id: 9, nombre: "Depósito" }] });
    assert.ok(t.includes("Cajas de hoy · Casiano") && t.includes("No se pudo consultar: Depósito."), t);
  });

  it("ventas de un turno, un local: 'Turno Tarde · hoy · Casiano', el desglose del turno y sus cajas", () => {
    const t = ver({ estado: "VENTAS_TURNO", alcance: "LOCAL", periodo: PERIODO, turnoPedido: "tarde", turnoNoEncontrado: false, noSeparaPor: [], cajas: tarde });
    assert.ok(t.startsWith("Turno Tarde · hoy · Casiano Tarde · $ 26.000,00 4 ventas Efectivo · $ 21.000,00 Crédito · $ 4.000,00 Mercado Pago · $ 1.000,00"), t);
    assert.ok(t.includes("Diego · Falta $ 500,00") && t.includes("Eva · Abierta"));
  });

  it("ventas de un turno en todos: el total del turno, por medio y por local; un local sin ese turno lo dice; si falta uno, sin total", () => {
    const total = tarde.turnos[0]!.totales;
    const otro = { ...HOY, local: { id: 9, nombre: "Depósito" }, turnos: [] };
    const conTotal = ver({ estado: "VENTAS_TURNO", alcance: "TODOS", periodo: PERIODO, turnoPedido: "tarde", turnoNoEncontrado: false, noSeparaPor: [], total, locales: [tarde, otro], fallidos: [] });
    assert.ok(conTotal.startsWith("Turno Tarde · hoy · Todos los locales $ 26.000,00 4 ventas Por medio de pago"), conTotal);
    assert.ok(conTotal.includes("Por local Casiano · $ 26.000,00 Depósito · sin ese turno"), conTotal);
    const sinTotal = ver({ estado: "VENTAS_TURNO", alcance: "TODOS", periodo: PERIODO, turnoPedido: "tarde", turnoNoEncontrado: false, noSeparaPor: [], total: null, locales: [tarde], fallidos: [{ id: 9, nombre: "Depósito" }] });
    assert.ok(!sinTotal.includes("Por medio de pago") && sinTotal.includes("Sin total: faltan locales."), sinTotal);
  });

  it("guardada: la foto de una caja vuelve en el historial con cuándo fue, sin Reintentar", () => {
    const g: PreguntaGuardada = {
      id: "7",
      pregunta: "¿Cómo cerró la caja?",
      creadaEn: "2026-10-11T23:40:00.000Z",
      respuesta: { estado: "CAJA", alcance: "LOCAL", periodo: PERIODO, turnoPedido: null, turnoNoEncontrado: false, cajas: HOY },
    };
    const html = dibujar(createElement(PreguntaGuardadaVista, { guardada: g, zona: ZONA }));
    const t = texto(html);
    assert.ok(t.includes("¿Cómo cerró la caja?") && t.includes("Cajas de hoy · Casiano") && t.includes("Respuesta del 11/10 a las 20:40"), t);
    assert.ok(!t.includes("Reintentar"));
  });
});
