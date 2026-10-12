// CANDADOS DE LA INTERFAZ DE STOCK (Tanda 8B), SIN NAVEGADOR. Y "TURNO TURNO".
//
// Las tarjetas de bajo mínimo y de productos, el chip "Stock", las respuestas
// de las preguntas de stock (un local y todos), la foto guardada y el cliente
// HTTP. Los componentes se dibujan con react-dom/server. Los datos son los del
// fixture del ERP 41f702b en la forma pública (test/ayuda/stock.ts, atada a
// `bajoMinimoPublico` y `productosPublicos` por test/unidad/stockChats.test.ts).
// Donde un caso no está en el fixture (más de 10 bajo mínimo, total 0), se
// arma A PARTIR de un producto real, cambiando solo lo que el caso necesita.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { pedirStock } from "../../src/components/chats/clienteChats.ts";
import { AccionesDelLocal } from "../../src/components/chats/Conversacion.tsx";
import { formatearCantidad, lineaDeBajoMinimo, nombreDeTurno, tituloDeVentasDeTurno } from "../../src/components/chats/formato.ts";
import { reducirStock, type EstadoStock } from "../../src/components/chats/logica.ts";
import { TEXTO_CUPO_ERP } from "../../src/components/chats/Piezas.tsx";
import { PreguntaGuardadaVista, RespuestaDePreguntaVista } from "../../src/components/chats/Preguntas.tsx";
import { FilaDeProducto, ResultadoStock, TarjetaBajoMinimo, TarjetaProductos } from "../../src/components/chats/Stock.tsx";
import type { BajoMinimoDelLocal, RespuestaStock } from "../../src/shared/chats/api.ts";
import type { PreguntaGuardada } from "../../src/shared/chats/preguntas.ts";
import { bajoMinimoDelFixture, productosDelFixture } from "../ayuda/stock.ts";

const ZONA = "America/Argentina/Buenos_Aires";
const nada = () => {};
const dibujar = (e: ReactElement) => renderToStaticMarkup(e);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const CASIANO = { id: 3, nombre: "Casiano" };
const BAJO = bajoMinimoDelFixture(CASIANO);
/** 23 faltantes armados desde uno real del fixture, con su nombre y su id. */
const muchos = (n: number): BajoMinimoDelLocal => {
  const base = BAJO.productos[0]!;
  const productos = Array.from({ length: n }, (_, i) => ({ ...base, productoId: 100 + i, nombre: `Producto ${String(i + 1).padStart(2, "0")}` }));
  return { local: CASIANO, sinMinimo: false, total: n, hayMas: false, productos };
};
const tarjetaBajo = (datos: BajoMinimoDelLocal) => dibujar(createElement(TarjetaBajoMinimo, { datos }));

describe("la tarjeta 'Bajo mínimo'", () => {
  it("con faltantes: el total, y cada uno con lo que hay como lo dice el ERP y su mínimo", () => {
    const t = texto(tarjetaBajo(BAJO));
    assert.equal(t, "Bajo mínimo · Casiano 2 productos por debajo del mínimo Dulce de Leche Serenísima · 1 uds · mín. 4 Leche Descremada · 3 uds · mín. 10");
  });

  it("más de 10: los primeros 10 a la vista y 'Ver todos (n)' despliega el resto, sin estado propio", () => {
    const html = tarjetaBajo(muchos(23));
    const [visible, plegado] = html.split("<details");
    assert.equal((visible!.match(/Producto \d\d/g) ?? []).length, 10);
    assert.match(plegado!, /<summary>Ver todos \(23\)<\/summary>/);
    assert.equal((plegado!.match(/Producto \d\d/g) ?? []).length, 13);
    assert.ok(texto(html).startsWith("Bajo mínimo · Casiano 23 productos por debajo del mínimo Producto 01"));
    // Diez justos: sin "Ver todos".
    assert.ok(!tarjetaBajo(muchos(10)).includes("<details"));
  });

  it("el ERP mandó 50 de más: se dice cuántos se muestran", () => {
    const d = { ...muchos(50), total: 63, hayMas: true };
    assert.ok(texto(tarjetaBajo(d)).endsWith("Se muestran 50 de 63."));
  });

  it("sin mínimo cargado y con nada por debajo: su texto, sin lista", () => {
    assert.equal(texto(tarjetaBajo({ local: CASIANO, sinMinimo: true })), "Bajo mínimo · Casiano Este local no tiene stock mínimo cargado.");
    assert.equal(texto(tarjetaBajo({ ...BAJO, total: 0, productos: [] })), "Bajo mínimo · Casiano Nada por debajo del mínimo.");
  });
});

