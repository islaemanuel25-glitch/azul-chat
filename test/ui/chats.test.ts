// CANDADOS DE LA INTERFAZ DE CHATS (Tanda 2C), SIN NAVEGADOR.
//
// Tres niveles, todos en node:test:
//
//   · la lógica pura (components/chats/logica.ts y formato.ts): qué filas, qué
//     orden, qué se marca leído, qué se hace con cada falla;
//   · los componentes dibujados con react-dom/server (renderToStaticMarkup):
//     el primer render, sin efectos, con los datos que les llegan. Los .tsx se
//     cargan con test/ayuda/tsx.mjs;
//   · el cliente HTTP (clienteChats.ts) con un `fetch` de prueba: a qué URL va,
//     qué manda y cómo lee cada respuesta.
//
// Los datos tienen la forma EXACTA del contrato (`satisfies` con los tipos de
// src/shared/chats/api.ts, que `npm run typecheck` controla) y los eventos son
// los del fixture real del ERP (transferencias 180–183 de Casiano). La forma
// que devuelve la API la fijan los candados de test/db/chats.test.ts.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { marcarLeido, pedirChats, pedirGeneral, pedirLocal, RUTAS_DEL_CLIENTE } from "../../src/components/chats/clienteChats.ts";
import { CuerpoConversacion, ListaDeEventos } from "../../src/components/chats/Conversacion.tsx";
import { detalleDeDiferencias, etiquetaDeDia, formatearHora, formatearMomento, iniciales, resumenDeEvento } from "../../src/components/chats/formato.ts";
import {
  decidirLecturaLocal,
  destinoDeFalla,
  filasDeChats,
  leerVista,
  ordenCronologico,
  reducirConversacion,
  unirPaginas,
  urlDeVista,
  type EstadoConversacion,
  type InfoLocal,
} from "../../src/components/chats/logica.ts";
import { CuerpoChats, type Estado as EstadoChats } from "../../src/components/chats/PantallaChats.tsx";
import { TarjetaEvento } from "../../src/components/chats/Piezas.tsx";
import { RUTAS_CHATS, type EventoGeneral, type EventoPublico, type RespuestaChats } from "../../src/shared/chats/api.ts";

const ZONA = "America/Argentina/Buenos_Aires";
/** "Ahora": 2026-10-07 18:30 en Buenos Aires. */
const AHORA = new Date("2026-10-07T21:30:00.000Z");
const nada = () => {};

const DEPOSITO = { id: 9, nombre: "Depósito Central", esDeposito: true } as const;
const CASIANO = { id: 3, nombre: "Casiano" } as const;

const evento = (id: string, transferenciaId: number, fecha: string, extra: Partial<EventoPublico> = {}): EventoPublico =>
  ({
    id,
    tipo: "TRANSFERENCIA_RECIBIDA",
    fecha,
    transferenciaId,
    origen: DEPOSITO,
    destino: CASIANO,
    tieneDiferencias: false,
    lineasConDiferencia: 0,
    ...extra,
  }) satisfies EventoPublico;

const enLocal = (e: EventoPublico, localId: number, nombre: string): EventoGeneral =>
  ({ ...e, destino: { id: localId, nombre }, local: { localId, nombre } }) satisfies EventoGeneral;

// Los cuatro reales de Casiano: 181 y 182 en el mismo milisegundo.
const E180 = evento("1", 180, "2026-10-07T12:00:00.000Z");
const E181 = evento("2", 181, "2026-10-07T13:30:15.250Z", { tieneDiferencias: true, lineasConDiferencia: 2 });
const E182 = evento("3", 182, "2026-10-07T13:30:15.250Z", { tieneDiferencias: true, lineasConDiferencia: 3 });
const E183 = evento("4", 183, "2026-10-07T14:10:00.000Z", { origen: { id: 5, nombre: "Belgrano", esDeposito: false } });
/** Como los devuelve la API: del más reciente al más antiguo. */
const PAGINA_API = [E183, E182, E181, E180];

