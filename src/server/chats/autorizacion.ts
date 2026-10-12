// src/server/chats/autorizacion.ts
//
// QUÉ LOCALES, Y QUÉ DE CADA LOCAL, PUEDE VER LA PERSONA EN LOS CHATS, AHORA.
//
// La base de Azul Chat NO autoriza: ni Evento, ni CursorIngesta, ni
// LecturaLocal, ni Vinculo, ni Sesion prueban que alguien pueda leer un local.
// Cada solicitud de chats:
//
//   1. resuelve la sesión y el vínculo (conDelegacion);
//   2. llama a `mi_alcance` EN VIVO con el token del vínculo;
//   3. se queda con los locales cuyo `capacidades` incluye al menos una de las
//      capacidades de eventos (`transferencias_eventos`, `pedidos_eventos`,
//      `envios_eventos`, `cancelaciones_eventos`): `localesAutorizadosAhora`.
//      De cada local guarda CUÁLES anuncia: de ese local, la persona ve solo
//      los tipos de evento de esas capacidades (capacidades.ts,
//      TIPO_DE_CAPACIDAD), y solo esas se ingieren.
//
// Todo lo que se lee o se escribe después (eventos, lectura, ingesta) se
// restringe a ese conjunto. No se guarda, no se cachea y no se infiere nada de
// roles: solo lo que el ERP anuncia hoy. Un evento guardado de un tipo que la
// persona no tiene anunciado en ese local no se le muestra ni se le cuenta,
// aunque otra persona lo haya traído. Un local que aparece por territorio pero
// sin ninguna capacidad de eventos no forma parte de los chats.
//
// Si `mi_alcance` no se puede comprobar, no hay conjunto: fallo cerrado (P1).

import "server-only";

import type { TipoEvento } from "@prisma/client";

import {
  anunciaCapacidad,
  CAPACIDAD_CAJAS_RESUMEN,
  CAPACIDAD_PEDIDOS_PENDIENTES,
  CAPACIDAD_STOCK_CONSULTA,
  CAPACIDADES_EVENTOS,
  type CapacidadEventos,
  type DatosMiAlcance,
  type ResultadoConsulta,
} from "../../shared/erp/contrato.ts";
import { conDelegacion, type Contexto, type ResultadoDelegado } from "../sesion/delegacion.ts";
import { CAPACIDAD_VENTAS_RESUMEN } from "../erp/ventasResumen.ts";
import { TIPO_DE_CAPACIDAD } from "../eventos/capacidades.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import { accesoDePersona, type AccesoDePersona } from "../accesos/accesos.ts";
import { permite, type Permiso } from "../../shared/sesion/accesos.ts";

/** Un local de `mi_alcance` con una capacidad anunciada, con lo que el ERP dijo de él en esta solicitud. */
export type LocalAutorizado = {
  readonly localId: number;
  readonly grupoId: number;
  readonly nombre: string;
  readonly esDeposito: boolean;
};

/** Un local de los chats: además, las capacidades de eventos que el ERP le anuncia HOY, en el orden del catálogo. */
export type LocalDeEventos = LocalAutorizado & { readonly capacidades: readonly CapacidadEventos[] };

/** Los locales de `mi_alcance` que anuncian esa capacidad. Sin la lista (ERP anterior), ninguno. */
export function localesConCapacidad(datos: DatosMiAlcance, capacidad: string): LocalAutorizado[] {
  return datos.locales
    .filter((l) => anunciaCapacidad(l, capacidad))
    .map((l) => ({ localId: l.id, grupoId: l.grupoId, nombre: l.nombre, esDeposito: l.esDeposito }));
}

/** Tanda 9B: un local con lo que anuncia hoy de las dos fuentes de "Pendientes". */
export type LocalDePendientes = LocalAutorizado & {
  /** Anuncia `pedidos_pendientes`. */
  readonly pedidos: boolean;
  /** Anuncia `cajas_resumen`. */
  readonly cajas: boolean;
};

/** Los locales de `mi_alcance` que anuncian `pedidos_pendientes` o `cajas_resumen`, en el orden de `mi_alcance`. */
export function localesDePendientes(datos: DatosMiAlcance): LocalDePendientes[] {
  const salida: LocalDePendientes[] = [];
  for (const l of datos.locales) {
    const pedidos = anunciaCapacidad(l, CAPACIDAD_PEDIDOS_PENDIENTES);
    const cajas = anunciaCapacidad(l, CAPACIDAD_CAJAS_RESUMEN);
    if (!pedidos && !cajas) continue;
    salida.push({ localId: l.id, grupoId: l.grupoId, nombre: l.nombre, esDeposito: l.esDeposito, pedidos, cajas });
  }
  return salida;
}

/** Los locales de `mi_alcance` que anuncian al menos una capacidad de eventos: los de los chats. */
export function localesAutorizadosAhora(datos: DatosMiAlcance): LocalDeEventos[] {
  const salida: LocalDeEventos[] = [];
  for (const l of datos.locales) {
    const capacidades = CAPACIDADES_EVENTOS.filter((c) => anunciaCapacidad(l, c));
    if (capacidades.length === 0) continue;
    salida.push({ localId: l.id, grupoId: l.grupoId, nombre: l.nombre, esDeposito: l.esDeposito, capacidades });
  }
  return salida;
}

/** Los tipos de evento que la persona puede ver de ese local, por las capacidades anunciadas. */
export function tiposVisibles(capacidades: readonly CapacidadEventos[]): TipoEvento[] {
  return capacidades.map((c) => TIPO_DE_CAPACIDAD[c]);
}

