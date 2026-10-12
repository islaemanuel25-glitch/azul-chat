// CANDADOS DE LA INTERFAZ DE "BUSCAR" (Tanda 10), SIN NAVEGADOR.
//
// La pantalla en sus estados —sin buscar, buscando, "No encontré «X»", con
// resultados y su contador, "Ver más", la falla—, las pills, el campo que
// busca solo al enviar, la lupa del Local y de General, la vista por la URL,
// el estado de la búsqueda y el cliente HTTP. Los componentes se dibujan con
// react-dom/server. Los eventos son los reales de Casiano del fixture
// erp-25172fe.json, como los entrega la API (historial.ts, aEventoPublico).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampoBusqueda, CuerpoBusqueda, FiltrosBusqueda, PantallaBuscar } from "../../src/components/chats/Buscar.tsx";
import { pedirBuscar, RUTAS_DEL_CLIENTE } from "../../src/components/chats/clienteChats.ts";
import { PantallaGeneral, PantallaLocal } from "../../src/components/chats/Conversacion.tsx";
import { cantidadDeResultados, noEncontre } from "../../src/components/chats/formato.ts";
import { chatDeBusqueda, leerVista, reducirBusqueda, urlDeVista, type EstadoBusqueda, type Vista } from "../../src/components/chats/logica.ts";
import { comprobarAlAbrir } from "../../src/components/chats/version.ts";
import { RUTAS_CHATS, type EventoPublico } from "../../src/shared/chats/api.ts";
import { coincideTexto, leerTextoDeBusqueda, normalizar, type ResultadoBusqueda } from "../../src/shared/chats/buscar.ts";
import { EJEMPLOS_DE_PREGUNTAS } from "../../src/shared/chats/preguntas.ts";
import { resumenDeEvento } from "../../src/shared/chats/textos.ts";

const nada = () => {};
const dibujar = (e: ReactElement) => renderToStaticMarkup(e);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const ZONA = "America/Argentina/Buenos_Aires";
const AHORA = new Date("2026-10-08T12:00:00.000Z");

const CASIANO = { localId: 3, nombre: "Casiano" };
/** El 182 real del fixture: recibido de Depósito Central, con diferencias. */
const E182: EventoPublico = {
  id: "3",
  tipo: "TRANSFERENCIA_RECIBIDA",
  fecha: "2026-10-07T13:30:15.250Z",
  historico: true,
  transferenciaId: 182,
  origen: { id: 9, nombre: "Depósito Central", esDeposito: true },
  destino: { id: 3, nombre: "Casiano" },
  tieneDiferencias: true,
  lineasConDiferencia: 2,
};
const P182: ResultadoBusqueda = {
  tipo: "PREGUNTA",
  guardada: { id: "7", pregunta: "¿Qué pasó con la 182?", creadaEn: "2026-10-08T11:00:00.000Z", respuesta: { estado: "NO_ENTIENDO", ejemplos: [...EJEMPLOS_DE_PREGUNTAS] } },
  local: CASIANO,
};
const RESULTADOS: ResultadoBusqueda[] = [P182, { tipo: "EVENTO", evento: E182, local: CASIANO }];
const lista = (o: Partial<Extract<EstadoBusqueda, { fase: "LISTA" }>> = {}): EstadoBusqueda => ({
  fase: "LISTA",
  texto: "182",
  filtro: "todos",
  total: 2,
  resultados: RESULTADOS,
  siguiente: null,
  mas: "QUIETO",
  ...o,
});
const cuerpo = (estado: EstadoBusqueda, general = false) =>
  dibujar(createElement(CuerpoBusqueda, { estado, general, alReintentar: nada, alVerMas: nada, alVolver: nada, ahora: AHORA, zona: ZONA }));

