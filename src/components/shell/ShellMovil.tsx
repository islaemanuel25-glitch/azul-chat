import type { ReactNode } from "react";

/**
 * El marco móvil de Azul Chat: encabezado con la marca y el contenido debajo.
 * Las pantallas del diseño (Chats, Pendientes, Configuración…) van adentro.
 */
export function ShellMovil({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="ac-shell">
      <header className="ac-encabezado">
        <h1 className="ac-encabezado__marca">{titulo}</h1>
      </header>
      <main className="ac-contenido">{children}</main>
    </div>
  );
}
