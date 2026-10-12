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

import { cerrarOtrasSesiones, guardarAccesos, pedirAccesos, guardarSilencio, pedirConfiguracion, RUTAS_DE_CONFIGURACION } from "../../src/components/sesion/clienteConfiguracion.ts";
import {
  Confirmacion,
  desdeCuando,
  diaDeReinicio,
  formatearUsd,
  PREGUNTA_CERRAR_SESION,
  VistaIa,
  VistaSesiones,
  VistaAccesos,
  VistaSilencio,
  type Confirmando,
} from "../../src/components/sesion/Configuracion.tsx";
import { TEXTO_SIN_ACCESO } from "../../src/components/sesion/PanelSesion.tsx";
import { destinoDeFalla, motivoDeSesion, pideSesion } from "../../src/components/chats/logica.ts";
import { NINGUN_PERMISO, TODOS_LOS_PERMISOS, type PersonaConAcceso } from "../../src/shared/sesion/accesos.ts";
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
  const saldo = (o: Partial<SaldoIa> = {}): SaldoIa => ({ gastadoCentavos: 124, topeCentavos: 500, preguntasPropias: 12, agotado: false, reiniciaEl: "2026-11-01", ...o });

  it("lo gastado del mes por todo el negocio contra el tope, y las preguntas propias (Tanda 14)", () => {
    assert.equal(texto(dibujar(createElement(VistaIa, { ia: saldo() }))), "Inteligencia artificial Gastado este mes, entre todos: US$ 1,24 de US$ 5,00 Tus preguntas este mes: 12");
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

  it("cuatro rutas propias: leer (GET), guardar el silencio (PUT con el horario entero), cerrar las otras (DELETE) y, desde la Tanda 15, los accesos (GET y PUT)", async () => {
    const pedidos: { url: string; metodo: string; cuerpo: unknown }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url, metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ estado: "OK", silencio: { activo: true, desde: 0, hasta: 7 }, cerradas: 1, ia: null, dispositivos: [] }), { status: 200 });
    }) as typeof fetch;
    assert.ok((await pedirConfiguracion()).ok);
    assert.ok((await guardarSilencio({ activo: true, desde: 0, hasta: 7 })).ok);
    assert.ok((await cerrarOtrasSesiones()).ok);
    assert.ok((await pedirAccesos()).ok);
    const permisos = { entrar: true, ventas: false, caja: true, stock: false, pendientes: false, ia: true };
    assert.ok((await guardarAccesos({ personaId: 11, ...permisos })).ok);
    assert.deepEqual(pedidos, [
      { url: "/api/sesion/configuracion", metodo: "GET", cuerpo: undefined },
      { url: "/api/sesion/silencio", metodo: "PUT", cuerpo: { activo: true, desde: 0, hasta: 7 } },
      { url: "/api/sesion/otras", metodo: "DELETE", cuerpo: undefined },
      { url: "/api/sesion/accesos", metodo: "GET", cuerpo: undefined },
      { url: "/api/sesion/accesos", metodo: "PUT", cuerpo: { personaId: 11, ...permisos } },
    ]);
    assert.deepEqual(
      { ...RUTAS_DE_CONFIGURACION },
      { configuracion: "/api/sesion/configuracion", silencio: "/api/sesion/silencio", otras: "/api/sesion/otras", accesos: "/api/sesion/accesos" },
    );
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

