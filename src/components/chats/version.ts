// RECARGAR CUANDO EL SERVIDOR CAMBIÓ DE VERSIÓN (Tanda 3B).
//
// La app es una sola página que navega con history.pushState: una pestaña
// abierta antes de un despliegue sigue corriendo el JS viejo indefinidamente
// (el 10/10 una pestaña con 3d8b849 no mostró la barra de Ventas hasta
// cerrarla del todo).
//
// Por eso:
//   · se vuelve a pedir GET /api/version en tres momentos: cuando la página
//     vuelve a primer plano (visibilitychange → visible, y desde la Tanda 6C
//     también `pageshow` —la vuelta desde la caché de atrás/adelante— y `focus`
//     de la ventana) y al abrir un chat (Local o General). Nada de intervalos
//     ni temporizadores;
//   · si el commit cambió, `recargar()`.
//
// ── Tanda 6C: LA REFERENCIA ES LA VERSIÓN DE ESTA PÁGINA, NO LA DEL SERVIDOR ──
//
// Hasta la 6B, la referencia era el commit que contestaba el servidor AL
// ARRANCAR la página. El 11/10, 13 minutos después de desplegar dda5b80, un
// Android siguió corriendo el JS anterior: el navegador volvió a mostrar la
// página vieja (HTML y chunks de su caché, al restaurar la pestaña o la app),
// ese JS viejo arrancó, preguntó /api/version, recibió dda5b80… y lo tomó como
// SU versión. Desde ahí, cada comparación daba "igual" y no recargaba nunca.
//
// Ahora la página trae su propio commit (`propia`, lo escribe el servidor en el
// HTML que la sirvió: src/app/page.tsx) y se compara contra ese. Una página
// vieja que arranca con un servidor nuevo recarga en el arranque mismo. Si la
// página no sabe su commit (desarrollo, sin APP_BUILD_ID), se usa lo de antes:
// el primer commit que conteste el servidor.
//
// Para no recargar en bucle si el navegador insistiera en servir la página
// vieja: la recarga deja en la URL `#recarga=<commit>`, y si después de recargar
// la página sigue sin ser esa versión, no se insiste por ese mismo commit. La
// marca se lee y se borra al arrancar (leerMarcaDeRecarga, urlSinMarca). No es
// almacenamiento: es la URL de esa pestaña.
//
// Si /api/version falla o tarda, no se hace nada: ni recarga ni error. Un
// pedido en curso no se duplica. Nada se guarda en el navegador.
//
// Es una pieza sin React: pedir, recargar, el documento y la ventana se
// inyectan, así los tests de test/ui la ejercen sin navegador.

// ── Tanda 6D: EN CADA RESPUESTA, Y SIN BORRARLE NADA A LA PERSONA ──────────
//
// Quedaba un hueco: quien se queda DENTRO de un chat usando Ventas, Actualizar
// o preguntas no vuelve a primer plano ni abre otro chat, así que nunca se
// comparaba. Ahora toda respuesta de las rutas propias trae el commit de la
// imagen en `X-Azul-Chat-Commit` (shared/version/cabecera.ts), y los clientes
// HTTP de la interfaz se lo pasan a `anotarCommitDe` en CADA respuesta. Si no
// es el de la página, recarga, con la misma marca anti-bucle.
//
// Salvo que haya algo que se perdería: texto escrito en la caja de preguntas,
// o una pregunta esperando su respuesta. Mientras tanto la recarga queda
// RETENIDA (`retenerRecarga`) y se hace apenas se libera: al enviar y llegar
// la respuesta, o al vaciar la caja. Nada de temporizadores: lo dispara el
// cambio mismo.

import { CABECERA_COMMIT, SHA_COMPLETO } from "../../shared/version/cabecera.ts";
import type { Vista } from "./logica.ts";

export type ComprobadorDeVersion = {
  /** Pide la versión con la que arranca la página. Una sola vez. */
  arrancar(): Promise<void>;
  /** Vuelve a pedirla y recarga si cambió. */
  comprobar(): Promise<void>;
  /** Tanda 6D: el commit que vino en una respuesta. Recarga si no es el de la página (o lo deja pendiente si está retenida). */
  anotar(commit: string): void;
  /** Tanda 6D: se liberó la retención; si había una recarga pendiente, se hace ahora. */
  liberar(): void;
};

const SHA = SHA_COMPLETO;

export function crearComprobadorDeVersion({
  propia = null,
  yaRecargadoPor = null,
  pedir,
  recargar,
  retenida = () => false,
}: {
  /** El commit de ESTA página (el del HTML que la sirvió), o null si no se sabe. */
  propia?: string | null;
  /** El commit por el que esta pestaña ya recargó una vez (la marca de la URL). */
  yaRecargadoPor?: string | null;
  pedir: () => Promise<string | null>;
  recargar: (nueva: string) => void;
  /** Tanda 6D: ¿hay algo que se perdería al recargar ahora? (recargaRetenida). */
  retenida?: () => boolean;
}): ComprobadorDeVersion {
  let referencia: string | null = propia;
  let enCurso: Promise<void> | null = null;
  let recargando = false;
  /** Tanda 6D: el commit por el que hay que recargar apenas se libere. */
  let pendiente: string | null = null;

  /** Lo que se hace con un commit del servidor, venga de /api/version o de cualquier respuesta. */
  const decidir = (actual: string | null) => {
    if (actual === null || recargando) return;
    if (referencia === null) {
      referencia = actual;
      return;
    }
    if (actual === referencia) return;
    // Ya se recargó por este commit y la página sigue siendo otra: no se insiste (sin bucle).
    if (actual === yaRecargadoPor) return;
    if (retenida()) {
      pendiente = actual;
      return;
    }
    recargando = true;
    recargar(actual);
  };

  const consultar = (): Promise<void> => {
    if (enCurso) return enCurso;
    enCurso = pedir()
      .catch(() => null)
      .then(decidir)
      .finally(() => {
        enCurso = null;
      });
    return enCurso;
  };

  return {
    arrancar: consultar,
    comprobar: consultar,
    anotar: (commit) => decidir(SHA.test(commit) ? commit : null),
    liberar: () => {
      if (pendiente === null || retenida()) return;
      const p = pendiente;
      pendiente = null;
      decidir(p);
    },
  };
}

