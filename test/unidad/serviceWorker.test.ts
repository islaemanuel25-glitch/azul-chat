// CANDADOS DEL SERVICE WORKER (Tanda 13): el ORDEN de los avisos.
//
// Corre el public/sw.js DE VERDAD en un contexto aislado (node:vm), con un
// `self`, un `registration` y unas `caches` de mentira: lo que se prueba es el
// archivo que baja el teléfono, no una copia. Android puede entregar los push
// tarde y desordenados; un aviso más viejo que el último mostrado con su misma
// etiqueta no se muestra.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import vm from "node:vm";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const CODIGO_SW = readFileSync(path.join(RAIZ, "public/sw.js"), "utf8");
const ORIGEN = "https://chat.ejemplo.invalid";

type Mostrada = { titulo: string; tag: string; body: string; url: string };
type Payload = Record<string, unknown>;

/** Un service worker recién levantado sobre un almacenamiento (que sobrevive a "reiniciarlo"). */
function levantar(almacen: Map<string, string>, opciones: { lecturasQueFallan?: number; codigo?: string } = {}) {
  const oyentes = new Map<string, (e: unknown) => void>();
  const mostradas: Mostrada[] = [];
  let fallasPendientes = opciones.lecturasQueFallan ?? 0;
  const cache = {
    async match(clave: string) {
      if (fallasPendientes > 0) {
        fallasPendientes -= 1;
        throw new Error("almacenamiento no disponible");
      }
      const v = almacen.get(clave);
      return v === undefined ? undefined : new Response(v);
    },
    async put(clave: string, r: Response) {
      almacen.set(clave, await r.text());
    },
  };
  const contexto = vm.createContext({
    URL,
    Response,
    Number,
    caches: { open: async () => cache },
    self: {
      location: { origin: ORIGEN },
      addEventListener: (tipo: string, f: (e: unknown) => void) => oyentes.set(tipo, f),
      skipWaiting() {},
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => null },
      registration: {
        async showNotification(titulo: string, o: { tag: string; body: string; data: { url: string } }) {
          mostradas.push({ titulo, tag: o.tag, body: o.body, url: o.data.url });
        },
      },
    },
  });
  vm.runInContext(opciones.codigo ?? CODIGO_SW, contexto);
  async function push(p: Payload) {
    const pendientes: Promise<unknown>[] = [];
    oyentes.get("push")!({ data: { json: () => p }, waitUntil: (x: Promise<unknown>) => pendientes.push(x) });
    await Promise.all(pendientes);
  }
  return { push, mostradas, decidirAviso: contexto.decidirAviso as (a: unknown, b: unknown) => string };
}

const T = Date.parse("2026-10-12T15:11:59.000Z");
const apertura = (creadoEn: number | null = T): Payload => ({
  titulo: "Azul Chat",
  cuerpo: "Azul Chat no se está actualizando desde las 11:58. La actualización automática no está corriendo.",
  url: "/",
  etiqueta: "sistema",
  incidente: "2026-10-12T14:58:00.000Z",
  ...(creadoEn === null ? {} : { creadoEn }),
});
const recuperacion = (creadoEn = T + 5 * 60_000 + 10_000): Payload => ({ titulo: "Azul Chat", cuerpo: "Azul Chat volvió a actualizarse.", url: "/", etiqueta: "sistema", creadoEn });
const evento = (cuerpo: string, creadoEn?: number, local = 3): Payload => ({
  titulo: "Azul Chat",
  cuerpo,
  url: `/?vista=local&localId=${local}`,
  etiqueta: `local-${local}`,
  ...(creadoEn === undefined ? {} : { creadoEn }),
});

let almacen: Map<string, string>;
beforeEach(() => {
  almacen = new Map();
});

describe("Tanda 13: la decisión, pura", () => {
  it("solo descarta un aviso con hora más viejo que uno ya mostrado; sin hora, o sin nada guardado, muestra", () => {
    const { decidirAviso } = levantar(almacen);
    assert.equal(decidirAviso(T, null), "MOSTRAR");
    assert.equal(decidirAviso(T, T), "MOSTRAR");
    assert.equal(decidirAviso(T + 1, T), "MOSTRAR");
    assert.equal(decidirAviso(T - 1, T), "DESCARTAR");
    for (const sinHora of [undefined, null, "123", -5, 0, 1.5, Number.NaN]) assert.equal(decidirAviso(sinHora, T), "MOSTRAR", String(sinHora));
    assert.equal(decidirAviso(T, "basura"), "MOSTRAR");
  });
});

