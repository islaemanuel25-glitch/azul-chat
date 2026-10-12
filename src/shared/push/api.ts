// src/shared/push/api.ts
//
// LO QUE LAS RUTAS DE PUSH LE CONTESTAN AL NAVEGADOR (Tanda 5A). Es lo único
// de push que la interfaz puede importar. Sin secretos: la clave pública VAPID
// no lo es (el navegador la necesita para suscribirse).

/** GET /api/push/clave */
export type RespuestaClavePush =
  | { readonly estado: "OK"; readonly clave: string }
  /** El servidor no tiene las claves VAPID configuradas: no hay notificaciones. */
  | { readonly estado: "NO_DISPONIBLE" };

/**
 * GET /api/push/estado?endpoint=… (Tanda 11). `registrada`: el servidor tiene
 * esa suscripción para la sesión de este navegador, así que le van a llegar
 * los avisos. Si no, aunque el navegador siga suscripto, no llegan.
 */
export type RespuestaEstadoPush =
  | { readonly estado: "OK"; readonly registrada: boolean }
  | { readonly estado: "SIN_SESION" }
  | { readonly estado: "SOLICITUD_INVALIDA" }
  | { readonly estado: "NO_DISPONIBLE" };

/** POST y DELETE /api/push/suscribir */
export type RespuestaSuscripcionPush =
  | { readonly estado: "OK" }
  | { readonly estado: "SIN_SESION" }
  | { readonly estado: "ORIGEN_NO_PERMITIDO" }
  /** El cuerpo no es una suscripción de un servicio de push conocido. */
  | { readonly estado: "SOLICITUD_INVALIDA" }
  /** Sin claves VAPID en el servidor, o la base no responde. */
  | { readonly estado: "NO_DISPONIBLE" };
