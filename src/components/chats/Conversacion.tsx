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
//   · un Local marca leído con POST /api/chats/leido DESPUÉS de mostrar los
//     eventos (un efecto corre después de dibujar), y solo cuando puede
//     demostrar que todos sus no leídos están a la vista (logica.ts,
//     decidirLecturaLocal). Si faltan, avisa "Hay más eventos sin leer" y no
//     marca. Si el POST falla, la vista sigue y no se cuenta como leído;
//   · General NO marca leído: su respuesta no dice cuántos no leídos tiene cada
//     local, así que no puede demostrar que los mostró todos. Es solo lectura
//     visual (docs/INTERFAZ.md);
//   · cualquier falla de la API al cargar reemplaza la vista: con
//     ERP_NO_DISPONIBLE no queda historial detrás (P1). Con el rechazo por cupo
//     del ERP (Tanda 5B), su propio texto y "Reintentar" en espera 20 s.
//
// El título de un Local es el nombre que da la API; mientras carga, o si la
// carga falla, el que ya se conocía de la lista (viaja en la URL); si no se
// conoce, "Chat".
//
// Ningún GET marca leído, y no hay refresco automático.
//
// Tanda 3A: un Local cuyo `mi_alcance` anuncia `ventas_resumen` lleva abajo una
// barra fija con UN chip, "Ventas". Tocarlo consulta las ventas de hoy y deja la
// tarjeta al final del historial; no toca la lectura. General no lleva barra.
// Tanda 7B: si anuncia `cajas_resumen`, al lado va "Caja": las cajas de hoy por
// turno (Cajas.tsx), con los mismos estados que Ventas.
// Tanda 9B: "Pendientes" (Pendientes.tsx) al final de la barra del Local y,
// desde esta tanda, también en la de General: el primer chip de General.
// Tanda 10: la lupa del encabezado abre Buscar en este chat (Buscar.tsx).