describe("leer lo que se busca", () => {
  it("un número con o sin #, y el mismo número dentro del texto de una pregunta, entero", () => {
    assert.deepEqual(leerTextoDeBusqueda("182"), { tipo: "NUMERO", n: 182, digitos: "182" });
    assert.deepEqual(leerTextoDeBusqueda(" #182 "), { tipo: "NUMERO", n: 182, digitos: "182" });
    assert.deepEqual(leerTextoDeBusqueda("# 0182"), { tipo: "NUMERO", n: 182, digitos: "182" });
    // Más grande que un id del ERP: no hay evento posible, pero una pregunta lo puede contener.
    assert.deepEqual(leerTextoDeBusqueda("99999999999"), { tipo: "NUMERO", n: null, digitos: "99999999999" });
    const n = leerTextoDeBusqueda("182")!;
    assert.ok(coincideTexto(n, "¿Qué pasó con la #182?"));
    assert.ok(coincideTexto(n, "la 0182"));
    assert.ok(!coincideTexto(n, "la 1820"));
    assert.ok(!coincideTexto(n, "la 3182"));
  });

  it("un texto: sin mayúsculas ni acentos, con los espacios juntados", () => {
    assert.equal(normalizar("  Depósito   CENTRAL  "), "deposito central");
    assert.equal(normalizar("Ñandú"), "nandu");
    const t = leerTextoDeBusqueda("DEPOSITO")!;
    assert.deepEqual(t, { tipo: "TEXTO", normalizado: "deposito" });
    assert.ok(coincideTexto(t, "¿Qué llegó del Depósito?"));
    assert.ok(!coincideTexto(t, "¿Qué llegó de Belgrano?"));
  });

  it("vacío, solo espacios, más de 60 caracteres o con caracteres de control: no se busca", () => {
    for (const malo of ["", "   ", "a".repeat(61), "a\u0000b", "a\nb"]) assert.equal(leerTextoDeBusqueda(malo), null, JSON.stringify(malo));
    assert.ok(leerTextoDeBusqueda("á".repeat(60)));
  });

  it("el título de un evento no cambió al sacar sus palabras a una tabla", () => {
    assert.equal(resumenDeEvento(E182), "Transferencia #182 recibida con diferencias");
    assert.equal(resumenDeEvento({ ...E182, tieneDiferencias: false }), "Transferencia #182 recibida");
    assert.equal(resumenDeEvento({ id: "1", fecha: E182.fecha, historico: false, tipo: "PEDIDO_SOLICITADO", pedidoId: 91, origen: { id: 9, nombre: "D" }, lineas: 1 }), "Pedido #91 solicitado");
    assert.equal(resumenDeEvento({ id: "1", fecha: E182.fecha, historico: false, tipo: "TRANSFERENCIA_ENVIADA", transferenciaId: 184, origen: { id: 9, nombre: "D" }, lineas: 1 }), "Transferencia #184 enviada");
    assert.equal(resumenDeEvento({ id: "1", fecha: E182.fecha, historico: false, tipo: "TRANSFERENCIA_CANCELADA", transferenciaId: 184, origen: { id: 9, nombre: "D" } }), "Transferencia #184 cancelada");
  });
});

