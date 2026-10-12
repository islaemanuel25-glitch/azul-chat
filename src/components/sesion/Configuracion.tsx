"use client";

// LA CONFIGURACIÓN DEL PANEL ☰ (Tanda 11). Figma DpxKeDtugjdB8IfuGnHZcz,
// pantalla 06 "Configuración" (1:271–1:315), dentro del panel que ya existe y
// debajo de la lista de locales, en tres secciones:
//
//   · Notificaciones: el estado REAL de los avisos (push/FilaNotificaciones.tsx)
//     y, debajo, el horario de silencio (apagado por defecto; horas enteras de
//     Argentina, puede cruzar la medianoche). Se guarda al cambiarlo;
//   · Inteligencia artificial: lo gastado este mes contra el tope, las
//     preguntas del mes y, si se llegó al tope, hasta cuándo. Sin IA
//     configurada en el servidor, la sección no está;
//   · Accesos (Tanda 15), SOLO para administradores: las personas que alguna
//     vez se vincularon y un interruptor por permiso (Entrar, Ventas, Caja,
//     Stock, Pendientes, IA). Sin "Entrar", los demás se ven deshabilitados;
//     un administrador, con todo prendido y bloqueado. Cada toque se guarda
//     entero, como el horario de silencio: si falla, vuelve atrás y lo dice.
//     Las mismas piezas que el silencio (`ac-ajuste`, `ac-interruptor`);
//   · Sesiones: los dispositivos con sesión abierta, "Cerrar las otras
//     sesiones" y "Cerrar sesión", los dos con una confirmación PROPIA de la
//     app (no `confirm()` del navegador). El 11/10 alguien tocó "Cerrar sesión"
//     sin querer: tuvo que volver a poner el código y se quedó sin avisos.
//
// "Privacidad del push" y "Sonidos y vibración" del diseño NO están: los
// avisos no traen montos ni datos sensibles, y los sonidos los maneja el
// sistema del teléfono.
//
// Las piezas que dibujan no tienen red ni efectos (se prueban sin navegador);
// `SeccionesDeConfiguracion` es la que pide y guarda. Solo clases `ac-*`.

import { useCallback, useEffect, useState } from "react";

import type { Dispositivo, HorarioSilencio, RespuestaConfiguracion, SaldoIa } from "../../shared/sesion/configuracion.ts";
import { PERMISOS, type Permiso, type Permisos, type PersonaConAcceso } from "../../shared/sesion/accesos.ts";
import { formatearHora } from "../chats/formato.ts";
import { FilaNotificaciones } from "../push/FilaNotificaciones.tsx";
import { cerrarOtrasSesiones, guardarAccesos, guardarSilencio, pedirAccesos, pedirConfiguracion } from "./clienteConfiguracion.ts";

type Configuracion = Extract<RespuestaConfiguracion, { estado: "OK" }>;

const IDIOMA = "es-AR";

/** El texto de la confirmación de cerrar sesión, tal cual lo pidió el dueño. */
export const PREGUNTA_CERRAR_SESION =
  "¿Cerrar sesión en este teléfono? Vas a tener que volver a poner el código del ERP y las notificaciones de este teléfono se desactivan.";

