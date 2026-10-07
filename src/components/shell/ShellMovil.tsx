import type { ReactNode } from "react";

/**
 * El marco móvil de Azul Chat: encabezado con la marca y el contenido debajo.
 * Las pantallas del diseño (Chats, un Local, General…) van adentro.
 *
 * El encabezado queda fijo arriba al hacer scroll: volver y las acciones
 * siempre están a mano. `volver` dibuja la flecha con su etiqueta accesible;
 * `acciones` son botones de la pantalla (cada uno con su etiqueta).
 */
export function ShellMovil({
  titulo,
  subtitulo,
  volver,
  acciones,
  children,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  volver?: { readonly etiqueta: string; readonly alVolver: () => void };
  acciones?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ac-shell">
      <header className="ac-encabezado">
        {volver && (
          <button type="button" className="ac-boton-icono ac-boton-icono--sobre-marca" aria-label={volver.etiqueta} onClick={volver.alVolver}>
            <span aria-hidden="true">‹</span>
          </button>
        )}
        <div className="ac-encabezado__titulos">
          <h1 className="ac-encabezado__marca">{titulo}</h1>
          {subtitulo && <p className="ac-encabezado__subtitulo">{subtitulo}</p>}
        </div>
        {acciones && <div className="ac-encabezado__acciones">{acciones}</div>}
      </header>
      <main className="ac-contenido">{children}</main>
    </div>
  );
}
