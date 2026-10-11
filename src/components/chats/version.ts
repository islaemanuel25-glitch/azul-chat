// RECARGAR CUANDO EL SERVIDOR CAMBIÓ DE VERSIÓN (Tanda 3B).
//
// La app es una sola página que navega con history.pushState: una pestaña
// abierta antes de un despliegue sigue corriendo el JS viejo indefinidamente
// (el 10/10 una pestaña con 3d8b849 no mostró la barra de Ventas hasta
// cerrarla del todo).
//
// Por eso:
//   · al arrancar se pide GET /api/version y se guarda EN MEMORIA el commit
//     con el que arrancó la página;
//   · se vuelve a pedir SOLO en dos momentos: cuando la página vuelve a primer
//     plano (visibilitychange → visible) y al abrir un chat (Local o General).
//     Nada de intervalos ni temporizadores;
//   · si el commit cambió, `recargar()` (window.location.reload).
//
// Si /api/version falla o tarda, no se hace nada: ni recarga ni error. Si el
// pedido del arranque falló, el primer commit que se consiga después pasa a ser
// el de referencia (no hay otra forma de saber con qué arrancó). Un pedido en
// curso no se duplica. Nada se guarda en el navegador.
//
// Es una pieza sin React: pedir, recargar y el documento se inyectan, así los
// tests de test/ui la ejercen sin navegador.

import type { Vista } from "./logica.ts";

export type ComprobadorDeVersion = {
  /** Pide la versión con la que arranca la página. Una sola vez. */
  arrancar(): Promise<void>;
  /** Vuelve a pedirla y recarga si cambió. */
  comprobar(): Promise<void>;
};

export function crearComprobadorDeVersion({
  pedir,
  recargar,
}: {
  pedir: () => Promise<string | null>;
  recargar: () => void;
}): ComprobadorDeVersion {
  let deArranque: string | null = null;
  let enCurso: Promise<void> | null = null;
  let recargando = false;

  const consultar = (): Promise<void> => {
    if (enCurso) return enCurso;
    enCurso = pedir()
      .catch(() => null)
      .then((actual) => {
        if (actual === null || recargando) return;
        if (deArranque === null) {
          deArranque = actual;
          return;
        }
        if (actual !== deArranque) {
          recargando = true;
          recargar();
        }
      })
      .finally(() => {
        enCurso = null;
      });
    return enCurso;
  };

  return { arrancar: consultar, comprobar: consultar };
}

/** Lo mínimo del documento que hace falta: así un test pasa uno de mentira. */
export type DocumentoVisible = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;

/** Comprueba cada vez que la página vuelve a primer plano. Devuelve cómo desconectarlo. */
export function comprobarAlVolverAPrimerPlano(documento: DocumentoVisible, comprobador: ComprobadorDeVersion): () => void {
  const alCambiar = () => {
    if (documento.visibilityState === "visible") void comprobador.comprobar();
  };
  documento.addEventListener("visibilitychange", alCambiar);
  return () => documento.removeEventListener("visibilitychange", alCambiar);
}

/** Al abrir una vista: comprueba solo si es un chat (Local o General), no la lista. */
export function comprobarAlAbrir(vista: Vista, comprobador: ComprobadorDeVersion): void {
  if (vista.tipo === "LOCAL" || vista.tipo === "GENERAL") void comprobador.comprobar();
}
