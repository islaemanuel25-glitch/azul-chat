"use client";

// LAS PREGUNTAS EN LENGUAJE NATURAL, EN LA CONVERSACIÓN (Tanda 6A).
//
// Figma "Azul Chat — Mobile V1", pantalla 02: la caja es el nodo 1:152, la
// burbuja propia 1:124 y la tarjeta 1:127; pantalla 07: el error 1:329 y el
// saldo agotado 1:333.
//
//   · La caja va en la barra de abajo, debajo del chip "Ventas": "Preguntá
//     sobre este local…" en un Local, "Preguntá sobre tus locales…" en
//     General. Sin IA configurada no hay caja (la API lo dice: `preguntas`).
//   · La pregunta queda como burbuja propia al final del historial y, debajo,
//     la respuesta: la tarjeta de ventas de siempre (para todos los locales,
//     el total y una línea por local), una tarjeta de eventos (cantidad y
//     hasta 10, con los textos de la interfaz) o el texto de "no entendí" o
//     de la falla, con Reintentar a mano.
//   · No se guardan: viven mientras la pantalla está abierta, como la tarjeta
//     de Ventas. No marcan leído. Una a la vez.
//
// Ningún texto ni número de una respuesta sale de la IA: los arma el servidor
// con datos del ERP o de la base, y acá se dibujan con las mismas funciones de
// formato.ts que el resto de la conversación.

import { useCallback, useEffect, useId, useReducer, useRef, useState, type FormEvent } from "react";

import { MAX_LARGO_PREGUNTA, type PreguntaGuardada, type RespuestaGuardada } from "../../shared/chats/preguntas.ts";
import { preguntar, type FallaCliente, type RespuestaDePregunta } from "./clienteChats.ts";
import {
  avisoNoSepara,
  avisoTurnoNoEncontrado,
  cantidadDeEventos,
  cantidadDeVentas,
  etiquetaDePeriodo,
  formatearHora,
  formatearMonto,
  lineaDeMedioDePago,
  lineaDeNoCobrado,
  respuestaGuardadaDel,
  tituloDeCajas,
  tituloDeVentasDe,
  tituloDeVentasDeTurno,
  tituloDeProductosTodos,
  TITULO_BAJO_MINIMO_TODOS,
} from "./formato.ts";
import { TarjetaCajas } from "./Cajas.tsx";
import { ContenidoBajoMinimo, ContenidoProductos, TarjetaBajoMinimo, TarjetaProductos } from "./Stock.tsx";
import { TarjetaPendientes, TarjetaPendientesTodos } from "./Pendientes.tsx";
import { destinoDeFalla, hayPreguntaEnCurso, reducirPreguntas, type IntercambioDePregunta } from "./logica.ts";
import { retenerRecarga } from "./version.ts";
import { AvisoDeRespuesta, SubtituloDeTarjeta, TarjetaEvento, TarjetaVentas, TEXTO_CUPO_ERP } from "./Piezas.tsx";

/** El texto de la caja según dónde se pregunta. */
export const TEXTO_CAJA = Object.freeze({ local: "Preguntá sobre este local…", general: "Preguntá sobre tus locales…" });

/** La caja de preguntas, con su botón de enviar. Vacía o mientras espera, no manda. */
export function CajaPregunta({ texto, enviando, alEnviar }: { texto: string; enviando: boolean; alEnviar: (pregunta: string) => void }) {
  const [valor, setValor] = useState("");
  const vacia = valor.trim().length === 0;
  // Tanda 6D: con texto escrito, una recarga por versión espera (no se le borra lo que escribió).
  const clave = `caja${useId()}`;
  useEffect(() => retenerRecarga(clave, !vacia), [clave, vacia]);
  useEffect(() => () => retenerRecarga(clave, false), [clave]);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (vacia || enviando) return;
    alEnviar(valor.trim());
    setValor("");
  };
  return (
    <form className="ac-pregunta" onSubmit={enviar} role="search">
      <input
        className="ac-pregunta__campo"
        type="text"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={texto}
        aria-label={texto}
        maxLength={MAX_LARGO_PREGUNTA}
        autoComplete="off"
        enterKeyHint="send"
      />
      <button type="submit" className="ac-boton-icono ac-pregunta__enviar" aria-label="Enviar pregunta" disabled={vacia || enviando}>
        <span aria-hidden="true">➤</span>
      </button>
    </form>
  );
}

