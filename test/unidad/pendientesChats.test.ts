// CANDADOS DE "PENDIENTES" (Tanda 9B): qué entra, con qué etiqueta, en qué
// orden; la intención de la pregunta; los requisitos para mostrarla guardada; y
// cuánto le cuesta al cupo del ERP.
//
// Los datos son los de los fixtures del ERP: los pedidos de erp-ccf2894.json y
// las cajas de erp-14ae247.json (Ana correcta y verificada, Bruno con faltante,
// Carla con sobrante, Diego con faltante, Eva abierta, Sofía correcta sin
// verificar), en su forma pública.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import type { PendienteCaja, PendientePedido } from "../../src/shared/chats/api.ts";
import {
  compararPendientes,
  etiquetaDePedido,
  HORAS_PEDIDO_IMPORTANTE,
  ordenarPendientes,
  pendientesDeCajas,
  pendientesDePedidos,
  type PedidoDelErp,
} from "../../src/shared/chats/pendientes.ts";
import { localesDePendientes } from "../../src/server/chats/autorizacion.ts";
import { consultasDeLocal, ordenDeGeneral } from "../../src/server/pendientes/pendientes.ts";
import { cumpleRequisitos, requisitosDe } from "../../src/server/preguntas/guardadas.ts";
import { validarIntencion, type LocalesDeHoy } from "../../src/server/preguntas/intencion.ts";
import { cajasDelDiaDelFixture } from "../ayuda/cajas.ts";
import { FIXTURES_ERP_CCF2894 } from "../ayuda/servidorErp.ts";

const PEDIDOS = (FIXTURES_ERP_CCF2894.varios.respuesta.cuerpo.datos as { pedidos: PedidoDelErp[] }).pedidos;
const pedido = (id: number, horas: number | null, solicitadoAt: string | null = "2026-10-12T10:00:00.000Z"): PedidoDelErp => ({
  id,
  solicitadoAt,
  origen: { id: 1, nombre: "Depósito" },
  lineas: 2,
  antiguedadHoras: horas,
});

describe("los pedidos: todos los que manda el ERP, IMPORTANTE con más de 24 h", () => {
  it("la regla, en el borde", () => {
    assert.equal(HORAS_PEDIDO_IMPORTANTE, 24);
    assert.equal(etiquetaDePedido(25), "IMPORTANTE");
    assert.equal(etiquetaDePedido(24), "NORMAL");
    assert.equal(etiquetaDePedido(0), "NORMAL");
    assert.equal(etiquetaDePedido(null), "NORMAL", "sin antigüedad no se inventa que es viejo");
  });

  it("los del fixture (26 h): IMPORTANTE, copiados campo por campo", () => {
    const p = pendientesDePedidos(PEDIDOS);
    assert.deepEqual(p, [
      { tipo: "PEDIDO", etiqueta: "IMPORTANTE", pedidoId: 4, solicitadoAt: PEDIDOS[0]!.solicitadoAt, origen: { id: 1, nombre: "Depósito" }, lineas: 1, antiguedadHoras: 26 },
      { tipo: "PEDIDO", etiqueta: "IMPORTANTE", pedidoId: 7, solicitadoAt: PEDIDOS[1]!.solicitadoAt, origen: { id: 3, nombre: "Local B" }, lineas: 3, antiguedadHoras: 26 },
    ]);
  });
});

describe("las cajas: con diferencia o sin verificar", () => {
  const hoy = pendientesDeCajas(cajasDelDiaDelFixture("hoy"), "hoy");
  const porOperador = new Map(hoy.map((c) => [c.operador, c]));

  it("entran Bruno (falta), Carla (sobra), Diego (falta) y Sofía (sin verificar); no Ana (verificada) ni Eva (abierta)", () => {
    assert.deepEqual([...porOperador.keys()].sort(), ["Bruno", "Carla", "Diego", "Sofía"]);
  });

  it("faltante: IMPORTANTE con su monto; sobrante: NORMAL con su monto; sin diferencia y sin verificar: NORMAL sin monto", () => {
    const resumen = (c: PendienteCaja) => [c.etiqueta, c.motivo, c.monto, c.turno, c.dia];
    assert.deepEqual(resumen(porOperador.get("Bruno")!), ["IMPORTANTE", "FALTA", "1000.00", "Mañana", "hoy"]);
    assert.deepEqual(resumen(porOperador.get("Carla")!), ["NORMAL", "SOBRA", "1000.00", "Mañana", "hoy"]);
    assert.deepEqual(resumen(porOperador.get("Diego")!), ["IMPORTANTE", "FALTA", "500.00", "Tarde", "hoy"]);
    assert.deepEqual(resumen(porOperador.get("Sofía")!), ["NORMAL", "FALTA_VERIFICAR", null, "Sin turno asignado", "hoy"]);
  });

  it("una caja con diferencia que además falta verificar es UNA fila, por la diferencia", () => {
    // Bruno y Carla están FALTA_VERIFICAR en el fixture.
    assert.equal(hoy.filter((c) => c.operador === "Bruno").length, 1);
    assert.equal(porOperador.get("Bruno")!.motivo, "FALTA");
  });

  it("un día sin cajas, nada", () => {
    assert.deepEqual(pendientesDeCajas(cajasDelDiaDelFixture("ayerSinCajas"), "ayer"), []);
  });
});

