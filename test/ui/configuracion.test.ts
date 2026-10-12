// CANDADOS DE LA CONFIGURACIÓN DEL PANEL ☰ (Tanda 11), SIN NAVEGADOR.
//
// Las piezas se dibujan con react-dom/server: el horario de silencio, el saldo
// de IA (normal, agotado, sin IA), los dispositivos y las dos confirmaciones
// (cerrar las otras sesiones y cerrar esta). Que "Cancelar" no cierre se
// prueba llamando a los manejadores de los botones dibujados, como los
// tocaría la persona. El cliente HTTP se ejerce con un `fetch` de prueba.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { cerrarOtrasSesiones, guardarSilencio, pedirConfiguracion, RUTAS_DE_CONFIGURACION } from "../../src/components/sesion/clienteConfiguracion.ts";
import {
  Confirmacion,
  desdeCuando,
  diaDeReinicio,
  formatearUsd,
  PREGUNTA_CERRAR_SESION,
  VistaIa,
  VistaSesiones,
  VistaSilencio,
  type Confirmando,
} from "../../src/components/sesion/Configuracion.tsx";
import type { Dispositivo, HorarioSilencio, SaldoIa } from "../../src/shared/sesion/configuracion.ts";

const nada = () => {};
const dibujar = (e: ReactElement) => renderToStaticMarkup(e);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const ZONA = "America/Argentina/Buenos_Aires";

/** Los botones de un árbol ya evaluado (componentes de función llamados), con su texto y su onClick. */
function botones(nodo: ReactNode): { texto: string; onClick?: () => void }[] {
  const salida: { texto: string; onClick?: () => void }[] = [];
  const textoDe = (n: ReactNode): string =>
    typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(textoDe).join("") : isValidElement(n) ? textoDe((n.props as { children?: ReactNode }).children) : "";
  const recorrer = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(recorrer);
    if (!isValidElement(n)) return;
    if (typeof n.type === "function") return recorrer((n.type as (p: unknown) => ReactNode)(n.props));
    const p = n.props as { children?: ReactNode; onClick?: () => void };
    if (n.type === "button") salida.push({ texto: textoDe(p.children), ...(p.onClick ? { onClick: p.onClick } : {}) });
    recorrer(p.children);
  };
  recorrer(nodo);
  return salida;
}

describe("el horario de silencio", () => {
  const vista = (silencio: HorarioSilencio, extra: { error?: string } = {}) =>
    dibujar(createElement(VistaSilencio, { silencio, guardando: false, ...extra, alCambiar: nada }));

  it("apagado por defecto: el interruptor sin marcar y sin horas", () => {
    const html = vista({ activo: false, desde: 0, hasta: 7 });
    assert.match(html, /role="switch" aria-checked="false"/);
    assert.equal(texto(html), "Horario de silencio Apagado");
    assert.doesNotMatch(html, /<select/);
  });

  it("prendido: lo dice, con desde y hasta en horas de Argentina, y que no se avisa después", () => {
    const html = vista({ activo: true, desde: 22, hasta: 7 });
    assert.match(html, /aria-checked="true"/);
    assert.match(texto(html), /^Horario de silencio Sin avisos de 22 h a 07 h Desde .* Hasta .* Hora de Argentina\. Lo que llegue en ese horario queda sin leer en la app y no se avisa después\.$/);
    assert.equal((html.match(/<option/g) ?? []).length, 48);
    // La hora del otro extremo no se puede elegir: un horario de 0 o 24 horas no es un horario.
    assert.match(html, /<option value="7" disabled="">07 h<\/option>/);
  });

  it("tocar el interruptor manda el horario entero, con activo dado vuelta", () => {
    let recibido: HorarioSilencio | null = null;
    const arbol = VistaSilencio({ silencio: { activo: false, desde: 0, hasta: 7 }, guardando: false, alCambiar: (h) => (recibido = h) });
    botones(arbol)[0]!.onClick!();
    assert.deepEqual(recibido, { activo: true, desde: 0, hasta: 7 });
  });
});

describe("el saldo de IA", () => {
  const saldo = (o: Partial<SaldoIa> = {}): SaldoIa => ({ gastadoCentavos: 124, topeCentavos: 500, preguntas: 12, agotado: false, reiniciaEl: "2026-11-01", ...o });

  it("lo gastado del mes contra el tope y las preguntas", () => {
    assert.equal(texto(dibujar(createElement(VistaIa, { ia: saldo() }))), "Inteligencia artificial Gastado este mes: US$ 1,24 de US$ 5,00 Preguntas este mes: 12");
  });

  it("agotado: hasta el 1 del mes siguiente", () => {
    assert.match(texto(dibujar(createElement(VistaIa, { ia: saldo({ agotado: true, gastadoCentavos: 500 }) }))), /Saldo agotado hasta el 1\/11$/);
  });

  it("sin IA configurada en el servidor, la sección no está", () => {
    assert.equal(dibujar(createElement(VistaIa, { ia: null })), "");
  });

  it("los formatos", () => {
    assert.equal(formatearUsd(0), "US$ 0,00");
    assert.equal(formatearUsd(123456), "US$ 1.234,56");
    assert.equal(diaDeReinicio("2027-01-01"), "1/1");
    assert.equal(desdeCuando("2026-10-11T00:02:00.000Z", ZONA), "Desde el 10/10 a las 21:02");
  });
});