/** La pregunta propia, como burbuja a la derecha, con la hora. */
export function BurbujaPropia({ pregunta, cuando, zona }: { pregunta: string; cuando: string; zona?: string }) {
  return (
    <div className="ac-burbuja-propia">
      <p className="ac-burbuja-propia__texto">{pregunta}</p>
      <p className="ac-burbuja-propia__hora">{formatearHora(cuando, zona)}</p>
    </div>
  );
}

/** Una falla dentro de la conversación (Figma 1:329): el texto y, si corresponde, Reintentar. */
function TarjetaFalla({ texto, alReintentar, enEspera = false }: { texto: string; alReintentar?: () => void; enEspera?: boolean }) {
  return (
    <article className="ac-ventas ac-ventas--falla" role="alert">
      <p className="ac-ventas__falla">{texto}</p>
      {alReintentar && (
        <button type="button" className="ac-pastilla-accion" onClick={alReintentar} disabled={enEspera || undefined}>
          Reintentar
        </button>
      )}
    </article>
  );
}

/** Tanda 6B: los subtítulos de la tarjeta de todos los locales. */
export const TEXTO_POR_MEDIO = "Por medio de pago";
export const TEXTO_POR_LOCAL = "Por local";

/** Tanda 6B: el aviso de lo que la respuesta no separa, o nada. */
function AvisoNoSepara({ periodo, noSeparaPor }: { periodo: Parameters<typeof avisoNoSepara>[0]; noSeparaPor: Parameters<typeof avisoNoSepara>[1] }) {
  const texto = avisoNoSepara(periodo, noSeparaPor);
  return texto ? <AvisoDeRespuesta texto={texto} /> : null;
}

/** Lo que contestó la pregunta, dibujado con las piezas de siempre. */
export function RespuestaDePreguntaVista({
  respuesta,
  alReintentar,
  zona,
}: {
  respuesta: RespuestaDePregunta;
  alReintentar: () => void;
  zona?: string;
}) {
  switch (respuesta.estado) {
    case "VENTAS":
      if (respuesta.alcance === "LOCAL")
        return (
          <TarjetaVentas
            ventas={respuesta.ventas}
            titulo={tituloDeVentasDe(respuesta.periodo, respuesta.ventas.local.nombre)}
            aviso={avisoNoSepara(respuesta.periodo, respuesta.noSeparaPor)}
          />
        );
      return <TarjetaVentasTodos respuesta={respuesta} />;
    case "EVENTOS":
      return (
        <article className="ac-ventas" aria-label={cantidadDeEventos(respuesta.tipo, respuesta.cantidad)}>
          <AvisoNoSepara periodo={respuesta.periodo} noSeparaPor={respuesta.noSeparaPor} />
          <p className="ac-ventas__titulo">
            {respuesta.local ? respuesta.local.nombre : "Todos los locales"} · {etiquetaDePeriodo(respuesta.periodo)}
          </p>
          <p className="ac-ventas__linea">{cantidadDeEventos(respuesta.tipo, respuesta.cantidad)}</p>
          {respuesta.eventos.length > 0 && (
            <ul className="ac-respuesta-eventos">
              {respuesta.eventos.map((e) => (
                <li key={e.id}>
                  <TarjetaEvento evento={e} {...(respuesta.local ? {} : { local: e.local.nombre })} {...(zona ? { zona } : {})} />
                </li>
              ))}
            </ul>
          )}
          {respuesta.restantes > 0 && <p className="ac-ventas__linea">{respuesta.restantes === 1 ? "y 1 más" : `y ${respuesta.restantes} más`}</p>}
        </article>
      );
    case "CAJA":
      return <RespuestaDeCajas respuesta={respuesta} {...(zona ? { zona } : {})} />;
    case "VENTAS_TURNO":
      return <RespuestaVentasDeTurno respuesta={respuesta} {...(zona ? { zona } : {})} />;
    case "STOCK":
      return <RespuestaDeStock respuesta={respuesta} />;
    case "PENDIENTES":
      // Tanda 9B: la misma tarjeta que el chip "Pendientes".
      return respuesta.alcance === "LOCAL" ? <TarjetaPendientes datos={respuesta.resultado} /> : <TarjetaPendientesTodos locales={respuesta.locales} />;
    case "NO_ENTIENDO":
      return (
        <article className="ac-ventas">
          <p className="ac-ventas__linea">No entendí la pregunta. Podés preguntar, por ejemplo:</p>
          {respuesta.ejemplos.map((e) => (
            <p key={e} className="ac-ventas__advertencia">
              {e}
            </p>
          ))}
        </article>
      );
    case "SALDO_AGOTADO":
      return (
        <article className="ac-ventas" role="status">
          <p className="ac-ventas__saldo">Saldo de IA agotado</p>
          <p className="ac-ventas__linea">Eventos, historial y Ventas siguen funcionando.</p>
        </article>
      );
    case "IA_NO_DISPONIBLE":
      return <TarjetaFalla texto="La IA no respondió." alReintentar={alReintentar} />;
  }
}

