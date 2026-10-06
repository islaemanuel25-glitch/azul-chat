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

import "server-only";

import type { EstadoSesion } from "../../shared/sesion/api.ts";
import { json } from "../http/respuestas.ts";
import { cookieBorrada } from "./cookie.ts";
import { conDelegacion } from "./delegacion.ts";
import type { DependenciasSesion } from "./dependencias.ts";

export async function manejarEstado(request: Request, deps: DependenciasSesion): Promise<Response> {
  const produccion = deps.config.ok ? deps.config.config.produccion : true;
  const r = await conDelegacion(request.headers, deps, (token) => deps.erp.miAlcance(token));

  let estado: EstadoSesion;
  let cookie: string | null = null;
  switch (r.tipo) {
    case "OK":
      estado = {
        estado: "VINCULADO",
        usuario: { nombre: r.datos.usuario.nombre },
        alcance: r.datos.alcance,
        locales: r.datos.locales,
      };
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