type ChatsOk = Extract<RespuestaChats, { estado: "OK" }>;
const CHATS: ChatsOk = {
  estado: "OK",
  usuario: { nombre: "Emanuel" },
  general: { noLeidos: 2, ultimoEvento: enLocal(E183, 3, "Casiano") },
  locales: [
    { localId: 3, nombre: "Casiano", esDeposito: false, ultimoEvento: E183, noLeidos: 2, sincronizacion: "AL_DIA" },
    { localId: 9, nombre: "Depósito Central", esDeposito: true, ultimoEvento: null, noLeidos: 0, sincronizacion: "DEMORADA" },
    { localId: 20, nombre: "Centro", esDeposito: false, ultimoEvento: null, noLeidos: 0, sincronizacion: "AL_DIA" },
  ],
} satisfies RespuestaChats;

const dibujar = (e: ReactElement) => renderToStaticMarkup(e);
/** El texto visible, sin etiquetas. */
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const cuerpoChats = (estado: EstadoChats, filtro: "TODOS" | "NO_LEIDOS" = "TODOS") =>
  dibujar(createElement(CuerpoChats, { estado, filtro, alCambiarFiltro: nada, alAbrir: nada, alReintentar: nada, ahora: AHORA, zona: ZONA }));

type EstLocal = EstadoConversacion<EventoPublico, InfoLocal>;
const INFO_LOCAL: InfoLocal = { tipo: "LOCAL", localId: 3, nombre: "Casiano", sincronizacion: "AL_DIA", leidoHasta: "2", noLeidos: 2 };
const lista = (eventos: readonly EventoPublico[], extra: Partial<Extract<EstLocal, { fase: "LISTA" }>> = {}): EstLocal => ({
  fase: "LISTA",
  eventos,
  siguiente: null,
  anteriores: "QUIETO",
  info: INFO_LOCAL,
  ...extra,
});
const cuerpoLocal = (estado: EstLocal, masSinLeer = false) =>
  dibujar(
    createElement(CuerpoConversacion<EventoPublico, InfoLocal>, {
      estado,
      masSinLeer,
      vacio: "Todavía no hay eventos.",
      alReintentar: nada,
      alVolver: nada,
      alCargarAnteriores: nada,
      ahora: AHORA,
      zona: ZONA,
    }),
  );

// ─────────────────────────────────────────────────────────────────────────────

