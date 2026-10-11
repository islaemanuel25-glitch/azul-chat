// CANDADOS DE LA FILA "NOTIFICACIONES" Y DEL CLIENTE PUSH DEL NAVEGADOR (Tanda 5A).
//
// La fila se dibuja con react-dom/server (sin navegador). El cliente
// (components/push/notificaciones.ts) se ejerce con un navegador de mentira
// —service worker, Push API y permiso de notificaciones— y un `fetch` de
// prueba: a qué ruta va, qué manda y qué hace con cada respuesta.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VistaNotificaciones } from "../../src/components/push/FilaNotificaciones.tsx";
import {
  activar,
  bytesDeClave,
  desactivar,
  leerEstado,
  RUTA_SERVICE_WORKER,
  type EntornoPush,
  type EstadoNotificaciones,
  type SuscripcionNavegador,
} from "../../src/components/push/notificaciones.ts";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const nada = () => {};
const dibujar = (estado: EstadoNotificaciones | null, extra: { error?: string; trabajando?: boolean } = {}) =>
  renderToStaticMarkup(createElement(VistaNotificaciones, { estado, trabajando: extra.trabajando ?? false, ...(extra.error ? { error: extra.error } : {}), alActivar: nada, alDesactivar: nada }));

describe("la fila de notificaciones", () => {
  it("Activadas, con el botón para desactivar", () => {
    assert.equal(texto(dibujar("ACTIVADAS")), "Notificaciones Avisos en este teléfono Activadas Desactivar");
  });

  it("Desactivadas, con el botón para activar", () => {
    assert.equal(texto(dibujar("DESACTIVADAS")), "Notificaciones Avisos en este teléfono Desactivadas Activar");
  });

  it("bloqueadas por el navegador: lo dice en una línea y no ofrece un botón que no puede andar", () => {
    const html = dibujar("BLOQUEADAS");
    assert.doesNotMatch(html, /<button/);
    assert.match(texto(html), /Bloqueadas por el navegador El navegador las bloqueó: se habilitan desde la configuración del sitio\.$/);
  });

  it("sin soporte, sin botón; mientras consulta, sin botón", () => {
    assert.doesNotMatch(dibujar("NO_SOPORTADAS"), /<button/);
    assert.doesNotMatch(dibujar(null), /<button/);
    assert.match(texto(dibujar(null)), /Consultando…/);
  });

  it("mientras trabaja, el botón está deshabilitado; un error se muestra en una línea", () => {
    assert.match(dibujar("DESACTIVADAS", { trabajando: true }), /<button[^>]*disabled/);
    assert.match(texto(dibujar("DESACTIVADAS", { error: "No se pudieron activar. Probá de nuevo." })), /No se pudieron activar\. Probá de nuevo\.$/);
  });

  it("solo esa fila de la pantalla de Configuración, sin colores escritos", () => {
    const html = ["ACTIVADAS", "DESACTIVADAS", "BLOQUEADAS"].map((e) => dibujar(e as EstadoNotificaciones)).join("");
    assert.doesNotMatch(html, /Privacidad|Horario|Sonidos|Inteligencia|Saldo|style=|#[0-9a-f]{3,6}/i);
  });
});

// ── El cliente ──────────────────────────────────────────────────────────────

type Pedido = { url: string; metodo: string; cuerpo: unknown };
let pedidos: Pedido[];
const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Un fetch de prueba: GET clave y POST/DELETE suscribir, con las respuestas que diga el test. */
function servidor(r: { clave?: unknown; suscribir?: { status: number; cuerpo: unknown } } = {}) {
  pedidos = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    pedidos.push({ url, metodo, cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/push/clave") return new Response(JSON.stringify(r.clave ?? { estado: "OK", clave: CLAVE }), { status: 200 });
    if (url === "/api/push/suscribir") {
      const s = r.suscribir ?? { status: 200, cuerpo: { estado: "OK" } };
      return new Response(JSON.stringify(s.cuerpo), { status: s.status });
    }
    throw new Error(`ruta inesperada ${url}`);
  }) as typeof fetch;
}

/** Una clave pública P-256 con la forma real (65 bytes, primero 0x04), en base64url. */
const CLAVE = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");

function navegador(o: { permiso?: "default" | "granted" | "denied"; respuestaPermiso?: "default" | "granted" | "denied"; suscripto?: boolean; sinPush?: boolean } = {}) {
  const registro: { opciones?: unknown; suscribirCon?: unknown; bajas: number } = { bajas: 0 };
  let suscripcion: SuscripcionNavegador | null = null;
  const nueva = (): SuscripcionNavegador => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/prueba",
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/prueba", expirationTime: null, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => {
      registro.bajas += 1;
      suscripcion = null;
      return true;
    },
  });
  if (o.suscripto) suscripcion = nueva();
  const pushManager = {
    getSubscription: async () => suscripcion,
    subscribe: async (op: unknown) => {
      registro.suscribirCon = op;
      suscripcion = nueva();
      return suscripcion;
    },
  };
  let registrado = !!o.suscripto;
  const permiso = { valor: o.permiso ?? "default" };
  const entorno: EntornoPush = {
    serviceWorker: {
      register: async (url, opciones) => {
        assert.equal(url, RUTA_SERVICE_WORKER);
        registro.opciones = opciones;
        registrado = true;
        return { pushManager };
      },
      getRegistration: async () => (registrado ? { pushManager } : undefined),
    },
    Notification: {
      get permission() {
        return permiso.valor as "default" | "granted" | "denied";
      },
      requestPermission: async () => {
        permiso.valor = o.respuestaPermiso ?? "granted";
        return permiso.valor as "default" | "granted" | "denied";
      },
    },
    tienePushManager: !o.sinPush,
  };
  return { entorno, registro };
}

