// src/server/pendientes/pendientes.ts
//
// LO PENDIENTE DE UNO O VARIOS LOCALES, DESDE UNA SESIÓN (Tanda 9B). Servicio
// interno: lo usan GET /api/chats/pendientes, GET /api/chats/pendientes/general
// (chats/manejadores.ts) y la pregunta "¿qué está pendiente?"
// (preguntas/manejador.ts), que antes comprueban los locales con `mi_alcance`
// vivo.
//
// Por local, hasta tres consultas al ERP, de a una y sin reintentos, solo de lo
// que ese local anuncia hoy:
//
//   1. `pedidos_pendientes` (si la anuncia);
//   2. `cajas_resumen` de hoy y 3. de ayer (si anuncia `cajas_resumen`).
//
// Una fuente que falla no tira las otras: el local muestra lo que sí llegó y
// `faltaron` dice cuál no. La primera falla por CUPO corta todo lo que queda
// (no se sigue gastando) y eso también queda en `faltaron`. Sin sesión o con el
// servicio caído no hay respuesta. Si NINGUNA consulta contestó, es la falla de
// la primera: no se muestra "nada pendiente" sin haber mirado.
//
// Lo que el ERP contesta se copia si es del local y el grupo pedidos (y, en
// cajas, del día pedido); si no, esa fuente faltó. La etiqueta y el orden, en
// src/shared/chats/pendientes.ts. Nada se guarda acá.
//
// Cupo: 1 `mi_alcance` (de quien llama) + hasta 3 por local.

import "server-only";

import type { FallaChats, FuentePendientes, Pendiente, PendientesDelLocal } from "../../shared/chats/api.ts";
import { ordenarPendientes, pendientesDeCajas, pendientesDePedidos } from "../../shared/chats/pendientes.ts";
import type { DatosPedidosPendientes, ResultadoConsulta } from "../../shared/erp/contrato.ts";
import { cajasPublicas, cajasResumenDeSesion } from "../caja/cajasResumen.ts";
import type { LocalDePendientes } from "../chats/autorizacion.ts";
import { esFalloDeCupo } from "../chats/sincronizacion.ts";
import type { EntradaPedidosPendientes } from "../erp/pedidosPendientes.ts";
import { conDelegacion, type ResultadoDelegado } from "../sesion/delegacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";

export type { LocalDePendientes };

/** Cuántas consultas al ERP le cuesta un local, además de la `mi_alcance` de quien llama. */
export const consultasDeLocal = (l: LocalDePendientes): number => (l.pedidos ? 1 : 0) + (l.cajas ? 2 : 0);

/**
 * @param headers las de la solicitud del navegador: de ahí sale la cookie de sesión.
 * @param entrada `{ alcance: { grupoId, localId } }`, validada por el constructor del cuerpo.
 */
export function pedidosPendientesDeSesion(
  headers: Headers,
  entrada: EntradaPedidosPendientes,
  deps: DependenciasSesion,
): Promise<ResultadoDelegado<DatosPedidosPendientes>> {
  return conDelegacion(headers, deps, (token) => deps.erp.pedidosPendientes(token, entrada));
}

type Fuente = { readonly fuente: FuentePendientes; readonly consultar: () => Promise<ResultadoDelegado<unknown>>; readonly copiar: (d: unknown) => Pendiente[] | null };

