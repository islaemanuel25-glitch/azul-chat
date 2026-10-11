// CANDADOS DE LA RECARGA POR VERSIÓN (Tanda 3B), SIN NAVEGADOR.
//
// La pieza (src/components/chats/version.ts) recibe pedir, recargar y el
// documento, así que acá se ejercen con unos de mentira: qué versión dice el
// servidor, si recargó, y en qué momentos preguntó. El cliente HTTP
// (pedirVersion) se prueba con un `fetch` de prueba. Que estas piezas sean las
// únicas que recargan o escuchan el primer plano lo vigila
// test/frontera/alcanceUi.test.ts.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ESPERA_VERSION_MS, pedirVersion } from "../../src/components/chats/clienteChats.ts";
import type { Vista } from "../../src/components/chats/logica.ts";
import { comprobarAlAbrir, comprobarAlVolverAPrimerPlano, crearComprobadorDeVersion, type DocumentoVisible } from "../../src/components/chats/version.ts";

const A = "95702bed5cb9b82612411c1cb887c7008852ea95";
const B = "3d8b849bf840bd7eea803055461726c6d736d0bd";

/** Un servidor de mentira: contesta lo que diga `respuestas`, en orden (null = falló o tardó). */
function escenario(...respuestas: (string | null | Error)[]) {
  let pedidos = 0;
  let recargas = 0;
  const comprobador = crearComprobadorDeVersion({
    pedir: async () => {
      const r = respuestas[pedidos++];
      if (r instanceof Error) throw r;
      return r ?? null;
    },
    recargar: () => {
      recargas++;
    },
  });
  return { comprobador, pedidos: () => pedidos, recargas: () => recargas };
}

/** Un documento de mentira: un EventTarget con visibilityState que el test cambia. */
function documentoDePrueba() {
  const objetivo = new EventTarget();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: objetivo.addEventListener.bind(objetivo),
    removeEventListener: objetivo.removeEventListener.bind(objetivo),
  };
  const cambiar = (v: DocumentVisibilityState) => {
    doc.visibilityState = v;
    objetivo.dispatchEvent(new Event("visibilitychange"));
  };
  return { doc: doc as unknown as DocumentoVisible, cambiar };
}

/** Espera a que terminen las promesas pendientes (sin temporizadores). */
const vaciar = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("recarga por versión: qué se decide", () => {
  it("3B-1. versión igual → no recarga", async () => {
    const e = escenario(A, A, A);
    await e.comprobador.arrancar();
    await e.comprobador.comprobar();
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 0);
    assert.equal(e.pedidos(), 3);
  });

  it("3B-2. versión distinta → recarga, una vez", async () => {
    const e = escenario(A, B, B);
    await e.comprobador.arrancar();
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 1);
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 1, "no recarga dos veces mientras la página se va");
  });

  it("3B-3. fallo o demora → no recarga ni muestra nada; la próxima buena se compara contra la de arranque", async () => {
    const e = escenario(A, null, new Error("red"), A, B);
    await e.comprobador.arrancar();
    await e.comprobador.comprobar(); // null: falló o tardó
    await e.comprobador.comprobar(); // excepción
    await e.comprobador.comprobar(); // igual
    assert.equal(e.recargas(), 0);
    await e.comprobador.comprobar(); // cambió
    assert.equal(e.recargas(), 1);
  });

  it("3B-4. si falló el arranque, la primera versión que se consigue pasa a ser la de referencia: no recarga por eso", async () => {
    const e = escenario(null, A, A, B);
    await e.comprobador.arrancar();
    await e.comprobador.comprobar();
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 0);
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 1);
  });

  it("3B-5. dos pedidos a la vez se juntan en uno", async () => {
    const e = escenario(A, B);
    await e.comprobador.arrancar();
    await Promise.all([e.comprobador.comprobar(), e.comprobador.comprobar(), e.comprobador.comprobar()]);
    assert.equal(e.pedidos(), 2);
    assert.equal(e.recargas(), 1);
  });
});

