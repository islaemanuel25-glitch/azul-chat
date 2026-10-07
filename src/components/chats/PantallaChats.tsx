"use client";

// LA LISTA DE CHATS: General primero y, debajo, los locales que la API dice que
// la persona puede ver HOY. Ningún local sale de otro lado.
//
// Cada vez que se abre, pide GET /api/chats (que verifica el acceso con el ERP
// y trae lo nuevo). No hay refresco automático: "Actualizar" vuelve a pedir.
// Si la API falla, la lista se reemplaza por el estado de la falla: no se deja
// a la vista una lista vieja como si siguiera autorizada.

import { useEffect, useState } from "react";

import type { RespuestaChats } from "../../shared/chats/api.ts";
import { ShellMovil } from "../shell/ShellMovil.tsx";
import { pedirChats, type FallaCliente } from "./clienteChats.ts";
import { formatearMomento, resumenDeEvento } from "./formato.ts";
import { destinoDeFalla, filasDeChats, type FilaDeChats, type Filtro, type Vista } from "./logica.ts";
import { Avatar, AvisoDemorada, BadgeNoLeidos, EstadoChat, EstadoErpNoDisponible } from "./Piezas.tsx";

type RespuestaOk = Extract<RespuestaChats, { estado: "OK" }>;

export type Estado = { readonly fase: "CARGANDO" } | { readonly fase: "LISTA"; readonly datos: RespuestaOk } | { readonly fase: "FALLA"; readonly falla: FallaCliente };

/** Una fila: General o un local. Es un botón: abre la conversación. */
export function FilaChat({ fila, alAbrir, ahora, zona }: { fila: FilaDeChats; alAbrir: (v: Vista) => void; ahora: Date; zona?: string }) {
  const general = fila.tipo === "GENERAL";
  const nombre = general ? "General" : fila.local.nombre;
  const ultimo = general ? fila.ultimoEvento : fila.local.ultimoEvento;
  const noLeidos = general ? fila.noLeidos : fila.local.noLeidos;
  const resumen = !ultimo ? "Sin novedades" : general && fila.ultimoEvento ? `${fila.ultimoEvento.local.nombre}: ${resumenDeEvento(ultimo)}` : resumenDeEvento(ultimo);
  const demorada = !general && fila.local.sincronizacion === "DEMORADA";
  return (
    <li>
      <button
        type="button"
        className="ac-fila"
        onClick={() => alAbrir(general ? { tipo: "GENERAL" } : { tipo: "LOCAL", localId: fila.local.localId })}
      >
        <Avatar nombre={nombre} general={general} />
        <span className="ac-fila__texto">
          <span className="ac-fila__nombre">{nombre}</span>
          <span className="ac-fila__resumen">{resumen}</span>
          {demorada && <span className="ac-fila__demorada">Actualización demorada</span>}
        </span>
        <span className="ac-fila__meta">
          {ultimo && <span className="ac-fila__hora">{formatearMomento(ultimo.fecha, ahora, zona)}</span>}
          <BadgeNoLeidos cantidad={noLeidos} />
        </span>
      </button>
    </li>
  );
}

/** El cuerpo de la lista, ya con datos: filtros y filas. Sin red. */
export function ListaChats({
  datos,
  filtro,
  alCambiarFiltro,
  alAbrir,
  ahora,
  zona,
}: {
  datos: RespuestaOk;
  filtro: Filtro;
  alCambiarFiltro: (f: Filtro) => void;
  alAbrir: (v: Vista) => void;
  ahora: Date;
  zona?: string;
}) {
  const filas = filasDeChats(datos, filtro);
  return (
    <>
      <div className="ac-chips" role="group" aria-label="Filtrar chats">
        {(
          [
            ["TODOS", "Todos"],
            ["NO_LEIDOS", "No leídos"],
          ] as const
        ).map(([valor, texto]) => (
          <button key={valor} type="button" className="ac-chip" aria-pressed={filtro === valor} onClick={() => alCambiarFiltro(valor)}>
            {texto}
          </button>
        ))}
      </div>
      {filas.length === 0 ? (
        <EstadoChat texto="No hay chats sin leer." />
      ) : (
        <ul className="ac-filas">
          {filas.map((f) => (
            <FilaChat key={f.tipo === "GENERAL" ? "general" : `local-${f.local.localId}`} fila={f} alAbrir={alAbrir} ahora={ahora} {...(zona ? { zona } : {})} />
          ))}
        </ul>
      )}
      {datos.locales.length === 0 && <EstadoChat texto="Hoy no tenés locales con eventos para ver." />}
      {datos.locales.some((l) => l.sincronizacion === "DEMORADA") && filtro === "TODOS" && (
        <AvisoDemorada texto="Algunos locales muestran lo último guardado: traer lo nuevo se demoró." />
      )}
    </>
  );
}