/**
 * Todos los locales (Tanda 6B, ordenada): el total y la cantidad arriba;
 * "Por medio de pago" con sus líneas; "Por local" con una línea por local. Si
 * alguno falló, cuáles, y sin total (ni medios: serían de una suma parcial).
 */
function TarjetaVentasTodos({ respuesta }: { respuesta: Extract<RespuestaDePregunta, { estado: "VENTAS"; alcance: "TODOS" }> }) {
  const titulo = tituloDeVentasDe(respuesta.periodo, "Todos los locales");
  const aviso = avisoNoSepara(respuesta.periodo, respuesta.noSeparaPor);
  const porLocal = (
    <>
      <SubtituloDeTarjeta texto={TEXTO_POR_LOCAL} />
      {respuesta.locales.map((l) => (
        <p key={l.local.id} className="ac-ventas__linea">
          {l.local.nombre} · {formatearMonto(l.totalVendido)}
        </p>
      ))}
    </>
  );
  const fallidos = respuesta.fallidos.length > 0 && (
    <p className="ac-ventas__advertencia">No se pudo consultar: {respuesta.fallidos.map((f) => f.nombre).join(", ")}. Sin total: faltan locales.</p>
  );
  if (respuesta.total) {
    return (
      <TarjetaVentas ventas={{ ...respuesta.total, local: { nombre: "Todos los locales" } }} titulo={titulo} aviso={aviso} subtituloMedios={TEXTO_POR_MEDIO}>
        {porLocal}
      </TarjetaVentas>
    );
  }
  return (
    <article className="ac-ventas" aria-label={titulo}>
      <AvisoNoSepara periodo={respuesta.periodo} noSeparaPor={respuesta.noSeparaPor} />
      <p className="ac-ventas__titulo">{titulo}</p>
      {porLocal}
      {fallidos}
    </article>
  );
}

// ── Tanda 7B: caja y ventas de un turno ─────────────────────────────────────

/** Los locales que no se pudieron consultar, en una línea. */
function NoSePudo({ fallidos }: { fallidos: readonly { readonly nombre: string }[] }) {
  if (fallidos.length === 0) return null;
  return <p className="ac-ventas__advertencia">No se pudo consultar: {fallidos.map((f) => f.nombre).join(", ")}.</p>;
}

/**
 * Stock (Tanda 8B): lo que encontró el ERP, o lo que está bajo mínimo. De un
 * local, su tarjeta; de todos, UNA tarjeta con una sección por local —cada uno
 * con lo suyo, sin sumas— y los que no se pudieron consultar.
 */
