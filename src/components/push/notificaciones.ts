// LAS NOTIFICACIONES PUSH DE ESTE TELÉFONO, DEL LADO DEL NAVEGADOR (Tanda 5A).
//
// Sin React: lo usa la fila "Notificaciones" del panel (FilaNotificaciones.tsx)
// y los tests lo ejercen con un navegador de mentira. Es el ÚNICO lugar de la
// interfaz que registra el service worker y toca `pushManager`
// (test/frontera/alcanceUi.test.ts).
//
//   · activar: registrar /sw.js (solo maneja push y el toque; no cachea nada
//     ni intercepta pedidos), pedir permiso, pedir la clave pública a
//     GET /api/push/clave, suscribirse y mandar la suscripción a
//     POST /api/push/suscribir. Si el servidor no la guarda, se deshace la
//     suscripción del navegador: no queda "activada" algo que no avisa;
//   · desactivar: DELETE /api/push/suscribir con el endpoint, y darla de baja
//     en el navegador;
//   · al abrir el panel con una suscripción ya hecha, se vuelve a mandar al
//     servidor (es idempotente): la cuelga de la sesión de ahora, por si se
//     volvió a vincular o el servidor la había borrado.
//
// Nada se guarda en el navegador fuera de lo que el propio navegador guarda de
// su suscripción. Sin reintentos: si falla, la persona vuelve a tocar.

import type { RespuestaClavePush, RespuestaSuscripcionPush } from "../../shared/push/api.ts";
import { anotarCommitDe } from "../chats/version.ts";

export const RUTA_SERVICE_WORKER = "/sw.js";
/** Las dos rutas propias que llama este archivo, literales: es lo que admite la frontera de HTTP (secretoSoloServidor.test.ts). */
const RUTA_CLAVE = "/api/push/clave";
const RUTA_SUSCRIBIR = "/api/push/suscribir";

/** Lo que se ve en la fila. */
export type EstadoNotificaciones =
  /** Este navegador no tiene service worker, Push API o Notification. */
  | "NO_SOPORTADAS"
  /** La persona (o el navegador) las bloqueó para este sitio: solo se destraban desde la configuración del navegador. */
  | "BLOQUEADAS"
  | "ACTIVADAS"
  | "DESACTIVADAS";

/** Lo mínimo del navegador que se usa. En el navegador, `window`; en los tests, uno de mentira. */
export type EntornoPush = {
  readonly serviceWorker?: {
    register(url: string, opciones: { scope: string; updateViaCache: "none" }): Promise<RegistroPush>;
    getRegistration(url?: string): Promise<RegistroPush | undefined>;
  };
  readonly Notification?: { readonly permission: "default" | "granted" | "denied"; requestPermission(): Promise<"default" | "granted" | "denied"> };
  readonly tienePushManager: boolean;
};

export type SuscripcionNavegador = {
  readonly endpoint: string;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
};

export type RegistroPush = {
  readonly pushManager: {
    getSubscription(): Promise<SuscripcionNavegador | null>;
    subscribe(opciones: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<SuscripcionNavegador>;
  };
};

/** El entorno real del navegador. Se llama solo en el navegador (desde un efecto o un toque). */
export function entornoDelNavegador(): EntornoPush {
  const w = window as unknown as { Notification?: EntornoPush["Notification"]; PushManager?: unknown };
  return {
    ...("serviceWorker" in navigator ? { serviceWorker: navigator.serviceWorker as unknown as NonNullable<EntornoPush["serviceWorker"]> } : {}),
    ...(w.Notification ? { Notification: w.Notification } : {}),
    tienePushManager: typeof w.PushManager !== "undefined",
  };
}

/** Una clave base64url → los bytes que pide `applicationServerKey`. */
export function bytesDeClave(clave: string): Uint8Array {
  const base64 = clave.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (clave.length % 4)) % 4);
  const binario = atob(base64);
  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
}

const soportadas = (e: EntornoPush) => !!e.serviceWorker && !!e.Notification && e.tienePushManager;