describe("el cliente de notificaciones", () => {
  it("activar: permiso, clave por su ruta, service worker sin caché HTTP, suscripción y POST con lo que da el navegador", async () => {
    servidor();
    const { entorno, registro } = navegador();
    const r = await activar(entorno);
    assert.deepEqual(r, { estado: "ACTIVADAS" });
    assert.deepEqual(registro.opciones, { scope: "/", updateViaCache: "none" });
    assert.deepEqual(registro.suscribirCon, { userVisibleOnly: true, applicationServerKey: bytesDeClave(CLAVE) });
    assert.deepEqual(
      pedidos.map((p) => `${p.metodo} ${p.url}`),
      ["GET /api/push/clave", "POST /api/push/suscribir"],
    );
    assert.deepEqual(pedidos[1]!.cuerpo, { endpoint: "https://fcm.googleapis.com/fcm/send/prueba", expirationTime: null, keys: { p256dh: "p", auth: "a" } });
  });

  it("si el servidor no la guarda, se deshace en el navegador: no queda activada algo que no avisa", async () => {
    servidor({ suscribir: { status: 503, cuerpo: { estado: "NO_DISPONIBLE" } } });
    const { entorno, registro } = navegador();
    const r = await activar(entorno);
    assert.equal(r.estado, "DESACTIVADAS");
    assert.ok(r.error);
    assert.equal(registro.bajas, 1);
  });

  it("sin claves en el servidor no se suscribe nada", async () => {
    servidor({ clave: { estado: "NO_DISPONIBLE" } });
    const { entorno, registro } = navegador();
    assert.equal((await activar(entorno)).estado, "DESACTIVADAS");
    assert.equal(registro.suscribirCon, undefined);
  });

  it("permiso negado: BLOQUEADAS, sin pedir nada al servidor", async () => {
    servidor();
    const { entorno } = navegador({ respuestaPermiso: "denied" });
    assert.deepEqual(await activar(entorno), { estado: "BLOQUEADAS" });
    assert.equal(pedidos.length, 0);
    assert.equal(await leerEstado(navegador({ permiso: "denied" }).entorno), "BLOQUEADAS");
  });

  it("un navegador sin Push API: NO_SOPORTADAS, sin tocar nada", async () => {
    servidor();
    const { entorno } = navegador({ sinPush: true });
    assert.equal(await leerEstado(entorno), "NO_SOPORTADAS");
    assert.equal((await activar(entorno)).estado, "NO_SOPORTADAS");
    assert.equal(pedidos.length, 0);
  });

  it("al abrir el panel con una suscripción hecha, la vuelve a mandar (idempotente) y muestra Activadas", async () => {
    servidor();
    assert.equal(await leerEstado(navegador({ permiso: "granted", suscripto: true }).entorno), "ACTIVADAS");
    assert.deepEqual(pedidos.map((p) => `${p.metodo} ${p.url}`), ["POST /api/push/suscribir"]);
    servidor();
    assert.equal(await leerEstado(navegador({ permiso: "granted" }).entorno), "DESACTIVADAS");
    assert.equal(pedidos.length, 0);
  });

  it("desactivar: DELETE con el endpoint y baja en el navegador", async () => {
    servidor();
    const { entorno, registro } = navegador({ permiso: "granted", suscripto: true });
    assert.deepEqual(await desactivar(entorno), { estado: "DESACTIVADAS" });
    assert.deepEqual(pedidos, [{ url: "/api/push/suscribir", metodo: "DELETE", cuerpo: { endpoint: "https://fcm.googleapis.com/fcm/send/prueba" } }]);
    assert.equal(registro.bajas, 1);
  });

  it("la clave base64url se convierte a sus 65 bytes", () => {
    const b = bytesDeClave(CLAVE);
    assert.equal(b.length, 65);
    assert.equal(b[0], 4);
  });
});