// ── Tanda 6D: el commit de cada respuesta ───────────────────────────────────

/** A quién se le pasa el commit de cada respuesta: el comprobador de la página (AzulChat). Uno solo. */
let alVerCommit: ((commit: string) => void) | null = null;

/** Conecta el comprobador a las respuestas. Devuelve cómo desconectarlo. */
export function escucharCommitDeRespuestas(f: (commit: string) => void): () => void {
  alVerCommit = f;
  return () => {
    if (alVerCommit === f) alVerCommit = null;
  };
}

/**
 * Lo llaman los clientes HTTP de la interfaz con CADA respuesta de una ruta
 * propia: si trae un commit completo en `X-Azul-Chat-Commit`, se compara.
 * Sin cabecera (o con otra cosa), nada.
 */
export function anotarCommitDe(res: { readonly headers: Pick<Headers, "get"> }): void {
  const commit = res.headers.get(CABECERA_COMMIT);
  if (commit !== null && SHA.test(commit)) alVerCommit?.(commit);
}

// ── Tanda 6D: lo que retiene la recarga ─────────────────────────────────────

/** Qué está reteniendo la recarga ahora (la caja con texto, una pregunta en curso). */
const retenciones = new Set<string>();
let alLiberar: (() => void) | null = null;

/**
 * Marca (o desmarca) algo que se perdería al recargar. Cuando ya no queda
 * ninguno, avisa (`alLiberarRecarga`): si había una recarga pendiente, se hace.
 */
export function retenerRecarga(clave: string, retener: boolean): void {
  const habia = retenciones.size > 0;
  if (retener) retenciones.add(clave);
  else retenciones.delete(clave);
  if (habia && retenciones.size === 0) alLiberar?.();
}

/** ¿Hay algo que se perdería al recargar ahora? */
export const recargaRetenida = (): boolean => retenciones.size > 0;

/** Qué hacer cuando se libera la última retención. Devuelve cómo desconectarlo. */
export function alLiberarRecarga(f: () => void): () => void {
  alLiberar = f;
  return () => {
    if (alLiberar === f) alLiberar = null;
  };
}

/** La marca que deja una recarga por versión en la URL: `#recarga=<commit>`. */
const MARCA = /^#recarga=([0-9a-f]{40})$/;

/** El commit de la marca de recarga, o null si la URL no la trae. */
export function leerMarcaDeRecarga(hash: string): string | null {
  return MARCA.exec(hash)?.[1] ?? null;
}

/** La URL de ahora con la marca de recarga por `commit`. */
export function urlConMarca(u: { readonly pathname: string; readonly search: string }, commit: string): string {
  if (!SHA.test(commit)) return `${u.pathname}${u.search}`;
  return `${u.pathname}${u.search}#recarga=${commit}`;
}

/** La URL de ahora sin la marca (la vista sigue en la consulta). */
export function urlSinMarca(u: { readonly pathname: string; readonly search: string }): string {
  return `${u.pathname}${u.search}`;
}

/** Lo mínimo del documento que hace falta: así un test pasa uno de mentira. */
export type DocumentoVisible = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
/** Lo mínimo de la ventana (Tanda 6C): `pageshow` y `focus`. */
export type VentanaVisible = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * Comprueba cada vez que la página vuelve a primer plano: visibilitychange a
 * visible, `pageshow` (también la vuelta desde la caché de atrás/adelante, que
 * no siempre avisa con visibilitychange) y `focus` de la ventana. Los avisos que
 * llegan juntos se juntan en un pedido (el comprobador no duplica). Devuelve
 * cómo desconectarlo.
 */
export function comprobarAlVolverAPrimerPlano(documento: DocumentoVisible, ventana: VentanaVisible, comprobador: ComprobadorDeVersion): () => void {
  const alCambiar = () => {
    if (documento.visibilityState === "visible") void comprobador.comprobar();
  };
  documento.addEventListener("visibilitychange", alCambiar);
  ventana.addEventListener("pageshow", alCambiar);
  ventana.addEventListener("focus", alCambiar);
  return () => {
    documento.removeEventListener("visibilitychange", alCambiar);
    ventana.removeEventListener("pageshow", alCambiar);
    ventana.removeEventListener("focus", alCambiar);
  };
}

/** Al abrir una vista: comprueba solo si es un chat (Local o General), no la lista. */
export function comprobarAlAbrir(vista: Vista, comprobador: ComprobadorDeVersion): void {
  if (vista.tipo === "LOCAL" || vista.tipo === "GENERAL") void comprobador.comprobar();
}
