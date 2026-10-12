// public/sw.js — EL SERVICE WORKER DE AZUL CHAT (Tanda 5A). MÍNIMO A PROPÓSITO.
//
// Hace DOS cosas y nada más:
//
//   · `push`: muestra la notificación que mandó el servidor (título, texto y
//     qué local abrir). El contenido llega cifrado; acá ya viene descifrado
//     por el navegador.
//   · `notificationclick`: abre (o trae al frente) Azul Chat en ese local.
//
// No tiene `fetch`: no intercepta ningún pedido, así que nunca sirve JS viejo
// y la recarga por versión (Tanda 3B) sigue igual.
//
// LO ÚNICO QUE GUARDA (Tanda 13): por cada etiqueta, la hora de creación del
// último aviso que mostró, en una caché propia (CACHE_AVISOS) que no se usa
// para servir nada. Android puede entregar los push tarde y desordenados: si
// llega un aviso MÁS VIEJO que el último mostrado con la misma etiqueta, se
// descarta sin mostrarse. Así un "no se está actualizando" que llega tarde no
// pisa al "volvió a actualizarse" (mismo incidente o uno anterior: alcanza con
// la hora). Queda guardado aunque la persona haya borrado la notificación o el
// service worker se haya reiniciado. Si leer falla, se muestra: ante la duda,
// mostrar. La decisión es `decidirAviso`, pura; la prueban
// test/unidad/serviceWorker.test.ts y test/frontera/alcanceUi.test.ts.

"use strict";

/** Lo único que se abre al tocar: un local de Azul Chat, o la lista. */
const RUTA_LOCAL = /^\/\?vista=local&localId=[1-9][0-9]{0,9}$/;
const ICONO = "/icono-192.png";
/** La caché de las horas mostradas por etiqueta. No guarda respuestas del servidor. */
const CACHE_AVISOS = "azul-chat-avisos-v1";

/** Una hora de creación válida: ms enteros positivos. Lo demás (un servidor viejo, un payload roto) no cuenta. */
function esHora(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * ¿Se muestra este aviso? PURA. `creadoEn` es la hora del aviso que llegó;
 * `ultimaMostrada`, la del último mostrado con su etiqueta (o null si no hay,
 * o si no se pudo leer). Solo se descarta un aviso con hora que es MÁS VIEJO
 * que uno ya mostrado; todo lo demás se muestra, como antes de la Tanda 13.
 */
function decidirAviso(creadoEn, ultimaMostrada) {
  if (!esHora(creadoEn) || !esHora(ultimaMostrada)) return "MOSTRAR";
  return creadoEn < ultimaMostrada ? "DESCARTAR" : "MOSTRAR";
}

/** La clave de una etiqueta en la caché. Una URL propia que nadie pide: no hay `fetch`. */
function claveDeEtiqueta(etiqueta) {
  return new URL(`/__avisos-mostrados/${encodeURIComponent(etiqueta)}`, self.location.origin).href;
}

async function leerUltimaMostrada(etiqueta) {
  const cache = await caches.open(CACHE_AVISOS);
  const guardada = await cache.match(claveDeEtiqueta(etiqueta));
  if (!guardada) return null;
  const hora = Number(await guardada.text());
  return esHora(hora) ? hora : null;
}

/** Guarda la hora mostrada, sin bajar nunca la que ya estaba (la lectura de antes pudo haber fallado). */
async function anotarMostrada(etiqueta, creadoEn) {
  const anterior = await leerUltimaMostrada(etiqueta);
  if (anterior !== null && anterior >= creadoEn) return;
  const cache = await caches.open(CACHE_AVISOS);
  await cache.put(claveDeEtiqueta(etiqueta), new Response(String(creadoEn)));
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let aviso = null;
  try {
    aviso = event.data ? event.data.json() : null;
  } catch {
    aviso = null;
  }
  const texto = (v, porDefecto) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : porDefecto);
  const titulo = texto(aviso && aviso.titulo, "Azul Chat");
  const cuerpo = texto(aviso && aviso.cuerpo, "Hay novedades.");
  const url = aviso && typeof aviso.url === "string" && RUTA_LOCAL.test(aviso.url) ? aviso.url : "/";
  const etiqueta = texto(aviso && aviso.etiqueta, "azul-chat");
  const creadoEn = aviso ? aviso.creadoEn : undefined;
  event.waitUntil(
    (async () => {
      let ultima = null;
      try {
        ultima = await leerUltimaMostrada(etiqueta);
      } catch {
        ultima = null; // ante la duda, mostrar
      }
      if (decidirAviso(creadoEn, ultima) === "DESCARTAR") return;
      await self.registration.showNotification(titulo, { body: cuerpo, tag: etiqueta, renotify: true, icon: ICONO, badge: ICONO, data: { url } });
      if (!esHora(creadoEn)) return;
      try {
        await anotarMostrada(etiqueta, creadoEn);
      } catch {
        // Si no se pudo anotar, el próximo aviso viejo se muestra: mejor eso que perder uno.
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const datos = event.notification.data;
  const url = datos && typeof datos.url === "string" && RUTA_LOCAL.test(datos.url) ? datos.url : "/";
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin !== self.location.origin) continue;
        try {
          // Navegar recarga la página: con la versión del servidor de ahora.
          const navegada = await ventana.navigate(url);
          return (navegada || ventana).focus();
        } catch {
          // Una ventana que este service worker no controla no se puede navegar: se abre otra.
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