import { Fragment, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";

import type { EventoGeneral, EventoPublico } from "../../shared/chats/api.ts";
import type { PreguntaGuardada } from "../../shared/chats/preguntas.ts";
import { ShellMovil } from "../shell/ShellMovil.tsx";
import {
  marcarLeido,
  pedirCaja,
  pedirGeneral,
  pedirLocal,
  pedirPendientes,
  pedirPendientesGeneral,
  pedirStock,
  pedirVentas,
  type FallaCliente,
  type Resultado,
} from "./clienteChats.ts";
import { ResultadoCaja } from "./Cajas.tsx";
import { ResultadoPendientes } from "./Pendientes.tsx";
import { ResultadoStock } from "./Stock.tsx";
import { useEsperaTrasCupo } from "./esperaCupo.ts";
import { diaDe, etiquetaDeDia } from "./formato.ts";
import {
  decidirLecturaLocal,
  destinoDeFalla,
  elementosEnOrden,
  reducirCaja,
  reducirPendientes,
  reducirStock,
  reducirConversacion,
  reducirVentas,
  sinLasGuardadas,
  tituloDeLocal,
  type AccionConversacion,
  type EstadoCaja,
  type EstadoPendientes,
  type EstadoStock,
  type PendientesListos,
  type EstadoConversacion,
  type EstadoVentas,
  type InfoGeneral,
  type InfoLocal,
} from "./logica.ts";
import { CajaPregunta, ListaDePreguntas, PreguntaGuardadaVista, TEXTO_CAJA, usePreguntas } from "./Preguntas.tsx";
import { AvisoDemorada, BarraVentas, BotonBuscar, EstadoChat, EstadoCupoErp, EstadoErpNoDisponible, ResultadoVentas, TarjetaEvento } from "./Piezas.tsx";

type Pagina<E, I> = { readonly eventos: readonly E[]; readonly guardadas: readonly PreguntaGuardada[]; readonly siguiente: string | null; readonly info: I };
type PedirPagina<E, I> = (cursor: string | null, signal?: AbortSignal) => Promise<Resultado<Pagina<E, I>>>;
type AlPerderSesion = (motivo?: "VINCULO_INVALIDO") => void;

const raizDelScroll = () => document.scrollingElement ?? document.documentElement;

/** El estado de una conversación con su red: primera página y anteriores. No marca leído. `alFallar` ve cada falla (la espera por cupo). */
function useConversacion<E extends EventoPublico, I extends InfoLocal | InfoGeneral>(
  pedirPagina: PedirPagina<E, I>,
  alPerderSesion: AlPerderSesion,
  alFallar: (f: FallaCliente) => void,
) {
  const [estado, despachar] = useReducer(reducirConversacion<E, I>, { fase: "CARGANDO" });
  const [intento, setIntento] = useState(0);
  const distanciaAlFinal = useRef<number | null>(null);
  const primeraVista = useRef(true);

  const fallar = useCallback(
    (falla: FallaCliente) => {
      if (falla.estado === "SIN_SESION") return alPerderSesion(falla.motivo);
      alFallar(falla);
      despachar({ tipo: "FALLA", falla });
    },
    [alPerderSesion, alFallar],
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

  const cargarAnteriores = () => {
    if (estado.fase !== "LISTA" || !estado.siguiente || estado.anteriores === "CARGANDO") return;
    const raiz = raizDelScroll();
    distanciaAlFinal.current = raiz.scrollHeight - raiz.scrollTop;
    despachar({ tipo: "PIDIENDO_ANTERIORES" });
    void pedirPagina(estado.siguiente).then((r) => {
      if (r.ok) despachar({ tipo: "ANTERIORES", eventos: r.datos.eventos, guardadas: r.datos.guardadas, siguiente: r.datos.siguiente });
      else fallar(r.falla);
    });
  };

  return { estado, despachar, reintentar: () => setIntento((n) => n + 1), cargarAnteriores };
}

/**
 * La lectura de un Local: después de dibujar, si `decidirLecturaLocal` puede
 * demostrar que todos los no leídos están a la vista, un POST hasta el mayor id
 * nuevo mostrado; una vez por avance. Se vuelve a evaluar con cada cambio del
 * estado, así que cargar anteriores puede completar lo que faltaba. Devuelve la
 * decisión para que la pantalla avise si faltan.
 */
function useLecturaLocal<E extends EventoPublico>(
  estado: EstadoConversacion<E, InfoLocal>,
  despachar: (a: AccionConversacion<E, InfoLocal>) => void,
  alPerderSesion: AlPerderSesion,
) {
  const decision = decidirLecturaLocal(estado);
  const enviada = useRef<string | null>(null);
  const clave = decision.tipo === "MARCAR" ? `${decision.marca.localId}:${decision.marca.hastaEventoId}` : null;
  useEffect(() => {
    if (decision.tipo !== "MARCAR" || clave === null || enviada.current === clave) return;
    enviada.current = clave;
    const { marca } = decision;
    void marcarLeido({ marcas: [marca] }).then((r) => {
      if (r.ok) {
        const l = r.datos.lecturas.find((x) => x.localId === marca.localId);
        if (l) despachar({ tipo: "LEIDO", localId: l.localId, leidoHasta: l.leidoHasta, noLeidos: l.noLeidos });
      } else if (r.falla.estado === "SIN_SESION") {
        alPerderSesion(r.falla.motivo);
      }
      // Cualquier otra falla: no se finge que se leyó. La vista sigue como está.
    });
    // `decision` se deriva del estado; `clave` resume lo que importa de ella.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, despachar, alPerderSesion]);
  return decision;
}

/** Los eventos como chat: del más viejo al más nuevo, con un separador por día. Sin red. */
export function ListaDeEventos<E extends EventoPublico>({
  eventos,
  guardadas = [],
  local,
  ahora = new Date(),
  zona,
}: {
  eventos: readonly E[];
  /** Tanda 6C: las preguntas guardadas, intercaladas por hora con los eventos. */
  guardadas?: readonly PreguntaGuardada[];
  local?: (e: E) => string;
  ahora?: Date;
  zona?: string;
}) {
  const cronologico = elementosEnOrden(eventos, guardadas);
  return (
    <ol className="ac-conversacion">
      {cronologico.map((x, i) => {
        const nuevoDia = i === 0 || diaDe(x.fecha, zona) !== diaDe(cronologico[i - 1]!.fecha, zona);
        return (
          <Fragment key={x.tipo === "EVENTO" ? x.evento.id : `p${x.guardada.id}`}>
            {nuevoDia && (
              <li className="ac-dia">
                <span className="ac-dia__etiqueta">{etiquetaDeDia(x.fecha, ahora, zona)}</span>
              </li>
            )}
            <li>
              {x.tipo === "EVENTO" ? (
                <TarjetaEvento evento={x.evento} {...(local ? { local: local(x.evento) } : {})} {...(zona ? { zona } : {})} />
              ) : (
                <PreguntaGuardadaVista guardada={x.guardada} {...(zona ? { zona } : {})} />
              )}
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
  masSinLeer = false,
  local,
  alReintentar,
  enEspera = false,
  alVolver,
  alCargarAnteriores,
  ahora,
  zona,
}: {
  estado: EstadoConversacion<E, I>;
  vacio: string;
  aviso?: ReactNode;
  /** Hay no leídos que todavía no están cargados (solo un Local lo sabe). */
  masSinLeer?: boolean;
  local?: (e: E) => string;
  alReintentar: () => void;
  /** "Reintentar" en espera después de un rechazo por cupo (Tanda 5B). */
  enEspera?: boolean;
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
      case "CUPO_ERP":
        return <EstadoCupoErp alReintentar={alReintentar} enEspera={enEspera} />;
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
      {(estado.siguiente || masSinLeer) && (
        <div className="ac-anteriores">
          {masSinLeer && (
            <p className="ac-mensaje ac-anteriores__mas" role="status">
              Hay más eventos sin leer
            </p>
          )}
          {estado.siguiente && (
          <button
            type="button"
            className="ac-boton ac-boton--secundario"
            aria-label="Cargar eventos anteriores"
            onClick={alCargarAnteriores}
            disabled={estado.anteriores === "CARGANDO"}
          >
            {estado.anteriores === "CARGANDO" ? "Cargando anteriores…" : "Cargar anteriores"}
          </button>
          )}
          {estado.anteriores === "SIN_RED" && <p className="ac-mensaje">No se pudieron cargar. Probá de nuevo.</p>}
        </div>
      )}
      {estado.eventos.length === 0 && estado.guardadas.length === 0 ? (
        <EstadoChat texto={vacio} />
      ) : (
        <ListaDeEventos
          eventos={estado.eventos}
          guardadas={estado.guardadas}
          {...(local ? { local } : {})}
          {...(ahora ? { ahora } : {})}
          {...(zona ? { zona } : {})}
        />
      )}
    </>
  );
}

// ── Un Local ────────────────────────────────────────────────────────────────

export function PantallaLocal({
  localId,
  nombreConocido,
  alVolver,
  alPerderSesion,
  alBuscar,
}: {
  localId: number;
  /** El nombre que ya se conocía (de la fila de la lista, por la URL): solo para el título hasta que contesta la API. */
  nombreConocido?: string;
  alVolver: () => void;
  alPerderSesion: AlPerderSesion;
  /** Tanda 10: la lupa del encabezado; abre Buscar en este Local. */
  alBuscar?: () => void;
}) {
  const pedirPagina = useCallback<PedirPagina<EventoPublico, InfoLocal>>(
    async (cursor, signal) => {
      const r = await pedirLocal(localId, cursor, signal);
      if (!r.ok) return r;
      const d = r.datos;
      return {
        ok: true,
        datos: {
          eventos: d.eventos,
          guardadas: d.guardadas,
          siguiente: d.siguiente,
          info: {
            tipo: "LOCAL",
            localId: d.local.localId,
            nombre: d.local.nombre,
            sincronizacion: d.sincronizacion,
            leidoHasta: d.leidoHasta,
            noLeidos: d.noLeidos,
            ventas: d.local.ventas,
            caja: d.local.caja,
            stock: d.local.stock,
            pendientes: d.local.pendientes,
            preguntas: d.preguntas,
          },
        },
      };
    },
    [localId],
  );
  // Una sola espera por pantalla: la conversación y "Ventas" gastan el mismo cupo.
  const espera = useEsperaTrasCupo();
  const { estado, despachar, reintentar, cargarAnteriores } = useConversacion(pedirPagina, alPerderSesion, espera.anotar);
  const lectura = useLecturaLocal(estado, despachar, alPerderSesion);
  const info = estado.fase === "LISTA" ? estado.info : null;
  const ventas = useVentas(localId, alPerderSesion, espera.anotar);
  const caja = useCaja(localId, alPerderSesion, espera.anotar);
  const stock = useStock(localId, alPerderSesion, espera.anotar);
  const pendientes = usePendientes(localId, alPerderSesion, espera.anotar);
  const preguntas = usePreguntas(localId, alPerderSesion, espera.anotar);

  return (
    <ShellMovil
      titulo={tituloDeLocal(info?.nombre ?? null, nombreConocido)}
      subtitulo={info && info.noLeidos > 0 ? (info.noLeidos === 1 ? "1 sin leer" : `${info.noLeidos} sin leer`) : undefined}
      volver={{ etiqueta: "Volver a chats", alVolver }}
      acciones={alBuscar ? <BotonBuscar alBuscar={alBuscar} /> : undefined}
    >
      <CuerpoConversacion
        estado={estado}
        vacio="Todavía no hay eventos."
        aviso={info?.sincronizacion === "DEMORADA" ? <AvisoDemorada /> : undefined}
        masSinLeer={lectura.tipo === "FALTAN"}
        alReintentar={reintentar}
        enEspera={espera.enEspera}
        alVolver={alVolver}
        alCargarAnteriores={cargarAnteriores}
      />
      <AccionesDelLocal
        anuncia={info?.ventas === true}
        estado={ventas.estado}
        alPedir={ventas.pedir}
        caja={info?.caja === true ? { estado: caja.estado, alPedir: caja.pedir } : null}
        stock={info?.stock === true ? { estado: stock.estado, alPedir: stock.pedir } : null}
        pendientes={info?.pendientes === true ? { estado: pendientes.estado, alPedir: pendientes.pedir } : null}
        enEspera={espera.enEspera}
        iaDisponible={info?.preguntas === true}
        preguntas={{ ...preguntas, preguntas: sinLasGuardadas(preguntas.preguntas, estado.fase === "LISTA" ? estado.guardadas : []) }}
      />
    </ShellMovil>
  );
}

/**
 * Ventas de hoy de un Local (Tanda 3A): una consulta por toque. Pedir de nuevo
 * cancela la anterior; salir del chat (desmontar) también. No marca leído, no
 * guarda nada y no se repite sola.
 */
function useVentas(localId: number, alPerderSesion: AlPerderSesion, alFallar: (f: FallaCliente) => void) {
  const [estado, despachar] = useReducer(reducirVentas, { fase: "QUIETO" });
  const enCurso = useRef<AbortController | null>(null);

  useEffect(() => () => enCurso.current?.abort(), []);

  const pedir = useCallback(() => {
    enCurso.current?.abort();
    const control = new AbortController();
    enCurso.current = control;
    despachar({ tipo: "PEDIR" });
    void pedirVentas(localId, control.signal).then((resultado) => {
      if (control.signal.aborted) return;
      enCurso.current = null;
      if (!resultado.ok && resultado.falla.estado === "SIN_SESION") return alPerderSesion(resultado.falla.motivo);
      if (!resultado.ok) alFallar(resultado.falla);
      despachar({ tipo: "RESPUESTA", resultado });
    });
  }, [localId, alPerderSesion, alFallar]);

  return { estado, pedir };
}

/**
 * Cajas de hoy de un Local (Tanda 7B): igual que useVentas, con su propia
 * consulta. Una por toque, se cancela al volver a pedir o al salir.
 */
function useCaja(localId: number, alPerderSesion: AlPerderSesion, alFallar: (f: FallaCliente) => void) {
  const [estado, despachar] = useReducer(reducirCaja, { fase: "QUIETO" });
  const enCurso = useRef<AbortController | null>(null);

  useEffect(() => () => enCurso.current?.abort(), []);

  const pedir = useCallback(() => {
    enCurso.current?.abort();
    const control = new AbortController();
    enCurso.current = control;
    despachar({ tipo: "PEDIR" });
    void pedirCaja(localId, control.signal).then((resultado) => {
      if (control.signal.aborted) return;
      enCurso.current = null;
      if (!resultado.ok && resultado.falla.estado === "SIN_SESION") return alPerderSesion(resultado.falla.motivo);
      if (!resultado.ok) alFallar(resultado.falla);
      despachar({ tipo: "RESPUESTA", resultado });
    });
  }, [localId, alPerderSesion, alFallar]);

  return { estado, pedir };
}

/**
 * Productos bajo mínimo de un Local (Tanda 8B): igual que useCaja, con su
 * propia consulta. Una por toque, se cancela al volver a pedir o al salir.
 */
function useStock(localId: number, alPerderSesion: AlPerderSesion, alFallar: (f: FallaCliente) => void) {
  const [estado, despachar] = useReducer(reducirStock, { fase: "QUIETO" });
  const enCurso = useRef<AbortController | null>(null);

  useEffect(() => () => enCurso.current?.abort(), []);

  const pedir = useCallback(() => {
    enCurso.current?.abort();
    const control = new AbortController();
    enCurso.current = control;
    despachar({ tipo: "PEDIR" });
    void pedirStock(localId, control.signal).then((resultado) => {
      if (control.signal.aborted) return;
      enCurso.current = null;
      if (!resultado.ok && resultado.falla.estado === "SIN_SESION") return alPerderSesion(resultado.falla.motivo);
      if (!resultado.ok) alFallar(resultado.falla);
      despachar({ tipo: "RESPUESTA", resultado });
    });
  }, [localId, alPerderSesion, alFallar]);

  return { estado, pedir };
}

/**
 * Lo pendiente (Tanda 9B): de un Local (`localId`) o, con null, de todos
 * (General). Igual que useStock: una consulta por toque, se cancela al volver
 * a pedir o al salir.
 */
function usePendientes(localId: number | null, alPerderSesion: AlPerderSesion, alFallar: (f: FallaCliente) => void) {
  const [estado, despachar] = useReducer(reducirPendientes, { fase: "QUIETO" });
  const enCurso = useRef<AbortController | null>(null);

  useEffect(() => () => enCurso.current?.abort(), []);

  const pedir = useCallback(() => {
    enCurso.current?.abort();
    const control = new AbortController();
    enCurso.current = control;
    despachar({ tipo: "PEDIR" });
    const consulta: Promise<Resultado<PendientesListos>> =
      localId === null
        ? pedirPendientesGeneral(control.signal).then((r) => (r.ok ? { ok: true, datos: { tipo: "TODOS", locales: r.datos.locales } } : r))
        : pedirPendientes(localId, control.signal).then((r) => (r.ok ? { ok: true, datos: { tipo: "LOCAL", datos: r.datos } } : r));
    void consulta.then((resultado) => {
      if (control.signal.aborted) return;
      enCurso.current = null;
      if (!resultado.ok && resultado.falla.estado === "SIN_SESION") return alPerderSesion(resultado.falla.motivo);
      if (!resultado.ok) alFallar(resultado.falla);
      despachar({ tipo: "RESPUESTA", resultado });
    });
  }, [localId, alPerderSesion, alFallar]);

  return { estado, pedir };
}

/** Las preguntas de una pantalla, como las arma usePreguntas (Tanda 6A). */
type PreguntasDeLaPantalla = Pick<ReturnType<typeof usePreguntas>, "preguntas" | "enviando" | "alEnviar" | "alReintentar">;

/**
 * La tarjeta al final del historial y la barra fija con "Ventas". Sin el anuncio
 * de `ventas_resumen` en este local (o con la conversación todavía sin cargar),
 * no hay chip ni tarjeta. Tanda 6A: con preguntas, las burbujas y sus
 * respuestas van al final, y la caja en la barra, debajo del chip; sin
 * `iaDisponible` (el servidor no tiene clave) no hay caja ni burbujas.
 * Exportado para los tests.
 */
export function AccionesDelLocal({
  anuncia,
  estado,
  alPedir,
  caja = null,
  stock = null,
  pendientes = null,
  enEspera = false,
  iaDisponible = false,
  preguntas: todasLasPreguntas = null,
}: {
  anuncia: boolean;
  estado: EstadoVentas;
  alPedir: () => void;
  /** Tanda 7B: con el anuncio de `cajas_resumen`, el chip "Caja" y su tarjeta. Sin él, null: ni chip ni tarjeta. */
  caja?: { readonly estado: EstadoCaja; readonly alPedir: () => void } | null;
  /** Tanda 8B: con el anuncio de `stock_consulta`, el chip "Stock" y su tarjeta. Sin él, null: ni chip ni tarjeta. */
  stock?: { readonly estado: EstadoStock; readonly alPedir: () => void } | null;
  /** Tanda 9B: con el anuncio de `pedidos_pendientes` o `cajas_resumen`, el chip "Pendientes" y su tarjeta. Sin él, null. */
  pendientes?: { readonly estado: EstadoPendientes; readonly alPedir: () => void } | null;
  enEspera?: boolean;
  iaDisponible?: boolean;
  preguntas?: PreguntasDeLaPantalla | null;
}) {
  const preguntas = iaDisponible ? todasLasPreguntas : null;
  const tarjeta = useRef<HTMLDivElement | null>(null);
  const cantidadDePreguntas = preguntas?.preguntas.length ?? 0;
  const ultimaFase = preguntas?.preguntas.at(-1)?.estado.fase;
  const estadoCaja = caja?.estado;
  const estadoStock = stock?.estado;
  const estadoPendientes = pendientes?.estado;
  // La tarjeta nueva queda a la vista, como un mensaje que llega al final del chat.
  useLayoutEffect(() => {
    const llego = (f: string | undefined) => f === "LISTA" || f === "FALLA";
    if (llego(estado.fase) || llego(estadoCaja?.fase) || llego(estadoStock?.fase) || llego(estadoPendientes?.fase) || cantidadDePreguntas > 0) {
      tarjeta.current?.scrollIntoView({ block: "end" });
    }
  }, [estado, estadoCaja, estadoStock, estadoPendientes, cantidadDePreguntas, ultimaFase]);
  if (!anuncia && !caja && !stock && !pendientes && !preguntas) return null;
  return (
    <>
      <div ref={tarjeta} className="ac-ventas-al-final">
        {anuncia && <ResultadoVentas estado={estado} alReintentar={alPedir} enEspera={enEspera} />}
        {caja && <ResultadoCaja estado={caja.estado} alReintentar={caja.alPedir} enEspera={enEspera} />}
        {stock && <ResultadoStock estado={stock.estado} alReintentar={stock.alPedir} enEspera={enEspera} />}
        {pendientes && <ResultadoPendientes estado={pendientes.estado} alReintentar={pendientes.alPedir} enEspera={enEspera} />}
        {preguntas && <ListaDePreguntas preguntas={preguntas.preguntas} alReintentar={preguntas.alReintentar} enEspera={enEspera} />}
      </div>
      <BarraVentas
        cargando={estado.fase === "CARGANDO"}
        alPedir={alPedir}
        enEspera={enEspera}
        conVentas={anuncia}
        caja={caja ? { cargando: caja.estado.fase === "CARGANDO", alPedir: caja.alPedir } : null}
        stock={stock ? { cargando: stock.estado.fase === "CARGANDO", alPedir: stock.alPedir } : null}
        pendientes={pendientes ? { cargando: pendientes.estado.fase === "CARGANDO", alPedir: pendientes.alPedir } : null}
      >
        {preguntas && <CajaPregunta texto={TEXTO_CAJA.local} enviando={preguntas.enviando} alEnviar={preguntas.alEnviar} />}
      </BarraVentas>
    </>
  );
}

/**
 * General (Tanda 6A): con la IA disponible, las burbujas y la caja "sobre tus
 * locales". Tanda 9B: con algún local que lo anuncie, el chip "Pendientes" y su
 * tarjeta. Sin ninguna de las dos, nada. Exportado para los tests.
 */
export function AccionesDeGeneral({
  iaDisponible,
  preguntas: todasLasPreguntas,
  pendientes = null,
  enEspera = false,
}: {
  iaDisponible: boolean;
  preguntas: PreguntasDeLaPantalla;
  /** Tanda 9B: con algún local que anuncie `pedidos_pendientes` o `cajas_resumen`, el chip "Pendientes" y su tarjeta, por local. */
  pendientes?: { readonly estado: EstadoPendientes; readonly alPedir: () => void } | null;
  enEspera?: boolean;
}) {
  const preguntas = iaDisponible ? todasLasPreguntas : null;
  const final = useRef<HTMLDivElement | null>(null);
  const cantidad = preguntas?.preguntas.length ?? 0;
  const ultimaFase = preguntas?.preguntas.at(-1)?.estado.fase;
  const fasePendientes = pendientes?.estado.fase;
  useLayoutEffect(() => {
    if (cantidad > 0 || fasePendientes === "LISTA" || fasePendientes === "FALLA") final.current?.scrollIntoView({ block: "end" });
  }, [cantidad, ultimaFase, fasePendientes]);
  if (!preguntas && !pendientes) return null;
  return (
    <>
      <div ref={final} className="ac-ventas-al-final">
        {pendientes && <ResultadoPendientes estado={pendientes.estado} alReintentar={pendientes.alPedir} enEspera={enEspera} />}
        {preguntas && <ListaDePreguntas preguntas={preguntas.preguntas} alReintentar={preguntas.alReintentar} enEspera={enEspera} />}
      </div>
      <BarraVentas
        conVentas={false}
        enEspera={enEspera}
        etiqueta="Acciones de General"
        pendientes={pendientes ? { cargando: pendientes.estado.fase === "CARGANDO", alPedir: pendientes.alPedir } : null}
      >
        {preguntas && <CajaPregunta texto={TEXTO_CAJA.general} enviando={preguntas.enviando} alEnviar={preguntas.alEnviar} />}
      </BarraVentas>
    </>
  );
}

// ── General ─────────────────────────────────────────────────────────────────

export function PantallaGeneral({ alVolver, alPerderSesion, alBuscar }: { alVolver: () => void; alPerderSesion: AlPerderSesion; alBuscar?: () => void }) {
  const pedirPagina = useCallback<PedirPagina<EventoGeneral, InfoGeneral>>(async (cursor, signal) => {
    const r = await pedirGeneral(cursor, signal);
    if (!r.ok) return r;
    const d = r.datos;
    return {
      ok: true,
      datos: {
        eventos: d.eventos,
        guardadas: d.guardadas,
        siguiente: d.siguiente,
        info: { tipo: "GENERAL", localesDemorados: d.localesDemorados, preguntas: d.preguntas, pendientes: d.pendientes },
      },
    };
  }, []);
  // General no marca leído (Tanda 2C): no puede demostrar que mostró todos los no leídos de cada local.
  const espera = useEsperaTrasCupo();
  const { estado, reintentar, cargarAnteriores } = useConversacion(pedirPagina, alPerderSesion, espera.anotar);
  const demorados = estado.fase === "LISTA" ? estado.info.localesDemorados.length : 0;
  const preguntas = usePreguntas(null, alPerderSesion, espera.anotar);
  const pendientes = usePendientes(null, alPerderSesion, espera.anotar);
  const iaDisponible = estado.fase === "LISTA" && estado.info.preguntas;
  const conPendientes = estado.fase === "LISTA" && estado.info.pendientes;

  return (
    <ShellMovil
      titulo="General"
      subtitulo="Eventos de todos los locales"
      volver={{ etiqueta: "Volver a chats", alVolver }}
      acciones={alBuscar ? <BotonBuscar alBuscar={alBuscar} /> : undefined}
    >
      <CuerpoConversacion
        estado={estado}
        vacio="Todavía no hay eventos para mostrar."
        aviso={demorados > 0 ? <AvisoDemorada texto={demorados === 1 ? "Actualización demorada en 1 local" : `Actualización demorada en ${demorados} locales`} /> : undefined}
        local={(e) => e.local.nombre}
        alReintentar={reintentar}
        enEspera={espera.enEspera}
        alVolver={alVolver}
        alCargarAnteriores={cargarAnteriores}
      />
      <AccionesDeGeneral
        iaDisponible={iaDisponible}
        preguntas={{ ...preguntas, preguntas: sinLasGuardadas(preguntas.preguntas, estado.fase === "LISTA" ? estado.guardadas : []) }}
        pendientes={conPendientes ? { estado: pendientes.estado, alPedir: pendientes.pedir } : null}
        enEspera={espera.enEspera}
      />
    </ShellMovil>
  );
}
