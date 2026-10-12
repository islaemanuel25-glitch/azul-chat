// src/server/preguntas/stock.ts
//
// LAS PREGUNTAS DE STOCK (Tanda 8B). Con el ERP, sin IA.
//
// La IA ya interpretó (intencion.ts): un local o todos, y "cuánto hay de X"
// —con X tal como lo escribió la persona— o "qué está bajo mínimo". El texto
// del producto viaja al ERP, que lo busca con su buscador: acá no se busca, ni
// se compara, ni se calcula nada.
//
//   · un local: UNA `stock_consulta`; cualquier falla es la de la pregunta.
//   · todos: una por cada local con `stock_consulta`, de a una; la primera
//     falla por cupo corta las que faltan, y la respuesta dice cuáles locales
//     no se pudieron consultar. Ni en "bajo mínimo" se suma nada entre locales:
//     cada uno con su total.
//
// STOCK_MINIMO_NO_DISPONIBLE —el local no tiene ningún mínimo ajustado— no es
// una falla: es la respuesta de ese local (`sinMinimo`). Un texto que el ERP
// rechaza por su forma es NO_ENTIENDO. Sin reintentos.
//
// Cupo: 1 `mi_alcance` + 1 `stock_consulta` por local consultado.

import "server-only";

import type { BajoMinimoDelLocal, FallaChats, ProductosDelLocal } from "../../shared/chats/api.ts";
import { EJEMPLOS_DE_PREGUNTAS, type RespuestaPregunta } from "../../shared/chats/preguntas.ts";
import type { ParametrosStock } from "../erp/stockConsulta.ts";
import { fallaDeDelegacion, fallaDeRechazo } from "../chats/manejadores.ts";
import { esFalloDeCupo } from "../chats/sincronizacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import { bajoMinimoPublico, esSinMinimo, productosPublicos, sinMinimoPublico, stockConsultaDeSesion } from "../stock/stockConsulta.ts";
import type { Intencion, LocalesDeHoy } from "./intencion.ts";

type LocalDeStock = LocalesDeHoy["stock"][number];
type Consulta<T> = { readonly tipo: "OK"; readonly datos: T } | { readonly tipo: "NO_ENTIENDO" } | { readonly tipo: "FALLA"; readonly falla: FallaChats; readonly corta: boolean };

/** UNA `stock_consulta` de un local, copiada si es lo pedido. */
async function consultar<T>(
  headers: Headers,
  deps: DependenciasSesion,
  l: LocalDeStock,
  parametros: ParametrosStock,
  publicar: (d: Parameters<typeof bajoMinimoPublico>[0], pedido: { localId: number; grupoId: number; nombre: string }) => T | null,
  sinMinimo: ((pedido: { localId: number; grupoId: number; nombre: string }) => T) | null,
): Promise<Consulta<T>> {
  const pedido = { localId: l.localId, grupoId: l.grupoId, nombre: l.nombre };
  const r = await stockConsultaDeSesion(headers, { alcance: { grupoId: l.grupoId, localId: l.localId }, parametros }, deps);
  if (r.tipo === "SIN_SESION" || r.tipo === "SERVICIO_NO_DISPONIBLE") return { tipo: "FALLA", falla: fallaDeDelegacion(r), corta: true };
  if (r.tipo === "OK") {
    const d = publicar(r.datos, pedido);
    return d ? { tipo: "OK", datos: d } : { tipo: "FALLA", falla: { estado: "ERP_NO_DISPONIBLE" }, corta: false };
  }
  if (sinMinimo && esSinMinimo(r.resultado)) return { tipo: "OK", datos: sinMinimo(pedido) };
  // El texto que el ERP no acepta por su forma: una pregunta que no se puede contestar así.
  if (r.resultado.codigo === "SOLICITUD_INVALIDA") return { tipo: "NO_ENTIENDO" };
  // NO_AUTORIZADO a un local que mi_alcance anunció, o cualquier otro: no disponible. El cupo, el suyo.
  const cupo = esFalloDeCupo(r.resultado);
  return { tipo: "FALLA", falla: cupo ? fallaDeRechazo(r.resultado) : { estado: "ERP_NO_DISPONIBLE" }, corta: cupo };
}

type Recorrido<T> = { readonly bien: T[]; readonly fallidos: { id: number; nombre: string }[] } | { readonly respuesta: RespuestaPregunta } | { readonly falla: FallaChats };

/** Una consulta por local, de a una. Un local: cualquier falla es la de la pregunta. Todos: se dice cuáles fallaron. */
async function recorrer<T>(locales: readonly LocalDeStock[], todos: boolean, una: (l: LocalDeStock) => Promise<Consulta<T>>): Promise<Recorrido<T>> {
  const bien: T[] = [];
  const fallidos: { id: number; nombre: string }[] = [];
  let primeraFalla: FallaChats | null = null;
  for (const [i, l] of locales.entries()) {
    const c = await una(l);
    if (c.tipo === "NO_ENTIENDO") return { respuesta: { estado: "NO_ENTIENDO", ejemplos: EJEMPLOS_DE_PREGUNTAS } };
    if (c.tipo === "OK") {
      bien.push(c.datos);
      continue;
    }
    if (c.falla.estado === "SIN_SESION" || c.falla.estado === "SERVICIO_NO_DISPONIBLE") return { falla: c.falla };
    primeraFalla ??= c.falla;
    if (!todos) return { falla: c.falla };
    fallidos.push({ id: l.localId, nombre: l.nombre });
    if (c.corta) {
      for (const resto of locales.slice(i + 1)) fallidos.push({ id: resto.localId, nombre: resto.nombre });
      break;
    }
  }
  if (bien.length === 0) return { falla: primeraFalla ?? { estado: "ERP_NO_DISPONIBLE" } };
  return { bien, fallidos };
}

export type ResultadoStock = { readonly respuesta: RespuestaPregunta } | { readonly falla: FallaChats };

/** Intención STOCK: un producto o "bajo mínimo", de un local o de todos. */
export async function stockDePregunta(headers: Headers, deps: DependenciasSesion, intencion: Extract<Intencion, { tipo: "STOCK" }>): Promise<ResultadoStock> {
  if (intencion.modo === "producto" && intencion.texto !== null) {
    const texto = intencion.texto;
    const r = await recorrer<ProductosDelLocal>(intencion.locales, intencion.todos, (l) =>
      consultar(headers, deps, l, { modo: "producto", texto }, (d, p) => productosPublicos(d, { ...p, texto }), null),
    );
    if (!("bien" in r)) return r;
    if (!intencion.todos) return { respuesta: { estado: "STOCK", modo: "producto", alcance: "LOCAL", texto, resultado: r.bien[0]! } };
    return { respuesta: { estado: "STOCK", modo: "producto", alcance: "TODOS", texto, locales: r.bien, fallidos: r.fallidos } };
  }
  const r = await recorrer<BajoMinimoDelLocal>(intencion.locales, intencion.todos, (l) =>
    consultar(headers, deps, l, { modo: "bajo_minimo" }, bajoMinimoPublico, sinMinimoPublico),
  );
  if (!("bien" in r)) return r;
  if (!intencion.todos) return { respuesta: { estado: "STOCK", modo: "bajo_minimo", alcance: "LOCAL", resultado: r.bien[0]! } };
  return { respuesta: { estado: "STOCK", modo: "bajo_minimo", alcance: "TODOS", locales: r.bien, fallidos: r.fallidos } };
}
