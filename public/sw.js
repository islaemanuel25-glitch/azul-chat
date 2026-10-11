// public/sw.js — EL SERVICE WORKER DE AZUL CHAT (Tanda 5A). MÍNIMO A PROPÓSITO.
//
// Hace DOS cosas y nada más:
//
//   · `push`: muestra la notificación que mandó el servidor (título, texto y
//     qué local abrir). El contenido llega cifrado; acá ya viene descifrado
//     por el navegador.
//   · `notificationclick`: abre (o trae al frente) Azul Chat en ese local.
//
// No tiene `fetch` ni caché: no intercepta ningún pedido, así que nunca sirve
// JS viejo y la recarga por versión (Tanda 3B) sigue igual. No guarda nada.
// Lo vigila test/frontera/alcanceUi.test.ts.

"use strict";

/** Lo único que se abre al tocar: un local de Azul Chat, o la lista. */
const RUTA_LOCAL = /^\/\?vista=local&localId=[1-9][0-9]{0,9}$/;
const ICONO = "/icono-192.png";

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
  event.waitUntil(
    self.registration.showNotification(titulo, { body: cuerpo, tag: etiqueta, renotify: true, icon: ICONO, badge: ICONO, data: { url } }),
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