export function PantallaChats({ alAbrir, alPerderSesion, alVerSesion }: { alAbrir: (v: Vista) => void; alPerderSesion: (motivo?: "VINCULO_INVALIDO") => void; alVerSesion: () => void }) {
  const [estado, setEstado] = useState<Estado>({ fase: "CARGANDO" });
  const [intento, setIntento] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");

  useEffect(() => {
    const control = new AbortController();
    void pedirChats(control.signal).then((r) => {
      if (control.signal.aborted) return;
      if (r.ok) return setEstado({ fase: "LISTA", datos: r.datos });
      if (r.falla.estado === "SIN_SESION") return alPerderSesion(r.falla.motivo);
      setEstado({ fase: "FALLA", falla: r.falla });
    });
    return () => control.abort();
  }, [intento, alPerderSesion]);

  const reintentar = () => {
    setEstado({ fase: "CARGANDO" });
    setIntento((n) => n + 1);
  };

  return (
    <ShellMovil
      titulo="Azul Chat"
      acciones={
        <>
          <button type="button" className="ac-boton-icono ac-boton-icono--sobre-marca" aria-label="Actualizar chats" onClick={reintentar} disabled={estado.fase === "CARGANDO"}>
            <span aria-hidden="true">↻</span>
          </button>
          <button type="button" className="ac-boton-icono ac-boton-icono--sobre-marca" aria-label="Tu sesión" onClick={alVerSesion}>
            <span aria-hidden="true">☰</span>
          </button>
        </>
      }
    >
      <CuerpoChats estado={estado} filtro={filtro} alCambiarFiltro={setFiltro} alAbrir={alAbrir} alReintentar={reintentar} />
    </ShellMovil>
  );
}

/** Lo que va debajo del encabezado según el estado. Exportado para los tests. */
export function CuerpoChats({
  estado,
  filtro,
  alCambiarFiltro,
  alAbrir,
  alReintentar,
  ahora = new Date(),
  zona,
}: {
  estado: Estado;
  filtro: Filtro;
  alCambiarFiltro: (f: Filtro) => void;
  alAbrir: (v: Vista) => void;
  alReintentar: () => void;
  ahora?: Date;
  zona?: string;
}) {
  if (estado.fase === "CARGANDO") return <EstadoChat texto="Cargando chats…" cargando />;
  if (estado.fase === "FALLA") return <FallaDeChats falla={estado.falla} alReintentar={alReintentar} />;
  return <ListaChats datos={estado.datos} filtro={filtro} alCambiarFiltro={alCambiarFiltro} alAbrir={alAbrir} ahora={ahora} {...(zona ? { zona } : {})} />;
}

function FallaDeChats({ falla, alReintentar }: { falla: FallaCliente; alReintentar: () => void }) {
  switch (destinoDeFalla(falla)) {
    case "ERP_NO_DISPONIBLE":
      return <EstadoErpNoDisponible alReintentar={alReintentar} />;
    case "NO_AUTORIZADO":
      return <EstadoChat titulo="Sin acceso" texto="El ERP dice que hoy no estás autorizado para usar Azul Chat." accion={{ texto: "Reintentar", alTocar: alReintentar }} />;
    case "SIN_RED":
      return <EstadoChat titulo="Sin conexión" texto="No hubo respuesta de Azul Chat." accion={{ texto: "Reintentar", alTocar: alReintentar }} />;
    default:
      return <EstadoChat titulo="No disponible" texto="Azul Chat no está disponible en este momento." accion={{ texto: "Reintentar", alTocar: alReintentar }} />;
  }
}
