// PIEZAS CHICAS DE LOS CHATS: badge, avatar, estados y la tarjeta de un evento.
//
// Sin estado y sin red: reciben datos y los dibujan con las clases `ac-*` de
// src/app/globals.css, que leen los tokens del tema. Ningún color va escrito acá.

import type { ReactNode } from "react";

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
  /** `deshabilitada`: en espera después de un rechazo por cupo (Tanda 5B). */
  accion?: { readonly texto: string; readonly alTocar: () => void; readonly deshabilitada?: boolean };
  cargando?: boolean;
}) {
  return (
    <section className="ac-estado" aria-live="polite" aria-busy={cargando || undefined}>
      {titulo && <h2 className="ac-estado__titulo">{titulo}</h2>}
      <p className="ac-estado__texto">{texto}</p>
      {accion && (
        <button type="button" className="ac-boton" onClick={accion.alTocar} disabled={accion.deshabilitada || undefined}>
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

/** El texto del rechazo por cupo del ERP, para la pantalla y para la tarjeta de ventas. */
export const TEXTO_CUPO_ERP = "Muchas consultas seguidas al ERP. Probá de nuevo en un minuto.";

/**
 * El ERP rechazó por cupo (Tanda 5B). Sigue siendo P1 —sin historial detrás—,
 * pero no dice "no responde": contestó. "Reintentar" queda deshabilitado
 * mientras dure la espera (logica.ts, ESPERA_TRAS_CUPO_MS).
 */
export function EstadoCupoErp({ alReintentar, enEspera }: { alReintentar: () => void; enEspera: boolean }) {
  return <EstadoChat texto={TEXTO_CUPO_ERP} accion={{ texto: "Reintentar", alTocar: alReintentar, deshabilitada: enEspera }} />;
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

/**
 * La barra fija de abajo del chat: UN chip, "Ventas" (si el local la anuncia),
 * y debajo, desde la Tanda 6A, la caja de preguntas (`children`, si hay IA).
 * Mientras consulta, el chip queda deshabilitado.
 */
export function BarraVentas({
  cargando = false,
  alPedir,
  enEspera = false,
  conVentas = true,
  etiqueta = "Acciones del local",
  children,
}: {
  cargando?: boolean;
  alPedir?: () => void;
  enEspera?: boolean;
  conVentas?: boolean;
  etiqueta?: string;
  children?: ReactNode;
}) {
  return (
    <nav className={children ? "ac-barra-acciones ac-barra-acciones--con-pregunta" : "ac-barra-acciones"} aria-label={etiqueta}>
      {conVentas && (
        <button type="button" className="ac-chip ac-chip--accion" onClick={alPedir} disabled={cargando || enEspera} aria-busy={cargando || undefined}>
          {cargando ? "Consultando ventas…" : "Ventas"}
        </button>
      )}
      {children}
    </nav>
  );
}

/** Lo que la tarjeta de ventas muestra: lo del ERP, de un local o (Tanda 6A) la suma que hizo el código. */
type VentasParaTarjeta = Pick<Extract<RespuestaVentas, { estado: "OK" }>, "totalVendido" | "cantidadVentas" | "mediosDePago"> & {
  readonly local: { readonly nombre: string };
  readonly advertencias?: Extract<RespuestaVentas, { estado: "OK" }>["advertencias"];
};

/**
 * Las ventas como las dio el ERP. Sin acciones adentro. El título es el de
 * hoy salvo que se diga otro (Tanda 6A: ayer, un rango, todos los locales);
 * `children` va al final (6A: una línea por local). Tanda 6B: `aviso` va
 * arriba de todo (lo que la respuesta no separa) y `subtituloMedios`, si
 * viene, encabeza las líneas de medios de pago.
 */
export function TarjetaVentas({
  ventas,
  titulo,
  aviso = null,
  subtituloMedios,
  children,
}: {
  ventas: VentasParaTarjeta;
  titulo?: string;
  aviso?: string | null;
  subtituloMedios?: string;
  children?: ReactNode;
}) {
  const t = titulo ?? tituloDeVentas(ventas.local.nombre);
  return (
    <article className="ac-ventas" aria-label={t}>
      {aviso && <AvisoDeRespuesta texto={aviso} />}
      <p className="ac-ventas__titulo">{t}</p>
      <p className="ac-ventas__total">{formatearMonto(ventas.totalVendido)}</p>
      <p className="ac-ventas__linea">{cantidadDeVentas(ventas.cantidadVentas)}</p>
      {subtituloMedios && ventas.mediosDePago.length > 0 && <SubtituloDeTarjeta texto={subtituloMedios} />}
      {ventas.mediosDePago.map((m) => (
        <p key={m.medio} className="ac-ventas__linea">
          {lineaDeMedioDePago(m)}
        </p>
      ))}
      {(ventas.advertencias ?? []).map((a) => (
        <p key={a.codigo} className="ac-ventas__advertencia">
          {a.mensaje}
        </p>
      ))}
      {children}
    </article>
  );
}

/** Tanda 6B: lo que una respuesta no separa, arriba de la tarjeta. El texto lo arma `avisoNoSepara`. */
export function AvisoDeRespuesta({ texto }: { texto: string }) {
  return (
    <p className="ac-ventas__aviso" role="note">
      {texto}
    </p>
  );
}

/** Tanda 6B: un subtítulo dentro de una tarjeta ("Por medio de pago", "Por local"). */
export function SubtituloDeTarjeta({ texto }: { texto: string }) {
  return <p className="ac-ventas__subtitulo">{texto}</p>;
}

/**
 * No hubo respuesta buena del ERP. Reintentar es un toque de la persona, nunca
 * automático. Por cupo (Tanda 5B), su texto y Reintentar en espera.
 */
export function TarjetaVentasFalla({ alReintentar, cupo = false, enEspera = false }: { alReintentar: () => void; cupo?: boolean; enEspera?: boolean }) {
  return (
    <article className="ac-ventas ac-ventas--falla" role="alert">
      <p className="ac-ventas__falla">{cupo ? TEXTO_CUPO_ERP : "No se pudo consultar ERP Azul."}</p>
      <button type="button" className="ac-pastilla-accion" onClick={alReintentar} disabled={enEspera || undefined}>
        Reintentar
      </button>
    </article>
  );
}

/** Lo que va al final del historial según el estado de la consulta. */
export function ResultadoVentas({ estado, alReintentar, enEspera = false }: { estado: EstadoVentas; alReintentar: () => void; enEspera?: boolean }) {
  if (estado.fase === "LISTA") return <TarjetaVentas ventas={estado.ventas} />;
  if (estado.fase === "FALLA") return <TarjetaVentasFalla alReintentar={alReintentar} cupo={estado.cupo} enEspera={enEspera} />;
  return null;
}