describe("recarga por versión: cuándo se pregunta", () => {
  it("3B-6. al volver a primer plano, sí; al pasar a segundo plano, no; desconectado, nunca más", async () => {
    const e = escenario(A, A, B, B);
    await e.comprobador.arrancar();
    const { doc, cambiar } = documentoDePrueba();
    const desconectar = comprobarAlVolverAPrimerPlano(doc, e.comprobador);
    cambiar("hidden");
    await vaciar();
    assert.equal(e.pedidos(), 1, "ocultarse no pregunta");
    cambiar("visible");
    await vaciar();
    assert.equal(e.pedidos(), 2);
    assert.equal(e.recargas(), 0);
    cambiar("hidden");
    cambiar("visible");
    await vaciar();
    assert.equal(e.pedidos(), 3);
    assert.equal(e.recargas(), 1);
    desconectar();
    cambiar("visible");
    await vaciar();
    assert.equal(e.pedidos(), 3, "desconectado no escucha");
  });

  it("3B-7. al abrir un Local o General, sí; al volver a la lista, no", async () => {
    const e = escenario(A, A, A, A);
    await e.comprobador.arrancar();
    const vistas: Vista[] = [{ tipo: "CHATS" }, { tipo: "LOCAL", localId: 3 }, { tipo: "CHATS" }, { tipo: "GENERAL" }];
    const pedidosTras: number[] = [];
    for (const v of vistas) {
      comprobarAlAbrir(v, e.comprobador);
      await vaciar();
      pedidosTras.push(e.pedidos());
    }
    assert.deepEqual(pedidosTras, [1, 2, 2, 3]);
  });

  it("3B-8. sin abrir chats ni volver a primer plano, no pregunta nunca: ni intervalos ni temporizadores", async () => {
    const e = escenario(A, B);
    await e.comprobador.arrancar();
    const { doc } = documentoDePrueba();
    comprobarAlVolverAPrimerPlano(doc, e.comprobador);
    await vaciar();
    await new Promise((r) => setImmediate(r));
    assert.equal(e.pedidos(), 1);
    assert.equal(e.recargas(), 0);
  });
});

describe("pedirVersion: el cliente HTTP", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  const con = (respuesta: () => Response | Promise<Response>) => {
    const pedidos: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url: String(url), init });
      return respuesta();
    }) as typeof fetch;
    return pedidos;
  };
  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });

  it("3B-9. GET /api/version, mismo origen, sin caché y con corte por tiempo; devuelve el commit", async () => {
    const pedidos = con(() => json({ servicio: "azul-chat", commit: A }));
    assert.equal(await pedirVersion(), A);
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0]!.url, "/api/version");
    assert.equal(pedidos[0]!.init?.method, undefined);
    assert.equal(pedidos[0]!.init?.credentials, "same-origin");
    assert.equal(pedidos[0]!.init?.cache, "no-store");
    assert.ok(pedidos[0]!.init?.signal instanceof AbortSignal);
    assert.equal(ESPERA_VERSION_MS, 5000);
  });

  it("3B-10. todo lo que no es un commit completo de azul-chat es null, que nunca recarga", async () => {
    const malas: (() => Response | Promise<Response>)[] = [
      () => json({ servicio: "azul-chat", commit: null }),
      () => json({ servicio: "azul-chat", commit: "3d8b849" }),
      () => json({ servicio: "otro", commit: A }),
      () => json({ servicio: "azul-chat", commit: A }, 503),
      () => new Response("<html>Bad gateway</html>", { status: 502 }),
      () => new Response("no es json", { status: 200 }),
      () => Promise.reject(new TypeError("failed to fetch")),
      () => Promise.reject(new DOMException("tardó", "TimeoutError")),
    ];
    for (const [i, m] of malas.entries()) {
      con(m);
      assert.equal(await pedirVersion(), null, `caso ${i}`);
    }
  });
});