/** "US$ 0,42": centavos de dólar, con coma. */
export function formatearUsd(centavos: number): string {
  return `US$ ${(centavos / 100).toLocaleString(IDIOMA, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "00 h" … "23 h". */
export const textoDeHora = (h: number) => `${String(h).padStart(2, "0")} h`;

/** "1/11": el día en que vuelve el saldo, de "2026-11-01". */
export function diaDeReinicio(fecha: string): string {
  const [, m, d] = fecha.split("-").map(Number) as [number, number, number];
  return `${d}/${m}`;
}

/** "Desde el 11/10 a las 21:02". */
export function desdeCuando(iso: string, zona?: string): string {
  const dia = new Intl.DateTimeFormat(IDIOMA, { timeZone: zona, day: "numeric", month: "numeric" }).format(new Date(iso));
  return `Desde el ${dia} a las ${formatearHora(iso, zona)}`;
}

/** Una confirmación de la app, en el lugar del botón: la pregunta, "Cancelar" y la acción. Cancelar no hace nada más. */
export function Confirmacion({
  pregunta,
  textoConfirmar,
  trabajando = false,
  alConfirmar,
  alCancelar,
}: {
  pregunta: string;
  textoConfirmar: string;
  trabajando?: boolean;
  alConfirmar: () => void;
  alCancelar: () => void;
}) {
  return (
    <div className="ac-confirmacion" role="alertdialog" aria-label={textoConfirmar} aria-describedby="ac-confirmacion-pregunta">
      <p id="ac-confirmacion-pregunta" className="ac-confirmacion__pregunta">
        {pregunta}
      </p>
      <div className="ac-acciones">
        <button type="button" className="ac-boton ac-boton--secundario" onClick={alCancelar} disabled={trabajando}>
          Cancelar
        </button>
        <button type="button" className="ac-boton" onClick={alConfirmar} disabled={trabajando}>
          {textoConfirmar}
        </button>
      </div>
    </div>
  );
}

/** Las 24 horas, para elegir desde y hasta. */
const HORAS = Array.from({ length: 24 }, (_, h) => h);

/** El horario de silencio: el interruptor y, prendido, desde y hasta. Cada cambio se guarda entero. */
export function VistaSilencio({
  silencio,
  guardando,
  error,
  alCambiar,
}: {
  silencio: HorarioSilencio;
  guardando: boolean;
  error?: string;
  alCambiar: (h: HorarioSilencio) => void;
}) {
  const cambiarHora = (campo: "desde" | "hasta", valor: number) => {
    const otro = campo === "desde" ? silencio.hasta : silencio.desde;
    if (valor === otro) return; // un horario de 0 o de 24 horas no es un horario
    alCambiar({ ...silencio, [campo]: valor });
  };
  return (
    <div className="ac-ajuste ac-ajuste--apilado">
      <div className="ac-ajuste__fila">
        <div className="ac-ajuste__texto">
          <p className="ac-ajuste__titulo">Horario de silencio</p>
          <p className="ac-ajuste__estado">
            {silencio.activo ? `Sin avisos de ${textoDeHora(silencio.desde)} a ${textoDeHora(silencio.hasta)}` : "Apagado"}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={silencio.activo}
          aria-label="Horario de silencio"
          className="ac-interruptor"
          onClick={() => alCambiar({ ...silencio, activo: !silencio.activo })}
          disabled={guardando}
        >
          <span className="ac-interruptor__perilla" aria-hidden="true" />
        </button>
      </div>
      {silencio.activo && (
        <div className="ac-ajuste__horas">
          {(["desde", "hasta"] as const).map((campo) => (
            <label key={campo} className="ac-ajuste__hora">
              <span className="ac-ajuste__estado">{campo === "desde" ? "Desde" : "Hasta"}</span>
              <select className="ac-ajuste__selector" value={silencio[campo]} onChange={(e) => cambiarHora(campo, Number(e.target.value))} disabled={guardando}>
                {HORAS.map((h) => (
                  <option key={h} value={h} disabled={h === (campo === "desde" ? silencio.hasta : silencio.desde)}>
                    {textoDeHora(h)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {silencio.activo && (
        <p className="ac-ajustes__nota">Hora de Argentina. Lo que llegue en ese horario queda sin leer en la app y no se avisa después.</p>
      )}
      {error && <p className="ac-ajustes__nota">{error}</p>}
    </div>
  );
}

/** Inteligencia artificial: lo gastado del mes por todo el negocio contra el tope, y las preguntas de esta persona. Sin IA en el servidor, nada. */
export function VistaIa({ ia }: { ia: SaldoIa | null }) {
  if (!ia) return null;
  return (
    <section className="ac-ajustes" aria-labelledby="ac-ajustes-ia">
      <h3 id="ac-ajustes-ia" className="ac-ajustes__seccion">
        Inteligencia artificial
      </h3>
      <div className="ac-ajuste">
        <div className="ac-ajuste__texto">
          <p className="ac-ajuste__titulo">
            Gastado este mes, entre todos: {formatearUsd(ia.gastadoCentavos)} de {formatearUsd(ia.topeCentavos)}
          </p>
          <p className="ac-ajuste__estado">Tus preguntas este mes: {ia.preguntasPropias.toLocaleString(IDIOMA)}</p>
          {ia.agotado && <p className="ac-ajuste__estado">Saldo agotado hasta el {diaDeReinicio(ia.reiniciaEl)}</p>}
        </div>
      </div>
    </section>
  );
}

/** Tanda 15: el rótulo de cada interruptor de la sección Accesos (alcanceUi.test.ts los admite solo acá). */
export const ROTULO_PERMISO: Readonly<Record<Permiso, string>> = Object.freeze({
  entrar: "Entrar",
  ventas: "Ventas",
  caja: "Caja",
  stock: "Stock",
  pendientes: "Pendientes",
  ia: "IA",
});

/** "Vinculado el 12/10 a las 21:02": el último vínculo de una persona. */
export function vinculadoEl(iso: string, zona?: string): string {
  const dia = new Intl.DateTimeFormat(IDIOMA, { timeZone: zona, day: "numeric", month: "numeric" }).format(new Date(iso));
  return `Vinculado el ${dia} a las ${formatearHora(iso, zona)}`;
}

/**
 * Tanda 15: los accesos de las personas, para un administrador. Sin red: cada
 * interruptor avisa con los seis permisos de esa persona, ya cambiados.
 */
export function VistaAccesos({
  personas,
  guardando,
  error,
  alCambiar,
  zona,
}: {
  personas: readonly PersonaConAcceso[];
  /** El id de la persona cuyo cambio se está guardando: sus interruptores quedan quietos. */
  guardando: number | null;
  error?: string;
  alCambiar: (personaId: number, permisos: Permisos) => void;
  zona?: string;
}) {
  const cambiar = (p: PersonaConAcceso, permiso: Permiso) => alCambiar(p.personaId, { ...p.permisos, [permiso]: !p.permisos[permiso] });
  return (
    <section className="ac-ajustes" aria-labelledby="ac-ajustes-accesos">
      <h3 id="ac-ajustes-accesos" className="ac-ajustes__seccion">
        Accesos
      </h3>
      {personas.map((p) => (
        <div key={p.personaId} className="ac-ajuste ac-ajuste--apilado">
          <div className="ac-ajuste__texto">
            <p className="ac-ajuste__titulo">{p.nombre}</p>
            <p className="ac-ajuste__estado">{p.administrador ? `Administrador · ${vinculadoEl(p.vinculadoEn, zona)}` : vinculadoEl(p.vinculadoEn, zona)}</p>
          </div>
          {PERMISOS.map((permiso) => (
            <div key={permiso} className="ac-ajuste__fila">
              <div className="ac-ajuste__texto">
                <p className="ac-ajuste__estado">{ROTULO_PERMISO[permiso]}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={p.permisos[permiso]}
                aria-label={`${ROTULO_PERMISO[permiso]} de ${p.nombre}`}
                className="ac-interruptor"
                onClick={() => cambiar(p, permiso)}
                disabled={p.administrador || guardando === p.personaId || (permiso !== "entrar" && !p.permisos.entrar)}
              >
                <span className="ac-interruptor__perilla" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ))}
      {error && <p className="ac-ajustes__nota">{error}</p>}
    </section>
  );
}

/** Tanda 15: la sección Accesos con su red. Solo la monta un administrador (`config.administrador`); el servidor igual la niega a cualquier otro. */
export function SeccionAccesos() {
  const [personas, setPersonas] = useState<readonly PersonaConAcceso[] | null>(null);
  const [guardando, setGuardando] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let vigente = true;
    void pedirAccesos().then((r) => {
      if (vigente && r.ok) setPersonas(r.datos.personas);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const cambiar = async (personaId: number, permisos: Permisos) => {
    if (!personas) return;
    const antes = personas;
    setPersonas(personas.map((p) => (p.personaId === personaId ? { ...p, permisos } : p)));
    setGuardando(personaId);
    setError(undefined);
    const r = await guardarAccesos({ personaId, ...permisos });
    setGuardando(null);
    if (r.ok) setPersonas((actuales) => (actuales ?? antes).map((p) => (p.personaId === personaId ? r.datos.persona : p)));
    else {
      setPersonas(antes);
      setError("No se pudo guardar. Probá de nuevo.");
    }
  };

  if (!personas) return null;
  return <VistaAccesos personas={personas} guardando={guardando} {...(error ? { error } : {})} alCambiar={(id, p) => void cambiar(id, p)} />;
}

/** Qué confirmación está abierta en Sesiones. */
export type Confirmando = "OTRAS" | "ESTA" | null;

/** Sesiones: los dispositivos, cerrar las otras y cerrar esta, cada una con su confirmación. */
export function VistaSesiones({
  dispositivos,
  confirmando,
  trabajando,
  mensaje,
  alPedirConfirmacion,
  alCancelar,
  alCerrarOtras,
  alCerrarSesion,
  zona,
}: {
  /** null: todavía no se sabe (o no se pudo leer): solo "Cerrar sesión". */
  dispositivos: readonly Dispositivo[] | null;
  confirmando: Confirmando;
  trabajando: boolean;
  mensaje?: string;
  alPedirConfirmacion: (c: Exclude<Confirmando, null>) => void;
  alCancelar: () => void;
  alCerrarOtras: () => void;
  alCerrarSesion: () => void;
  zona?: string;
}) {
  const otras = dispositivos?.filter((d) => !d.esEste).length ?? 0;
  return (
    <section className="ac-ajustes" aria-labelledby="ac-ajustes-sesiones">
      <h3 id="ac-ajustes-sesiones" className="ac-ajustes__seccion">
        Sesiones
      </h3>
      {dispositivos && (
        <div className="ac-ajuste ac-ajuste--apilado">
          <p className="ac-ajuste__titulo">Dispositivos</p>
          <p className="ac-ajuste__estado">{dispositivos.length === 1 ? "1 sesión abierta" : `${dispositivos.length} sesiones abiertas`}</p>
          <ul className="ac-lista">
            {dispositivos.map((d, i) => (
              <li key={`${d.creadaEn}-${i}`} className="ac-lista__item">
                <span>{d.esEste ? "Este dispositivo" : "Otro dispositivo"}</span>
                <span className="ac-tarjeta__texto">{desdeCuando(d.creadaEn, zona)}</span>
              </li>
            ))}
          </ul>
          {otras > 0 &&
            (confirmando === "OTRAS" ? (
              <Confirmacion
                pregunta={`¿Cerrar ${otras === 1 ? "la otra sesión" : `las otras ${otras} sesiones`}? En ${otras === 1 ? "ese teléfono" : "esos teléfonos"} van a tener que volver a poner el código del ERP y dejan de llegar los avisos.`}
                textoConfirmar="Cerrar las otras"
                trabajando={trabajando}
                alConfirmar={alCerrarOtras}
                alCancelar={alCancelar}
              />
            ) : (
              <div className="ac-acciones">
                <button type="button" className="ac-pastilla-accion" onClick={() => alPedirConfirmacion("OTRAS")} disabled={trabajando}>
                  Cerrar las otras sesiones
                </button>
              </div>
            ))}
        </div>
      )}
      {confirmando === "ESTA" ? (
        <Confirmacion pregunta={PREGUNTA_CERRAR_SESION} textoConfirmar="Cerrar sesión" trabajando={trabajando} alConfirmar={alCerrarSesion} alCancelar={alCancelar} />
      ) : (
        <div className="ac-acciones ac-ajustes__accion">
          <button type="button" className="ac-boton ac-boton--secundario" onClick={() => alPedirConfirmacion("ESTA")} disabled={trabajando}>
            Cerrar sesión
          </button>
        </div>
      )}
      {mensaje && <p className="ac-ajustes__nota">{mensaje}</p>}
    </section>
  );
}

/**
 * Las tres secciones, con su red. `alCerrarSesion` es el cierre de siempre
 * (DELETE /api/sesion, en PanelSesion): acá solo se le pone la confirmación.
 */
export function SeccionesDeConfiguracion({ alCerrarSesion, cerrando }: { alCerrarSesion: () => void; cerrando: boolean }) {
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [silencio, setSilencio] = useState<HorarioSilencio | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorSilencio, setErrorSilencio] = useState<string | undefined>(undefined);
  const [confirmando, setConfirmando] = useState<Confirmando>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | undefined>(undefined);

  const cargar = useCallback(async () => {
    const r = await pedirConfiguracion();
    if (r.ok) {
      setConfig(r.datos);
      setSilencio(r.datos.silencio);
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    void pedirConfiguracion().then((r) => {
      if (!vigente || !r.ok) return;
      setConfig(r.datos);
      setSilencio(r.datos.silencio);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const cambiarSilencio = async (h: HorarioSilencio) => {
    const antes = silencio;
    setSilencio(h);
    setGuardando(true);
    setErrorSilencio(undefined);
    const r = await guardarSilencio(h);
    setGuardando(false);
    if (r.ok) setSilencio(r.datos.silencio);
    else {
      setSilencio(antes);
      setErrorSilencio("No se pudo guardar. Probá de nuevo.");
    }
  };

  const cerrarOtras = async () => {
    setTrabajando(true);
    setMensaje(undefined);
    const r = await cerrarOtrasSesiones();
    setTrabajando(false);
    setConfirmando(null);
    if (!r.ok) {
      setMensaje("No se pudieron cerrar. Probá de nuevo.");
      return;
    }
    setMensaje(r.datos.cerradas === 1 ? "Se cerró 1 sesión." : `Se cerraron ${r.datos.cerradas} sesiones.`);
    await cargar();
  };

  return (
    <>
      <FilaNotificaciones>
        {silencio && <VistaSilencio silencio={silencio} guardando={guardando} {...(errorSilencio ? { error: errorSilencio } : {})} alCambiar={(h) => void cambiarSilencio(h)} />}
      </FilaNotificaciones>
      <VistaIa ia={config?.ia ?? null} />
      {config?.administrador && <SeccionAccesos />}
      <VistaSesiones
        dispositivos={config?.dispositivos ?? null}
        confirmando={confirmando}
        trabajando={trabajando || cerrando}
        {...(mensaje ? { mensaje } : {})}
        alPedirConfirmacion={setConfirmando}
        alCancelar={() => setConfirmando(null)}
        alCerrarOtras={() => void cerrarOtras()}
        alCerrarSesion={() => {
          setConfirmando(null);
          alCerrarSesion();
        }}
      />
    </>
  );
}
