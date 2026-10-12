// CANDADOS DE LA INTERFAZ DE "PENDIENTES" (Tanda 9B), SIN NAVEGADOR.
//
// La tarjeta de un local y la de todos, las pills IMPORTANTE / NORMAL, los
// textos de las plantillas, "Nada pendiente", la fuente que faltó, el chip en
// Local y en General, la respuesta de la pregunta y su foto guardada, y el
// cliente HTTP. Los componentes se dibujan con react-dom/server. Los datos son
// los de los fixtures del ERP (pedidos de erp-ccf2894.json, cajas de
// erp-14ae247.json) pasados por las reglas de src/shared/chats/pendientes.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { pedirPendientes, pedirPendientesGeneral, RUTAS_DEL_CLIENTE } from "../../src/components/chats/clienteChats.ts";
import { AccionesDelLocal, AccionesDeGeneral } from "../../src/components/chats/Conversacion.tsx";
import { desdeHace, estadoDePedidoPendiente, motivoDeCajaPendiente, tituloDeCajaPendiente } from "../../src/components/chats/formato.ts";
import { reducirPendientes, type EstadoPendientes } from "../../src/components/chats/logica.ts";
import { ResultadoPendientes, TarjetaPendientes, TarjetaPendientesTodos } from "../../src/components/chats/Pendientes.tsx";
import { TEXTO_CUPO_ERP } from "../../src/components/chats/Piezas.tsx";
import { PreguntaGuardadaVista, RespuestaDePreguntaVista } from "../../src/components/chats/Preguntas.tsx";
import { RUTAS_CHATS, type PendientesDelLocal } from "../../src/shared/chats/api.ts";
import { ordenarPendientes, pendientesDeCajas, pendientesDePedidos, type PedidoDelErp } from "../../src/shared/chats/pendientes.ts";
import type { PreguntaGuardada } from "../../src/shared/chats/preguntas.ts";
import { cajasDelDiaDelFixture } from "../ayuda/cajas.ts";
import { FIXTURES_ERP_CCF2894 } from "../ayuda/servidorErp.ts";

const nada = () => {};
const dibujar = (e: ReactElement) => renderToStaticMarkup(e);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const PEDIDOS = (FIXTURES_ERP_CCF2894.varios.respuesta.cuerpo.datos as { pedidos: PedidoDelErp[] }).pedidos;
const CASIANO = { id: 3, nombre: "Casiano" };
/** Lo que mostraría Casiano con los pedidos del fixture (26 h) y las cajas de hoy del fixture. */
const DATOS: PendientesDelLocal = {
  local: CASIANO,
  pendientes: ordenarPendientes([...pendientesDePedidos(PEDIDOS), ...pendientesDeCajas(cajasDelDiaDelFixture("hoy", "Casiano"), "hoy")]),
  faltaron: [],
};
const tarjeta = (datos: PendientesDelLocal) => dibujar(createElement(TarjetaPendientes, { datos }));

describe("los textos de las plantillas", () => {
  it("la antigüedad: días desde las 24 h, horas antes, y menos de una hora", () => {
    assert.deepEqual([desdeHace(0), desdeHace(1), desdeHace(23), desdeHace(24), desdeHace(26), desdeHace(49), desdeHace(72)], [
      "menos de 1 h",
      "1 h",
      "23 h",
      "1 día",
      "1 día",
      "2 días",
      "3 días",
    ]);
    assert.equal(estadoDePedidoPendiente(26), "Pendiente de envío · desde hace 1 día");
    assert.equal(estadoDePedidoPendiente(5), "Pendiente de envío · desde hace 5 h");
    assert.equal(estadoDePedidoPendiente(null), "Pendiente de envío");
  });

  it("la caja: operador, turno y día; sin operador, el nombre del ERP; 'Sin turno asignado' como está", () => {
    const c = { operador: "Bruno", nombreCaja: "Caja de Bruno", turno: "Mañana", dia: "hoy" as const };
    assert.equal(tituloDeCajaPendiente(c), "Caja de Bruno · Turno Mañana · hoy");
    assert.equal(tituloDeCajaPendiente({ ...c, turno: "Turno noche", dia: "ayer" }), "Caja de Bruno · Turno noche · ayer");
    assert.equal(tituloDeCajaPendiente({ ...c, operador: null, nombreCaja: "Caja del turno #4" }), "Caja del turno #4 · Turno Mañana · hoy");
    assert.equal(tituloDeCajaPendiente({ ...c, turno: "Sin turno asignado" }), "Caja de Bruno · Sin turno asignado · hoy");
    assert.equal(motivoDeCajaPendiente({ motivo: "FALTA", monto: "1000.00" }), "Falta $ 1.000,00");
    assert.equal(motivoDeCajaPendiente({ motivo: "SOBRA", monto: "250.50" }), "Sobra $ 250,50");
    assert.equal(motivoDeCajaPendiente({ motivo: "FALTA_VERIFICAR", monto: null }), "Falta verificar en Tesorería");
  });
});

