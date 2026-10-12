"use client";

// LA FILA "NOTIFICACIONES" DEL PANEL QUE ABRE ☰ (Tanda 5A).
//
// Figma DpxKeDtugjdB8IfuGnHZcz, pantalla 06 "Configuración", sección
// Notificaciones (nodo 1:277), adaptada a lo que existe: UNA fila con el
// estado ("Activadas" / "Desactivadas") y el botón para cambiarlo. Si el
// navegador las bloqueó, se dice en una línea (solo se destraban desde la
// configuración del navegador). Tanda 11: el estado es el REAL, el del
// servidor ("No están llegando" + "Reactivar"), y debajo, en la misma sección,
// el horario de silencio (sesion/Configuracion.tsx). Privacidad del push y
// sonidos por tipo siguen sin existir.
//
// Colores y medidas: los tokens `--ac-*` de globals.css, por sus clases.

import { useEffect, useState, type ReactNode } from "react";

import { activar, desactivar, entornoDelNavegador, leerEstado, reactivar, textoDeEstado, type EstadoNotificaciones } from "./notificaciones.ts";

/** Lo que se dibuja, sin efectos: separado para poder probarlo sin navegador. */
export function VistaNotificaciones({
  estado,
  trabajando,
  error,
  alActivar,
  alDesactivar,
  alReactivar,
  children,
}: {
  estado: EstadoNotificaciones | null;
  trabajando: boolean;
  error?: string;
  alActivar: () => void;
  alDesactivar: () => void;
  /** Tanda 11: el navegador está suscripto y el servidor no: volver a mandarla, sin pedir permiso. */
  alReactivar: () => void;
  /** Tanda 11: lo que va debajo en la misma sección (el horario de silencio). */
  children?: ReactNode;
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
        {estado === "NO_LLEGAN" && (
          <button type="button" className="ac-pastilla-accion" onClick={alReactivar} disabled={trabajando}>
            Reactivar
          </button>
        )}
      </div>
      {estado === "BLOQUEADAS" && <p className="ac-ajustes__nota">El navegador las bloqueó: se habilitan desde la configuración del sitio.</p>}
      {estado === "NO_LLEGAN" && <p className="ac-ajustes__nota">Este teléfono quedó suscripto, pero Azul Chat no lo tiene registrado: los avisos no llegan.</p>}
      {error && <p className="ac-ajustes__nota">{error}</p>}
      {children}
    </section>
  );
}

export function FilaNotificaciones({ children }: { children?: ReactNode } = {}) {
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
      alReactivar={() => void cambiar(reactivar)}
    >
      {children}
    </VistaNotificaciones>
  );
}