async function suscripcionActual(e: EntornoPush): Promise<SuscripcionNavegador | null> {
  const registro = await e.serviceWorker!.getRegistration(RUTA_SERVICE_WORKER);
  return registro ? registro.pushManager.getSubscription() : null;
}

async function mandar(metodo: "POST" | "DELETE", cuerpo: unknown): Promise<boolean> {
  try {
    const res = await fetch(RUTA_SUSCRIBIR, {
      method: metodo,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    anotarCommitDe(res); // Tanda 6D: el commit de cada respuesta (chats/version.ts)
    const r = (await res.json().catch(() => null)) as RespuestaSuscripcionPush | null;
    return res.ok && r?.estado === "OK";
  } catch {
    return false;
  }
}

/** Qué mostrar ahora. Si ya hay una suscripción, la vuelve a mandar al servidor (idempotente). */
export async function leerEstado(e: EntornoPush): Promise<EstadoNotificaciones> {
  if (!soportadas(e)) return "NO_SOPORTADAS";
  if (e.Notification!.permission === "denied") return "BLOQUEADAS";
  const s = await suscripcionActual(e).catch(() => null);
  if (!s || e.Notification!.permission !== "granted") return "DESACTIVADAS";
  return (await mandar("POST", s.toJSON())) ? "ACTIVADAS" : "DESACTIVADAS";
}

export type ResultadoAccion = { readonly estado: EstadoNotificaciones; readonly error?: string };

export async function activar(e: EntornoPush): Promise<ResultadoAccion> {
  if (!soportadas(e)) return { estado: "NO_SOPORTADAS" };
  const permiso = await e.Notification!.requestPermission();
  if (permiso === "denied") return { estado: "BLOQUEADAS" };
  if (permiso !== "granted") return { estado: "DESACTIVADAS" };
  let clave: RespuestaClavePush | null = null;
  try {
    const res = await fetch(RUTA_CLAVE, { cache: "no-store", credentials: "same-origin" });
    anotarCommitDe(res);
    clave = (await res.json().catch(() => null)) as RespuestaClavePush | null;
  } catch {
    clave = null;
  }
  if (clave?.estado !== "OK") return { estado: "DESACTIVADAS", error: "Las notificaciones no están disponibles en este momento." };
  let s: SuscripcionNavegador;
  try {
    const registro = await e.serviceWorker!.register(RUTA_SERVICE_WORKER, { scope: "/", updateViaCache: "none" });
    s = (await registro.pushManager.getSubscription()) ?? (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDeClave(clave.clave) }));
  } catch {
    return { estado: "DESACTIVADAS", error: "Este navegador no pudo activar las notificaciones." };
  }
  if (await mandar("POST", s.toJSON())) return { estado: "ACTIVADAS" };
  await s.unsubscribe().catch(() => false);
  return { estado: "DESACTIVADAS", error: "No se pudieron activar. Probá de nuevo." };
}

export async function desactivar(e: EntornoPush): Promise<ResultadoAccion> {
  if (!soportadas(e)) return { estado: "NO_SOPORTADAS" };
  const s = await suscripcionActual(e).catch(() => null);
  if (!s) return { estado: "DESACTIVADAS" };
  const borrada = await mandar("DELETE", { endpoint: s.endpoint });
  await s.unsubscribe().catch(() => false);
  // Aunque el servidor no haya contestado, el navegador ya no está suscripto:
  // el servicio de push va a decir 410 y el servidor la borra en la próxima corrida.
  return borrada ? { estado: "DESACTIVADAS" } : { estado: "DESACTIVADAS", error: "Quedaron desactivadas en este teléfono." };
}

/** El texto del estado, como en el diseño (fila de Configuración). */
export function textoDeEstado(estado: EstadoNotificaciones): string {
  switch (estado) {
    case "ACTIVADAS":
      return "Activadas";
    case "DESACTIVADAS":
      return "Desactivadas";
    case "BLOQUEADAS":
      return "Bloqueadas por el navegador";
    case "NO_SOPORTADAS":
      return "No disponibles en este navegador";
  }
}
