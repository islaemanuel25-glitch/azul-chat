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
  CAPACIDADES_EVENTOS,
  type CapacidadEventos,
  type DatosMiAlcance,
  type ResultadoConsulta,
} from "../../shared/erp/contrato.ts";
import { conDelegacion, type Contexto, type ResultadoDelegado } from "../sesion/delegacion.ts";
import { CAPACIDAD_VENTAS_RESUMEN } from "../erp/ventasResumen.ts";
import { TIPO_DE_CAPACIDAD } from "../eventos/capacidades.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";

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
};

/**
 * Corre `trabajo` con la autorización de AHORA. Una sola llamada a
 * `mi_alcance` por solicitud. Si el trabajo vuelve a llamar al ERP y recibe
 * VINCULO_NO_VALIDO, lo devuelve y `conDelegacion` invalida el vínculo.
 */
export function conAutorizacionViva<T>(
  headers: Headers,
  deps: DependenciasSesion,
  trabajo: (a: Autorizacion) => Promise<ResultadoConsulta<T>>,
): Promise<ResultadoDelegado<T>> {
  return conDelegacion<T>(headers, deps, async (token, contexto) => {
    const alcance = await deps.erp.miAlcance(token);
    if (!alcance.ok) return alcance;
    return trabajo({
      token,
      contexto,
      usuario: { nombre: alcance.datos.usuario.nombre },
      autorizados: localesAutorizadosAhora(alcance.datos),
      conVentas: localesConCapacidad(alcance.datos, CAPACIDAD_VENTAS_RESUMEN),
    });
  });
}