function fuentesDe(headers: Headers, deps: DependenciasSesion, l: LocalDePendientes): Fuente[] {
  const alcance = { grupoId: l.grupoId, localId: l.localId };
  const delPedido = (d: { local: { id: number }; grupoId: number }) => d.local.id === l.localId && d.grupoId === l.grupoId;
  const salida: Fuente[] = [];
  if (l.pedidos) {
    salida.push({
      fuente: "PEDIDOS",
      consultar: () => pedidosPendientesDeSesion(headers, { alcance }, deps),
      copiar: (d) => {
        const datos = d as DatosPedidosPendientes;
        return delPedido(datos) ? pendientesDePedidos(datos.pedidos) : null;
      },
    });
  }
  if (l.cajas) {
    for (const [fuente, tipo] of [["CAJAS_HOY", "hoy"], ["CAJAS_AYER", "ayer"]] as const) {
      salida.push({
        fuente,
        consultar: () => cajasResumenDeSesion(headers, { alcance, periodo: { tipo } }, deps),
        copiar: (d) => {
          const dia = cajasPublicas(d as Parameters<typeof cajasPublicas>[0], { localId: l.localId, grupoId: l.grupoId, periodo: { tipo } });
          return dia ? pendientesDeCajas(dia, tipo) : null;
        },
      });
    }
  }
  return salida;
}

export type ResultadoPendientes = { readonly tipo: "OK"; readonly locales: PendientesDelLocal[] } | { readonly tipo: "FALLA"; readonly falla: FallaChats };

/** Un rechazo del ERP, por código: el cupo corta; cualquier otro, solo esa fuente. */
const fallaDeFuente = (r: Extract<ResultadoConsulta<unknown>, { ok: false }>): FallaChats =>
  esFalloDeCupo(r) ? { estado: "ERP_CUPO_EXCEDIDO" } : { estado: "ERP_NO_DISPONIBLE" };

/**
 * Lo pendiente de cada local, en el orden recibido. Ver arriba qué pasa
 * cuando una fuente falla.
 */
export async function pendientesDeLocales(headers: Headers, deps: DependenciasSesion, locales: readonly LocalDePendientes[]): Promise<ResultadoPendientes> {
  const salida: PendientesDelLocal[] = [];
  let primeraFalla: FallaChats | null = null;
  let contestadas = 0;
  let cortado = false;
  for (const l of locales) {
    const pendientes: Pendiente[] = [];
    const faltaron: FuentePendientes[] = [];
    for (const f of fuentesDe(headers, deps, l)) {
      if (cortado) {
        faltaron.push(f.fuente);
        continue;
      }
      const r = await f.consultar();
      if (r.tipo === "SIN_SESION") {
        return { tipo: "FALLA", falla: r.vinculoInvalidado ? { estado: "SIN_SESION", motivo: "VINCULO_INVALIDO" } : { estado: "SIN_SESION" } };
      }
      if (r.tipo === "SERVICIO_NO_DISPONIBLE") return { tipo: "FALLA", falla: { estado: "SERVICIO_NO_DISPONIBLE" } };
      const copiado = r.tipo === "OK" ? f.copiar(r.datos) : null;
      if (copiado) {
        contestadas++;
        pendientes.push(...copiado);
        continue;
      }
      // NO_AUTORIZADO a una fuente que mi_alcance anunció, una respuesta de otro local o cualquier otro rechazo: faltó.
      const falla = r.tipo === "RECHAZO_ERP" ? fallaDeFuente(r.resultado) : ({ estado: "ERP_NO_DISPONIBLE" } as const);
      primeraFalla ??= falla;
      faltaron.push(f.fuente);
      if (falla.estado === "ERP_CUPO_EXCEDIDO") cortado = true;
    }
    salida.push({ local: { id: l.localId, nombre: l.nombre }, pendientes: ordenarPendientes(pendientes), faltaron });
  }
  if (contestadas === 0) return { tipo: "FALLA", falla: primeraFalla ?? { estado: "ERP_NO_DISPONIBLE" } };
  return { tipo: "OK", locales: salida };
}

/** Para General: los locales con algo que decir (pendientes, o una fuente que faltó) primero; los que no tienen nada, al final. Estable. */
export function ordenDeGeneral(locales: readonly PendientesDelLocal[]): PendientesDelLocal[] {
  const conAlgo = (l: PendientesDelLocal) => l.pendientes.length > 0 || l.faltaron.length > 0;
  return [...locales.filter(conAlgo), ...locales.filter((l) => !conAlgo(l))];
}
