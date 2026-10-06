// src/server/version.ts
//
// QUÉ COMMIT ESTÁ CORRIENDO. GET /api/version.
//
// APP_BUILD_ID es el SHA completo del commit con el que se construyó la imagen.
// Lo pone el Dockerfile como ENV, desde el build-arg que pasa el workflow de
// publicación (`github.sha`). NO se configura en el .env del despliegue: si un
// archivo de entorno lo pisara, la ruta diría un commit que no es el de la
// imagen. El runbook compara este valor contra la etiqueta de la imagen y la
// etiqueta OCI `org.opencontainers.image.revision`.
//
// Solo dice el commit. Nada de configuración, variables ni versiones de
// dependencias.

import "server-only";

import type { Entorno } from "./erp/config.ts";

export const VARIABLE_BUILD_ID = "APP_BUILD_ID";

/** Un SHA-1 de git completo, en minúsculas. Cualquier otra cosa no es una identidad. */
const FORMATO_SHA = /^[0-9a-f]{40}$/;

export type Version = { readonly servicio: "azul-chat"; readonly commit: string | null };

/** El commit de la imagen, o `null` si no hay uno con forma de SHA completo. */
export function leerVersion(entorno: Entorno = process.env): Version {
  const valor = entorno[VARIABLE_BUILD_ID];
  return { servicio: "azul-chat", commit: valor && FORMATO_SHA.test(valor) ? valor : null };
}