describe("la tarjeta de productos", () => {
  const ver = (caso: Parameters<typeof productosDelFixture>[0]) => texto(dibujar(createElement(TarjetaProductos, { datos: productosDelFixture(caso, CASIANO) })));

  it("varios: una fila por resultado, con su código, lo que hay y el mínimo; bajo mínimo con la marca de alerta", () => {
    const html = dibujar(createElement(TarjetaProductos, { datos: productosDelFixture("variasCoincidencias", CASIANO) }));
    assert.equal(
      texto(html),
      "Stock de «leche» · Casiano Leche Entera La Serenísima 7790001000012 · 24 uds · mín. 10 Leche Descremada 7790001000029 · 3 uds · mín. 10 ⚠ Bajo mínimo Dulce de Leche Serenísima 7790001000036 · 1 uds · mín. 4 ⚠ Bajo mínimo",
    );
    // La marca es la de "recibida con diferencias": la misma clase, sin colores nuevos.
    assert.equal((html.match(/class="ac-evento__marca"/g) ?? []).length, 2);
    assert.equal((html.match(/ac-stock__producto--bajo/g) ?? []).length, 2);
  });

  it("uno, en kg y en bultos: la cantidad como la muestra la pantalla del ERP", () => {
    assert.equal(ver("unaPorCodigo"), "Stock de «7790001000029» · Casiano Leche Descremada 7790001000029 · 3 uds · mín. 10 ⚠ Bajo mínimo");
    assert.ok(ver("enUnidadesYKg").includes("Queso Cremoso 2.350 kg"));
    assert.ok(ver("enBultosEnElDeposito").includes("Cerveza Quilmes 1 L 7790070000016 · 2 bultos + 6 uds"));
  });

  it("sin equivalencia, la existencia con su unidad", () => {
    const p = { ...productosDelFixture("enUnidadesYKg").productos[0]!, equivalencia: "" };
    assert.ok(texto(dibujar(createElement(FilaDeProducto, { producto: p }))).includes("2,35 Kg"));
    assert.deepEqual([formatearCantidad("2.350"), formatearCantidad("10.00"), formatearCantidad("1250.000"), formatearCantidad("-3.500")], ["2,35", "10", "1.250", "-3,5"]);
  });

  it("ninguna: 'No encontré «texto» en {local}.'; más de 10: el aviso fijo", () => {
    assert.equal(ver("ninguna"), "Stock de «fernet» · Casiano No encontré «fernet» en Casiano.");
    const hayMas = ver("hayMas");
    assert.ok(hayMas.endsWith("Hay más coincidencias: escribí el nombre más completo."), hayMas);
    assert.equal((hayMas.match(/Alfajor Havanna/g) ?? []).length, 10);
  });
});