describe("el orden: IMPORTANTE primero; dentro, lo más viejo primero", () => {
  const caja = (cajaId: number, motivo: PendienteCaja["motivo"], apertura: string, dia: "hoy" | "ayer" = "hoy"): PendienteCaja => ({
    tipo: "CAJA",
    etiqueta: motivo === "FALTA" ? "IMPORTANTE" : "NORMAL",
    cajaId,
    operador: `Op ${cajaId}`,
    nombreCaja: `Caja de Op ${cajaId}`,
    turno: "Mañana",
    dia,
    apertura,
    motivo,
    monto: motivo === "FALTA_VERIFICAR" ? null : "10.00",
  });
  const [pViejo, pNuevo, pReciente] = pendientesDePedidos([
    pedido(1, 72, "2026-10-09T10:00:00.000Z"),
    pedido(2, 30, "2026-10-11T04:00:00.000Z"),
    pedido(3, 2, "2026-10-12T08:00:00.000Z"),
  ]) as [PendientePedido, PendientePedido, PendientePedido];

  it("mezcla pedidos y cajas, y de ayer antes que de hoy", () => {
    const faltaAyer = caja(10, "FALTA", "2026-10-11T12:00:00.000Z", "ayer");
    const faltaHoy = caja(11, "FALTA", "2026-10-12T09:00:00.000Z");
    const sobraAyer = caja(12, "SOBRA", "2026-10-11T13:00:00.000Z", "ayer");
    const verificarHoy = caja(13, "FALTA_VERIFICAR", "2026-10-12T07:00:00.000Z");
    const orden = ordenarPendientes([verificarHoy, pReciente, faltaHoy, sobraAyer, pNuevo, faltaAyer, pViejo]);
    assert.deepEqual(
      orden.map((p) => (p.tipo === "PEDIDO" ? `P${p.pedidoId}` : `C${p.cajaId}`)),
      // IMPORTANTE, del más viejo: pedido 1 (9/10), pedido 2 (11/10 04:00), faltante de ayer (11/10 12:00), faltante de hoy.
      // NORMAL, del más viejo: sobrante de ayer, sin verificar de hoy (07:00), pedido 3 (08:00).
      ["P1", "P2", "C10", "C11", "C12", "C13", "P3"],
    );
  });

  it("sin fecha va al final de su grupo; empate de fecha: pedido antes que caja, después por id", () => {
    const sinFecha = pendientesDePedidos([pedido(9, 30, null)])[0]!;
    const igual = "2026-10-12T09:00:00.000Z";
    const a = pendientesDePedidos([pedido(5, 30, igual)])[0]!;
    const c = { ...caja(4, "FALTA", igual) };
    assert.deepEqual(ordenarPendientes([sinFecha, c, a]).map((p) => p.tipo), ["PEDIDO", "CAJA", "PEDIDO"]);
    assert.equal(compararPendientes(a, sinFecha) < 0, true);
  });
});

describe("General: los locales con algo primero, los que no tienen nada al final", () => {
  it("estable, y una fuente que faltó cuenta como 'algo que decir'", () => {
    const l = (id: number, n: number, faltaron: ("PEDIDOS" | "CAJAS_HOY" | "CAJAS_AYER")[] = []) => ({
      local: { id, nombre: `L${id}` },
      pendientes: pendientesDePedidos(Array.from({ length: n }, (_, i) => pedido(id * 10 + i, 1))),
      faltaron,
    });
    assert.deepEqual(
      ordenDeGeneral([l(1, 0), l(2, 2), l(3, 0, ["PEDIDOS"]), l(4, 1), l(5, 0)]).map((x) => x.local.id),
      [2, 3, 4, 1, 5],
    );
  });
});

