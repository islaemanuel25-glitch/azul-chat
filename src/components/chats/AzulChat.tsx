"use client";

// LA APLICACIÓN: QUÉ PANTALLA SE VE Y CÓMO SE NAVEGA.
//
// Tres vistas —la lista, un Local y General— y la sesión. La vista va en la URL
// como consulta (`/?vista=local&localId=N`, `/?vista=general`), no como
// segmento de ruta: la app no tiene segmentos dinámicos. Así el botón "atrás"
// del teléfono vuelve a la vista anterior, y además cada pantalla tiene su
// propia flecha para volver, que no depende del historial del navegador.
//
// Si cualquier pedido dice SIN_SESION (o que el vínculo ya no vale), se vuelve
// al panel de sesión de siempre para vincular de nuevo. No hay otra forma de
// autenticarse ni se guarda nada en el navegador.

import { useCallback, useEffect, useState } from "react";

import { PanelSesion } from "../sesion/PanelSesion.tsx";
import { ShellMovil } from "../shell/ShellMovil.tsx";
import { PantallaGeneral, PantallaLocal } from "./Conversacion.tsx";
import { leerVista, urlDeVista, type Vista } from "./logica.ts";
import { PantallaChats } from "./PantallaChats.tsx";

/** Marca de las entradas de historial que agrega la app: volver con la flecha usa el "atrás" solo si la entrada es nuestra. */
const MARCA_HISTORIAL = "azul-chat";

type Modo = { readonly tipo: "CHATS" } | { readonly tipo: "SESION"; readonly motivo?: "VINCULO_INVALIDO" };

export function AzulChat() {
  // La vista se lee de la URL recién en el navegador (no hay URL en el servidor).
  const [vista, setVista] = useState<Vista | null>(null);
  const [modo, setModo] = useState<Modo>({ tipo: "CHATS" });

  useEffect(() => {
    const leer = () => setVista(leerVista(window.location.search));
    leer();
    window.addEventListener("popstate", leer);
    return () => window.removeEventListener("popstate", leer);
  }, []);

  const abrir = useCallback((v: Vista) => {
    window.history.pushState({ [MARCA_HISTORIAL]: true }, "", urlDeVista(v));
    setVista(v);
  }, []);

  const volverAChats = useCallback(() => {
    const estado = window.history.state as Record<string, unknown> | null;
    if (estado?.[MARCA_HISTORIAL]) {
      window.history.back(); // popstate lee la URL anterior
      return;
    }
    window.history.replaceState(null, "", urlDeVista({ tipo: "CHATS" }));
    setVista({ tipo: "CHATS" });
  }, []);

  const perderSesion = useCallback((motivo?: "VINCULO_INVALIDO") => setModo(motivo ? { tipo: "SESION", motivo } : { tipo: "SESION" }), []);
  const verSesion = useCallback(() => setModo({ tipo: "SESION" }), []);
  const entrar = useCallback(() => setModo({ tipo: "CHATS" }), []);

  if (modo.tipo === "SESION") {
    return (
      <ShellMovil titulo="Azul Chat">
        <PanelSesion alVincular={entrar} alVerChats={entrar} {...(modo.motivo ? { motivo: modo.motivo } : {})} />
      </ShellMovil>
    );
  }
  if (vista === null) return <ShellMovil titulo="Azul Chat">{null}</ShellMovil>;
  switch (vista.tipo) {
    case "CHATS":
      return <PantallaChats alAbrir={abrir} alPerderSesion={perderSesion} alVerSesion={verSesion} />;
    case "LOCAL":
      return <PantallaLocal key={vista.localId} localId={vista.localId} alVolver={volverAChats} alPerderSesion={perderSesion} />;
    case "GENERAL":
      return <PantallaGeneral alVolver={volverAChats} alPerderSesion={perderSesion} />;
  }
}
