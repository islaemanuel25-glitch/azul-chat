// CANDADOS DEL CONTRATO DE `stock_consulta` (Tanda 8B).
//
// Todo contra el fixture generado EJECUTANDO la puerta del ERP en producción
// (erpmanual 41f702b, copiado sin tocar en test/fixtures/erp-41f702b.json):
// los bytes que manda Azul Chat tienen que ser exactamente los que el ERP
// aceptó, y lo que el ERP contestó tiene que pasar el validador. Las
// respuestas rotas salen de una respuesta real con UNA cosa cambiada a
// propósito: la contraprueba de cada regla de forma.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { crearClienteErp, type ClienteErp } from "../../src/server/erp/cliente.ts";
import { construirCuerpoStockConsulta } from "../../src/server/erp/stockConsulta.ts";
import { anunciaCapacidad, esDatosMiAlcance, esDatosStockConsulta, type DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import {
  FIXTURES_ERP_41F702B,
  SECRETO_PRUEBA,
  TOKEN_PRUEBA,
  levantarServidorErp,
  pedidoConToken,
  responderJson,
  type IntercambioErp,
  type Manejador,
  type ServidorErp,
} from "../ayuda/servidorErp.ts";

const F = FIXTURES_ERP_41F702B;
type Datos = Record<string, unknown> & { productos: Record<string, unknown>[] };
const datosDe = (i: IntercambioErp) => structuredClone(i.respuesta.cuerpo.datos) as Datos;
const entradaDe = (i: IntercambioErp) => ({ alcance: i.pedido.alcance, parametros: i.pedido.parametros });

let erp: ServidorErp;
let manejador: Manejador;
before(async () => {
  erp = await levantarServidorErp((s, res) => manejador(s, res));
});
after(async () => {
  await erp.cerrar();
});
beforeEach(() => {
  erp.recibidas.length = 0;
});
const cliente = (): ClienteErp => crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, registrar: () => {} });

const TODOS_LOS_OK: [string, IntercambioErp][] = [...Object.entries(F.producto), ["bajoMinimo.conFaltantes", F.bajoMinimo.conFaltantes]];

describe("stock_consulta: lo que viaja es lo que el ERP aceptó", () => {
  for (const [nombre, i] of TODOS_LOS_OK) {
    it(`${nombre}: los BYTES del cuerpo son los del fixture, y la respuesta del ERP pasa entera`, async () => {
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().stockConsulta(TOKEN_PRUEBA, entradaDe(i));
      assert.equal(erp.recibidas.length, 1);
      assert.equal(erp.recibidas[0]!.cuerpo.toString("utf8"), pedidoConToken(i, TOKEN_PRUEBA));
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(r.datos, i.respuesta.cuerpo.datos);
    });
  }

  it("STOCK_MINIMO_NO_DISPONIBLE (409) es un código del contrato, con su status y su texto", async () => {
    const i = F.bajoMinimo.stockMinimoNoDisponible;
    manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
    const r = await cliente().stockConsulta(TOKEN_PRUEBA, entradaDe(i));
    assert.ok(!r.ok && r.origen === "erp", JSON.stringify(r));
    assert.deepEqual([r.codigo, r.status], ["STOCK_MINIMO_NO_DISPONIBLE", 409]);
  });

  it("modo y texto: lo que el ERP rechaza no se manda", async () => {
    const alcance = { grupoId: 1, localId: 1 };
    const ok = construirCuerpoStockConsulta(TOKEN_PRUEBA, { alcance, parametros: { modo: "producto", texto: "  leche  " } });
    assert.ok(ok.ok);
    assert.deepEqual(ok.cuerpo.parametros, { modo: "producto", texto: "leche" });
    manejador = () => assert.fail("no tenía que llamar");
    for (const parametros of [
      { modo: "producto", texto: "l" },
      { modo: "producto", texto: "x".repeat(61) },
      { modo: "producto" },
      { modo: "producto", texto: 7790001 },
      { modo: "bajo_minimo", texto: "leche" },
      { modo: "todo" },
      { modo: "producto", texto: "leche", localId: 3 },
    ]) {
      const r = await cliente().stockConsulta(TOKEN_PRUEBA, { alcance, parametros });
      assert.ok(!r.ok && r.origen === "local" && r.codigo === "SOLICITUD_INVALIDA", JSON.stringify(parametros));
    }
    for (const entrada of [{ alcance: { ...alcance, usuarioId: 3 }, parametros: { modo: "bajo_minimo" } }, { alcance, parametros: { modo: "bajo_minimo" }, otro: 1 }]) {
      const r = await cliente().stockConsulta(TOKEN_PRUEBA, entrada);
      assert.ok(!r.ok && r.codigo === "SOLICITUD_INVALIDA");
    }
    assert.equal(erp.recibidas.length, 0);
    // CONTRAPRUEBA: el texto de 60 justos y el de 2 sí viajan.
    for (const texto of ["ab", "x".repeat(60)]) assert.ok(construirCuerpoStockConsulta(TOKEN_PRUEBA, { alcance, parametros: { modo: "producto", texto } }).ok);
  });
});

