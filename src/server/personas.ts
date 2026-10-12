// src/server/personas.ts
//
// UNA LISTA DE PERSONAS DEL ERP EN UNA VARIABLE DE ENTORNO. Solo servidor.
//
// La usan AZUL_CHAT_AVISOS_SISTEMA (Tanda 12, a quién avisa el vigía) y, desde
// la Tanda 15, AZUL_CHAT_ADMINISTRADORES (quién administra los accesos). Mismo
// formato y mismo criterio: ids de persona del ERP (Vinculo.erpUsuarioId)
// separados por coma. Vacía o ausente es VACIA; cualquier otra cosa que no sea
// eso exacto es INVALIDA, y quien la lee decide cerrado: no se adivina a
// quién avisar ni quién administra.
//
// Cada variable se lee en su propio archivo (secretoSoloServidor.test.ts):
// acá solo se interpreta el texto.

import "server-only";

export type ListaDePersonas = { readonly tipo: "OK"; readonly ids: readonly number[] } | { readonly tipo: "VACIA" } | { readonly tipo: "INVALIDA" };

const LISTA_DE_IDS = /^\s*[1-9][0-9]{0,9}\s*(,\s*[1-9][0-9]{0,9}\s*)*$/;

/** "9, 11" → [9, 11]. Vacía o ausente: VACIA. Cualquier otra cosa: INVALIDA. */
export function leerListaDePersonas(crudo: string | undefined): ListaDePersonas {
  if (crudo === undefined || crudo.trim() === "") return { tipo: "VACIA" };
  if (!LISTA_DE_IDS.test(crudo)) return { tipo: "INVALIDA" };
  const ids = [...new Set(crudo.split(",").map((x) => Number(x.trim())))];
  return ids.every((n) => Number.isSafeInteger(n) && n <= 2_147_483_647) ? { tipo: "OK", ids } : { tipo: "INVALIDA" };
}
