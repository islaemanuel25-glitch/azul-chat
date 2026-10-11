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

import type { Vista } from "./logica.ts";

export type ComprobadorDeVersion = {
  /** Pide la versión con la que arranca la página. Una sola vez. */
  arrancar(): Promise<void>;
  /** Vuelve a pedirla y recarga si cambió. */
  comprobar(): Promise<void>;
};

const SHA = /^[0-9a-f]{40}$/;

export function crearComprobadorDeVersion({
  propia = null,
  yaRecargadoPor = null,
  pedir,
  recargar,
}: {
  /** El commit de ESTA página (el del HTML que la sirvió), o null si no se sabe. */
  propia?: string | null;
  /** El commit por el que esta pestaña ya recargó una vez (la marca de la URL). */
  yaRecargadoPor?: string | null;
  pedir: () => Promise<string | null>;
  recargar: (nueva: string) => void;
}): ComprobadorDeVersion {
  let referencia: string | null = propia;
  let enCurso: Promise<void> | null = null;
  let recargando = false;

  const consultar = (): Promise<void> => {
    if (enCurso) return enCurso;
    enCurso = pedir()
      .catch(() => null)
      .then((actual) => {
        if (actual === null || recargando) return;
        if (referencia === null) {
          referencia = actual;
          return;
        }
        if (actual === referencia) return;
        // Ya se recargó por este commit y la página sigue siendo otra: no se insiste (sin bucle).
        if (actual === yaRecargadoPor) return;
        recargando = true;
        recargar(actual);
      })
      .finally(() => {
        enCurso = null;
      });
    return enCurso;
  };

  return { arrancar: consultar, comprobar: consultar };
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
