// PIEZAS CHICAS DE LOS CHATS: badge, avatar, estados y la tarjeta de un evento.
//
// Sin estado y sin red: reciben datos y los dibujan con las clases `ac-*` de
// src/app/globals.css, que leen los tokens del tema. Ningún color va escrito acá.

import type { EventoGeneral, EventoPublico, RespuestaVentas } from "../../shared/chats/api.ts";
import {
  cantidadDeVentas,
  esAlerta,
  formatearMonto,
  iniciales,
  lineaDeMedioDePago,
  metaDeEvento,
  resumenDeEvento,
  tituloDeVentas,
} from "./formato.ts";
import type { EstadoVentas } from "./logica.ts";

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
 * Un evento, como burbuja de la conversación: el MISMO componente para los
 * cuatro tipos (recibida, pedido, enviada, cancelada), sin colores nuevos. En
 * General lleva arriba el local al que pertenece. Lo secundario —origen,
 * líneas, la hora— va en una sola línea chica (formato.ts, metaDeEvento). Solo
 * una recepción con diferencias lleva marca y borde de alerta. Sin acciones.
 */
export function TarjetaEvento({ evento, local, zona }: { evento: EventoPublico | EventoGeneral; local?: string; zona?: string }) {
  const alerta = esAlerta(evento);
  return (
    <article className={alerta ? "ac-evento ac-evento--diferencias" : "ac-evento"}>
      {local && <p className="ac-evento__local">{local}</p>}
      <p className="ac-evento__titulo">
        {alerta && (
          <span className="ac-evento__marca" aria-hidden="true">
            ⚠
          </span>
        )}
        {resumenDeEvento(evento)}
      </p>
      <p className="ac-evento__meta">{metaDeEvento(evento, zona)}</p>
    </article>
  );
}

// ── Ventas de hoy (Tanda 3A) ────────────────────────────────────────────────
//
// Figma "Azul Chat — Mobile V1": el chip es el nodo 1:142, la tarjeta 1:127 y
// la falla 1:329. De la tarjeta van el título, el total, la cantidad y una
// línea por medio de pago; sus acciones ("Ver detalle", "Comparar") NO: no
// existen todavía (test/frontera/alcanceUi.test.ts).

/** La barra fija de abajo del chat de un Local: UN chip, "Ventas". Mientras consulta, deshabilitado. */
export function BarraVentas({ cargando, alPedir }: { cargando: boolean; alPedir: () => void }) {
  return (
    <nav className="ac-barra-acciones" aria-label="Acciones del local">
      <button type="button" className="ac-chip ac-chip--accion" onClick={alPedir} disabled={cargando} aria-busy={cargando || undefined}>
        {cargando ? "Consultando ventas…" : "Ventas"}
      </button>
    </nav>
  );
}

/** Las ventas de hoy como las dio el ERP. Sin acciones adentro. */
export function TarjetaVentas({ ventas }: { ventas: Extract<RespuestaVentas, { estado: "OK" }> }) {
  return (
    <article className="ac-ventas" aria-label={tituloDeVentas(ventas.local.nombre)}>
      <p className="ac-ventas__titulo">{tituloDeVentas(ventas.local.nombre)}</p>
      <p className="ac-ventas__total">{formatearMonto(ventas.totalVendido)}</p>
      <p className="ac-ventas__linea">{cantidadDeVentas(ventas.cantidadVentas)}</p>
      {ventas.mediosDePago.map((m) => (
        <p key={m.medio} className="ac-ventas__linea">
          {lineaDeMedioDePago(m)}
        </p>
      ))}
      {ventas.advertencias.map((a) => (
        <p key={a.codigo} className="ac-ventas__advertencia">
          {a.mensaje}
        </p>
      ))}
    </article>
  );
}

/** No hubo respuesta buena del ERP. Reintentar es un toque de la persona, nunca automático. */
export function TarjetaVentasFalla({ alReintentar }: { alReintentar: () => void }) {
  return (
    <article className="ac-ventas ac-ventas--falla" role="alert">
      <p className="ac-ventas__falla">No se pudo consultar ERP Azul.</p>
      <button type="button" className="ac-pastilla-accion" onClick={alReintentar}>
        Reintentar
      </button>
    </article>
  );
}

/** Lo que va al final del historial según el estado de la consulta. */
export function ResultadoVentas({ estado, alReintentar }: { estado: EstadoVentas; alReintentar: () => void }) {
  if (estado.fase === "LISTA") return <TarjetaVentas ventas={estado.ventas} />;
  if (estado.fase === "FALLA") return <TarjetaVentasFalla alReintentar={alReintentar} />;
  return null;
}
