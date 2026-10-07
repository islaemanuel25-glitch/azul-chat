"use client";

// EL PANEL DE SESIÓN: SIN SESIÓN, PEGAR EL CÓDIGO; CON SESIÓN, QUIÉN SOS Y QUÉ
// LOCALES PODÉS VER.
//
// Habla solo con las rutas propias de Azul Chat (/api/sesion y
// /api/sesion/vincular), nunca con el ERP: el navegador no tiene el secreto ni
// el token, y no tiene por qué. La sesión vive en una cookie HttpOnly que este
// código no puede leer.
//
// El código de canje viaja en el CUERPO de un POST y se borra del campo apenas
// se manda. No va a la URL, ni al almacenamiento del navegador, ni a la consola.
// El nombre y los locales que se muestran son los que acaba de devolver el ERP
// (`mi_alcance`), sin nada inventado.
//
// Dentro de la app de chats (components/chats/AzulChat.tsx) es la puerta de
// entrada: `alVincular` avisa que la vinculación salió bien, `alVerChats` vuelve
// a los chats con la sesión abierta, y `motivo` trae el aviso de un vínculo que
// el ERP invalidó mientras se usaban los chats (la cookie ya se borró, así que
// GET /api/sesion no lo puede decir).

import { useEffect, useState, type FormEvent } from "react";

import type { EstadoSesion, RespuestaCerrar, RespuestaVincular } from "../../shared/sesion/api.ts";

const RUTA_SESION = "/api/sesion";
const RUTA_VINCULAR = "/api/sesion/vincular";

