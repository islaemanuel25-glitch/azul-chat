// src/server/caja/cajasResumen.ts
//
// LAS CAJAS DE UN DÍA DESDE UNA SESIÓN (Tanda 7B). Servicio interno: lo usan
// GET /api/chats/caja (chats/manejadores.ts) y las preguntas de caja y de
// ventas por turno (preguntas/cajas.ts), que antes comprueban el local con
// `mi_alcance` vivo.
//
// La persona sale de la sesión (su vínculo y su token, descifrado acá en el
// servidor). Quien llama elige solo QUÉ local y QUÉ día; el ERP decide si esa
// persona puede verlo. Sin reintentos.
//
// `cajasPublicas` copia lo que contestó el ERP campo por campo, y solo si es
// del local, el grupo y el tipo de período pedidos: un número de otra cosa no
// se muestra. Acá no se calcula nada.

import "server-only";

import type { CajasDelDia, MedioDeCajaPublico } from "../../shared/chats/api.ts";
import type { DatosCajasResumen, MedioDeCaja, PeriodoCajas } from "../../shared/erp/contrato.ts";
import { conDelegacion, type ResultadoDelegado } from "../sesion/delegacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";

/**
 * @param headers las de la solicitud del navegador: de ahí sale la cookie de sesión.
 * @param entrada `{ alcance: { grupoId, localId }, periodo }`, validada por el constructor del cuerpo.
 */
export function cajasResumenDeSesion(headers: Headers, entrada: unknown, deps: DependenciasSesion): Promise<ResultadoDelegado<DatosCajasResumen>> {
  return conDelegacion(headers, deps, (token) => deps.erp.cajasResumen(token, entrada));
}

const medio = (m: MedioDeCaja): MedioDeCajaPublico => ({ medio: m.medio, etiqueta: m.etiqueta, total: m.total, cantidadPagos: m.cantidadPagos, cobrado: m.cobrado });

/** Lo que el ERP contestó → lo que se muestra, o null si no es del local, el grupo y el período pedidos. */
export function cajasPublicas(d: DatosCajasResumen, pedido: { localId: number; grupoId: number; periodo: PeriodoCajas }): CajasDelDia | null {
  if (d.local.id !== pedido.localId || d.grupoId !== pedido.grupoId || d.periodo.tipo !== pedido.periodo.tipo) return null;
  if (pedido.periodo.tipo === "fecha" && d.periodo.fecha !== pedido.periodo.fecha) return null;
  return {
    local: { id: d.local.id, nombre: d.local.nombre },
    fecha: d.periodo.fecha,
    turnos: d.turnosOperativos.map((t) => ({
      turno: { id: t.turnoOperativo.id, nombre: t.turnoOperativo.nombre },
      sinTurnoAsignado: t.sinTurnoAsignado,
      totales: {
        cantidadVentas: t.totales.cantidadVentas,
        totalVendido: t.totales.totalVendido,
        ventasEfectivo: t.totales.ventasEfectivo,
        ventasPorMedio: t.totales.ventasPorMedio.map(medio),
        ventasNoCobradas: t.totales.ventasNoCobradas.map(medio),
      },
      cajas: t.cajas.map((c) => ({
        id: c.id,
        etiqueta: c.etiqueta,
        operador: c.operador,
        apertura: c.apertura,
        cierre: c.cierre,
        estado: c.estado,
        montoInicial: c.montoInicial,
        cantidadVentas: c.cantidadVentas,
        totalVendido: c.totalVendido,
        ventasEfectivo: c.ventasEfectivo,
        ventasPorMedio: c.ventasPorMedio.map(medio),
        ventasNoCobradas: c.ventasNoCobradas.map(medio),
        retiros: c.retiros.map((r) => ({
          tipo: r.tipo,
          monto: r.monto,
          motivo: r.motivo,
          aQuien: r.aQuien,
          recibidoPor: r.recibidoPor,
          hora: r.hora,
          registradoPor: r.registradoPor,
        })),
        ingresos: c.ingresos.map((i) => ({ monto: i.monto, motivo: i.motivo, hora: i.hora, registradoPor: i.registradoPor })),
        efectivoEsperado: c.efectivoEsperado,
        efectivoContado: c.efectivoContado,
        diferencia: c.diferencia ? { monto: c.diferencia.monto, tipo: c.diferencia.tipo } : null,
        efectivoRetiradoCierre: c.efectivoRetiradoCierre,
        fondoDejadoCierre: c.fondoDejadoCierre,
        verificacionTesoreria: c.verificacionTesoreria,
      })),
    })),
    advertencias: d.advertencias.map((a) => ({ codigo: a.codigo, mensaje: a.mensaje })),
  };
}
