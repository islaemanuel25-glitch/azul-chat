// src/server/stock/stockConsulta.ts
//
// EL STOCK DE UN LOCAL DESDE UNA SESIÓN (Tanda 8B). Servicio interno: lo usan
// GET /api/chats/stock (chats/manejadores.ts) y las preguntas de stock
// (preguntas/stock.ts), que antes comprueban el local con `mi_alcance` vivo.
//
// La persona sale de la sesión (su vínculo y su token, descifrado acá en el
// servidor). Quien llama elige solo QUÉ local y QUÉ pregunta —un texto de
// producto, o "bajo mínimo"—; el ERP decide si esa persona puede verlo y busca
// el producto con su buscador. Sin reintentos.
//
// `bajoMinimoPublico` y `productosPublicos` copian lo que contestó el ERP
// campo por campo, y solo si es del local, el grupo, el modo y el texto
// pedidos: un dato de otra cosa no se muestra. Acá no se calcula nada.
//
// STOCK_MINIMO_NO_DISPONIBLE no es una falla: el local no tiene ningún mínimo
// ajustado. `esSinMinimo` lo reconoce por su CÓDIGO, nunca por el texto.

import "server-only";

import type { BajoMinimoDelLocal, ProductoDeStockPublico, ProductosDelLocal } from "../../shared/chats/api.ts";
import type { DatosStockConsulta, ProductoDeStock, ResultadoConsulta } from "../../shared/erp/contrato.ts";
import { conDelegacion, type ResultadoDelegado } from "../sesion/delegacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import type { EntradaStockConsulta } from "../erp/stockConsulta.ts";

/**
 * @param headers las de la solicitud del navegador: de ahí sale la cookie de sesión.
 * @param entrada `{ alcance: { grupoId, localId }, parametros }`, validada por el constructor del cuerpo.
 */
export function stockConsultaDeSesion(headers: Headers, entrada: EntradaStockConsulta, deps: DependenciasSesion): Promise<ResultadoDelegado<DatosStockConsulta>> {
  return conDelegacion(headers, deps, (token) => deps.erp.stockConsulta(token, entrada));
}

/** ¿El ERP dijo que el local no tiene stock mínimo ajustado? Por código. */
export function esSinMinimo(r: ResultadoConsulta<unknown>): boolean {
  return !r.ok && r.origen === "erp" && r.codigo === "STOCK_MINIMO_NO_DISPONIBLE";
}

const producto = (p: ProductoDeStock): ProductoDeStockPublico => ({
  productoId: p.productoId,
  nombre: p.nombre,
  codigo: p.codigo,
  cantidad: p.cantidad,
  unidad: p.unidad,
  equivalencia: p.equivalencia,
  stockMinimo: p.stockMinimo,
  bajoMinimo: p.bajoMinimo,
});

type Pedido = { readonly localId: number; readonly grupoId: number; readonly nombre: string };

const delPedido = (d: DatosStockConsulta, p: Pedido) => d.local.id === p.localId && d.grupoId === p.grupoId;

/**
 * Lo que el ERP contestó a "bajo mínimo" → lo que se muestra, o null si no es
 * del local, el grupo y el modo pedidos. El nombre es el de HOY, de `mi_alcance`.
 */
export function bajoMinimoPublico(d: DatosStockConsulta, pedido: Pedido): BajoMinimoDelLocal | null {
  if (!delPedido(d, pedido) || d.modo !== "bajo_minimo" || d.total === undefined) return null;
  return {
    local: { id: pedido.localId, nombre: pedido.nombre },
    sinMinimo: false,
    total: d.total,
    hayMas: d.hayMas,
    productos: d.productos.map(producto),
  };
}

/** El local sin mínimo ajustado, dicho como respuesta y no como falla. */
export function sinMinimoPublico(pedido: Pedido): BajoMinimoDelLocal {
  return { local: { id: pedido.localId, nombre: pedido.nombre }, sinMinimo: true };
}

/**
 * Lo que el ERP contestó a un texto → lo que se muestra, o null si no es del
 * local, el grupo, el modo y el texto pedidos.
 */
export function productosPublicos(d: DatosStockConsulta, pedido: Pedido & { readonly texto: string }): ProductosDelLocal | null {
  if (!delPedido(d, pedido) || d.modo !== "producto" || d.texto !== pedido.texto) return null;
  return {
    local: { id: pedido.localId, nombre: pedido.nombre },
    texto: d.texto,
    productos: d.productos.map(producto),
    hayMas: d.hayMas,
  };
}