async function pedirEstado(): Promise<EstadoSesion> {
  const res = await fetch(RUTA_SESION, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return { estado: "SERVICIO_NO_DISPONIBLE" };
  return (await res.json()) as EstadoSesion;
}

const TEXTO_ALCANCE: Record<string, string> = {
  LOCAL: "Tu local",
  GRUPO: "Los locales de tu grupo",
  GLOBAL: "Todos los locales",
  NINGUNO: "Ningún local",
};

export function PanelSesion({
  alVincular,
  alVerChats,
  motivo,
}: { alVincular?: () => void; alVerChats?: () => void; motivo?: "VINCULO_INVALIDO" } = {}) {
  const [estado, setEstado] = useState<EstadoSesion | null>(null);
  const [codigo, setCodigo] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    let vigente = true;
    pedirEstado()
      .then((e) => {
        if (vigente) setEstado(e);
      })
      .catch(() => {
        if (vigente) setEstado({ estado: "SERVICIO_NO_DISPONIBLE" });
      });
    return () => {
      vigente = false;
    };
  }, []);

  const recargar = async () => setEstado(await pedirEstado().catch((): EstadoSesion => ({ estado: "SERVICIO_NO_DISPONIBLE" })));

  const vincular = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const enviado = codigo.trim();
    // El código sale del campo antes de viajar: no queda a la vista ni en el estado.
    setCodigo("");
    setMensaje("");
    setTrabajando(true);
    try {
      const res = await fetch(RUTA_VINCULAR, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: enviado }),
      });
      const r = (await res.json().catch(() => null)) as RespuestaVincular | null;
      if (!r || !r.ok) {
        setMensaje(r?.mensaje ?? `No se pudo vincular (error ${res.status}).`);
        return;
      }
      await recargar();
      alVincular?.();
    } catch {
      setMensaje("No hubo respuesta de Azul Chat.");
    } finally {
      setTrabajando(false);
    }
  };

  const cerrar = async () => {
    setMensaje("");
    setTrabajando(true);
    try {
      const res = await fetch(RUTA_SESION, { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      const r = (await res.json().catch(() => null)) as RespuestaCerrar | null;
      if (!r || !r.ok) setMensaje(r?.mensaje ?? `No se pudo cerrar la sesión (error ${res.status}).`);
      await recargar();
    } finally {
      setTrabajando(false);
    }
  };

  if (estado === null) {
    return (
      <section className="ac-tarjeta" aria-busy="true">
        <p className="ac-tarjeta__texto">Cargando…</p>
      </section>
    );
  }

  if (estado.estado === "VINCULADO") {
    return (
      <section className="ac-tarjeta" aria-live="polite">
        <span className="ac-pastilla">
          <span className="ac-pastilla__punto ac-pastilla__punto--activo" aria-hidden="true" />
          Sesión iniciada
        </span>
        <h2 className="ac-tarjeta__titulo">Hola, {estado.usuario.nombre}</h2>
        <p className="ac-tarjeta__texto">{TEXTO_ALCANCE[estado.alcance.modo]}, según el ERP:</p>
        {estado.locales.length === 0 ? (
          <p className="ac-tarjeta__texto">El ERP no te muestra ningún local hoy.</p>
        ) : (
          <ul className="ac-lista">
            {estado.locales.map((l) => (
              <li key={l.id} className="ac-lista__item">
                <span>{l.nombre}</span>
                <span className="ac-tarjeta__texto">
                  {l.esDeposito ? "Depósito" : "Local"}
                  {l.activo ? "" : " · inactivo"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="ac-acciones">
          {alVerChats && (
            <button type="button" className="ac-boton" onClick={alVerChats} disabled={trabajando}>
              Ver chats
            </button>
          )}
          <button type="button" className="ac-boton ac-boton--secundario" onClick={cerrar} disabled={trabajando}>
            Cerrar sesión
          </button>
        </div>
        {mensaje && <p className="ac-mensaje">{mensaje}</p>}
      </section>
    );
  }

  if (estado.estado === "ERP_NO_DISPONIBLE" || estado.estado === "NO_AUTORIZADO" || estado.estado === "SERVICIO_NO_DISPONIBLE") {
    const texto =
      estado.estado === "NO_AUTORIZADO"
        ? "Tu sesión sigue abierta, pero el ERP dice que hoy no estás autorizado para usar Azul Chat."
        : estado.estado === "ERP_NO_DISPONIBLE"
          ? "Tu sesión sigue abierta, pero el ERP no respondió. Probá de nuevo en un rato."
          : "Azul Chat no está disponible en este momento.";
    return (
      <section className="ac-tarjeta" aria-live="polite">
        <h2 className="ac-tarjeta__titulo">No se pudo cargar tu información</h2>
        <p className="ac-tarjeta__texto">{texto}</p>
        <div className="ac-acciones">
          <button type="button" className="ac-boton" onClick={() => void recargar()} disabled={trabajando}>
            Reintentar
          </button>
          <button type="button" className="ac-boton ac-boton--secundario" onClick={cerrar} disabled={trabajando}>
            Cerrar sesión
          </button>
        </div>
        {mensaje && <p className="ac-mensaje">{mensaje}</p>}
      </section>
    );
  }

  return (
    <section className="ac-tarjeta" aria-live="polite">
      <span className="ac-pastilla">
        <span className="ac-pastilla__punto" aria-hidden="true" />
        Sin sesión
      </span>
      <h2 className="ac-tarjeta__titulo">Vinculá Azul Chat con el ERP</h2>
      <p className="ac-tarjeta__texto">
        {(estado.motivo ?? motivo) === "VINCULO_INVALIDO"
          ? "Tu vínculo con el ERP ya no es válido. Generá un código nuevo para volver a entrar."
          : "En el ERP, abrí tu menú, tocá «Vincular Azul Chat» y pegá acá el código. Vence en 10 minutos y sirve una sola vez."}
      </p>
      <form className="ac-formulario" onSubmit={vincular}>
        <label className="ac-campo">
          <span className="ac-campo__rotulo">Código del ERP</span>
          <input
            className="ac-campo__entrada"
            name="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={trabajando}
          />
        </label>
        <button type="submit" className="ac-boton" disabled={trabajando || codigo.trim() === ""}>
          {trabajando ? "Vinculando…" : "Vincular"}
        </button>
      </form>
      {mensaje && <p className="ac-mensaje">{mensaje}</p>}
    </section>
  );
}