describe("la pantalla", () => {
  it("sin buscar: dice qué se puede buscar; buscando: lo dice", () => {
    assert.match(texto(cuerpo({ fase: "QUIETO" })), /Buscá por número de transferencia o de pedido, o por texto/);
    assert.match(cuerpo({ fase: "BUSCANDO", texto: "182", filtro: "todos" }), /aria-busy="true"[^>]*>.*Buscando…/s);
  });

  it("sin resultados: 'No encontré «X».', sin contador", () => {
    const t = texto(cuerpo(lista({ texto: "fernet", total: 0, resultados: [] })));
    assert.equal(t, "No encontré «fernet».");
    assert.equal(noEncontre("fernet", "Casiano"), "No encontré «fernet» en Casiano.", "el de stock sigue igual");
  });

  it("con resultados: el contador del TOTAL, del más nuevo al más viejo, con el día, la misma tarjeta del chat y la pregunta como foto", () => {
    const t = texto(cuerpo(lista({ total: 37 })));
    assert.ok(t.startsWith("37 resultados Hoy ¿Qué pasó con la 182?"), t);
    assert.match(t, /Respuesta del 8\/10 a las 08:00 Ayer ⚠ Transferencia #182 recibida con diferencias 2 líneas con diferencias · Desde Depósito Central · 10:30/);
    assert.doesNotMatch(t, /Casiano/, "en un Local no se repite el local");
    assert.equal(cantidadDeResultados(1), "1 resultado");
    assert.equal(cantidadDeResultados(1234), "1.234 resultados");
  });

  it("en General, el local arriba de cada resultado; una pregunta hecha en General dice General", () => {
    const enGeneral: ResultadoBusqueda = { ...P182, local: null } as ResultadoBusqueda;
    const t = texto(cuerpo(lista({ resultados: [enGeneral, ...RESULTADOS] }), true));
    assert.match(t, /Hoy General ¿Qué pasó con la 182\?.* Casiano ¿Qué pasó con la 182\?.* Ayer Casiano ⚠ Transferencia #182 recibida/);
  });

  it("'Ver más' solo si hay siguiente; cargando, deshabilitado; sin red, lo dice y lo de antes sigue", () => {
    assert.doesNotMatch(cuerpo(lista()), /Ver más/);
    assert.match(cuerpo(lista({ siguiente: "abc" })), />Ver más</);
    assert.match(cuerpo(lista({ siguiente: "abc", mas: "CARGANDO" })), /disabled=""[^>]*>Cargando…/);
    const sinRed = texto(cuerpo(lista({ siguiente: "abc", mas: "SIN_RED" })));
    assert.match(sinRed, /Transferencia #182 .* No se pudieron cargar\. Probá de nuevo\./);
  });

  it("una falla reemplaza los resultados: ERP caído, cupo, sin acceso", () => {
    const falla = (estado: string) => texto(cuerpo({ fase: "FALLA", texto: "182", filtro: "todos", falla: { estado } as never }));
    assert.match(falla("ERP_NO_DISPONIBLE"), /^ERP Azul no responde/);
    assert.match(falla("ERP_CUPO_EXCEDIDO"), /^Muchas consultas seguidas al ERP/);
    assert.match(falla("NO_AUTORIZADO"), /^Sin acceso Este chat no está entre los que podés ver hoy\. Volver$/);
    assert.doesNotMatch(falla("ERP_NO_DISPONIBLE"), /182/);
  });

  it("las pills: Todos · Transferencias · Pedidos · Preguntas, con la elegida marcada; sin Caja ni Ventas", () => {
    const html = dibujar(createElement(FiltrosBusqueda, { filtro: "pedidos", alCambiar: nada }));
    assert.equal(texto(html), "Todos Transferencias Pedidos Preguntas");
    assert.match(html, /aria-pressed="true"[^>]*>Pedidos</);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  });

  it("el campo busca al ENVIAR: es un formulario con su botón, y no reacciona a cada tecla", () => {
    const html = dibujar(createElement(CampoBusqueda, { buscando: false, alBuscar: nada }));
    assert.match(html, /<form[^>]*role="search"/);
    assert.match(html, /<input[^>]*maxLength="60"/);
    assert.match(html, /<button type="submit"[^>]*aria-label="Buscar"[^>]*disabled=""/, "vacío, el botón no busca");
    const fuente = CampoBusqueda.toString();
    assert.match(fuente, /onSubmit/);
    assert.doesNotMatch(fuente, /alBuscar\([^)]*\)[^;]*onChange|onChange[^}]*alBuscar/, "escribir no busca");
  });

  it("la pantalla entera: título Buscar, el chat abajo del título, Volver al chat, el campo, las pills y el estado inicial", () => {
    const local = texto(dibujar(createElement(PantallaBuscar, { ambito: { tipo: "LOCAL", localId: 3 }, nombre: "Casiano", alVolver: nada, alPerderSesion: nada })));
    assert.match(local, /^‹ Buscar Casiano ⌕ Todos/);
    assert.match(local, /Todos Transferencias Pedidos Preguntas Buscá por número/);
    assert.match(dibujar(createElement(PantallaBuscar, { ambito: { tipo: "GENERAL" }, alVolver: nada, alPerderSesion: nada })), /aria-label="Volver al chat"/);
    const general = texto(dibujar(createElement(PantallaBuscar, { ambito: { tipo: "GENERAL" }, alVolver: nada, alPerderSesion: nada })));
    assert.match(general, /^‹ Buscar General ⌕ Todos/);
  });

  it("la lupa: en el encabezado del Local y de General, solo si la app la pide; la lista de chats no tiene", () => {
    const conLupa = (e: ReactElement) => /aria-label="Buscar en el historial"[^>]*>.*⌕/s.test(dibujar(e));
    assert.ok(conLupa(createElement(PantallaLocal, { localId: 3, alVolver: nada, alPerderSesion: nada, alBuscar: nada })));
    assert.ok(conLupa(createElement(PantallaGeneral, { alVolver: nada, alPerderSesion: nada, alBuscar: nada })));
    assert.ok(!conLupa(createElement(PantallaLocal, { localId: 3, alVolver: nada, alPerderSesion: nada })), "CONTRAPRUEBA: sin alBuscar no hay lupa");
  });
});

describe("la vista por la URL", () => {
  it("?vista=buscar&localId=N[&nombre=…] y ?vista=buscar&general=1, de ida y vuelta; 'Volver' va a ese chat", () => {
    const vistas: Vista[] = [
      { tipo: "BUSCAR", chat: { tipo: "LOCAL", localId: 3 } },
      { tipo: "BUSCAR", chat: { tipo: "LOCAL", localId: 9, nombre: "Depósito Central" } },
      { tipo: "BUSCAR", chat: { tipo: "GENERAL" } },
    ];
    assert.equal(urlDeVista(vistas[0]!), "/?vista=buscar&localId=3");
    assert.equal(urlDeVista(vistas[2]!), "/?vista=buscar&general=1");
    for (const v of vistas) assert.deepEqual(leerVista(urlDeVista(v).slice(1)), v);
    assert.deepEqual(chatDeBusqueda(vistas[1] as Extract<Vista, { tipo: "BUSCAR" }>), { tipo: "LOCAL", localId: 9, nombre: "Depósito Central" });
    assert.deepEqual(chatDeBusqueda(vistas[2] as Extract<Vista, { tipo: "BUSCAR" }>), { tipo: "GENERAL" });
  });

  it("una URL de buscar mal formada es la lista", () => {
    for (const malo of ["?vista=buscar", "?vista=buscar&general=2", "?vista=buscar&localId=0", "?vista=buscar&localId=3&general=1", "?vista=buscar&localId=x"]) {
      assert.deepEqual(leerVista(malo), { tipo: "CHATS" }, malo);
    }
  });

  it("abrir Buscar comprueba la versión, como abrir un chat", () => {
    let veces = 0;
    comprobarAlAbrir({ tipo: "BUSCAR", chat: { tipo: "GENERAL" } }, { comprobar: async () => void veces++ } as never);
    assert.equal(veces, 1);
  });
});

describe("el estado de la búsqueda", () => {
  const ok = (resultados: ResultadoBusqueda[], siguiente: string | null, total = 3) => ({ ok: true as const, datos: { estado: "OK" as const, total, resultados, siguiente } });

  it("buscar reemplaza lo anterior; 'Ver más' agrega sin repetir; una respuesta que llega sin búsqueda en curso no cambia nada", () => {
    let e = reducirBusqueda({ fase: "QUIETO" }, { tipo: "BUSCAR", texto: "182", filtro: "todos" });
    e = reducirBusqueda(e, { tipo: "RESPUESTA", resultado: ok(RESULTADOS, "c1") });
    assert.equal(e.fase, "LISTA");
    e = reducirBusqueda(e, { tipo: "PIDIENDO_MAS" });
    e = reducirBusqueda(e, { tipo: "MAS", resultado: ok([RESULTADOS[1]!, { ...P182, guardada: { ...P182.guardada, id: "8" } } as ResultadoBusqueda], null) });
    assert.ok(e.fase === "LISTA");
    assert.deepEqual(
      e.resultados.map((r) => (r.tipo === "EVENTO" ? `e${r.evento.id}` : `p${r.guardada.id}`)),
      ["p7", "e3", "p8"],
    );
    assert.equal(e.siguiente, null);
    assert.deepEqual(reducirBusqueda(e, { tipo: "RESPUESTA", resultado: ok([], null) }), e);
    const otra = reducirBusqueda(e, { tipo: "BUSCAR", texto: "deposito", filtro: "transferencias" });
    assert.deepEqual(otra, { fase: "BUSCANDO", texto: "deposito", filtro: "transferencias" });
  });

  it("una falla al buscar es la falla; sin red en 'Ver más', lo de antes sigue; otra falla en 'Ver más' la reemplaza", () => {
    const buscando = reducirBusqueda({ fase: "QUIETO" }, { tipo: "BUSCAR", texto: "182", filtro: "todos" });
    assert.equal(reducirBusqueda(buscando, { tipo: "RESPUESTA", resultado: { ok: false, falla: { estado: "ERP_NO_DISPONIBLE" } } }).fase, "FALLA");
    const pidiendo = reducirBusqueda(lista({ siguiente: "c" }), { tipo: "PIDIENDO_MAS" });
    const sinRed = reducirBusqueda(pidiendo, { tipo: "MAS", resultado: { ok: false, falla: { estado: "RED" } } });
    assert.ok(sinRed.fase === "LISTA" && sinRed.mas === "SIN_RED" && sinRed.resultados.length === 2);
    assert.equal(reducirBusqueda(pidiendo, { tipo: "MAS", resultado: { ok: false, falla: { estado: "ERP_NO_DISPONIBLE" } } }).fase, "FALLA");
  });
});

describe("el cliente HTTP", () => {
  it("la ruta es la declarada; texto, filtro, el chat y el cursor van por query, exactos", async () => {
    assert.equal(RUTAS_DEL_CLIENTE.buscar, RUTAS_CHATS.buscar);
    const pedidos: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      pedidos.push(url);
      return new Response(JSON.stringify({ estado: "OK", total: 0, resultados: [], siguiente: null }), { status: 200 });
    }) as typeof fetch;
    try {
      assert.ok((await pedirBuscar({ texto: "#182", filtro: "todos", ambito: { tipo: "LOCAL", localId: 3 }, cursor: null })).ok);
      await pedirBuscar({ texto: "depósito", filtro: "pedidos", ambito: { tipo: "GENERAL" }, cursor: "eyJmIjoxfQ" });
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(pedidos, [
      "/api/chats/buscar?texto=%23182&filtro=todos&localId=3",
      "/api/chats/buscar?texto=dep%C3%B3sito&filtro=pedidos&general=1&cursor=eyJmIjoxfQ",
    ]);
  });
});
