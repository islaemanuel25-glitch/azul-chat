// src/shared/version/cabecera.ts
//
// TANDA 6D: LA CABECERA CON EL COMMIT DE LA IMAGEN. La pone el servidor en
// toda respuesta JSON de sus rutas (http/respuestas.ts) y la lee la interfaz
// en cada respuesta (components/chats/version.ts). Es el mismo valor que
// GET /api/version: el SHA del repo, que no es un secreto.

/** El nombre de la cabecera. Los navegadores la leen sin distinguir mayúsculas. */
export const CABECERA_COMMIT = "X-Azul-Chat-Commit";

/** Un SHA-1 de git completo, en minúsculas. Cualquier otra cosa no es un commit. */
export const SHA_COMPLETO = /^[0-9a-f]{40}$/;