describe("Tanda 13: el orden de los avisos del sistema", () => {
  it("apertura y después recuperación: se ven las dos, en orden", async () => {
    const sw = levantar(almacen);
    await sw.push(apertura());
    await sw.push(recuperacion());
    assert.deepEqual(
      sw.mostradas.map((m) => [m.tag, m.body]),
      [
        ["sistema", "Azul Chat no se está actualizando desde las 11:58. La actualización automática no está corriendo."],
        ["sistema", "Azul Chat volvió a actualizarse."],
      ],
    );
  });

  it("recuperación y después la apertura vieja: la apertura NO se muestra", async () => {
    const sw = levantar(almacen);
    await sw.push(recuperacion());
    await sw.push(apertura());
    assert.deepEqual(sw.mostradas.map((m) => m.body), ["Azul Chat volvió a actualizarse."]);
  });

  it("la apertura vieja llega después de que la persona borró la recuperación y el service worker se reinició: NO se muestra", async () => {
    await levantar(almacen).push(recuperacion());
    // Borrar la notificación no toca el almacenamiento; un service worker nuevo lo lee igual.
    const otro = levantar(almacen);
    await otro.push(apertura());
    assert.deepEqual(otro.mostradas, []);
  });

  it("si leer el almacenamiento falla, se muestra (ante la duda, mostrar) y no se baja la hora guardada", async () => {
    await levantar(almacen).push(recuperacion());
    // Falla solo la primera lectura (la de decidir): la de anotar después anda,
    // y no tiene que pisar la hora más nueva con la de este aviso viejo.
    const roto = levantar(almacen, { lecturasQueFallan: 1 });
    await roto.push(apertura());
    assert.deepEqual(roto.mostradas.map((m) => m.tag), ["sistema"]);
    const sano = levantar(almacen);
    await sano.push(apertura(T + 1));
    assert.deepEqual(sano.mostradas, [], "la recuperación sigue siendo la última hora");
  });

  it("etiquetas distintas no se afectan: un aviso de un local no descarta uno del sistema, ni al revés", async () => {
    const sw = levantar(almacen);
    await sw.push(evento("Casiano: Pedido #92 solicitado", T + 60 * 60_000));
    await sw.push(apertura());
    await sw.push(evento("Centro: Transferencia #7 recibida", T - 60 * 60_000, 4));
    assert.deepEqual(sw.mostradas.map((m) => m.tag), ["local-3", "sistema", "local-4"]);
  });
});

describe("Tanda 13: los avisos de eventos siguen igual", () => {
  it("en orden se ven todos, con el mismo título, texto, etiqueta y local que antes", async () => {
    const sw = levantar(almacen);
    await sw.push(evento("Casiano: Transferencia #404 recibida", T));
    await sw.push(evento("Casiano: 3 novedades", T + 2 * 60_000));
    assert.deepEqual(sw.mostradas, [
      { titulo: "Azul Chat", tag: "local-3", body: "Casiano: Transferencia #404 recibida", url: "/?vista=local&localId=3" },
      { titulo: "Azul Chat", tag: "local-3", body: "Casiano: 3 novedades", url: "/?vista=local&localId=3" },
    ]);
  });

  it("un aviso sin hora (de un servidor anterior a la Tanda 13) se muestra siempre, como antes", async () => {
    const sw = levantar(almacen);
    await sw.push(recuperacion());
    await sw.push(apertura(null));
    await sw.push(evento("Casiano: Pedido #93 solicitado"));
    assert.equal(sw.mostradas.length, 3);
  });

  it("un payload roto sigue mostrando lo de siempre", async () => {
    const sw = levantar(almacen);
    await sw.push({});
    assert.deepEqual(sw.mostradas, [{ titulo: "Azul Chat", tag: "azul-chat", body: "Hay novedades.", url: "/" }]);
  });
});

describe("CONTRAPRUEBA: sin la defensa, el aviso viejo pisa al nuevo", () => {
  it("con decidirAviso que siempre muestra, la apertura vieja aparece después de la recuperación", async () => {
    const roto = CODIGO_SW.replace('return creadoEn < ultimaMostrada ? "DESCARTAR" : "MOSTRAR";', 'return "MOSTRAR";');
    assert.notEqual(roto, CODIGO_SW);
    const sw = levantar(almacen, { codigo: roto });
    await sw.push(recuperacion());
    await sw.push(apertura());
    assert.equal(sw.mostradas.at(-1)!.body.startsWith("Azul Chat no se está actualizando"), true);
  });
});