/** Lo que recibe el trabajo de una solicitud de chats, ya autorizado. */
export type Autorizacion = {
  /** El token claro, solo para llamar al ERP en esta solicitud. No sale de acá. */
  readonly token: string;
  readonly contexto: Contexto;
  readonly usuario: { readonly nombre: string };
  readonly autorizados: readonly LocalDeEventos[];
  /**
   * Los locales de `mi_alcance` que anuncian `ventas_resumen` (Tanda 3A), con
   * el `grupoId` que el ERP acepta para cada uno. Mismo criterio que
   * `autorizados`: lo que el ERP anuncia hoy, sin guardar ni inferir nada.
   */
  readonly conVentas: readonly LocalAutorizado[];
  /** Tanda 7B: los locales que anuncian `cajas_resumen`, con el mismo criterio. */
  readonly conCaja: readonly LocalAutorizado[];
  /** Tanda 8B: los locales que anuncian `stock_consulta`, con el mismo criterio. */
  readonly conStock: readonly LocalAutorizado[];
  /** Tanda 9B: los locales que anuncian `pedidos_pendientes` o `cajas_resumen` (el chip "Pendientes"). */
  readonly conPendientes: readonly LocalDePendientes[];
  /**
   * Tanda 15: lo que esta persona puede usar en Azul Chat, leído en este
   * pedido. Las listas de arriba YA vienen cruzadas con estos permisos: sin
   * "ventas", `conVentas` está vacía aunque el ERP anuncie ventas_resumen.
   */
  readonly acceso: AccesoDePersona;
};

/** Tanda 15: le falta el permiso de esta ruta. `ENTRAR`: le falta entrar, no solo esta sección. */
export type SinAcceso = { readonly tipo: "SIN_ACCESO"; readonly motivo: "ENTRAR" | "PERMISO" };

/** Lo que devuelve una solicitud autorizada: lo de siempre, o que la persona no tiene ese acceso en Azul Chat. */
export type ResultadoAutorizado<T> = ResultadoDelegado<T> | SinAcceso;

/** El acceso de la persona de este contexto, leído de la base. */
export function accesoDelContexto(contexto: Contexto, deps: DependenciasSesion): Promise<AccesoDePersona> {
  return accesoDePersona(
    contexto.db,
    { instalacionId: contexto.config.instalacionId, administradores: contexto.config.administradores, erpUsuarioId: contexto.sesion.vinculo.erpUsuarioId },
    deps.registrar,
  );
}

/**
 * Corre `trabajo` con la autorización de AHORA. Una sola llamada a
 * `mi_alcance` por solicitud. Si el trabajo vuelve a llamar al ERP y recibe
 * VINCULO_NO_VALIDO, lo devuelve y `conDelegacion` invalida el vínculo.
 *
 * Tanda 15: ANTES de llamar al ERP, el acceso de la persona en Azul Chat. Sin
 * `permiso` (o sin "entrar"), SIN_ACCESO, y el ERP ni se consulta.
 */
export async function conAutorizacionViva<T>(
  headers: Headers,
  deps: DependenciasSesion,
  permiso: Permiso,
  trabajo: (a: Autorizacion) => Promise<ResultadoConsulta<T>>,
): Promise<ResultadoAutorizado<T>> {
  let sinAcceso: SinAcceso | null = null;
  const r = await conDelegacion<T | null>(headers, deps, async (token, contexto) => {
    const acceso = await accesoDelContexto(contexto, deps);
    if (!permite(acceso.permisos, permiso)) {
      sinAcceso = { tipo: "SIN_ACCESO", motivo: acceso.permisos.entrar ? "PERMISO" : "ENTRAR" };
      return { ok: true, requestId: "", datos: null };
    }
    const a = await autorizacionViva(deps, token, contexto, acceso);
    return a.ok ? trabajo(a.datos) : a;
  });
  if (sinAcceso) return sinAcceso;
  return r as ResultadoDelegado<T>;
}

/**
 * `mi_alcance` vivo con ese token, convertido en la autorización de AHORA.
 * La usa cada solicitud de chats y, desde la Tanda 5A, la sincronización de
 * fondo para cada persona: el mismo criterio, sin caché.
 */
export async function autorizacionViva(
  deps: DependenciasSesion,
  token: string,
  contexto: Contexto,
  acceso: AccesoDePersona,
): Promise<ResultadoConsulta<Autorizacion>> {
  const alcance = await deps.erp.miAlcance(token);
  if (!alcance.ok) return alcance;
  // Tanda 15: lo que da el ERP, CRUZADO con lo que la persona puede usar acá. Solo resta.
  const p = acceso.permisos;
  const si = <L>(puede: boolean, locales: L[]): L[] => (puede ? locales : []);
  return {
    ok: true,
    requestId: alcance.requestId,
    datos: {
      token,
      contexto,
      usuario: { nombre: alcance.datos.usuario.nombre },
      autorizados: si(permite(p, "entrar"), localesAutorizadosAhora(alcance.datos)),
      conVentas: si(permite(p, "ventas"), localesConCapacidad(alcance.datos, CAPACIDAD_VENTAS_RESUMEN)),
      conCaja: si(permite(p, "caja"), localesConCapacidad(alcance.datos, CAPACIDAD_CAJAS_RESUMEN)),
      conStock: si(permite(p, "stock"), localesConCapacidad(alcance.datos, CAPACIDAD_STOCK_CONSULTA)),
      // Pendientes trae cajas sin cerrar: esa parte es de Caja, y sin "caja" no va.
      conPendientes: si(permite(p, "pendientes"), localesDePendientes(alcance.datos))
        .map((l) => ({ ...l, cajas: l.cajas && permite(p, "caja") }))
        .filter((l) => l.pedidos || l.cajas),
      acceso,
    },
  };
}