describe("qué locales tienen 'Pendientes' y cuánto cuestan al cupo", () => {
  const alcance = (locales: { id: number; capacidades: string[] }[]): DatosMiAlcance => ({
    capacidad: "mi_alcance",
    version: 1,
    usuario: { id: 1, nombre: "x" },
    alcance: { modo: "LOCAL" },
    locales: locales.map((l) => ({ id: l.id, nombre: `L${l.id}`, grupoId: 1, esDeposito: false, activo: true, capacidades: l.capacidades })),
  });

  it("los que anuncian alguna de las dos, con cuál, en el orden de mi_alcance; los demás no", () => {
    const r = localesDePendientes(
      alcance([
        { id: 1, capacidades: ["ventas_resumen", "pedidos_pendientes"] },
        { id: 2, capacidades: ["ventas_resumen"] },
        { id: 3, capacidades: ["cajas_resumen"] },
        { id: 4, capacidades: ["cajas_resumen", "pedidos_pendientes"] },
      ]),
    );
    assert.deepEqual(
      r.map((l) => [l.localId, l.pedidos, l.cajas]),
      [
        [1, true, false],
        [3, false, true],
        [4, true, true],
      ],
    );
  });

  it("cupo: 1 (pedidos) + 2 (cajas hoy y ayer) por local; General con 5 locales y el fondo (18) entra en 120", () => {
    const l = (pedidos: boolean, cajas: boolean) => ({ localId: 1, grupoId: 1, nombre: "x", esDeposito: false, pedidos, cajas });
    assert.equal(consultasDeLocal(l(true, true)), 3);
    assert.equal(consultasDeLocal(l(true, false)), 1);
    assert.equal(consultasDeLocal(l(false, true)), 2);
    const MAX_FONDO = 18;
    const general = 1 + 5 * consultasDeLocal(l(true, true));
    assert.equal(general, 16);
    assert.ok(general + MAX_FONDO <= 120);
  });
});

describe("la pregunta de pendientes", () => {
  const LOCALES: LocalesDeHoy = {
    eventos: [],
    ventas: [{ localId: 1, grupoId: 1, nombre: "Centro" }],
    caja: [],
    stock: [],
    pendientes: [
      { localId: 1, grupoId: 1, nombre: "Centro", esDeposito: false, pedidos: true, cajas: true },
      { localId: 2, grupoId: 1, nombre: "Norte", esDeposito: false, pedidos: true, cajas: false },
    ],
  };
  const salida = (o: Record<string, unknown>) => ({
    intencion: "pendientes",
    tipoEvento: null,
    local: "Centro",
    periodo: "hoy",
    desde: null,
    hasta: null,
    turno: null,
    modoStock: null,
    producto: null,
    restriccionesNoSoportadas: [],
    ...o,
  });

  it("de un local o de todos", () => {
    const uno = validarIntencion(salida({}), "2026-10-12", LOCALES);
    assert.equal(uno.tipo, "PENDIENTES");
    assert.deepEqual(uno.tipo === "PENDIENTES" && [uno.todos, uno.locales.map((l) => l.localId)], [false, [1]]);
    const todos = validarIntencion(salida({ local: "todos" }), "2026-10-12", LOCALES);
    assert.deepEqual(todos.tipo === "PENDIENTES" && [todos.todos, todos.locales.map((l) => l.localId)], [true, [1, 2]]);
  });

  it("es de ahora: con otro período, un turno, un tipo de evento o un producto no se entiende", () => {
    for (const o of [
      { periodo: "ayer" },
      { periodo: "rango", desde: "2026-10-01", hasta: "2026-10-12" },
      { turno: "tarde" },
      { tipoEvento: "pedidos" },
      { modoStock: "bajo_minimo" },
      { local: "Inexistente" },
    ]) {
      assert.equal(validarIntencion(salida(o), "2026-10-12", LOCALES).tipo, "NO_ENTIENDO", JSON.stringify(o));
    }
    assert.equal(validarIntencion(salida({ local: "todos" }), "2026-10-12", { ...LOCALES, pendientes: [] }).tipo, "NO_ENTIENDO");
  });

  it("los requisitos para mostrarla guardada: cada fuente consultada en cada local, y se ocultan si hoy no las anuncia", () => {
    const intencion = validarIntencion(salida({ local: "todos" }), "2026-10-12", LOCALES);
    assert.equal(intencion.tipo, "PENDIENTES");
    const respuesta = { estado: "PENDIENTES" as const, alcance: "TODOS" as const, locales: [] };
    const req = requisitosDe(intencion, respuesta);
    assert.deepEqual(req, [
      { localId: 1, capacidad: "pedidos_pendientes" },
      { localId: 1, capacidad: "cajas_resumen" },
      { localId: 2, capacidad: "pedidos_pendientes" },
    ]);
    const hoy = (conPendientes: { localId: number; pedidos: boolean }[], conCaja: number[]) => ({
      autorizados: [],
      conVentas: [],
      conCaja: conCaja.map((localId) => ({ localId })),
      conStock: [],
      conPendientes,
    });
    assert.equal(cumpleRequisitos(req, hoy([{ localId: 1, pedidos: true }, { localId: 2, pedidos: true }], [1])), true);
    assert.equal(cumpleRequisitos(req, hoy([{ localId: 1, pedidos: true }, { localId: 2, pedidos: false }], [1])), false, "Norte sin pedidos_pendientes hoy");
    assert.equal(cumpleRequisitos(req, hoy([{ localId: 1, pedidos: true }, { localId: 2, pedidos: true }], [])), false, "Centro sin cajas_resumen hoy");
  });
});
