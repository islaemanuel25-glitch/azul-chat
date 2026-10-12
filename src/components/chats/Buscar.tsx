"use client";

// BUSCAR EN EL HISTORIAL (Tanda 10). Figma DpxKeDtugjdB8IfuGnHZcz, pantalla 05
// "Buscar historial" (1:241–1:270): el campo, los filtros en pills, el
// contador "N resultados" y la lista.
//
// Se abre con la lupa del encabezado de un Local o de General y busca en ESE
// chat: un Local, solo ese local; General, todos los locales de hoy. Busca al
// enviar (botón o Enter), nunca mientras se escribe; cambiar de filtro vuelve a
// buscar el mismo texto. Cada resultado es la MISMA tarjeta del chat —el
// evento, o la pregunta guardada como foto—, con un separador por día para la
// fecha y, en General, el local arriba. No lleva a ese punto del historial.
//
// Las pills del diseño "Caja" y "Ventas" no están: lo que se busca es el
// historial guardado (eventos y preguntas), y caja y ventas no se guardan.

import { Fragment, useCallback, useEffect, useId, useReducer, useRef, useState, type FormEvent } from "react";

import { FILTROS_BUSQUEDA, MAX_LARGO_BUSQUEDA, type FiltroBusqueda, type ResultadoBusqueda } from "../../shared/chats/buscar.ts";
import { ShellMovil } from "../shell/ShellMovil.tsx";
import { pedirBuscar, type AmbitoBusqueda, type FallaCliente } from "./clienteChats.ts";
import { useEsperaTrasCupo } from "./esperaCupo.ts";
import { cantidadDeResultados, diaDe, etiquetaDeDia, noEncontre } from "./formato.ts";
import { claveDeResultado, destinoDeFalla, motivoDeSesion, pideSesion, reducirBusqueda, type EstadoBusqueda } from "./logica.ts";
import { EstadoChat, EstadoCupoErp, EstadoErpNoDisponible, TarjetaEvento } from "./Piezas.tsx";
import { PreguntaGuardadaVista } from "./Preguntas.tsx";
import { retenerRecarga } from "./version.ts";

/** El texto de cada pill, en el orden de FILTROS_BUSQUEDA. */
const TEXTO_DE_FILTRO: Readonly<Record<FiltroBusqueda, string>> = {
  todos: "Todos",
  transferencias: "Transferencias",
  pedidos: "Pedidos",
  preguntas: "Preguntas",
};

/** El nombre del chat de una pregunta guardada en General: su local, o General. */
const NOMBRE_GENERAL = "General";

/** El campo de búsqueda: busca al enviar. Con texto escrito, una recarga por versión espera (como la caja de preguntas). */
export function CampoBusqueda({ inicial = "", buscando, alBuscar }: { inicial?: string; buscando: boolean; alBuscar: (texto: string) => void }) {
  const [valor, setValor] = useState(inicial);
  const vacio = valor.trim().length === 0;
  const clave = `buscar${useId()}`;
  useEffect(() => retenerRecarga(clave, !vacio), [clave, vacio]);
  useEffect(() => () => retenerRecarga(clave, false), [clave]);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (vacio || buscando) return;
    alBuscar(valor.trim());
  };
  return (
    <form className="ac-pregunta ac-buscar__campo" onSubmit={enviar} role="search">
      <input
        className="ac-pregunta__campo"
        type="search"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Número o texto"
        aria-label="Buscar en el historial"
        maxLength={MAX_LARGO_BUSQUEDA}
        autoComplete="off"
        enterKeyHint="search"
      />
      <button type="submit" className="ac-boton-icono ac-pregunta__enviar" aria-label="Buscar" disabled={vacio || buscando}>
        <span aria-hidden="true">⌕</span>
      </button>
    </form>
  );
}