describe("la tarjeta de un local", () => {
  it("IMPORTANTE primero (pedidos de 26 h y faltantes), después NORMAL; cada fila con su pill", () => {
    const t = texto(tarjeta(DATOS));
    assert.equal(
      t,
      [
        "Pendientes · Casiano",
        "Caja de Bruno · Turno Mañana · hoy IMPORTANTE Falta $ 1.000,00",
        "Caja de Diego · Turno Tarde · hoy IMPORTANTE Falta $ 500,00",
        "Pedido #4 IMPORTANTE Pendiente de envío · desde hace 1 día A Depósito · 1 línea",
        "Pedido #7 IMPORTANTE Pendiente de envío · desde hace 1 día A Local B · 3 líneas",
        "Caja de Sofía · Sin turno asignado · hoy NORMAL Falta verificar en Tesorería",
        "Caja de Carla · Turno Mañana · hoy NORMAL Sobra $ 1.000,00",
      ].join(" "),
    );
  });

  it("la pill IMPORTANTE lleva la marca de alerta; NORMAL, no", () => {
    const html = tarjeta(DATOS);
    assert.equal((html.match(/class="ac-pill ac-pill--importante">IMPORTANTE</g) ?? []).length, 4);
    assert.equal((html.match(/class="ac-pill">NORMAL</g) ?? []).length, 2);
    assert.equal((html.match(/ac-pendiente--importante/g) ?? []).length, 4);
  });

  it("sin los botones del Figma: ni 'Ver detalle' ni 'Abrir en ERP', ni un enlace", () => {
    const html = tarjeta(DATOS);
    assert.doesNotMatch(html, /Ver detalle|Abrir en ERP|<a |<button/);
  });

  it("sin pendientes: 'Nada pendiente en {local}.'", () => {
    assert.equal(texto(tarjeta({ local: CASIANO, pendientes: [], faltaron: [] })), "Pendientes · Casiano Nada pendiente en Casiano.");
  });

  it("una fuente que faltó se dice debajo del título, y lo que llegó se muestra igual", () => {
    const t = texto(tarjeta({ ...DATOS, pendientes: DATOS.pendientes.filter((p) => p.tipo === "PEDIDO"), faltaron: ["CAJAS_HOY", "CAJAS_AYER"] }));
    assert.ok(t.startsWith("Pendientes · Casiano No se pudo consultar: las cajas de hoy, las cajas de ayer. La lista puede estar incompleta. Pedido #4"), t);
    // Faltó y no hay nada: el "nada pendiente" va con el aviso de que no se miró todo.
    const vacio = texto(tarjeta({ local: CASIANO, pendientes: [], faltaron: ["PEDIDOS"] }));
    assert.equal(vacio, "Pendientes · Casiano No se pudo consultar: los pedidos. La lista puede estar incompleta. Nada pendiente en Casiano.");
  });
});

describe("la tarjeta de todos (General)", () => {
  it("una sección por local, en el orden que manda el servidor (los que no tienen nada, al final)", () => {
    const norte: PendientesDelLocal = { local: { id: 4, nombre: "Norte" }, pendientes: [], faltaron: [] };
    const t = texto(dibujar(createElement(TarjetaPendientesTodos, { locales: [DATOS, norte] })));
    assert.ok(t.startsWith("Pendientes · Todos los locales Casiano Caja de Bruno"), t);
    assert.ok(t.endsWith("Norte Nada pendiente en Norte."), t);
  });
});

