// EL NAVEGADOR HABLA CON LAS CUATRO RUTAS DE CHATS DESDE ACÁ, Y SOLO DESDE ACÁ.
//
// Las rutas son las propias de Azul Chat (docs/CHATS.md); este archivo no sabe
// nada del ERP, ni de la delegación, ni de tokens: la sesión va en una cookie
// HttpOnly que el navegador manda solo. Lo que devuelve es la respuesta buena o
// la falla pública, con su código, para que cada pantalla decida por el código
// y nunca por un texto.
//
// Los destinos de `fetch` son constantes literales: el candado
// test/frontera/secretoSoloServidor.test.ts solo admite rutas propias, y una
// consulta (`?localId=…&cursor=…`) solo después de una de ellas.
// test/ui/clienteChats.test.ts comprueba que coinciden con RUTAS_CHATS.

import type { FallaChats, PedidoLeido, RespuestaChats, RespuestaGeneral, RespuestaLeido, RespuestaLocal } from "../../shared/chats/api.ts";

const RUTA_CHATS = "/api/chats";
const RUTA_LOCAL = "/api/chats/local";
const RUTA_GENERAL = "/api/chats/general";
const RUTA_LEIDO = "/api/chats/leido";

export const RUTAS_DEL_CLIENTE = Object.freeze({ chats: RUTA_CHATS, local: RUTA_LOCAL, general: RUTA_GENERAL, leido: RUTA_LEIDO });

const ESTADOS_DE_FALLA: readonly FallaChats["estado"][] = [
  "SIN_SESION",
  "NO_AUTORIZADO",
  "ERP_NO_DISPONIBLE",
  "SERVICIO_NO_DISPONIBLE",
  "SOLICITUD_INVALIDA",
  "ORIGEN_NO_PERMITIDO",
];

/** Una falla que vio el navegador: la pública de la API, la red caída, o un pedido que se canceló a propósito. */
export type FallaCliente = FallaChats | { readonly estado: "RED" } | { readonly estado: "CANCELADA" };

export type Resultado<T> = { readonly ok: true; readonly datos: T } | { readonly ok: false; readonly falla: FallaCliente };

type Ok<T> = Extract<T, { estado: "OK" }>;

/** La respuesta → resultado. Algo que no es la forma del contrato es SERVICIO_NO_DISPONIBLE, no se adivina. */
async function leer<T>(res: Response): Promise<Resultado<Ok<T>>> {
  const cuerpo = (await res.json().catch(() => null)) as { estado?: unknown; motivo?: unknown } | null;
  if (res.ok && cuerpo?.estado === "OK") return { ok: true, datos: cuerpo as Ok<T> };
  const estado = ESTADOS_DE_FALLA.find((e) => e === cuerpo?.estado);
  if (!res.ok && estado) {
    const falla: FallaChats = estado === "SIN_SESION" && cuerpo?.motivo === "VINCULO_INVALIDO" ? { estado, motivo: "VINCULO_INVALIDO" } : ({ estado } as FallaChats);
    return { ok: false, falla };
  }
  return { ok: false, falla: { estado: "SERVICIO_NO_DISPONIBLE" } };
}

async function pedir<T>(hacer: () => Promise<Response>, signal: AbortSignal | undefined): Promise<Resultado<Ok<T>>> {
  try {
    return await leer<T>(await hacer());
  } catch {
    return { ok: false, falla: signal?.aborted ? { estado: "CANCELADA" } : { estado: "RED" } };
  }
}

const OPCIONES = { cache: "no-store", credentials: "same-origin" } as const;

/** GET /api/chats. */
export function pedirChats(signal?: AbortSignal) {
  return pedir<RespuestaChats>(() => fetch(RUTA_CHATS, { ...OPCIONES, signal: signal ?? null }), signal);
}

/** GET /api/chats/local?localId=N[&cursor=C]. */
export function pedirLocal(localId: number, cursor: string | null, signal?: AbortSignal) {
  const q = new URLSearchParams({ localId: String(localId), ...(cursor ? { cursor } : {}) }).toString();
  return pedir<RespuestaLocal>(() => fetch(`${RUTA_LOCAL}?${q}`, { ...OPCIONES, signal: signal ?? null }), signal);
}

/** GET /api/chats/general[?cursor=C]. */
export function pedirGeneral(cursor: string | null, signal?: AbortSignal) {
  const q = new URLSearchParams(cursor ? { cursor } : {}).toString();
  return pedir<RespuestaGeneral>(() => fetch(`${RUTA_GENERAL}?${q}`, { ...OPCIONES, signal: signal ?? null }), signal);
}

/** POST /api/chats/leido: lo único que marca leído, y solo cuando una pantalla lo pide. */
export function marcarLeido(pedido: PedidoLeido) {
  return pedir<RespuestaLeido>(
    () => fetch(RUTA_LEIDO, { ...OPCIONES, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pedido) }),
    undefined,
  );
}