function RespuestaDeStock({ respuesta }: { respuesta: Extract<RespuestaDePregunta, { estado: "STOCK" }> }) {
  if (respuesta.alcance === "LOCAL") {
    return respuesta.modo === "producto" ? <TarjetaProductos datos={respuesta.resultado} /> : <TarjetaBajoMinimo datos={respuesta.resultado} />;
  }
  const titulo = respuesta.modo === "producto" ? tituloDeProductosTodos(respuesta.texto) : TITULO_BAJO_MINIMO_TODOS;
  return (
    <article className="ac-ventas ac-stock" aria-label={titulo}>
      <p className="ac-ventas__titulo">{titulo}</p>
      {respuesta.modo === "producto"
        ? respuesta.locales.map((d) => (
            <section key={d.local.id} className="ac-stock__local" aria-label={d.local.nombre}>
              <SubtituloDeTarjeta texto={d.local.nombre} />
              <ContenidoProductos datos={d} />
            </section>
          ))
        : respuesta.locales.map((d) => (
            <section key={d.local.id} className="ac-stock__local" aria-label={d.local.nombre}>
              <SubtituloDeTarjeta texto={d.local.nombre} />
              <ContenidoBajoMinimo datos={d} />
            </section>
          ))}
      <NoSePudo fallidos={respuesta.fallidos} />
    </article>
  );
}

/** Caja: la tarjeta de cajas de cada local (filtrada por el turno si se encontró). */
function RespuestaDeCajas({ respuesta, zona }: { respuesta: Extract<RespuestaDePregunta, { estado: "CAJA" }>; zona?: string }) {
  const aviso = respuesta.turnoNoEncontrado && respuesta.turnoPedido ? avisoTurnoNoEncontrado(respuesta.turnoPedido) : null;
  const z = zona ? { zona } : {};
  if (respuesta.alcance === "LOCAL") {
    return <TarjetaCajas cajas={respuesta.cajas} titulo={tituloDeCajas(respuesta.periodo, respuesta.cajas.local.nombre)} aviso={aviso} {...z} />;
  }
  return (
    <div className="ac-respuesta-cajas">
      {aviso && <AvisoDeRespuesta texto={aviso} />}
      {respuesta.locales.map((c) => (
        <TarjetaCajas key={c.local.id} cajas={c} titulo={tituloDeCajas(respuesta.periodo, c.local.nombre)} {...z} />
      ))}
      <NoSePudo fallidos={respuesta.fallidos} />
    </div>
  );
}

/**
 * Ventas de un turno. Un local: el turno con su desglose y sus cajas. Todos:
 * el total del turno (si no faltó ningún local) y una línea por local; si el
 * turno no está en ninguno, el aviso y todos los turnos de cada local.
 */
