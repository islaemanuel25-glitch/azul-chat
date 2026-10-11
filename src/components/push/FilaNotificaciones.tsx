"use client";

// LA FILA "NOTIFICACIONES" DEL PANEL QUE ABRE ☰ (Tanda 5A).
//
// Figma DpxKeDtugjdB8IfuGnHZcz, pantalla 06 "Configuración", sección
// Notificaciones (nodo 1:277), adaptada a lo que existe: UNA fila con el
// estado ("Activadas" / "Desactivadas") y el botón para cambiarlo. Si el
// navegador las bloqueó, se dice en una línea (solo se destraban desde la
// configuración del navegador). Nada de privacidad del push, horario de
// silencio, sonidos, IA ni saldo: no existen.
//
// Colores y medidas: los tokens `--ac-*` de globals.css, por sus clases.

import { useEffect, useState } from "react";

import { activar, desactivar, entornoDelNavegador, leerEstado, textoDeEstado, type EstadoNotificaciones } from "./notificaciones.ts";

/** Lo que se dibuja, sin efectos: separado para poder probarlo sin navegador. */
export function VistaNotificaciones({
  estado,
  trabajando,
  error,
  alActivar,
  alDesactivar,
}: {
  estado: EstadoNotificaciones | null;
  trabajando: boolean;
  error?: string;
  alActivar: () => void;
  alDesactivar: () => void;
}) {
  return (
    <section className="ac-ajustes" aria-labelledby="ac-ajustes-notificaciones">
      <h3 id="ac-ajustes-notificaciones" className="ac-ajustes__seccion">
        Notificaciones
      </h3>
      <div className="ac-ajuste">
        <div className="ac-ajuste__texto">
          <p className="ac-ajuste__titulo">Avisos en este teléfono</p>
          <p className="ac-ajuste__estado" aria-live="polite">
            {estado === null ? "Consultando…" : textoDeEstado(estado)}
          </p>
        </div>
        {estado === "ACTIVADAS" && (
          <button type="button" className="ac-pastilla-accion" onClick={alDesactivar} disabled={trabajando}>
            Desactivar
          </button>
        )}
        {estado === "DESACTIVADAS" && (
          <button type="button" className="ac-pastilla-accion" onClick={alActivar} disabled={trabajando}>
            Activar
          </button>
        )}
      </div>
      {estado === "BLOQUEADAS" && <p className="ac-ajustes__nota">El navegador las bloqueó: se habilitan desde la configuración del sitio.</p>}
      {error && <p className="ac-ajustes__nota">{error}</p>}
    </section>
  );
}

export function FilaNotificaciones() {
  const [estado, setEstado] = useState<EstadoNotificaciones | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let vigente = true;
    leerEstado(entornoDelNavegador())
      .then((e) => {
        if (vigente) setEstado(e);
      })
      .catch(() => {
        if (vigente) setEstado("DESACTIVADAS");
      });
    return () => {
      vigente = false;
    };
  }, []);

  const cambiar = async (accion: typeof activar) => {
    setTrabajando(true);
    setError(undefined);
    try {
      const r = await accion(entornoDelNavegador());
      setEstado(r.estado);
      setError(r.error);
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <VistaNotificaciones
      estado={estado}
      trabajando={trabajando}
      {...(error ? { error } : {})}
      alActivar={() => void cambiar(activar)}
      alDesactivar={() => void cambiar(desactivar)}
    />
  );
}
