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

import { ESPERA_VERSION_MS, marcarLeido, pedirChats, pedirGeneral, pedirLocal, pedirVentas, pedirVersion, preguntar } from "../../src/components/chats/clienteChats.ts";
import type { Vista } from "../../src/components/chats/logica.ts";
import {
  alLiberarRecarga,
  anotarCommitDe,
  comprobarAlAbrir,
  comprobarAlVolverAPrimerPlano,
  crearComprobadorDeVersion,
  escucharCommitDeRespuestas,
  leerMarcaDeRecarga,
  recargaRetenida,
  retenerRecarga,
  urlConMarca,
  urlSinMarca,
  type DocumentoVisible,
  type VentanaVisible,
} from "../../src/components/chats/version.ts";

const A = "95702bed5cb9b82612411c1cb887c7008852ea95";
const B = "3d8b849bf840bd7eea803055461726c6d736d0bd";
const C = "dda5b80d4c05796452c03d767422d1e4dc315deb";

/** Un servidor de mentira: contesta lo que diga `respuestas`, en orden (null = falló o tardó). */
function escenario(...respuestas: (string | null | Error)[]) {
  return escenarioCon({}, ...respuestas);
}

/** Tanda 6C: con el commit de la página (`propia`) y la marca de una recarga anterior. */
function escenarioCon(o: { propia?: string | null; yaRecargadoPor?: string | null }, ...respuestas: (string | null | Error)[]) {
  let pedidos = 0;
  const recargadas: string[] = [];
  const comprobador = crearComprobadorDeVersion({
    ...o,
    pedir: async () => {
      const r = respuestas[pedidos++];
      if (r instanceof Error) throw r;
      return r ?? null;
    },
    recargar: (nueva) => {
      recargadas.push(nueva);
    },
  });
  return { comprobador, pedidos: () => pedidos, recargas: () => recargadas.length, recargadas: () => recargadas };
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
  // Tanda 6C: la ventana, para pageshow y focus.
  const ventana = new EventTarget();
  const avisar = (evento: "pageshow" | "focus") => ventana.dispatchEvent(new Event(evento));
  return { doc: doc as unknown as DocumentoVisible, ventana: ventana as unknown as VentanaVisible, cambiar, avisar };
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
    const { doc, ventana, cambiar } = documentoDePrueba();
    const desconectar = comprobarAlVolverAPrimerPlano(doc, ventana, e.comprobador);
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
    const { doc, ventana } = documentoDePrueba();
    comprobarAlVolverAPrimerPlano(doc, ventana, e.comprobador);
    await vaciar();
    await new Promise((r) => setImmediate(r));
    assert.equal(e.pedidos(), 1);
    assert.equal(e.recargas(), 0);
  });
});