describe("el chip 'Pendientes'", () => {
  const QUIETO: EstadoPendientes = { fase: "QUIETO" };
  const local = (pendientes: { estado: EstadoPendientes; alPedir: () => void } | null) =>
    dibujar(createElement(AccionesDelLocal, { anuncia: true, estado: { fase: "QUIETO" }, alPedir: nada, pendientes }));

  it("en el Local: al final de la barra, junto a los demás, solo si el local lo anuncia", () => {
    const con = texto(local({ estado: QUIETO, alPedir: nada }));
    assert.ok(con.endsWith("Ventas Pendientes"), con);
    assert.doesNotMatch(texto(local(null)), /Pendientes/);
  });

  it("consultando: deshabilitado; con la tarjeta: abajo del historial", () => {
    assert.match(local({ estado: { fase: "CARGANDO" }, alPedir: nada }), /disabled="" aria-busy="true">Consultando pendientes…/);
    const lista = local({ estado: { fase: "LISTA", pendientes: { tipo: "LOCAL", datos: { estado: "OK", ...DATOS } } }, alPedir: nada });
    assert.match(texto(lista), /Pendientes · Casiano/);
  });

  it("en General: el chip con la caja de preguntas o sin ella; sin ningún local que lo anuncie, nada", () => {
    const preguntas = { preguntas: [], enviando: false, alEnviar: nada, alReintentar: nada };
    const general = (pendientes: { estado: EstadoPendientes; alPedir: () => void } | null, iaDisponible: boolean) =>
      dibujar(createElement(AccionesDeGeneral, { iaDisponible, preguntas, pendientes }));
    assert.match(texto(general({ estado: QUIETO, alPedir: nada }, false)), /^Pendientes$/);
    assert.match(general({ estado: QUIETO, alPedir: nada }, true), /Pendientes<\/button>.*<form/s);
    assert.equal(general(null, false), "");
    const todos = general({ estado: { fase: "LISTA", pendientes: { tipo: "TODOS", locales: [DATOS] } }, alPedir: nada }, false);
    assert.match(texto(todos), /^Pendientes · Todos los locales Casiano/);
  });

  it("la falla: Reintentar a mano; la del cupo, su texto", () => {
    const f = (cupo: boolean) => texto(dibujar(createElement(ResultadoPendientes, { estado: { fase: "FALLA", cupo }, alReintentar: nada })));
    assert.match(f(false), /Reintentar/);
    assert.ok(f(true).includes(TEXTO_CUPO_ERP));
  });

  it("el reductor: una consulta por toque, y la respuesta vieja no pisa una nueva", () => {
    const lista = { tipo: "LOCAL" as const, datos: { estado: "OK" as const, ...DATOS } };
    const cargando = reducirPendientes({ fase: "QUIETO" }, { tipo: "PEDIR" });
    assert.equal(cargando.fase, "CARGANDO");
    assert.equal(reducirPendientes(cargando, { tipo: "RESPUESTA", resultado: { ok: true, datos: lista } }).fase, "LISTA");
    assert.deepEqual(reducirPendientes({ fase: "QUIETO" }, { tipo: "RESPUESTA", resultado: { ok: true, datos: lista } }), { fase: "QUIETO" });
    assert.deepEqual(reducirPendientes(cargando, { tipo: "RESPUESTA", resultado: { ok: false, falla: { estado: "ERP_CUPO_EXCEDIDO" } } }), { fase: "FALLA", cupo: true });
  });
});

describe("la pregunta, y su foto guardada", () => {
  it("la misma tarjeta que el chip, de un local y de todos", () => {
    const uno = texto(dibujar(createElement(RespuestaDePreguntaVista, { respuesta: { estado: "PENDIENTES", alcance: "LOCAL", resultado: DATOS }, alReintentar: nada })));
    assert.equal(uno, texto(tarjeta(DATOS)));
    const todos = texto(dibujar(createElement(RespuestaDePreguntaVista, { respuesta: { estado: "PENDIENTES", alcance: "TODOS", locales: [DATOS] }, alReintentar: nada })));
    assert.ok(todos.startsWith("Pendientes · Todos los locales Casiano"));
  });

  it("guardada: la foto, con la pregunta y cuándo se preguntó", () => {
    const guardada: PreguntaGuardada = { id: "9", pregunta: "¿Qué está pendiente?", creadaEn: "2026-10-12T13:00:00.000Z", respuesta: { estado: "PENDIENTES", alcance: "LOCAL", resultado: DATOS } };
    const t = texto(dibujar(createElement(PreguntaGuardadaVista, { guardada, zona: "America/Argentina/Buenos_Aires" })));
    assert.match(t, /¿Qué está pendiente\?/);
    assert.match(t, /Pendientes · Casiano Caja de Bruno/);
  });
});

describe("el cliente HTTP", () => {
  it("las dos rutas son las declaradas, y el local va por query", async () => {
    assert.equal(RUTAS_DEL_CLIENTE.pendientes, RUTAS_CHATS.pendientes);
    assert.equal(RUTAS_DEL_CLIENTE.pendientesGeneral, RUTAS_CHATS.pendientesGeneral);
    const pedidos: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      pedidos.push(url);
      return new Response(JSON.stringify({ estado: "OK", local: CASIANO, pendientes: [], faltaron: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await pedirPendientes(3);
      assert.ok(r.ok);
      await pedirPendientesGeneral();
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(pedidos, ["/api/chats/pendientes?localId=3", "/api/chats/pendientes/general"]);
  });
});
