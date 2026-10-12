// src/server/sesion/estado.ts
//
// GET /api/sesion — ¿HAY SESIÓN EN ESTE DISPOSITIVO, DE QUIÉN, Y QUÉ LOCALES
// PUEDE VER HOY?
//
// La identidad y los locales salen de `mi_alcance` EN EL MOMENTO, con el token
// del vínculo descifrado en el servidor. No se guardan: no son una autorización
// de Azul Chat, y cada consulta sobre un local la vuelve a decidir el ERP.
//
// La respuesta lleva solo lo que la interfaz necesita para dibujarse: el
// nombre, el modo de alcance y los locales. Nunca el token, ids internos ni el
// identificador de la cookie. Siempre 200: el estado está en el cuerpo.
//
// Tanda 15: si el dueño todavía no le dio "entrar" a esta persona, SIN_ACCESO
// con su nombre y nada más. El nombre queda anotado para la lista de Accesos.

import "server-only";

import type { EstadoSesion } from "../../shared/sesion/api.ts";
import { json } from "../http/respuestas.ts";
import { cookieBorrada } from "./cookie.ts";
import { conDelegacion } from "./delegacion.ts";
import type { DependenciasSesion } from "./dependencias.ts";
import { anotarNombre } from "../accesos/accesos.ts";
import { accesoDelContexto } from "../chats/autorizacion.ts";

export async function manejarEstado(request: Request, deps: DependenciasSesion): Promise<Response> {
  const produccion = deps.config.ok ? deps.config.config.produccion : true;
  let r;
  try {
    r = await conDelegacion(request.headers, deps, async (token, contexto) => {
      const alcance = await deps.erp.miAlcance(token);
      if (!alcance.ok) return alcance;
      // Tanda 15: el nombre, para la lista de Accesos; y si el dueño ya le dio acceso.
      await anotarNombre(contexto.db, contexto.sesion.vinculo.id, alcance.datos.usuario.nombre);
      const acceso = await accesoDelContexto(contexto, deps);
      return { ...alcance, datos: { alcance: alcance.datos, entra: acceso.permisos.entrar } };
    });
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return json({ estado: "SERVICIO_NO_DISPONIBLE" } satisfies EstadoSesion);
  }

  let estado: EstadoSesion;
  let cookie: string | null = null;
  switch (r.tipo) {
    case "OK":
      estado = r.datos.entra
        ? {
            estado: "VINCULADO",
            usuario: { nombre: r.datos.alcance.usuario.nombre },
            alcance: r.datos.alcance.alcance,
            locales: r.datos.alcance.locales,
          }
        : // Sin acceso a Azul Chat: solo el nombre, ningún local.
          { estado: "SIN_ACCESO", usuario: { nombre: r.datos.alcance.usuario.nombre } };
      break;
    case "SIN_SESION":
      estado = r.vinculoInvalidado ? { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" } : { estado: "SIN_SESION" };
      // Si el navegador trae una cookie que ya no vale, se le borra.
      if (request.headers.get("cookie")) cookie = cookieBorrada({ produccion });
      break;
    case "RECHAZO_ERP":
      estado = r.resultado.origen === "erp" && r.resultado.codigo === "NO_AUTORIZADO" ? { estado: "NO_AUTORIZADO" } : { estado: "ERP_NO_DISPONIBLE" };
      break;
    case "SERVICIO_NO_DISPONIBLE":
      estado = { estado: "SERVICIO_NO_DISPONIBLE" };
      break;
  }
  return json(estado, { cookie });
}