describe("las sesiones y las confirmaciones", () => {
  const DOS: Dispositivo[] = [
    { creadaEn: "2026-10-11T00:02:00.000Z", esEste: true },
    { creadaEn: "2026-10-09T15:00:00.000Z", esEste: false },
  ];
  type Llamadas = { pedir: Confirmando[]; cancelar: number; otras: number; esta: number };
  const sesiones = (dispositivos: readonly Dispositivo[] | null, confirmando: Confirmando, l: Llamadas) =>
    VistaSesiones({
      dispositivos,
      confirmando,
      trabajando: false,
      alPedirConfirmacion: (c) => l.pedir.push(c),
      alCancelar: () => (l.cancelar += 1),
      alCerrarOtras: () => (l.otras += 1),
      alCerrarSesion: () => (l.esta += 1),
      zona: ZONA,
    });
  const nuevas = (): Llamadas => ({ pedir: [], cancelar: 0, otras: 0, esta: 0 });

  it("los dispositivos, este marcado; 'Cerrar las otras sesiones' y 'Cerrar sesión' piden confirmación y no cierran nada", () => {
    const l = nuevas();
    const arbol = sesiones(DOS, null, l);
    assert.equal(
      texto(dibujar(arbol)),
      "Sesiones Dispositivos 2 sesiones abiertas Este dispositivo Desde el 10/10 a las 21:02 Otro dispositivo Desde el 9/10 a las 12:00 Cerrar las otras sesiones Cerrar sesión",
    );
    for (const b of botones(arbol)) b.onClick!();
    assert.deepEqual(l, { pedir: ["OTRAS", "ESTA"], cancelar: 0, otras: 0, esta: 0 }, "tocar los botones solo abre la confirmación");
  });

  it("sin otras sesiones, no se ofrece cerrarlas", () => {
    assert.doesNotMatch(dibujar(sesiones([DOS[0]!], null, nuevas())), /Cerrar las otras/);
  });

  it("confirmar cerrar sesión: el texto pedido, y 'Cancelar' NO cierra; 'Cerrar sesión' sí", () => {
    const l = nuevas();
    const arbol = sesiones(DOS, "ESTA", l);
    const html = dibujar(arbol);
    assert.match(html, /role="alertdialog"/);
    assert.ok(texto(html).includes(PREGUNTA_CERRAR_SESION));
    assert.equal(
      PREGUNTA_CERRAR_SESION,
      "¿Cerrar sesión en este teléfono? Vas a tener que volver a poner el código del ERP y las notificaciones de este teléfono se desactivan.",
    );
    const [cancelar, confirmar] = botones(arbol).filter((b) => b.texto === "Cancelar" || b.texto === "Cerrar sesión");
    assert.equal(cancelar!.texto, "Cancelar");
    cancelar!.onClick!();
    assert.deepEqual(l, { pedir: [], cancelar: 1, otras: 0, esta: 0 }, "Cancelar no cierra");
    confirmar!.onClick!();
    assert.equal(l.esta, 1);
  });

  it("confirmar cerrar las otras: cuántas y qué pasa en esos teléfonos; Cancelar no cierra", () => {
    const l = nuevas();
    const arbol = sesiones(DOS, "OTRAS", l);
    assert.match(texto(dibujar(arbol)), /¿Cerrar la otra sesión\? En ese teléfono van a tener que volver a poner el código del ERP y dejan de llegar los avisos\. Cancelar Cerrar las otras/);
    botones(arbol).find((b) => b.texto === "Cancelar")!.onClick!();
    assert.equal(l.otras, 0);
    botones(arbol).find((b) => b.texto === "Cerrar las otras")!.onClick!();
    assert.equal(l.otras, 1);
  });

  it("la confirmación es de la app, no del navegador", () => {
    const fuente = [Confirmacion, VistaSesiones].map((f) => f.toString()).join("\n");
    assert.doesNotMatch(fuente, /\b(window\.)?confirm\s*\(/);
  });
});

describe("el cliente HTTP de la configuración", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("tres rutas propias: leer (GET), guardar el silencio (PUT con el horario entero) y cerrar las otras (DELETE)", async () => {
    const pedidos: { url: string; metodo: string; cuerpo: unknown }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url, metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ estado: "OK", silencio: { activo: true, desde: 0, hasta: 7 }, cerradas: 1, ia: null, dispositivos: [] }), { status: 200 });
    }) as typeof fetch;
    assert.ok((await pedirConfiguracion()).ok);
    assert.ok((await guardarSilencio({ activo: true, desde: 0, hasta: 7 })).ok);
    assert.ok((await cerrarOtrasSesiones()).ok);
    assert.deepEqual(pedidos, [
      { url: "/api/sesion/configuracion", metodo: "GET", cuerpo: undefined },
      { url: "/api/sesion/silencio", metodo: "PUT", cuerpo: { activo: true, desde: 0, hasta: 7 } },
      { url: "/api/sesion/otras", metodo: "DELETE", cuerpo: undefined },
    ]);
    assert.deepEqual({ ...RUTAS_DE_CONFIGURACION }, { configuracion: "/api/sesion/configuracion", silencio: "/api/sesion/silencio", otras: "/api/sesion/otras" });
  });

  it("una falla es la falla, y sin red es RED", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ estado: "ORIGEN_NO_PERMITIDO" }), { status: 403 })) as unknown as typeof fetch;
    assert.deepEqual(await cerrarOtrasSesiones(), { ok: false, falla: "ORIGEN_NO_PERMITIDO" });
    globalThis.fetch = (async () => {
      throw new TypeError("sin red");
    }) as typeof fetch;
    assert.deepEqual(await pedirConfiguracion(), { ok: false, falla: "RED" });
  });
});
