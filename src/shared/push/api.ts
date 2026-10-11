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

/** POST y DELETE /api/push/suscribir */
export type RespuestaSuscripcionPush =
  | { readonly estado: "OK" }
  | { readonly estado: "SIN_SESION" }
  | { readonly estado: "ORIGEN_NO_PERMITIDO" }
  /** El cuerpo no es una suscripción de un servicio de push conocido. */
  | { readonly estado: "SOLICITUD_INVALIDA" }
  /** Sin claves VAPID en el servidor, o la base no responde. */
  | { readonly estado: "NO_DISPONIBLE" };
