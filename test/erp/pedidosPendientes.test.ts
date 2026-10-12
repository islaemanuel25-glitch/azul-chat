// CANDADOS DEL CONTRATO DE `pedidos_pendientes` (Tanda 9B).
//
// Todo contra el fixture generado EJECUTANDO la puerta del ERP en producción
// (erpmanual ccf2894, copiado sin tocar en test/fixtures/erp-ccf2894.json): los
// bytes que manda Azul Chat tienen que ser exactamente los que el ERP aceptó, y
// lo que el ERP contestó tiene que pasar el validador. Las respuestas rotas
// salen de una respuesta real con UNA cosa cambiada a propósito: la
// contraprueba de cada regla de forma.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { crearClienteErp, type ClienteErp } from "../../src/server/erp/cliente.ts";
import { construirCuerpoPedidosPendientes } from "../../src/server/erp/pedidosPendientes.ts";
import { esDatosPedidosPendientes } from "../../src/shared/erp/contrato.ts";
import {
  FIXTURES_ERP_CCF2894,
  SECRETO_PRUEBA,
  TOKEN_PRUEBA,
  levantarServidorErp,
  pedidoConToken,
  responderJson,
  type IntercambioErp,
  type Manejador,
  type ServidorErp,
} from "../ayuda/servidorErp.ts";

const F = FIXTURES_ERP_CCF2894;
type Datos = Record<string, unknown> & { pedidos: Record<string, unknown>[] };
const datosDe = (i: IntercambioErp) => structuredClone(i.respuesta.cuerpo.datos) as Datos;
const entradaDe = (i: IntercambioErp) => ({ alcance: i.pedido.alcance });

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

describe("pedidos_pendientes: lo que viaja es lo que el ERP aceptó", () => {
  for (const [nombre, i] of [["varios", F.varios], ["ninguno", F.ninguno]] as const) {
    it(`${nombre}: los BYTES del cuerpo son los del fixture, y la respuesta del ERP pasa entera`, async () => {
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().pedidosPendientes(TOKEN_PRUEBA, entradaDe(i));
      assert.equal(erp.recibidas.length, 1);
      assert.equal(erp.recibidas[0]!.cuerpo.toString("utf8"), pedidoConToken(i, TOKEN_PRUEBA));
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(r.datos, i.respuesta.cuerpo.datos);
    });
  }

  it("el fixture es lo que dice: dos pendientes de dos orígenes, del más viejo al más nuevo, y el cancelado no está", () => {
    const d = datosDe(F.varios);
    assert.deepEqual(
      d.pedidos.map((p) => [p.id, (p.origen as { nombre: string }).nombre, p.lineas, p.antiguedadHoras]),
      [
        [4, "Depósito", 1, 26],
        [7, "Local B", 3, 26],
      ],
    );
    assert.equal(F.canceladoQueNoAparece.estado, "Cancelado");
    assert.ok(!d.pedidos.some((p) => p.id === F.canceladoQueNoAparece.id));
    assert.deepEqual(datosDe(F.ninguno).pedidos, []);
  });

  it("sin permiso y con un parámetro de más: los rechazos reales, por código", async () => {
    for (const [i, codigo, status] of [
      [F.sinPermiso, "NO_AUTORIZADO", 403],
      [F.conParametro, "SOLICITUD_INVALIDA", 400],
    ] as const) {
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().pedidosPendientes(TOKEN_PRUEBA, { alcance: i.pedido.alcance });
      assert.ok(!r.ok && r.origen === "erp", JSON.stringify(r));
      assert.deepEqual([r.codigo, r.status], [codigo, status]);
    }
  });

  it("la entrada: solo el alcance, con enteros positivos; los parámetros no los elige nadie", () => {
    const alcance = { grupoId: 1, localId: 2 };
    const ok = construirCuerpoPedidosPendientes(TOKEN_PRUEBA, { alcance });
    assert.ok(ok.ok);
    assert.deepEqual(ok.cuerpo.parametros, {});
    for (const mala of [
      { alcance, parametros: {} },
      { alcance, parametros: { estado: "Cancelado" } },
      { alcance: { ...alcance, usuarioId: 8 } },
      { alcance: { grupoId: 1, localId: 0 } },
      { alcance: { grupoId: "1", localId: 2 } },
      {},
      null,
    ]) {
      assert.equal(construirCuerpoPedidosPendientes(TOKEN_PRUEBA, mala).ok, false, JSON.stringify(mala));
    }
    assert.equal(construirCuerpoPedidosPendientes("no-es-un-token", { alcance }).ok, false);
  });

  it("una entrada inválida no viaja", async () => {
    manejador = () => assert.fail("no tenía que llamar");
    const r = await cliente().pedidosPendientes(TOKEN_PRUEBA, { alcance: { grupoId: 1, localId: 2 }, parametros: { x: 1 } });
    assert.ok(!r.ok && r.origen === "local" && r.codigo === "SOLICITUD_INVALIDA");
    assert.equal(erp.recibidas.length, 0);
  });
});

describe("pedidos_pendientes: el validador de la forma (contrapruebas)", () => {
  const base = () => datosDe(F.varios);
  it("la respuesta real pasa", () => {
    assert.equal(esDatosPedidosPendientes(base()), true);
    assert.equal(esDatosPedidosPendientes(datosDe(F.ninguno)), true);
  });

  const rotas: [string, (d: Datos) => void][] = [
    ["otra capacidad", (d) => (d.capacidad = "pedidos_eventos")],
    ["otra versión", (d) => (d.version = 2)],
    ["una clave de más", (d) => (d.extra = 1)],
    ["el local con una clave de más", (d) => ((d.local as Record<string, unknown>).esDeposito = false)],
    ["grupo 0", (d) => (d.grupoId = 0)],
    ["un pedido con productos", (d) => (d.pedidos[0]!.productos = [])],
    ["un id negativo", (d) => (d.pedidos[0]!.id = -1)],
    ["líneas con decimales", (d) => (d.pedidos[0]!.lineas = 1.5)],
    ["antigüedad negativa", (d) => (d.pedidos[0]!.antiguedadHoras = -1)],
    ["antigüedad sin fecha", (d) => (d.pedidos[0]!.solicitadoAt = null)],
    ["fecha que no es ISO", (d) => (d.pedidos[0]!.solicitadoAt = "12/10/2026")],
    ["el origen sin nombre", (d) => delete (d.pedidos[0]!.origen as Record<string, unknown>).nombre],
    ["fuera de orden", (d) => d.pedidos.reverse()],
    ["un pedido repetido", (d) => d.pedidos.push(structuredClone(d.pedidos[0]!))],
  ];
  for (const [nombre, romper] of rotas) {
    it(`rechaza: ${nombre}`, () => {
      const d = base();
      romper(d);
      assert.equal(esDatosPedidosPendientes(d), false);
    });
  }

  it("sin fecha y sin antigüedad, juntos, es válido (el ERP lo contempla)", () => {
    const d = base();
    d.pedidos[1]!.solicitadoAt = null;
    d.pedidos[1]!.antiguedadHoras = null;
    assert.equal(esDatosPedidosPendientes(d), true);
  });
});