describe("Tanda 15: la sección Accesos (solo administradores)", () => {
  const ZONA = "America/Argentina/Buenos_Aires";
  const persona = (o: Partial<PersonaConAcceso>): PersonaConAcceso => ({
    personaId: 11,
    nombre: "Encargada Casiano",
    vinculadoEn: "2026-10-12T15:02:00.000Z",
    administrador: false,
    permisos: NINGUN_PERMISO,
    ...o,
  });
  const interruptores = (html: string) =>
    [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => ({
      rotulo: /aria-label="([^"]*)"/.exec(m[0])![1],
      prendido: /aria-checked="true"/.test(m[0]),
      quieto: /disabled=""/.test(m[0]),
    }));

  it("cada persona con su nombre, su último vínculo y un interruptor por permiso, en orden; sin Entrar, los otros quietos", () => {
    const html = dibujar(createElement(VistaAccesos, { personas: [persona({})], guardando: null, alCambiar: nada, zona: ZONA }));
    assert.equal(texto(html), "Accesos Encargada Casiano Vinculado el 12/10 a las 12:02 Entrar Ventas Caja Stock Pendientes IA");
    assert.deepEqual(
      interruptores(html).map((i) => [i.rotulo, i.prendido, i.quieto]),
      [
        ["Entrar de Encargada Casiano", false, false],
        ["Ventas de Encargada Casiano", false, true],
        ["Caja de Encargada Casiano", false, true],
        ["Stock de Encargada Casiano", false, true],
        ["Pendientes de Encargada Casiano", false, true],
        ["IA de Encargada Casiano", false, true],
      ],
    );
    const conEntrar = interruptores(dibujar(createElement(VistaAccesos, { personas: [persona({ permisos: { ...NINGUN_PERMISO, entrar: true, caja: true } })], guardando: null, alCambiar: nada, zona: ZONA })));
    assert.deepEqual(conEntrar.map((i) => [i.prendido, i.quieto]), [[true, false], [false, false], [true, false], [false, false], [false, false], [false, false]]);
  });

  it("un administrador: todo prendido y bloqueado; mientras se guarda una persona, sus interruptores quedan quietos", () => {
    const html = dibujar(createElement(VistaAccesos, { personas: [persona({ personaId: 9, nombre: "Emanuel", administrador: true, permisos: TODOS_LOS_PERMISOS })], guardando: null, alCambiar: nada, zona: ZONA }));
    assert.match(texto(html), /Emanuel Administrador · Vinculado el/);
    assert.ok(interruptores(html).every((i) => i.prendido && i.quieto));
    const guardando = interruptores(dibujar(createElement(VistaAccesos, { personas: [persona({ permisos: TODOS_LOS_PERMISOS })], guardando: 11, alCambiar: nada, zona: ZONA })));
    assert.ok(guardando.every((i) => i.quieto));
  });

  it("tocar un interruptor manda los seis permisos de esa persona, con ese cambiado", () => {
    const cambios: [number, unknown][] = [];
    const el = VistaAccesos({ personas: [persona({ permisos: { ...NINGUN_PERMISO, entrar: true } })], guardando: null, alCambiar: (id, p) => cambios.push([id, p]) });
    const botones: ReactElement<{ onClick: () => void }>[] = [];
    const juntar = (n: ReactNode): void => {
      if (Array.isArray(n)) n.forEach(juntar);
      else if (isValidElement(n)) {
        const props = n.props as { role?: string; children?: ReactNode };
        if (props.role === "switch") botones.push(n as ReactElement<{ onClick: () => void }>);
        juntar(props.children);
      }
    };
    juntar(el);
    botones[2]!.props.onClick(); // Caja
    assert.deepEqual(cambios, [[11, { ...NINGUN_PERMISO, entrar: true, caja: true }]]);
  });

  it("la falla SIN_ACCESO: sin \"entrar\" lleva a la sesión (que dice el texto de sin acceso); sin una sección, como un local que no se ve", () => {
    assert.equal(TEXTO_SIN_ACCESO, "Todavía no tenés acceso a Azul Chat.");
    assert.equal(pideSesion({ estado: "SIN_ACCESO", motivo: "ENTRAR" }), true);
    assert.equal(destinoDeFalla({ estado: "SIN_ACCESO", motivo: "ENTRAR" }), "SESION");
    assert.equal(motivoDeSesion({ estado: "SIN_ACCESO", motivo: "ENTRAR" }), undefined);
    assert.equal(pideSesion({ estado: "SIN_ACCESO" }), false);
    assert.equal(destinoDeFalla({ estado: "SIN_ACCESO" }), "NO_AUTORIZADO");
    assert.equal(pideSesion({ estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" }), true, "CONTRAPRUEBA: sin sesión, como siempre");
    assert.equal(motivoDeSesion({ estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" }), "VINCULO_INVALIDO");
  });
});
