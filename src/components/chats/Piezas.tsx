// PIEZAS CHICAS DE LOS CHATS: badge, avatar, estados y la tarjeta de un evento.
//
// Sin estado y sin red: reciben datos y los dibujan con las clases `ac-*` de
// src/app/globals.css, que leen los tokens del tema. Ningún color va escrito acá.

import type { EventoGeneral, EventoPublico } from "../../shared/chats/api.ts";
import { detalleDeDiferencias, formatearHora, iniciales, resumenDeEvento } from "./formato.ts";

/** El número de no leídos. Con 0, nada. El texto oculto dice qué es para un lector de pantalla. */
export function BadgeNoLeidos({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return null;
  return (
    <span className="ac-badge">
      <span aria-hidden="true">{cantidad > 99 ? "99+" : cantidad}</span>
      <span className="ac-oculto">{cantidad === 1 ? "1 sin leer" : `${cantidad} sin leer`}</span>
    </span>
  );
}

export function Avatar({ nombre, general = false }: { nombre: string; general?: boolean }) {
  return (
    <span className={general ? "ac-avatar ac-avatar--general" : "ac-avatar"} aria-hidden="true">
      {general ? "GE" : iniciales(nombre)}
    </span>
  );
}

/** "Actualización demorada": lo guardado se ve, pero traer lo nuevo falló. No es una caída. */
export function AvisoDemorada({ texto = "Actualización demorada" }: { texto?: string }) {
  return (
    <p className="ac-aviso" role="status">
      <span className="ac-aviso__punto" aria-hidden="true" />
      {texto}
    </p>
  );
}

/** Un estado que ocupa la pantalla: cargando, vacío o una falla, con su acción si la hay. */
export function EstadoChat({
  titulo,
  texto,
  accion,
  cargando = false,
}: {
  titulo?: string;
  texto: string;
  accion?: { readonly texto: string; readonly alTocar: () => void };
  cargando?: boolean;
}) {
  return (
    <section className="ac-estado" aria-live="polite" aria-busy={cargando || undefined}>
      {titulo && <h2 className="ac-estado__titulo">{titulo}</h2>}
      <p className="ac-estado__texto">{texto}</p>
      {accion && (
        <button type="button" className="ac-boton" onClick={accion.alTocar}>
          {accion.texto}
        </button>
      )}
    </section>
  );
}

/** P1: el ERP no respondió y no se pudo verificar el acceso. Reemplaza la vista: no hay historial detrás. */
export function EstadoErpNoDisponible({ alReintentar }: { alReintentar: () => void }) {
  return (
    <EstadoChat
      titulo="ERP Azul no responde"
      texto="Para ver el historial hace falta verificar tu acceso."
      accion={{ texto: "Reintentar", alTocar: alReintentar }}
    />
  );
}

/**
 * Una transferencia recibida, como burbuja de la conversación. En General
 * lleva arriba el local al que pertenece. Lo secundario —líneas con
 * diferencias, de dónde vino, la hora— va en una sola línea chica.
 */
export function TarjetaEvento({ evento, local, zona }: { evento: EventoPublico | EventoGeneral; local?: string; zona?: string }) {
  const detalle = detalleDeDiferencias(evento);
  const meta = [detalle, `Desde ${evento.origen.nombre}`, formatearHora(evento.fecha, zona)].filter(Boolean).join(" · ");
  return (
    <article className={evento.tieneDiferencias ? "ac-evento ac-evento--diferencias" : "ac-evento"}>
      {local && <p className="ac-evento__local">{local}</p>}
      <p className="ac-evento__titulo">
        {evento.tieneDiferencias && (
          <span className="ac-evento__marca" aria-hidden="true">
            ⚠
          </span>
        )}
        {resumenDeEvento(evento)}
      </p>
      <p className="ac-evento__meta">{meta}</p>
    </article>
  );
}
