// src/shared/chats/buscar.ts
//
// BUSCAR EN EL HISTORIAL (Tanda 10): qué se manda, cómo se lee el texto y qué
// contesta GET /api/chats/buscar. Lo usan el servidor y la interfaz.
//
// Se busca SOLO en la base propia de Azul Chat —los eventos guardados y las
// preguntas guardadas de la persona—; al ERP no se le pregunta nada más que
// `mi_alcance`, como en cualquier pedido del navegador.
//
//   · un NÚMERO (con o sin "#") es el número de la transferencia o del pedido
//     del evento, y además lo que contenga ese número en el texto de una
//     pregunta guardada (como número entero: "18" no encuentra "182");
//   · un TEXTO se busca sin distinguir mayúsculas ni acentos en el texto de la
//     pregunta guardada y en lo que se ve del evento: el título sin el número
//     ("Transferencia recibida", "con diferencias", "Pedido solicitado"…) y el
//     nombre del origen o del destino. Nunca dentro de los números de una
//     respuesta guardada.

import type { EventoPublico, FallaChats } from "./api.ts";
import type { PreguntaGuardada } from "./preguntas.ts";

/** El texto que se busca: de 1 a 60 caracteres, sin contar los espacios de las puntas. */
export const MAX_LARGO_BUSQUEDA = 60;
/** Resultados por página; el resto, con "Ver más". */
export const RESULTADOS_POR_PAGINA = 50;

/** Los filtros, en el orden de las pills, con su valor en la URL. */
export const FILTROS_BUSQUEDA = ["todos", "transferencias", "pedidos", "preguntas"] as const;
export type FiltroBusqueda = (typeof FILTROS_BUSQUEDA)[number];

/** Qué tipos de evento entran en cada filtro. "preguntas" no trae eventos. */
export const TIPOS_DE_FILTRO: Readonly<Record<FiltroBusqueda, readonly EventoPublico["tipo"][]>> = Object.freeze({
  todos: ["TRANSFERENCIA_RECIBIDA", "TRANSFERENCIA_ENVIADA", "TRANSFERENCIA_CANCELADA", "PEDIDO_SOLICITADO", "COMPRA_CON_SALDO"],
  transferencias: ["TRANSFERENCIA_RECIBIDA", "TRANSFERENCIA_ENVIADA", "TRANSFERENCIA_CANCELADA"],
  pedidos: ["PEDIDO_SOLICITADO"],
  preguntas: [],
});

/** ¿El filtro trae preguntas guardadas? */
export const filtroConPreguntas = (f: FiltroBusqueda) => f === "todos" || f === "preguntas";

/** Sin mayúsculas, sin acentos (ni diéresis ni tilde de la ñ) y con los espacios juntados. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Lo que se busca, ya leído. */
export type Busqueda =
  /** `n`: el número, si entra en el id de un evento (entero de 32 bits); `digitos`: el mismo número, para el texto de las preguntas. */
  | { readonly tipo: "NUMERO"; readonly n: number | null; readonly digitos: string }
  | { readonly tipo: "TEXTO"; readonly normalizado: string };

const NUMERO = /^#?\s*([0-9]{1,18})$/;
const MAX_ID_EVENTO = 2_147_483_647;

/** El texto tal como llega → la búsqueda, o null si está vacío, es largo o trae caracteres de control. */
export function leerTextoDeBusqueda(crudo: string): Busqueda | null {
  const texto = crudo.trim();
  if (texto.length === 0 || [...texto].length > MAX_LARGO_BUSQUEDA || /\p{Cc}/u.test(texto)) return null;
  const m = NUMERO.exec(texto);
  if (m) {
    const digitos = m[1]!.replace(/^0+(?=[0-9])/, "");
    const n = Number(digitos);
    return { tipo: "NUMERO", n: n >= 1 && n <= MAX_ID_EVENTO ? n : null, digitos };
  }
  return { tipo: "TEXTO", normalizado: normalizar(texto) };
}

/** ¿El texto de una pregunta guardada coincide? Un número, como número entero dentro del texto. */
export function coincideTexto(b: Busqueda, texto: string): boolean {
  if (b.tipo === "TEXTO") return normalizar(texto).includes(b.normalizado);
  return new RegExp(`(?<![0-9])0*${b.digitos}(?![0-9])`).test(texto);
}

/** Un resultado: un evento o una pregunta guardada, con el local al que pertenece (null: una pregunta hecha en General). */
export type ResultadoBusqueda =
  | { readonly tipo: "EVENTO"; readonly evento: EventoPublico; readonly local: { readonly localId: number; readonly nombre: string } }
  | { readonly tipo: "PREGUNTA"; readonly guardada: PreguntaGuardada; readonly local: { readonly localId: number; readonly nombre: string } | null };

/** GET /api/chats/buscar?texto=…&filtro=…&(localId=N | general=1)[&cursor=…] */
export type RespuestaBuscar =
  | {
      readonly estado: "OK";
      /** Cuántos resultados hay en total con ese texto y ese filtro, no solo en esta página. */
      readonly total: number;
      /** Del más nuevo al más viejo. */
      readonly resultados: readonly ResultadoBusqueda[];
      /** Opaco: se manda tal cual como `cursor`, con el mismo texto y filtro, para "Ver más". Null: no hay más. */
      readonly siguiente: string | null;
    }
  | FallaChats;