describe("el chip 'Stock' y la tarjeta al final del chat", () => {
  const acciones = (stock: NonNullable<Parameters<typeof AccionesDelLocal>[0]["stock"]> | null) =>
    dibujar(createElement(AccionesDelLocal, { anuncia: true, estado: { fase: "QUIETO" }, alPedir: nada, caja: { estado: { fase: "QUIETO" }, alPedir: nada }, stock }));

  it("con stock_consulta: el chip después de 'Ventas' y 'Caja'; sin ella, ni chip ni tarjeta", () => {
    const con = acciones({ estado: { fase: "QUIETO" }, alPedir: nada });
    assert.deepEqual([...con.matchAll(/class="ac-chip ac-chip--accion"[^>]*>([^<]+)</g)].map((m) => m[1]), ["Ventas", "Caja", "Stock"]);
    assert.ok(!texto(acciones(null)).includes("Stock"));
  });

  it("mientras consulta, el chip dice que consulta y no se puede tocar; con la respuesta, la tarjeta", () => {
    assert.match(acciones({ estado: { fase: "CARGANDO" }, alPedir: nada }), /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Consultando stock…<\/button>/);
    assert.ok(texto(acciones({ estado: { fase: "LISTA", stock: { estado: "OK", ...BAJO } }, alPedir: nada })).includes("Bajo mínimo · Casiano 2 productos"));
  });

  it("falla: Reintentar a mano; por cupo, su texto y Reintentar en espera", () => {
    assert.ok(texto(dibujar(createElement(ResultadoStock, { estado: { fase: "FALLA", cupo: false }, alReintentar: nada }))).includes("No se pudo consultar ERP Azul. Reintentar"));
    const cupo = dibujar(createElement(ResultadoStock, { estado: { fase: "FALLA", cupo: true }, alReintentar: nada, enEspera: true }));
    assert.ok(texto(cupo).includes(TEXTO_CUPO_ERP));
    assert.match(cupo, /<button[^>]*disabled=""[^>]*>Reintentar<\/button>/);
  });

  it("el estado: pedir, la respuesta (sin mínimo también es respuesta), la falla; cancelada no es falla", () => {
    const sin = { estado: "OK" as const, local: CASIANO, sinMinimo: true as const };
    const e: EstadoStock = reducirStock({ fase: "QUIETO" }, { tipo: "PEDIR" });
    assert.deepEqual(reducirStock(e, { tipo: "RESPUESTA", resultado: { ok: true, datos: sin } }), { fase: "LISTA", stock: sin });
    assert.deepEqual(reducirStock(e, { tipo: "RESPUESTA", resultado: { ok: false, falla: { estado: "ERP_CUPO_EXCEDIDO" } } }), { fase: "FALLA", cupo: true });
    assert.deepEqual(reducirStock(e, { tipo: "RESPUESTA", resultado: { ok: false, falla: { estado: "CANCELADA" } } }), { fase: "QUIETO" });
    assert.deepEqual(reducirStock({ fase: "QUIETO" }, { tipo: "RESPUESTA", resultado: { ok: true, datos: sin } }), { fase: "QUIETO" });
  });

  it("el cliente: GET /api/chats/stock?localId=N, mismo origen y sin caché", async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    const inits: RequestInit[] = [];
    globalThis.fetch = (async (u: string, init: RequestInit) => {
      urls.push(u);
      inits.push(init);
      return new Response(JSON.stringify({ estado: "OK", ...BAJO } satisfies RespuestaStock), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await pedirStock(3);
      assert.ok(r.ok && !r.datos.sinMinimo && r.datos.total === 2);
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(urls, ["/api/chats/stock?localId=3"]);
    assert.deepEqual([inits[0]?.method, inits[0]?.credentials, inits[0]?.cache], [undefined, "same-origin", "no-store"]);
  });
});

describe("preguntas de stock", () => {
  const ver = (r: Parameters<typeof RespuestaDePreguntaVista>[0]["respuesta"]) => texto(dibujar(createElement(RespuestaDePreguntaVista, { respuesta: r, alReintentar: nada, zona: ZONA })));
  const NORTE = { id: 4, nombre: "Norte" };

  it("producto en un local: la tarjeta de productos", () => {
    const t = ver({ estado: "STOCK", modo: "producto", alcance: "LOCAL", texto: "leche", resultado: productosDelFixture("variasCoincidencias", CASIANO) });
    assert.ok(t.startsWith("Stock de «leche» · Casiano Leche Entera La Serenísima"), t);
  });

  it("producto en todos: una sección por local, con lo suyo o 'no encontrado', y los que fallaron", () => {
    const t = ver({
      estado: "STOCK",
      modo: "producto",
      alcance: "TODOS",
      texto: "leche",
      locales: [productosDelFixture("unaPorCodigo", CASIANO), { ...productosDelFixture("ninguna", NORTE), texto: "leche" }],
      fallidos: [{ id: 9, nombre: "Depósito" }],
    });
    assert.equal(t, "Stock de «leche» · Todos los locales Casiano Leche Descremada 7790001000029 · 3 uds · mín. 10 ⚠ Bajo mínimo Norte No encontré «leche» en Norte. No se pudo consultar: Depósito.");
  });

  it("bajo mínimo en un local y en todos: cada local con su total, sin sumas", () => {
    assert.ok(ver({ estado: "STOCK", modo: "bajo_minimo", alcance: "LOCAL", resultado: BAJO }).startsWith("Bajo mínimo · Casiano 2 productos"));
    const t = ver({ estado: "STOCK", modo: "bajo_minimo", alcance: "TODOS", locales: [BAJO, { local: NORTE, sinMinimo: true }], fallidos: [] });
    assert.equal(
      t,
      "Bajo mínimo · Todos los locales Casiano 2 productos por debajo del mínimo Dulce de Leche Serenísima · 1 uds · mín. 4 Leche Descremada · 3 uds · mín. 10 Norte Este local no tiene stock mínimo cargado.",
    );
  });

  it("guardada: la foto vuelve en el historial con cuándo fue, sin Reintentar", () => {
    const g: PreguntaGuardada = {
      id: "8",
      pregunta: "¿Qué falta reponer?",
      creadaEn: "2026-10-12T13:05:00.000Z",
      respuesta: { estado: "STOCK", modo: "bajo_minimo", alcance: "LOCAL", resultado: BAJO },
    };
    const t = texto(dibujar(createElement(PreguntaGuardadaVista, { guardada: g, zona: ZONA })));
    assert.ok(t.includes("¿Qué falta reponer?") && t.includes("Bajo mínimo · Casiano 2 productos") && t.includes("Respuesta del 12/10 a las 10:05"), t);
    assert.ok(!t.includes("Reintentar"));
  });

  it("la línea de bajo mínimo no escribe lo que no hay", () => {
    assert.equal(lineaDeBajoMinimo({ nombre: "X", cantidad: "1.000", unidad: "Unidad", equivalencia: "1 uds", stockMinimo: null }), "X · 1 uds");
  });
});

describe("'Turno Turno': el título no repite la palabra", () => {
  const P = { tipo: "hoy" as const, desde: "2026-10-12", hasta: "2026-10-12" };

  it("un nombre sin 'turno' lleva 'Turno' adelante; uno que ya empieza con 'turno', no (sin mayúsculas ni acentos)", () => {
    assert.equal(tituloDeVentasDeTurno("Tarde", P, "Casiano"), "Turno Tarde · hoy · Casiano");
    for (const [nombre, esperado] of [
      ["Turno mañana", "Turno mañana"],
      ["turno noche", "turno noche"],
      ["TURNO Tarde", "TURNO Tarde"],
      ["Túrno x", "Túrno x"],
      ["Turno", "Turno"],
    ] as const) {
      assert.equal(nombreDeTurno(nombre), esperado, nombre);
      assert.ok(!/turno\s+turno/i.test(tituloDeVentasDeTurno(nombre, P, "Casiano").normalize("NFD").replace(/[̀-ͯ]/g, "")), nombre);
    }
    // CONTRAPRUEBA: una palabra que solo EMPIEZA igual no es "turno".
    assert.equal(nombreDeTurno("Turnos rotativos"), "Turno Turnos rotativos");
    assert.equal(nombreDeTurno("Mañana"), "Turno Mañana");
  });

  it("en la respuesta de ventas por turno, con el nombre que da el ERP", () => {
    const ver = (r: Parameters<typeof RespuestaDePreguntaVista>[0]["respuesta"]) => texto(dibujar(createElement(RespuestaDePreguntaVista, { respuesta: r, alReintentar: nada, zona: ZONA })));
    const turno = { turno: { id: 1, nombre: "Turno Mañana" }, sinTurnoAsignado: false, totales: { cantidadVentas: 0, totalVendido: "0.00", ventasEfectivo: "0.00", ventasPorMedio: [], ventasNoCobradas: [] }, cajas: [] };
    const t = ver({ estado: "VENTAS_TURNO", alcance: "LOCAL", periodo: P, turnoPedido: "mañana", turnoNoEncontrado: false, noSeparaPor: [], cajas: { local: CASIANO, fecha: "2026-10-12", turnos: [turno], advertencias: [] } });
    assert.ok(t.startsWith("Turno Mañana · hoy · Casiano"), t);
  });
});