function RespuestaVentasDeTurno({ respuesta, zona }: { respuesta: Extract<RespuestaDePregunta, { estado: "VENTAS_TURNO" }>; zona?: string }) {
  const z = zona ? { zona } : {};
  const avisoTurno = respuesta.turnoNoEncontrado ? avisoTurnoNoEncontrado(respuesta.turnoPedido) : null;
  const aviso = avisoTurno ?? avisoNoSepara(respuesta.periodo, respuesta.noSeparaPor);
  if (respuesta.alcance === "LOCAL") {
    const c = respuesta.cajas;
    const titulo = respuesta.turnoNoEncontrado ? tituloDeCajas(respuesta.periodo, c.local.nombre) : tituloDeVentasDeTurno(c.turnos[0]?.turno.nombre ?? respuesta.turnoPedido, respuesta.periodo, c.local.nombre);
    return <TarjetaCajas cajas={c} titulo={titulo} aviso={aviso} conMedios={!respuesta.turnoNoEncontrado} {...z} />;
  }
  if (respuesta.turnoNoEncontrado) {
    return (
      <div className="ac-respuesta-cajas">
        {aviso && <AvisoDeRespuesta texto={aviso} />}
        {respuesta.locales.map((c) => (
          <TarjetaCajas key={c.local.id} cajas={c} titulo={tituloDeCajas(respuesta.periodo, c.local.nombre)} {...z} />
        ))}
        <NoSePudo fallidos={respuesta.fallidos} />
      </div>
    );
  }
  const nombreTurno = respuesta.locales.flatMap((c) => c.turnos)[0]?.turno.nombre ?? respuesta.turnoPedido;
  const titulo = tituloDeVentasDeTurno(nombreTurno, respuesta.periodo, "Todos los locales");
  return (
    <article className="ac-ventas" aria-label={titulo}>
      {aviso && <AvisoDeRespuesta texto={aviso} />}
      <p className="ac-ventas__titulo">{titulo}</p>
      {respuesta.total && (
        <>
          <p className="ac-ventas__total">{formatearMonto(respuesta.total.totalVendido)}</p>
          <p className="ac-ventas__linea">{cantidadDeVentas(respuesta.total.cantidadVentas)}</p>
          <SubtituloDeTarjeta texto={TEXTO_POR_MEDIO} />
          {respuesta.total.ventasPorMedio.map((m) => (
            <p key={m.medio} className="ac-ventas__linea">
              {lineaDeMedioDePago(m)}
            </p>
          ))}
          {respuesta.total.ventasNoCobradas.map((m) => (
            <p key={m.medio} className="ac-ventas__advertencia">
              {lineaDeNoCobrado(m)}
            </p>
          ))}
        </>
      )}
      <SubtituloDeTarjeta texto={TEXTO_POR_LOCAL} />
      {respuesta.locales.map((c) => (
        <p key={c.local.id} className="ac-ventas__linea">
          {c.local.nombre} · {c.turnos[0] ? formatearMonto(c.turnos[0].totales.totalVendido) : "sin ese turno"}
        </p>
      ))}
      {respuesta.fallidos.length > 0 && (
        <p className="ac-ventas__advertencia">No se pudo consultar: {respuesta.fallidos.map((f) => f.nombre).join(", ")}. Sin total: faltan locales.</p>
      )}
    </article>
  );
}

/** Una falla de la API al preguntar, como texto en la conversación. */
function FallaDePregunta({ falla, alReintentar, enEspera }: { falla: FallaCliente; alReintentar: () => void; enEspera: boolean }) {
  switch (destinoDeFalla(falla)) {
    case "ERP_NO_DISPONIBLE":
      return <TarjetaFalla texto="No se pudo consultar ERP Azul." alReintentar={alReintentar} />;
    case "CUPO_ERP":
      return <TarjetaFalla texto={TEXTO_CUPO_ERP} alReintentar={alReintentar} enEspera={enEspera} />;
    case "NO_AUTORIZADO":
      return <TarjetaFalla texto="No tenés acceso a esto hoy." />;
    case "SIN_RED":
      return <TarjetaFalla texto="No hubo respuesta de Azul Chat." alReintentar={alReintentar} />;
    default:
      return <TarjetaFalla texto="Azul Chat no está disponible en este momento." alReintentar={alReintentar} />;
  }
}

/** Tanda 6C: la respuesta guardada, tal cual se vio. Sin "Reintentar": es una foto, no una consulta. */
function RespuestaGuardadaVista({ respuesta, zona }: { respuesta: RespuestaGuardada; zona?: string }) {
  switch (respuesta.estado) {
    case "IA_NO_DISPONIBLE":
      return <TarjetaFalla texto="La IA no respondió." />;
    case "ERP_NO_DISPONIBLE":
      return <TarjetaFalla texto="No se pudo consultar ERP Azul." />;
    case "ERP_CUPO_EXCEDIDO":
      return <TarjetaFalla texto={TEXTO_CUPO_ERP} />;
    default:
      return <RespuestaDePreguntaVista respuesta={respuesta} alReintentar={() => {}} {...(zona ? { zona } : {})} />;
  }
}

/**
 * Tanda 6C: una pregunta guardada en el historial: la burbuja con la hora, la
 * respuesta como se vio y cuándo fue ("Respuesta del 11/10 a las 21:02"), así
 * se lee como una foto y no como un dato de ahora. Exportado para los tests.
 */