describe("la lista de chats", () => {
  it("A/B. General primero y después exactamente los locales de la API, en su orden", () => {
    const filas = filasDeChats(CHATS, "TODOS");
    assert.deepEqual(
      filas.map((f) => (f.tipo === "GENERAL" ? "General" : f.local.nombre)),
      ["General", "Casiano", "Depósito Central", "Centro"],
    );
    const html = cuerpoChats({ fase: "LISTA", datos: CHATS });
    const nombres = [...html.matchAll(/class="ac-fila__nombre">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(nombres, ["General", "Casiano", "Depósito Central", "Centro"]);
    // Ningún local conocido de memoria: con otra respuesta, otros nombres.
    const otra: ChatsOk = { ...CHATS, locales: [{ ...CHATS.locales[0]!, localId: 77, nombre: "Mini el 7" }] };
    assert.deepEqual([...cuerpoChats({ fase: "LISTA", datos: otra }).matchAll(/class="ac-fila__nombre">([^<]*)</g)].map((m) => m[1]), ["General", "Mini el 7"]);
  });

  it("C. el badge aparece solo con noLeidos > 0, con texto para lectores de pantalla", () => {
    const html = cuerpoChats({ fase: "LISTA", datos: CHATS });
    assert.equal([...html.matchAll(/class="ac-badge"/g)].length, 2, "General y Casiano");
    assert.match(html, /2 sin leer/);
    const sinNada: ChatsOk = { ...CHATS, general: { ...CHATS.general, noLeidos: 0 }, locales: CHATS.locales.map((l) => ({ ...l, noLeidos: 0 })) };
    assert.doesNotMatch(cuerpoChats({ fase: "LISTA", datos: sinNada }), /ac-badge/);
  });

  it("D. DEMORADA se indica sin ocultar el local ni su último evento; un local sin eventos dice 'Sin novedades'", () => {
    const html = cuerpoChats({ fase: "LISTA", datos: CHATS });
    assert.match(texto(html), /Depósito Central Sin novedades Actualización demorada/);
    const conEvento: ChatsOk = { ...CHATS, locales: [{ ...CHATS.locales[0]!, sincronizacion: "DEMORADA" }] };
    const t = texto(cuerpoChats({ fase: "LISTA", datos: conEvento }));
    assert.match(t, /Casiano Transferencia #183 recibida Actualización demorada/);
    assert.doesNotMatch(t, /desconect|sin conexión/i);
  });

  it("General resume su último evento con el nombre del local; el filtro 'No leídos' es local y no inventa nada", () => {
    const t = texto(cuerpoChats({ fase: "LISTA", datos: CHATS }));
    assert.match(t, /General Casiano: Transferencia #183 recibida 11:10/);
    assert.deepEqual(
      filasDeChats(CHATS, "NO_LEIDOS").map((f) => (f.tipo === "GENERAL" ? "General" : f.local.nombre)),
      ["General", "Casiano"],
    );
    const html = cuerpoChats({ fase: "LISTA", datos: CHATS });
    assert.match(html, /aria-pressed="true"[^>]*>Todos</);
    assert.doesNotMatch(html, /Pendientes|Buscar/, "sin controles de lo que no existe");
  });
});

describe("el evento de transferencia", () => {
  it("E/F. el resumen sale de un único formateador", () => {
    assert.equal(resumenDeEvento(E180), "Transferencia #180 recibida");
    assert.equal(resumenDeEvento(E182), "Transferencia #182 recibida con diferencias");
  });

  it("G/H. habla de LÍNEAS con diferencia, en singular y plural; sin diferencias, nada", () => {
    assert.equal(detalleDeDiferencias({ tieneDiferencias: true, lineasConDiferencia: 1 }), "1 línea con diferencia");
    assert.equal(detalleDeDiferencias({ tieneDiferencias: true, lineasConDiferencia: 3 }), "3 líneas con diferencias");
    assert.equal(detalleDeDiferencias({ tieneDiferencias: false, lineasConDiferencia: 0 }), null);
    const t = texto(dibujar(createElement(TarjetaEvento, { evento: E182, zona: ZONA })));
    assert.equal(t, "⚠ Transferencia #182 recibida con diferencias 3 líneas con diferencias · Desde Depósito Central · 10:30");
    assert.doesNotMatch(t, /productos/);
  });

  it("I/J. la tarjeta no ofrece 'Ver diferencias' ni 'Abrir en ERP', ni ids internos", () => {
    const html = dibujar(createElement(TarjetaEvento, { evento: enLocal(E182, 3, "Casiano"), local: "Casiano", zona: ZONA }));
    assert.doesNotMatch(html, /Ver diferencias|Abrir en ERP|<button|<a /);
    assert.doesNotMatch(html, /claveExterna|eventoId|payload|>3</);
  });
});

describe("una conversación", () => {
  it("U. se lee como chat: del más viejo al más nuevo, y a igual fecha por id, aunque la API mande al revés", () => {
    assert.deepEqual(ordenCronologico(PAGINA_API).map((e) => e.transferenciaId), [180, 181, 182, 183]);
    const t = texto(dibujar(createElement(ListaDeEventos<EventoPublico>, { eventos: PAGINA_API, ahora: AHORA, zona: ZONA })));
    assert.ok(t.indexOf("#180") < t.indexOf("#181") && t.indexOf("#181") < t.indexOf("#182") && t.indexOf("#182") < t.indexOf("#183"));
    assert.match(t, /^Hoy /, "con su separador de día");
  });

  it("S/T. cargar anteriores conserva lo que había y no repite eventos", () => {
    let e: EstLocal = lista([E183, E182], { siguiente: "c1" });
    e = reducirConversacion(e, { tipo: "PIDIENDO_ANTERIORES" });
    assert.equal(e.fase === "LISTA" && e.anteriores, "CARGANDO");
    // La página anterior repite el 182 (por ejemplo, si llegó dos veces): no se duplica.
    e = reducirConversacion(e, { tipo: "ANTERIORES", eventos: [E182, E181, E180], siguiente: null });
    assert.equal(e.fase, "LISTA");
    if (e.fase !== "LISTA") return;
    assert.deepEqual(e.eventos.map((x) => x.id), ["4", "3", "2", "1"]);
    assert.equal(e.siguiente, null);
    assert.deepEqual(unirPaginas([E183], [E183, E180]).map((x) => x.id), ["4", "1"]);
  });

  it("'Cargar anteriores' es un botón con etiqueta, solo si hay más; vacío dice lo que corresponde", () => {
    assert.match(cuerpoLocal(lista(PAGINA_API, { siguiente: "c" })), /<button[^>]*aria-label="Cargar eventos anteriores"[^>]*>Cargar anteriores</);
    assert.doesNotMatch(cuerpoLocal(lista(PAGINA_API)), /Cargar anteriores/);
    assert.equal(texto(cuerpoLocal(lista([]))), "Todavía no hay eventos.");
    assert.match(cuerpoLocal({ fase: "CARGANDO" }), /aria-busy="true"/);
  });

  it("P/Q. ERP_NO_DISPONIBLE reemplaza la vista: sin historial detrás, con el texto P1 y Reintentar", () => {
    let e: EstLocal = lista(PAGINA_API, { siguiente: "c", anteriores: "CARGANDO" });
    e = reducirConversacion(e, { tipo: "FALLA", falla: { estado: "ERP_NO_DISPONIBLE" } });
    assert.deepEqual(e, { fase: "FALLA", falla: { estado: "ERP_NO_DISPONIBLE" } }, "no queda ningún evento en el estado");
    const t = texto(cuerpoLocal(e));
    assert.equal(t, "ERP Azul no responde Para ver el historial hace falta verificar tu acceso. Reintentar");
    assert.doesNotMatch(t, /Transferencia|Podés leer historial/);
    const chats = texto(cuerpoChats({ fase: "FALLA", falla: { estado: "ERP_NO_DISPONIBLE" } }));
    assert.equal(chats, "ERP Azul no responde Para ver el historial hace falta verificar tu acceso. Reintentar");
  });

  it("sin red al pedir anteriores, lo que ya se ve sigue (no es una respuesta sobre el acceso); cualquier respuesta mala de la API, no", () => {
    const base = lista(PAGINA_API, { siguiente: "c", anteriores: "CARGANDO" });
    const sinRed = reducirConversacion(base, { tipo: "FALLA", falla: { estado: "RED" } });
    assert.equal(sinRed.fase === "LISTA" && sinRed.anteriores, "SIN_RED");
    for (const estado of ["SERVICIO_NO_DISPONIBLE", "NO_AUTORIZADO", "ERP_NO_DISPONIBLE"] as const) {
      assert.equal(reducirConversacion(base, { tipo: "FALLA", falla: { estado } }).fase, "FALLA", estado);
    }
    assert.equal(reducirConversacion(base, { tipo: "FALLA", falla: { estado: "CANCELADA" } }), base);
  });

  it("DEMORADA en una conversación: se ve lo guardado y un aviso discreto", () => {
    const html = dibujar(
      createElement(CuerpoConversacion<EventoPublico, InfoLocal>, {
        estado: lista(PAGINA_API),
        vacio: "x",
        aviso: createElement("p", { className: "ac-aviso" }, "Actualización demorada"),
        alReintentar: nada,
        alVolver: nada,
        alCargarAnteriores: nada,
        ahora: AHORA,
        zona: ZONA,
      }),
    );
    assert.match(texto(html), /^Actualización demorada Hoy .*#183/);
  });
});

describe("marcar leído: un Local solo marca lo que puede demostrar que mostró", () => {
  /** Eventos de Casiano con ids `desde`..`hasta`, un minuto entre cada uno: el id crece con la fecha, como en la ingesta real. */
  const serie = (desde: number, hasta: number) =>
    Array.from({ length: hasta - desde + 1 }, (_, k) => evento(String(desde + k), 1000 + desde + k, new Date(Date.parse("2026-10-08T00:00:00.000Z") + (desde + k) * 60_000).toISOString()));
  /** Como los devuelve la API: del más reciente al más antiguo. */
  const pagina = (desde: number, hasta: number) => serie(desde, hasta).reverse();
  const info = (leidoHasta: string, noLeidos: number): InfoLocal => ({ ...INFO_LOCAL, leidoHasta, noLeidos });
  const conInfo = (eventos: readonly EventoPublico[], i: InfoLocal, extra: Partial<Extract<EstLocal, { fase: "LISTA" }>> = {}) => lista(eventos, { info: i, ...extra });

  it("K. sin la conversación mostrada no se decide nada", () => {
    assert.deepEqual(decidirLecturaLocal<EventoPublico>({ fase: "CARGANDO" }), { tipo: "NADA" });
    assert.deepEqual(decidirLecturaLocal<EventoPublico>({ fase: "FALLA", falla: { estado: "RED" } }), { tipo: "NADA" });
    assert.deepEqual(decidirLecturaLocal(conInfo([], info("4", 0))), { tipo: "NADA" });
  });

  it("AL/AC/AM. el caso real: leidoHasta 4, 40 nuevos (6..45), la primera página trae 16..45 → NO marca", () => {
    const primera = conInfo(pagina(16, 45), info("4", 40), { siguiente: "c1" });
    assert.deepEqual(decidirLecturaLocal(primera), { tipo: "FALTAN", nuevosMostrados: 30, noLeidos: 40 });
    // Y la pantalla lo dice, junto a "Cargar anteriores".
    const t = texto(cuerpoLocal(primera, true));
    assert.match(t, /^Hay más eventos sin leer Cargar anteriores/);
  });

  it("AD/AE. cargadas las anteriores (6..15), los 40 están a la vista: recién ahí marca, hasta 45", () => {
    let e = conInfo(pagina(16, 45), info("4", 40), { siguiente: "c1" });
    e = reducirConversacion(e, { tipo: "PIDIENDO_ANTERIORES" });
    e = reducirConversacion(e, { tipo: "ANTERIORES", eventos: pagina(1, 15), siguiente: null });
    assert.deepEqual(decidirLecturaLocal(e), { tipo: "MARCAR", marca: { localId: 3, hastaEventoId: "45" } });
    assert.doesNotMatch(cuerpoLocal(e, false), /Hay más eventos sin leer/);
  });

  it("AF. con 30 o menos no leídos, todos en la primera página, marca como siempre", () => {
    // 12 no leídos (99..110) dentro de una página de 30 (81..110).
    assert.deepEqual(decidirLecturaLocal(conInfo(pagina(81, 110), info("98", 12))), { tipo: "MARCAR", marca: { localId: 3, hastaEventoId: "110" } });
    // Y los cuatro reales de Casiano con 2 no leídos (3 y 4).
    assert.deepEqual(decidirLecturaLocal(lista(PAGINA_API)), { tipo: "MARCAR", marca: { localId: 3, hastaEventoId: "4" } });
  });

  it("AG/AH. la historia ya leída en pantalla no cuenta: 71..100 leídos + 101..110 nuevos, 10 no leídos → marca hasta 110", () => {
    const e = conInfo(pagina(81, 110), info("100", 10));
    assert.deepEqual(decidirLecturaLocal(e), { tipo: "MARCAR", marca: { localId: 3, hastaEventoId: "110" } });
    // Con la misma pantalla de 30 eventos y 25 no leídos, la cantidad total (30 ≥ 25) NO alcanza: solo 10 están por encima de lo leído.
    assert.deepEqual(decidirLecturaLocal(conInfo(pagina(81, 110), info("100", 25))), { tipo: "FALTAN", nuevosMostrados: 10, noLeidos: 25 });
  });

  it("AN. ya leído hasta el mayor mostrado: nada que pedir (no se repite el POST)", () => {
    let e = conInfo(pagina(16, 45), info("4", 30));
    assert.equal(decidirLecturaLocal(e).tipo, "MARCAR");
    e = reducirConversacion(e, { tipo: "LEIDO", localId: 3, leidoHasta: "45", noLeidos: 0 });
    assert.deepEqual(decidirLecturaLocal(e), { tipo: "NADA" });
  });

  it("AO/W. ids más allá de Number.MAX_SAFE_INTEGER: compara con BigInt y manda texto", () => {
    // 9007199254740993 y 9007199254740992 son el mismo Number: con Number, el nuevo no contaría.
    const grandes = [evento("9007199254740993", 2, "2026-10-07T12:00:00.000Z"), evento("9007199254740992", 1, "2026-10-07T11:00:00.000Z")];
    const d = decidirLecturaLocal(conInfo(grandes, info("9007199254740992", 1)));
    assert.deepEqual(d, { tipo: "MARCAR", marca: { localId: 3, hastaEventoId: "9007199254740993" } });
    assert.equal(d.tipo === "MARCAR" && typeof d.marca.hastaEventoId, "string");
  });

  it("AP. un evento nuevo que llegó después de abrir y no se mostró no queda cubierto", () => {
    // La respuesta que abrió decía 40 no leídos (6..45). Mientras se cargan las anteriores llega el 46:
    // tiene un id mayor y no está a la vista. La marca es hasta el mayor MOSTRADO (45), no 46.
    let e = conInfo(pagina(16, 45), info("4", 40), { siguiente: "c1" });
    e = reducirConversacion(e, { tipo: "ANTERIORES", eventos: pagina(1, 15), siguiente: null });
    const d = decidirLecturaLocal(e);
    assert.deepEqual(d, { tipo: "MARCAR", marca: { localId: 3, hastaEventoId: "45" } });
    // Después del POST, el servidor dice que queda 1 sin leer (el 46): no se marca nada más y se avisa.
    e = reducirConversacion(e, { tipo: "LEIDO", localId: 3, leidoHasta: "45", noLeidos: 1 });
    assert.deepEqual(decidirLecturaLocal(e), { tipo: "FALTAN", nuevosMostrados: 0, noLeidos: 1 });
  });

  it("evento tardío: si está a la vista cuenta como nuevo por id; si no está, la marca no lo alcanza", () => {
    // 101..110 nuevos y además el 111, con fecha VIEJA (antes que todo lo de la página): no vino en la primera página.
    const primera = conInfo(pagina(81, 110), info("100", 11), { siguiente: "c1" });
    assert.deepEqual(decidirLecturaLocal(primera), { tipo: "FALTAN", nuevosMostrados: 10, noLeidos: 11 });
    const tardio = evento("111", 9999, "2026-10-01T00:00:00.000Z");
    const con = reducirConversacion(primera, { tipo: "ANTERIORES", eventos: [tardio], siguiente: null });
    assert.deepEqual(decidirLecturaLocal(con), { tipo: "MARCAR", marca: { localId: 3, hastaEventoId: "111" } });
  });

  it("AQ/O. si el POST falla, la lectura no cambia; solo una respuesta buena la mueve", () => {
    const e = conInfo(pagina(16, 45), info("4", 30));
    // Una falla del POST no despacha nada (Conversacion.tsx): el estado, y por lo tanto el "30 sin leer", quedan iguales.
    assert.equal(e.fase === "LISTA" && e.info.noLeidos, 30);
    const leido = reducirConversacion(e, { tipo: "LEIDO", localId: 3, leidoHasta: "45", noLeidos: 0 });
    assert.equal(leido.fase === "LISTA" && leido.info.noLeidos, 0);
    // Una lectura de OTRO local no toca este.
    assert.equal(reducirConversacion(e, { tipo: "LEIDO", localId: 9, leidoHasta: "40", noLeidos: 0 }), e);
  });
});

describe("fallas y sesión", () => {
  it("R. SIN_SESION (con o sin VINCULO_INVALIDO) vuelve a la sesión; cada falla tiene su destino", () => {
    assert.equal(destinoDeFalla({ estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" }), "SESION");
    assert.equal(destinoDeFalla({ estado: "SIN_SESION" }), "SESION");
    assert.equal(destinoDeFalla({ estado: "ERP_NO_DISPONIBLE" }), "ERP_NO_DISPONIBLE");
    assert.equal(destinoDeFalla({ estado: "NO_AUTORIZADO" }), "NO_AUTORIZADO");
    assert.equal(destinoDeFalla({ estado: "CANCELADA" }), "IGNORAR");
  });

  it("un local sin acceso (o que no existe) no revela nada y ofrece volver", () => {
    const t = texto(cuerpoLocal({ fase: "FALLA", falla: { estado: "NO_AUTORIZADO" } }));
    assert.equal(t, "Sin acceso Este chat no está entre los que podés ver hoy. Volver a chats");
  });
});

describe("fechas", () => {
  it("V. hoy la hora, ayer 'Ayer', antes la fecha corta; nunca el ISO crudo", () => {
    assert.equal(formatearMomento("2026-10-07T14:10:00.000Z", AHORA, ZONA), "11:10");
    assert.equal(formatearMomento("2026-10-06T14:10:00.000Z", AHORA, ZONA), "Ayer");
    assert.equal(formatearMomento("2026-10-02T14:10:00.000Z", AHORA, ZONA), "2/10");
    assert.equal(formatearMomento("2025-12-31T14:10:00.000Z", AHORA, ZONA), "31/12/25");
    // 02:30 UTC del 8 es todavía el 7 en Buenos Aires: es "hoy", no mañana.
    assert.equal(formatearMomento("2026-10-08T02:30:00.000Z", AHORA, ZONA), "23:30");
    assert.equal(formatearHora("2026-10-07T13:30:15.250Z", ZONA), "10:30");
    assert.equal(etiquetaDeDia("2026-10-05T14:10:00.000Z", AHORA, ZONA), "lunes, 5 de octubre");
    const html = cuerpoChats({ fase: "LISTA", datos: CHATS }) + cuerpoLocal(lista(PAGINA_API));
    assert.doesNotMatch(html, /\d{4}-\d{2}-\d{2}T/);
  });

  it("iniciales para el avatar", () => {
    assert.equal(iniciales("Casiano Casas"), "CC");
    assert.equal(iniciales("Casiano"), "CA");
    assert.equal(iniciales("depósito central"), "DC");
  });
});

describe("navegación", () => {
  it("la vista va en la consulta de la URL, sin segmentos; lo que no se entiende es la lista", () => {
    assert.deepEqual(leerVista("?vista=local&localId=3"), { tipo: "LOCAL", localId: 3 });
    assert.deepEqual(leerVista("?vista=general"), { tipo: "GENERAL" });
    for (const malo of ["", "?vista=local", "?vista=local&localId=03", "?vista=local&localId=-1", "?vista=local&localId=1e3", "?vista=otra"]) {
      assert.deepEqual(leerVista(malo), { tipo: "CHATS" }, malo);
    }
    assert.equal(urlDeVista({ tipo: "LOCAL", localId: 3 }), "/?vista=local&localId=3");
    for (const v of [{ tipo: "CHATS" }, { tipo: "GENERAL" }, { tipo: "LOCAL", localId: 42 }] as const) {
      assert.deepEqual(leerVista(urlDeVista(v).slice(1)), v);
    }
  });
});

describe("el cliente HTTP", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  type Pedido = { url: string; init: RequestInit | undefined };
  function fetchDePrueba(respuesta: () => Response | Promise<Response>) {
    const pedidos: Pedido[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url: String(url), init });
      return respuesta();
    }) as typeof fetch;
    return pedidos;
  }
  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

  it("va solo a las cuatro rutas propias, con la cookie del mismo origen y sin caché; nada del ERP", async () => {
    assert.deepEqual({ ...RUTAS_DEL_CLIENTE }, { ...RUTAS_CHATS });
    const pedidos = fetchDePrueba(() => json({ estado: "SIN_SESION" }, 401));
    await pedirChats();
    await pedirLocal(3, null);
    await pedirLocal(3, "eyJmIjoiMjAyNiJ9");
    await pedirGeneral(null);
    await pedirGeneral("abc_-");
    await marcarLeido({ marcas: [{ localId: 3, hastaEventoId: "9007199254740993" }] });
    assert.deepEqual(
      pedidos.map((p) => p.url),
      ["/api/chats", "/api/chats/local?localId=3", "/api/chats/local?localId=3&cursor=eyJmIjoiMjAyNiJ9", "/api/chats/general?", "/api/chats/general?cursor=abc_-", "/api/chats/leido"],
    );
    for (const p of pedidos) {
      assert.equal(p.init?.credentials, "same-origin");
      assert.equal(p.init?.cache, "no-store");
    }
    const post = pedidos.at(-1)!;
    assert.equal(post.init?.method, "POST");
    // X/W: el cuerpo es exactamente el pedido, con el id como texto y sin nada de identidad.
    assert.equal(post.init?.body, '{"marcas":[{"localId":3,"hastaEventoId":"9007199254740993"}]}');
  });

  it("lee la respuesta buena y cada falla pública por su código; lo que no es del contrato no se adivina", async () => {
    fetchDePrueba(() => json(CHATS));
    assert.deepEqual(await pedirChats(), { ok: true, datos: CHATS });
    fetchDePrueba(() => json({ estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" }, 401));
    assert.deepEqual(await pedirChats(), { ok: false, falla: { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" } });
    fetchDePrueba(() => json({ estado: "ERP_NO_DISPONIBLE" }, 503));
    assert.deepEqual(await pedirGeneral(null), { ok: false, falla: { estado: "ERP_NO_DISPONIBLE" } });
    fetchDePrueba(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    assert.deepEqual(await pedirChats(), { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } });
    fetchDePrueba(() => json({ estado: "OK" }, 503));
    assert.deepEqual(await pedirChats(), { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } });
    fetchDePrueba(() => Promise.reject(new TypeError("failed to fetch")));
    assert.deepEqual(await marcarLeido({ marcas: [{ localId: 3, hastaEventoId: "1" }] }), { ok: false, falla: { estado: "RED" } });
    const control = new AbortController();
    control.abort();
    fetchDePrueba(() => Promise.reject(new DOMException("abortado", "AbortError")));
    assert.deepEqual(await pedirChats(control.signal), { ok: false, falla: { estado: "CANCELADA" } });
  });

  it("W. los ids que llegan quedan como texto en el cliente", async () => {
    const grande = evento("9007199254740993", 1, "2026-10-07T12:00:00.000Z");
    fetchDePrueba(() => new Response(`{"estado":"OK","local":{"localId":3,"nombre":"Casiano","esDeposito":false},"sincronizacion":"AL_DIA","noLeidos":1,"leidoHasta":"9007199254740992","eventos":[${JSON.stringify(grande)}],"siguiente":null}`));
    const r = await pedirLocal(3, null);
    assert.ok(r.ok);
    assert.equal(r.datos.eventos[0]!.id, "9007199254740993");
    assert.equal(r.datos.leidoHasta, "9007199254740992");
  });
});
