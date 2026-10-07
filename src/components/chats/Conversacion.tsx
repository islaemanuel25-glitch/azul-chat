"use client";

// UNA CONVERSACIÓN: EL HISTORIAL DE UN LOCAL, O GENERAL.
//
// Las dos funcionan igual y comparten todo menos de dónde salen los eventos:
//
//   · al abrir, GET de la primera página (30, del más reciente al más antiguo);
//   · se muestran como chat: lo más viejo arriba, lo más nuevo abajo, con un
//     separador por día;
//   · "Cargar anteriores" pide la página siguiente con el cursor opaco de la
//     API, la agrega sin repetir y deja la vista donde estaba;
//   · DESPUÉS de mostrar los eventos (un efecto corre después de dibujar), se
//     marca leído con POST /api/chats/leido: un Local, hasta el mayor id
//     mostrado; General, una marca por local con su propio mayor id. Si el POST
//     falla, la vista sigue y no se cuenta como leído;
//   · cualquier falla de la API al cargar reemplaza la vista: con
//     ERP_NO_DISPONIBLE no queda historial detrás (P1).
//
// Ningún GET marca leído, y no hay refresco automático.

import { Fragment, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";

import type { EventoGeneral, EventoPublico } from "../../shared/chats/api.ts";
import { ShellMovil } from "../shell/ShellMovil.tsx";
import { marcarLeido, pedirGeneral, pedirLocal, type FallaCliente, type Resultado } from "./clienteChats.ts";
import { diaDe, etiquetaDeDia } from "./formato.ts";
import {
  destinoDeFalla,
  marcaDeLocal,
  marcasDeEstado,
  marcasDeGeneral,
  ordenCronologico,
  reducirConversacion,
  type EstadoConversacion,
  type InfoGeneral,
  type InfoLocal,
  type Marca,
} from "./logica.ts";
import { AvisoDemorada, EstadoChat, EstadoErpNoDisponible, TarjetaEvento } from "./Piezas.tsx";

type Pagina<E, I> = { readonly eventos: readonly E[]; readonly siguiente: string | null; readonly info: I };
type PedirPagina<E, I> = (cursor: string | null, signal?: AbortSignal) => Promise<Resultado<Pagina<E, I>>>;
type AlPerderSesion = (motivo?: "VINCULO_INVALIDO") => void;

const raizDelScroll = () => document.scrollingElement ?? document.documentElement;

/** El estado de una conversación con su red: primera página, anteriores y marcar leído. */
function useConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral>(
  pedirPagina: PedirPagina<E, I>,
  marcas: (e: Extract<EstadoConversacion<E, I>, { fase: "LISTA" }>) => Marca[],
  alPerderSesion: AlPerderSesion,
) {
  const [estado, despachar] = useReducer(reducirConversacion<E, I>, { fase: "CARGANDO" });
  const [intento, setIntento] = useState(0);
  const enviada = useRef<string | null>(null);
  const distanciaAlFinal = useRef<number | null>(null);
  const primeraVista = useRef(true);

  const fallar = useCallback(
    (falla: FallaCliente) => {
      if (falla.estado === "SIN_SESION") return alPerderSesion(falla.motivo);
      despachar({ tipo: "FALLA", falla });
    },
    [alPerderSesion],
  );

  useEffect(() => {
    const control = new AbortController();
    despachar({ tipo: "CARGANDO" });
    primeraVista.current = true;
    void pedirPagina(null, control.signal).then((r) => {
      if (control.signal.aborted) return;
      if (r.ok) despachar({ tipo: "CARGADA", ...r.datos });
      else fallar(r.falla);
    });
    return () => control.abort();
  }, [pedirPagina, intento, fallar]);

  // La primera vez, al final (lo más nuevo); después de cargar anteriores, donde estaba.
  const cantidad = estado.fase === "LISTA" ? estado.eventos.length : -1;
  useLayoutEffect(() => {
    if (cantidad < 0) return;
    const raiz = raizDelScroll();
    if (primeraVista.current) {
      primeraVista.current = false;
      raiz.scrollTop = raiz.scrollHeight;
    } else if (distanciaAlFinal.current !== null) {
      raiz.scrollTop = raiz.scrollHeight - distanciaAlFinal.current;
      distanciaAlFinal.current = null;
    }
  }, [cantidad]);

  // Marcar leído: después de dibujar, lo que se mostró, una vez por marca.
  useEffect(() => {
    const lista = marcasDeEstado(estado, marcas);
    if (lista.length === 0) return;
    const clave = JSON.stringify(lista);
    if (enviada.current === clave) return;
    enviada.current = clave;
    void marcarLeido({ marcas: lista }).then((r) => {
      if (r.ok) {
        for (const l of r.datos.lecturas) despachar({ tipo: "LEIDO", localId: l.localId, leidoHasta: l.leidoHasta, noLeidos: l.noLeidos });
      } else if (r.falla.estado === "SIN_SESION") {
        alPerderSesion(r.falla.motivo);
      }
      // Cualquier otra falla: no se finge que se leyó. La vista sigue como está.
    });
  }, [estado, marcas, alPerderSesion]);

  const cargarAnteriores = () => {
    if (estado.fase !== "LISTA" || !estado.siguiente || estado.anteriores === "CARGANDO") return;
    const raiz = raizDelScroll();
    distanciaAlFinal.current = raiz.scrollHeight - raiz.scrollTop;
    despachar({ tipo: "PIDIENDO_ANTERIORES" });
    void pedirPagina(estado.siguiente).then((r) => {
      if (r.ok) despachar({ tipo: "ANTERIORES", eventos: r.datos.eventos, siguiente: r.datos.siguiente });
      else fallar(r.falla);
    });
  };

  return { estado, reintentar: () => setIntento((n) => n + 1), cargarAnteriores };
}

/** Los eventos como chat: del más viejo al más nuevo, con un separador por día. Sin red. */
export function ListaDeEventos<E extends EventoPublico>({
  eventos,
  local,
  ahora = new Date(),
  zona,
}: {
  eventos: readonly E[];
  local?: (e: E) => string;
  ahora?: Date;
  zona?: string;
}) {
  const cronologico = ordenCronologico(eventos);
  return (
    <ol className="ac-conversacion">
      {cronologico.map((e, i) => {
        const nuevoDia = i === 0 || diaDe(e.fecha, zona) !== diaDe(cronologico[i - 1]!.fecha, zona);
        return (
          <Fragment key={e.id}>
            {nuevoDia && (
              <li className="ac-dia">
                <span className="ac-dia__etiqueta">{etiquetaDeDia(e.fecha, ahora, zona)}</span>
              </li>
            )}
            <li>
              <TarjetaEvento evento={e} {...(local ? { local: local(e) } : {})} {...(zona ? { zona } : {})} />
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/** Lo que va debajo del encabezado de una conversación, según el estado. Exportado para los tests. */
export function CuerpoConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral>({
  estado,
  vacio,
  aviso,
  local,
  alReintentar,
  alVolver,
  alCargarAnteriores,
  ahora,
  zona,
}: {
  estado: EstadoConversacion<E, I>;
  vacio: string;
  aviso?: ReactNode;
  local?: (e: E) => string;
  alReintentar: () => void;
  alVolver: () => void;
  alCargarAnteriores: () => void;
  ahora?: Date;
  zona?: string;
}) {
  if (estado.fase === "CARGANDO") return <EstadoChat texto="Cargando conversación…" cargando />;
  if (estado.fase === "FALLA") {
    switch (destinoDeFalla(estado.falla)) {
      case "ERP_NO_DISPONIBLE":
        return <EstadoErpNoDisponible alReintentar={alReintentar} />;
      case "NO_AUTORIZADO":
        return <EstadoChat titulo="Sin acceso" texto="Este chat no está entre los que podés ver hoy." accion={{ texto: "Volver a chats", alTocar: alVolver }} />;
      case "SIN_RED":
        return <EstadoChat titulo="Sin conexión" texto="No hubo respuesta de Azul Chat." accion={{ texto: "Reintentar", alTocar: alReintentar }} />;
      default:
        return <EstadoChat titulo="No disponible" texto="Azul Chat no está disponible en este momento." accion={{ texto: "Reintentar", alTocar: alReintentar }} />;
    }
  }
  return (
    <>
      {aviso}
      {estado.siguiente && (
        <div className="ac-anteriores">
          <button
            type="button"
            className="ac-boton ac-boton--secundario"
            aria-label="Cargar eventos anteriores"
            onClick={alCargarAnteriores}
            disabled={estado.anteriores === "CARGANDO"}
          >
            {estado.anteriores === "CARGANDO" ? "Cargando anteriores…" : "Cargar anteriores"}
          </button>
          {estado.anteriores === "SIN_RED" && <p className="ac-mensaje">No se pudieron cargar. Probá de nuevo.</p>}
        </div>
      )}
      {estado.eventos.length === 0 ? (
        <EstadoChat texto={vacio} />
      ) : (
        <ListaDeEventos eventos={estado.eventos} {...(local ? { local } : {})} {...(ahora ? { ahora } : {})} {...(zona ? { zona } : {})} />
      )}
    </>
  );
}

// ── Un Local ────────────────────────────────────────────────────────────────

export function PantallaLocal({ localId, alVolver, alPerderSesion }: { localId: number; alVolver: () => void; alPerderSesion: AlPerderSesion }) {
  const pedirPagina = useCallback<PedirPagina<EventoPublico, InfoLocal>>(
    async (cursor, signal) => {
      const r = await pedirLocal(localId, cursor, signal);
      if (!r.ok) return r;
      const d = r.datos;
      return {
        ok: true,
        datos: {
          eventos: d.eventos,
          siguiente: d.siguiente,
          info: { tipo: "LOCAL", localId: d.local.localId, nombre: d.local.nombre, sincronizacion: d.sincronizacion, leidoHasta: d.leidoHasta, noLeidos: d.noLeidos },
        },
      };
    },
    [localId],
  );
  const marcas = useCallback(
    (e: Extract<EstadoConversacion<EventoPublico, InfoLocal>, { fase: "LISTA" }>) => {
      const m = marcaDeLocal(e.info.localId, e.eventos, e.info.leidoHasta);
      return m ? [m] : [];
    },
    [],
  );
  const { estado, reintentar, cargarAnteriores } = useConversacion(pedirPagina, marcas, alPerderSesion);
  const info = estado.fase === "LISTA" ? estado.info : null;

  return (
    <ShellMovil
      titulo={info?.nombre ?? "Chat"}
      subtitulo={info && info.noLeidos > 0 ? (info.noLeidos === 1 ? "1 sin leer" : `${info.noLeidos} sin leer`) : undefined}
      volver={{ etiqueta: "Volver a chats", alVolver }}
    >
      <CuerpoConversacion
        estado={estado}
        vacio="Todavía no hay eventos."
        aviso={info?.sincronizacion === "DEMORADA" ? <AvisoDemorada /> : undefined}
        alReintentar={reintentar}
        alVolver={alVolver}
        alCargarAnteriores={cargarAnteriores}
      />
    </ShellMovil>
  );
}

// ── General ─────────────────────────────────────────────────────────────────

export function PantallaGeneral({ alVolver, alPerderSesion }: { alVolver: () => void; alPerderSesion: AlPerderSesion }) {
  const pedirPagina = useCallback<PedirPagina<EventoGeneral, InfoGeneral>>(async (cursor, signal) => {
    const r = await pedirGeneral(cursor, signal);
    if (!r.ok) return r;
    const d = r.datos;
    return { ok: true, datos: { eventos: d.eventos, siguiente: d.siguiente, info: { tipo: "GENERAL", localesDemorados: d.localesDemorados, noLeidos: d.noLeidos } } };
  }, []);
  // Sin no leídos en General, no hay nada que marcar.
  const marcas = useCallback(
    (e: Extract<EstadoConversacion<EventoGeneral, InfoGeneral>, { fase: "LISTA" }>) => (e.info.noLeidos > 0 ? marcasDeGeneral(e.eventos) : []),
    [],
  );
  const { estado, reintentar, cargarAnteriores } = useConversacion(pedirPagina, marcas, alPerderSesion);
  const demorados = estado.fase === "LISTA" ? estado.info.localesDemorados.length : 0;

  return (
    <ShellMovil titulo="General" subtitulo="Eventos de todos los locales" volver={{ etiqueta: "Volver a chats", alVolver }}>
      <CuerpoConversacion
        estado={estado}
        vacio="Todavía no hay eventos para mostrar."
        aviso={demorados > 0 ? <AvisoDemorada texto={demorados === 1 ? "Actualización demorada en 1 local" : `Actualización demorada en ${demorados} locales`} /> : undefined}
        local={(e) => e.local.nombre}
        alReintentar={reintentar}
        alVolver={alVolver}
        alCargarAnteriores={cargarAnteriores}
      />
    </ShellMovil>
  );
}