export function PreguntaGuardadaVista({ guardada, zona }: { guardada: PreguntaGuardada; zona?: string }) {
  return (
    <div className="ac-preguntas__item ac-pregunta-guardada">
      <BurbujaPropia pregunta={guardada.pregunta} cuando={guardada.creadaEn} {...(zona ? { zona } : {})} />
      <RespuestaGuardadaVista respuesta={guardada.respuesta} {...(zona ? { zona } : {})} />
      <p className="ac-pregunta-guardada__momento">{respuestaGuardadaDel(guardada.creadaEn, zona)}</p>
    </div>
  );
}

/** Las preguntas de la conversación: cada burbuja y, debajo, su respuesta. Sin red. Exportado para los tests. */
export function ListaDePreguntas({
  preguntas,
  alReintentar,
  enEspera = false,
  zona,
}: {
  preguntas: readonly IntercambioDePregunta[];
  alReintentar: (id: number) => void;
  enEspera?: boolean;
  zona?: string;
}) {
  if (preguntas.length === 0) return null;
  return (
    <ol className="ac-preguntas" aria-label="Preguntas">
      {preguntas.map((p) => (
        <li key={p.id} className="ac-preguntas__item">
          <BurbujaPropia pregunta={p.pregunta} cuando={p.cuando} {...(zona ? { zona } : {})} />
          {p.estado.fase === "CARGANDO" && (
            <p className="ac-mensaje" role="status" aria-busy="true">
              Buscando la respuesta…
            </p>
          )}
          {p.estado.fase === "LISTA" && <RespuestaDePreguntaVista respuesta={p.estado.respuesta} alReintentar={() => alReintentar(p.id)} {...(zona ? { zona } : {})} />}
          {p.estado.fase === "FALLA" && <FallaDePregunta falla={p.estado.falla} alReintentar={() => alReintentar(p.id)} enEspera={enEspera} />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Las preguntas de una pantalla, con su red. `localId`: el Local desde el que
 * se pregunta (sin él, General). Cancelar al salir de la pantalla. Una
 * pregunta a la vez; ningún reintento solo.
 */
export function usePreguntas(localId: number | null, alPerderSesion: (motivo?: "VINCULO_INVALIDO") => void, alFallar: (f: FallaCliente) => void) {
  const [preguntas, despachar] = useReducer(reducirPreguntas, []);
  const siguienteId = useRef(1);
  const enCurso = useRef<AbortController | null>(null);
  const textos = useRef(new Map<number, string>());
  // Tanda 6D: mientras una pregunta espera su respuesta, una recarga por versión espera también.
  const clave = `pregunta${useId()}`;

  useEffect(
    () => () => {
      enCurso.current?.abort();
      retenerRecarga(clave, false);
    },
    [clave],
  );

  const mandar = useCallback(
    (id: number, pregunta: string) => {
      const control = new AbortController();
      enCurso.current = control;
      // Se marca ANTES de mandar, en el mismo toque: la caja se vacía enseguida y no tiene que soltar la recarga en el medio.
      retenerRecarga(clave, true);
      void preguntar({ pregunta, ...(localId === null ? {} : { localId }) }, control.signal).then((resultado) => {
        if (control.signal.aborted) return;
        enCurso.current = null;
        retenerRecarga(clave, false);
        if (!resultado.ok && resultado.falla.estado === "SIN_SESION") return alPerderSesion(resultado.falla.motivo);
        if (!resultado.ok) alFallar(resultado.falla);
        despachar({ tipo: "RESPUESTA", id, resultado });
      });
    },
    [localId, alPerderSesion, alFallar, clave],
  );

  const alEnviar = useCallback(
    (pregunta: string) => {
      if (enCurso.current) return;
      const id = siguienteId.current++;
      textos.current.set(id, pregunta);
      despachar({ tipo: "PREGUNTAR", id, pregunta, cuando: new Date().toISOString() });
      mandar(id, pregunta);
    },
    [mandar],
  );

  const alReintentar = useCallback(
    (id: number) => {
      const pregunta = textos.current.get(id);
      if (enCurso.current || pregunta === undefined) return;
      despachar({ tipo: "REINTENTAR", id });
      mandar(id, pregunta);
    },
    [mandar],
  );

  return { preguntas, enviando: hayPreguntaEnCurso(preguntas), alEnviar, alReintentar };
}