/** Las pills de filtro. */
export function FiltrosBusqueda({ filtro, alCambiar, deshabilitados = false }: { filtro: FiltroBusqueda; alCambiar: (f: FiltroBusqueda) => void; deshabilitados?: boolean }) {
  return (
    <div className="ac-chips ac-buscar__filtros" role="group" aria-label="Filtrar resultados">
      {FILTROS_BUSQUEDA.map((f) => (
        <button key={f} type="button" className="ac-chip" aria-pressed={filtro === f} onClick={() => alCambiar(f)} disabled={deshabilitados || undefined}>
          {TEXTO_DE_FILTRO[f]}
        </button>
      ))}
    </div>
  );
}

/** Los resultados, del más nuevo al más viejo, con un separador por día. `general`: con el local de cada uno arriba. Sin red. */
export function ListaDeResultados({ resultados, general, ahora = new Date(), zona }: { resultados: readonly ResultadoBusqueda[]; general: boolean; ahora?: Date; zona?: string }) {
  const fecha = (r: ResultadoBusqueda) => (r.tipo === "EVENTO" ? r.evento.fecha : r.guardada.creadaEn);
  return (
    <ol className="ac-conversacion" aria-label="Resultados">
      {resultados.map((r, i) => {
        const nuevoDia = i === 0 || diaDe(fecha(r), zona) !== diaDe(fecha(resultados[i - 1]!), zona);
        return (
          <Fragment key={claveDeResultado(r)}>
            {nuevoDia && (
              <li className="ac-dia">
                <span className="ac-dia__etiqueta">{etiquetaDeDia(fecha(r), ahora, zona)}</span>
              </li>
            )}
            <li>
              {r.tipo === "EVENTO" ? (
                <TarjetaEvento evento={r.evento} {...(general ? { local: r.local.nombre } : {})} {...(zona ? { zona } : {})} />
              ) : (
                <>
                  {general && <p className="ac-evento__local">{r.local?.nombre ?? NOMBRE_GENERAL}</p>}
                  <PreguntaGuardadaVista guardada={r.guardada} {...(zona ? { zona } : {})} />
                </>
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/** Lo que va debajo del campo y los filtros, según el estado. Exportado para los tests. */
export function CuerpoBusqueda({
  estado,
  general,
  alReintentar,
  alVerMas,
  alVolver,
  enEspera = false,
  ahora,
  zona,
}: {
  estado: EstadoBusqueda;
  general: boolean;
  alReintentar: () => void;
  alVerMas: () => void;
  alVolver: () => void;
  enEspera?: boolean;
  ahora?: Date;
  zona?: string;
}) {
  switch (estado.fase) {
    case "QUIETO":
      return <EstadoChat texto="Buscá por número de transferencia o de pedido, o por texto." />;
    case "BUSCANDO":
      return <EstadoChat texto="Buscando…" cargando />;
    case "FALLA":
      return <FallaDeBusqueda falla={estado.falla} alReintentar={alReintentar} alVolver={alVolver} enEspera={enEspera} />;
    case "LISTA":
      if (estado.resultados.length === 0) return <EstadoChat texto={noEncontre(estado.texto)} />;
      return (
        <section className="ac-buscar__resultados">
          <p className="ac-buscar__contador" role="status">
            {cantidadDeResultados(estado.total)}
          </p>
          <ListaDeResultados resultados={estado.resultados} general={general} {...(ahora ? { ahora } : {})} {...(zona ? { zona } : {})} />
          {estado.siguiente && (
            <div className="ac-anteriores">
              <button type="button" className="ac-boton ac-boton--secundario" onClick={alVerMas} disabled={estado.mas === "CARGANDO"}>
                {estado.mas === "CARGANDO" ? "Cargando…" : "Ver más"}
              </button>
              {estado.mas === "SIN_RED" && <p className="ac-mensaje">No se pudieron cargar. Probá de nuevo.</p>}
            </div>
          )}
        </section>
      );
  }
}

/** Una falla al buscar reemplaza los resultados: sin acceso comprobado, no se muestra nada (P1). */
function FallaDeBusqueda({ falla, alReintentar, alVolver, enEspera }: { falla: FallaCliente; alReintentar: () => void; alVolver: () => void; enEspera: boolean }) {
  switch (destinoDeFalla(falla)) {
    case "ERP_NO_DISPONIBLE":
      return <EstadoErpNoDisponible alReintentar={alReintentar} />;
    case "CUPO_ERP":
      return <EstadoCupoErp alReintentar={alReintentar} enEspera={enEspera} />;
    case "NO_AUTORIZADO":
      return <EstadoChat titulo="Sin acceso" texto="Este chat no está entre los que podés ver hoy." accion={{ texto: "Volver", alTocar: alVolver }} />;
    case "SIN_RED":
      return <EstadoChat titulo="Sin conexión" texto="No hubo respuesta de Azul Chat." accion={{ texto: "Reintentar", alTocar: alReintentar }} />;
    default:
      return <EstadoChat titulo="No disponible" texto="Azul Chat no está disponible en este momento." accion={{ texto: "Reintentar", alTocar: alReintentar }} />;
  }
}

/** La pantalla Buscar de un Local (`nombre`: el que ya se conocía, para el subtítulo) o de General. */
export function PantallaBuscar({
  ambito,
  nombre,
  alVolver,
  alPerderSesion,
}: {
  ambito: AmbitoBusqueda;
  nombre?: string;
  alVolver: () => void;
  alPerderSesion: (motivo?: "VINCULO_INVALIDO") => void;
}) {
  const [estado, despachar] = useReducer(reducirBusqueda, { fase: "QUIETO" });
  const [filtro, setFiltro] = useState<FiltroBusqueda>("todos");
  const espera = useEsperaTrasCupo();
  const { anotar } = espera;
  const enCurso = useRef<AbortController | null>(null);
  useEffect(() => () => enCurso.current?.abort(), []);

  const alFallar = useCallback(
    (f: FallaCliente) => {
      if (pideSesion(f)) {
        alPerderSesion(motivoDeSesion(f));
        return true;
      }
      anotar(f);
      return false;
    },
    [alPerderSesion, anotar],
  );

  const buscar = useCallback(
    (texto: string, f: FiltroBusqueda) => {
      enCurso.current?.abort();
      const control = new AbortController();
      enCurso.current = control;
      despachar({ tipo: "BUSCAR", texto, filtro: f });
      void pedirBuscar({ texto, filtro: f, ambito, cursor: null }, control.signal).then((resultado) => {
        if (control.signal.aborted) return;
        enCurso.current = null;
        if (!resultado.ok && alFallar(resultado.falla)) return;
        despachar({ tipo: "RESPUESTA", resultado });
      });
    },
    [ambito, alFallar],
  );

  const verMas = () => {
    if (estado.fase !== "LISTA" || !estado.siguiente || estado.mas === "CARGANDO") return;
    const control = new AbortController();
    enCurso.current = control;
    despachar({ tipo: "PIDIENDO_MAS" });
    void pedirBuscar({ texto: estado.texto, filtro: estado.filtro, ambito, cursor: estado.siguiente }, control.signal).then((resultado) => {
      if (control.signal.aborted) return;
      enCurso.current = null;
      if (!resultado.ok && alFallar(resultado.falla)) return;
      despachar({ tipo: "MAS", resultado });
    });
  };

  const textoBuscado = estado.fase === "QUIETO" ? null : estado.texto;
  const cambiarFiltro = (f: FiltroBusqueda) => {
    setFiltro(f);
    if (textoBuscado !== null) buscar(textoBuscado, f);
  };

  return (
    <ShellMovil titulo="Buscar" subtitulo={ambito.tipo === "GENERAL" ? NOMBRE_GENERAL : nombre} volver={{ etiqueta: "Volver al chat", alVolver }}>
      <CampoBusqueda buscando={estado.fase === "BUSCANDO"} alBuscar={(t) => buscar(t, filtro)} />
      <FiltrosBusqueda filtro={filtro} alCambiar={cambiarFiltro} />
      <CuerpoBusqueda
        estado={estado}
        general={ambito.tipo === "GENERAL"}
        alReintentar={() => textoBuscado !== null && buscar(textoBuscado, filtro)}
        alVerMas={verMas}
        alVolver={alVolver}
        enEspera={espera.enEspera}
      />
    </ShellMovil>
  );
}
