// El stock del fixture del ERP (erp-41f702b.json) en la forma PÚBLICA que
// contesta Azul Chat (`BajoMinimoDelLocal`, `ProductosDelLocal`), para los
// tests de la interfaz, que no pueden importar src/server (server-only).
//
// No es una copia de la lógica: es el mismo dato con las claves del contrato
// público. test/unidad/stockChats.test.ts comprueba que `bajoMinimoPublico` y
// `productosPublicos` —las funciones del servidor— dan EXACTAMENTE esto para
// cada caso del fixture: si alguna vez difieren, ese candado se pone rojo.

import type { BajoMinimoDelLocal, ProductoDeStockPublico, ProductosDelLocal } from "../../src/shared/chats/api.ts";
import type { DatosStockConsulta } from "../../src/shared/erp/contrato.ts";
import { FIXTURES_ERP_41F702B, type CasosStockProducto } from "./servidorErp.ts";

type Local = { readonly id: number; readonly nombre: string };

const datosDe = (d: unknown) => structuredClone(d) as DatosStockConsulta;
const productos = (d: DatosStockConsulta): ProductoDeStockPublico[] => d.productos.map((p) => ({ ...p }));

/** "Bajo mínimo" del fixture: dos faltantes, con su total. */
export function bajoMinimoDelFixture(local?: Local): Extract<BajoMinimoDelLocal, { sinMinimo: false }> {
  const d = datosDe(FIXTURES_ERP_41F702B.bajoMinimo.conFaltantes.respuesta.cuerpo.datos);
  return { local: local ?? { id: d.local.id, nombre: d.local.nombre }, sinMinimo: false, total: d.total!, hayMas: d.hayMas, productos: productos(d) };
}

/** Una búsqueda del fixture, por su caso. */
export function productosDelFixture(caso: keyof CasosStockProducto, local?: Local): ProductosDelLocal {
  const d = datosDe(FIXTURES_ERP_41F702B.producto[caso].respuesta.cuerpo.datos);
  return { local: local ?? { id: d.local.id, nombre: d.local.nombre }, texto: d.texto!, productos: productos(d), hayMas: d.hayMas };
}
