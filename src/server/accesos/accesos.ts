// src/server/accesos/accesos.ts
//
// QUIÉN ENTRA A AZUL CHAT Y A QUÉ (Tanda 15). Solo servidor.
//
// Una capa MÁS sobre el ERP, que solo puede RESTAR: la sesión, la delegación y
// `mi_alcance` en cada pedido siguen igual, y encima de eso cada persona tiene
// seis permisos (AccesoPersona): entrar, ventas, caja, stock, pendientes, ia.
// Sin "entrar", nada de lo demás vale. Lo que el ERP no da, prenderlo acá no
// lo da: las capacidades del ERP se CRUZAN con estos permisos
// (chats/autorizacion.ts), nunca se suman.
//
// ADMINISTRADORES: las personas de AZUL_CHAT_ADMINISTRADORES (ids del ERP,
// como AZUL_CHAT_AVISOS_SISTEMA). Tienen siempre todo y son los únicos que ven
// y cambian los accesos de los demás; los suyos no se tocan (tampoco los
// propios: nadie se deja afuera a sí mismo). Si la variable está vacía o mal
// escrita, NADIE administra y nadie sin una fila guardada entra: cerrado por
// defecto, con una línea en el log la primera vez que se nota.
//
// Se decide en cada pedido, leyendo la base: un cambio rige desde el pedido
// siguiente de esa persona, sin cerrar su sesión.

import "server-only";

import type { Entorno } from "../erp/config.ts";
import type { Db } from "../db.ts";
import type { Registro } from "../log.ts";
import { leerListaDePersonas, type ListaDePersonas } from "../personas.ts";
import { NINGUN_PERMISO, TODOS_LOS_PERMISOS, type Permisos } from "../../shared/sesion/accesos.ts";

export const VARIABLE_ADMINISTRADORES = "AZUL_CHAT_ADMINISTRADORES";

/** Los administradores de AZUL_CHAT_ADMINISTRADORES. VACIA o INVALIDA: nadie. */
export function leerAdministradores(entorno: Entorno = process.env): ListaDePersonas {
  return leerListaDePersonas(entorno[VARIABLE_ADMINISTRADORES]);
}

export const esAdministrador = (lista: ListaDePersonas, erpUsuarioId: number): boolean => lista.tipo === "OK" && lista.ids.includes(erpUsuarioId);

/** Lo que puede una persona AHORA: sus permisos y si administra. */
export type AccesoDePersona = { readonly administrador: boolean; readonly permisos: Permisos };

let avisadoSinAdministradores = false;

/**
 * El acceso de esa persona, leído de la base en este pedido. Un administrador
 * tiene todo; los demás, su fila, y sin fila nada.
 */
export async function accesoDePersona(
  db: Db,
  q: { readonly instalacionId: string; readonly administradores: ListaDePersonas; readonly erpUsuarioId: number },
  registrar: (r: Registro) => void,
): Promise<AccesoDePersona> {
  if (q.administradores.tipo !== "OK" && !avisadoSinAdministradores) {
    avisadoSinAdministradores = true;
    registrar({ evento: "accesos.sin_administradores", motivo: q.administradores.tipo });
  }
  if (esAdministrador(q.administradores, q.erpUsuarioId)) return { administrador: true, permisos: TODOS_LOS_PERMISOS };
  const fila = await db.accesoPersona.findUnique({
    where: { instalacionId_erpUsuarioId: { instalacionId: q.instalacionId, erpUsuarioId: q.erpUsuarioId } },
    select: { entrar: true, ventas: true, caja: true, stock: true, pendientes: true, ia: true },
  });
  return { administrador: false, permisos: fila ?? NINGUN_PERMISO };
}

/** El nombre que dio el ERP, guardado solo si cambió (para la lista de Accesos). Recortado a lo que entra en la columna. */
export async function anotarNombre(db: Db, vinculoId: string, nombre: string): Promise<void> {
  const limpio = nombre.trim().slice(0, 120);
  if (limpio === "") return;
  await db.vinculo.updateMany({ where: { id: vinculoId, OR: [{ erpNombre: null }, { NOT: { erpNombre: limpio } }] }, data: { erpNombre: limpio } });
}