describe("stock_consulta: la forma de la respuesta, una regla por vez", () => {
  const prod = () => datosDe(F.producto.variasCoincidencias);
  const bajo = () => datosDe(F.bajoMinimo.conFaltantes);

  it("el fixture entero pasa (la base de cada contraprueba)", () => {
    for (const [, i] of TODOS_LOS_OK) assert.ok(esDatosStockConsulta(i.respuesta.cuerpo.datos));
  });

  const rotos: [string, () => unknown][] = [
    ["otra capacidad", () => ({ ...prod(), capacidad: "cajas_resumen" })],
    ["otra versión", () => ({ ...prod(), version: 2 })],
    ["un campo de más", () => ({ ...prod(), precio: "1.00" })],
    ["producto con total", () => ({ ...prod(), total: 3 })],
    ["producto sin texto", () => ({ ...prod(), texto: null })],
    ["más de 10 coincidencias", () => { const d = prod(); d.productos = Array.from({ length: 11 }, () => d.productos[0]!); return d; }],
    ["bajo mínimo sin total", () => { const d = bajo(); delete d.total; return d; }],
    ["bajo mínimo con texto", () => ({ ...bajo(), texto: "leche" })],
    ["hayMas que no dice lo mismo que el total", () => ({ ...bajo(), hayMas: true })],
    ["total menor que los que vinieron", () => ({ ...bajo(), total: 1 })],
    ["un faltante que no está bajo mínimo", () => { const d = bajo(); d.productos[0]!.bajoMinimo = false; return d; }],
    ["cantidad sin tres decimales", () => { const d = prod(); d.productos[0]!.cantidad = "24"; return d; }],
    ["cantidad como número", () => { const d = prod(); d.productos[0]!.cantidad = 24; return d; }],
    ["mínimo sin bajoMinimo", () => { const d = prod(); d.productos[0]!.bajoMinimo = null; return d; }],
    ["bajoMinimo sin mínimo", () => { const d = prod(); d.productos[2]!.stockMinimo = null; return d; }],
    ["un precio en el producto", () => { const d = prod(); d.productos[0]!.precio = "1.00"; return d; }],
    ["unidad vacía", () => { const d = prod(); d.productos[0]!.unidad = ""; return d; }],
    ["local sin esDeposito", () => ({ ...prod(), local: { id: 1, nombre: "Local Centro" } })],
    ["productoId cero", () => { const d = prod(); d.productos[0]!.productoId = 0; return d; }],
  ];
  for (const [nombre, armar] of rotos) {
    it(`CONTRAPRUEBA: ${nombre} no pasa`, () => assert.equal(esDatosStockConsulta(armar()), false));
  }
});

describe("mi_alcance de 41f702b: el encargado la tiene anunciada, el cajero no", () => {
  it("el anuncio es por local, como en el ERP", () => {
    const enc = F.miAlcance.encargado.respuesta.cuerpo.datos as DatosMiAlcance;
    const caj = F.miAlcance.cajero.respuesta.cuerpo.datos as DatosMiAlcance;
    assert.ok(esDatosMiAlcance(enc) && esDatosMiAlcance(caj));
    assert.ok(anunciaCapacidad(enc.locales[0]!, "stock_consulta"));
    assert.ok(!anunciaCapacidad(caj.locales[0]!, "stock_consulta"));
  });
});