describe("6C. la referencia es el commit de la página, no el primero que contesta el servidor", () => {
  it("6C-1. el caso del 11/10: página vieja (A) que arranca con el servidor nuevo (B) → recarga EN EL ARRANQUE", async () => {
    const e = escenarioCon({ propia: A }, B);
    await e.comprobador.arrancar();
    assert.deepEqual(e.recargadas(), [B], "con la referencia de antes (el primero del servidor) esto daba 0 recargas");
  });

  it("6C-1 CONTRAPRUEBA: sin el commit propio, el mismo escenario NO recarga nunca (el defecto de producción)", async () => {
    const e = escenarioCon({}, B, B, B);
    await e.comprobador.arrancar();
    await e.comprobador.comprobar();
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 0);
  });

  it("6C-2. página y servidor iguales → no recarga, ni al arrancar ni después", async () => {
    const e = escenarioCon({ propia: A }, A, A);
    await e.comprobador.arrancar();
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 0);
  });

  it("6C-3. sin bucle: si ya se recargó por B y la página sigue siendo A, no se insiste por B; por un C nuevo, sí", async () => {
    const e = escenarioCon({ propia: A, yaRecargadoPor: B }, B, B, C);
    await e.comprobador.arrancar();
    await e.comprobador.comprobar();
    assert.equal(e.recargas(), 0);
    await e.comprobador.comprobar();
    assert.deepEqual(e.recargadas(), [C]);
  });

  it("6C-4. la marca de recarga: se escribe en la URL de la pestaña y se lee solo si es un commit completo", () => {
    const u = { pathname: "/", search: "?vista=local&localId=3" };
    assert.equal(urlConMarca(u, B), `/?vista=local&localId=3#recarga=${B}`);
    assert.equal(leerMarcaDeRecarga(`#recarga=${B}`), B);
    assert.equal(urlSinMarca(u), "/?vista=local&localId=3");
    for (const malo of ["", "#recarga=", "#recarga=abc", `#recarga=${B}x`, `#otra=${B}`]) assert.equal(leerMarcaDeRecarga(malo), null, malo);
    assert.equal(urlConMarca(u, "no-es-un-sha"), "/?vista=local&localId=3");
  });

  it("6C-5. pageshow (vuelta desde la caché de atrás/adelante) y focus también comparan; desconectado, ninguno", async () => {
    const e = escenarioCon({ propia: A }, A, A, B, B);
    await e.comprobador.arrancar();
    const { doc, ventana, avisar } = documentoDePrueba();
    const desconectar = comprobarAlVolverAPrimerPlano(doc, ventana, e.comprobador);
    avisar("pageshow");
    await vaciar();
    assert.equal(e.pedidos(), 2);
    avisar("focus");
    await vaciar();
    assert.equal(e.pedidos(), 3);
    assert.deepEqual(e.recargadas(), [B]);
    desconectar();
    avisar("pageshow");
    avisar("focus");
    await vaciar();
    assert.equal(e.pedidos(), 3, "desconectado no escucha");
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

// ── Tanda 6D: el commit de CADA respuesta ───────────────────────────────────

describe("6D. cada respuesta trae el commit: quien se queda adentro de un chat también recarga", () => {
  /** Arma la página como AzulChat: comprobador con la retención, conectado a las respuestas y a la liberación. */
  function pagina(o: { propia?: string; yaRecargadoPor?: string } = {}) {
    const recargadas: string[] = [];
    const comprobador = crearComprobadorDeVersion({
      propia: o.propia ?? A,
      yaRecargadoPor: o.yaRecargadoPor ?? null,
      pedir: async () => null,
      recargar: (c) => recargadas.push(c),
      retenida: recargaRetenida,
    });
    const desconectar = [escucharCommitDeRespuestas((c) => comprobador.anotar(c)), alLiberarRecarga(() => comprobador.liberar())];
    return { recargadas, cerrar: () => desconectar.forEach((d) => d()) };
  }
  const respuestaCon = (commit: string | null) => new Response("{}", { headers: commit === null ? {} : { "x-azul-chat-commit": commit } });
  afterEach(() => {
    for (const k of ["caja", "envio"]) retenerRecarga(k, false);
  });

  it("6D-1. una respuesta con el mismo commit no recarga; con otro, recarga; sin cabecera o con basura, nada", () => {
    const p = pagina();
    anotarCommitDe(respuestaCon(A));
    anotarCommitDe(respuestaCon(null));
    anotarCommitDe(respuestaCon("3d8b849"));
    assert.deepEqual(p.recargadas, []);
    anotarCommitDe(respuestaCon(B));
    anotarCommitDe(respuestaCon(B));
    assert.deepEqual(p.recargadas, [B], "una sola vez");
    p.cerrar();
  });

  it("6D-2. anti-bucle: si ya se recargó por ese commit y la página sigue siendo otra, no se insiste", () => {
    const p = pagina({ yaRecargadoPor: B });
    anotarCommitDe(respuestaCon(B));
    assert.deepEqual(p.recargadas, []);
    anotarCommitDe(respuestaCon(C));
    assert.deepEqual(p.recargadas, [C]);
    p.cerrar();
  });

  it("6D-3. con texto en la caja, la recarga espera; al vaciarla, recarga", () => {
    const p = pagina();
    retenerRecarga("caja", true);
    anotarCommitDe(respuestaCon(B));
    assert.deepEqual(p.recargadas, [], "no se le borra lo que escribió");
    retenerRecarga("caja", true); // sigue escribiendo
    assert.deepEqual(p.recargadas, []);
    retenerRecarga("caja", false);
    assert.deepEqual(p.recargadas, [B]);
    p.cerrar();
  });

  it("6D-4. al enviar: la caja se vacía pero la pregunta está en curso; recarga cuando llega la respuesta", () => {
    const p = pagina();
    retenerRecarga("caja", true);
    anotarCommitDe(respuestaCon(B));
    // usePreguntas marca el envío ANTES de que la caja se vacíe (mismo toque).
    retenerRecarga("envio", true);
    retenerRecarga("caja", false);
    assert.deepEqual(p.recargadas, [], "no corta la pregunta que se está mandando");
    retenerRecarga("envio", false);
    assert.deepEqual(p.recargadas, [B]);
    p.cerrar();
  });

  it("6D-5. sin nada pendiente, liberar no recarga; y desconectada, la página no escucha más", () => {
    const p = pagina();
    retenerRecarga("caja", true);
    retenerRecarga("caja", false);
    assert.deepEqual(p.recargadas, []);
    p.cerrar();
    anotarCommitDe(respuestaCon(B));
    assert.deepEqual(p.recargadas, []);
  });

  it("CONTRAPRUEBA 6D-3: sin la retención conectada, el mismo escenario recargaría con el texto escrito", () => {
    const recargadas: string[] = [];
    const comprobador = crearComprobadorDeVersion({ propia: A, pedir: async () => null, recargar: (c) => recargadas.push(c) });
    const d = escucharCommitDeRespuestas((c) => comprobador.anotar(c));
    retenerRecarga("caja", true);
    anotarCommitDe(respuestaCon(B));
    assert.deepEqual(recargadas, [B]);
    d();
  });

  describe("los clientes HTTP pasan CADA respuesta", () => {
    const original = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = original;
    });

    it("6D-6. chats, local, general, ventas, leído, preguntar y versión: todas, buenas o con falla", async () => {
      const vistos: string[] = [];
      const d = escucharCommitDeRespuestas((c) => vistos.push(c));
      for (const [status, cuerpo] of [
        [200, { estado: "OK" }],
        [503, { estado: "ERP_NO_DISPONIBLE" }],
      ] as const) {
        globalThis.fetch = (async () => new Response(JSON.stringify(cuerpo), { status, headers: { "x-azul-chat-commit": B } })) as typeof fetch;
        vistos.length = 0;
        await pedirChats();
        await pedirLocal(3, null);
        await pedirGeneral(null);
        await pedirVentas(3);
        await marcarLeido({ marcas: [{ localId: 3, hastaEventoId: "1" }] });
        await preguntar({ pregunta: "hola" });
        await pedirVersion();
        assert.deepEqual(vistos, Array(7).fill(B), `status ${status}`);
      }
      // Sin red no hay respuesta: nada que comparar.
      globalThis.fetch = (async () => Promise.reject(new TypeError("failed to fetch"))) as typeof fetch;
      vistos.length = 0;
      await pedirChats();
      assert.deepEqual(vistos, []);
      d();
    });
  });
});
