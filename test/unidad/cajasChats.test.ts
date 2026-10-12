// CANDADOS DE CAJA QUE NO NECESITAN BASE (Tanda 7B).
//
//   · GET /api/chats/caja valida la consulta ANTES de leer la sesión;
//   · la respuesta pública se arma copiando campo por campo lo que dio el ERP,
//     y solo si es del local, el grupo y el día pedidos;
//   · el turno lo elige el código sobre los nombres que devolvió el ERP;
//   · la suma de "todos" la hace el código, en centavos;
//   · la intención de la IA se valida: caja de UN día, turno corto, ventas por
//     turno solo con `cajas_resumen`.
//
// Los datos son los del fixture del ERP 14ae247 (test/fixtures/erp-14ae247.json).

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { cajasPublicas } from "../../src/server/caja/cajasResumen.ts";
import { manejarCaja } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import type { ClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { elegirTurno, normalizarTurno, sumarTotalesDeTurno } from "../../src/server/preguntas/cajas.ts";
import { validarIntencion, type LocalesDeHoy } from "../../src/server/preguntas/intencion.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import type { DatosCajasResumen } from "../../src/shared/erp/contrato.ts";
import { cajasDelDiaDelFixture } from "../ayuda/cajas.ts";
import { FIXTURES_ERP_14AE247 } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const datos = (caso: "hoy" | "turnoTarde" | "ayerSinCajas") => structuredClone(FIXTURES_ERP_14AE247.dia[caso].respuesta.cuerpo.datos) as unknown as DatosCajasResumen;
const PEDIDO_HOY = { localId: 1, grupoId: 1, periodo: { tipo: "hoy" } } as const;

const erpIntocable = new Proxy({} as ClienteErp, {
  get() {
    throw new Error("una solicitud inválida no llega al ERP");
  },
});

function deps(): DependenciasSesion {
  return {
    config: leerConfigAzulChat({
      AZUL_CHAT_INSTALACION_ID: "instalacion-prueba",
      AZUL_CHAT_ORIGEN_PUBLICO: ORIGEN,
      AZUL_CHAT_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    }),
    db: null,
    erp: erpIntocable,
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: Date.now,
    registrar: () => {},
    generarRequestId: randomUUID,
  } as unknown as DependenciasSesion;
}

describe("GET /api/chats/caja: la consulta", () => {
  it("sin localId, con uno raro o con claves de más: 400 sin tocar ni la sesión ni el ERP", async () => {
    for (const q of ["", "?localId=0", "?localId=abc", "?localId=3&localId=4", "?localId=3&periodo=ayer", "?localId=3&capacidad=cajas_resumen"]) {
      const res = await manejarCaja(new Request(`${ORIGEN}/api/chats/caja${q}`), deps());
      assert.equal(res.status, 400, q);
      assert.deepEqual(await res.json(), { estado: "SOLICITUD_INVALIDA" });
    }
  });
});

describe("la respuesta pública copia lo del ERP, campo por campo", () => {
  it("cada día del fixture: exactamente la forma pública, sin nada de más", () => {
    for (const [caso, periodo] of [["hoy", { tipo: "hoy" }], ["turnoTarde", { tipo: "hoy" }], ["ayerSinCajas", { tipo: "ayer" }]] as const) {
      assert.deepEqual(cajasPublicas(datos(caso), { localId: 1, grupoId: 1, periodo }), cajasDelDiaDelFixture(caso), caso);
    }
  });

  it("las diferencias quedan en cada caja: el turno no lleva ninguna", () => {
    const c = cajasPublicas(datos("hoy"), PEDIDO_HOY)!;
    const manana = c.turnos[0]!;
    assert.deepEqual(manana.cajas.map((x) => x.diferencia), [{ monto: "0.00", tipo: "NINGUNA" }, { monto: "1000.00", tipo: "FALTA" }, { monto: "1000.00", tipo: "SOBRA" }]);
    assert.ok(!JSON.stringify(manana.totales).includes("diferencia"));
  });

  it("si no es el local, el grupo o el día pedidos, no se muestra nada", () => {
    assert.equal(cajasPublicas(datos("hoy"), { ...PEDIDO_HOY, localId: 2 }), null);
    assert.equal(cajasPublicas(datos("hoy"), { ...PEDIDO_HOY, grupoId: 2 }), null);
    assert.equal(cajasPublicas(datos("hoy"), { ...PEDIDO_HOY, periodo: { tipo: "ayer" } }), null);
    const fecha = { ...datos("hoy"), periodo: { tipo: "fecha" as const, fecha: "2026-10-11", zonaHoraria: "America/Argentina/Cordoba" } };
    assert.ok(cajasPublicas(fecha, { ...PEDIDO_HOY, periodo: { tipo: "fecha", fecha: "2026-10-11" } }));
    assert.equal(cajasPublicas(fecha, { ...PEDIDO_HOY, periodo: { tipo: "fecha", fecha: "2026-10-10" } }), null);
  });
});

describe("el turno lo elige el código, sobre los nombres que dio el ERP", () => {
  const turnos = cajasDelDiaDelFixture("hoy").turnos;
  const nombre = (t: string) => elegirTurno(t, turnos)?.turno.nombre ?? null;

  it("sin acentos, sin mayúsculas, y 'contiene' en los dos sentidos", () => {
    assert.equal(nombre("tarde"), "Tarde");
    assert.equal(nombre("TARDE"), "Tarde");
    assert.equal(nombre("turno tarde"), "Tarde");
    assert.equal(nombre("manana"), "Mañana");
    assert.equal(nombre("la mañana"), "Mañana");
    assert.equal(normalizarTurno("  Turno   MAÑANA "), "turno manana");
  });

  it("uno que no está, o el grupo sin turno, no se elige", () => {
    assert.equal(nombre("noche"), null);
    assert.equal(nombre("sin turno asignado"), null);
    assert.equal(nombre("   "), null);
  });

  it("CONTRAPRUEBA: si coinciden dos y ninguno es exacto, no se adivina; el exacto gana", () => {
    const dos = [...turnos.slice(0, 2), { ...turnos[1]!, turno: { id: 9, nombre: "Tarde extendida" } }];
    assert.equal(elegirTurno("tard", dos), null);
    assert.equal(elegirTurno("tarde", dos)?.turno.nombre, "Tarde");
    assert.equal(elegirTurno("tarde extendida", dos)?.turno.id, 9);
  });
});

describe("la suma de un turno en varios locales la hace el código, en centavos", () => {
  it("total, efectivo, cantidad y cada medio; el fiado aparte", () => {
    const manana = cajasDelDiaDelFixture("hoy").turnos[0]!.totales;
    const s = sumarTotalesDeTurno([manana, manana])!;
    assert.deepEqual([s.cantidadVentas, s.totalVendido, s.ventasEfectivo], [12, "166000.00", "130000.00"]);
    assert.deepEqual(s.ventasPorMedio.map((m) => [m.medio, m.total, m.cantidadPagos, m.cobrado]), [
      ["EFECTIVO", "130000.00", 6, true],
      ["DEBITO", "16000.00", 2, true],
      ["MERCADOPAGO", "14000.00", 2, true],
    ]);
    assert.deepEqual(s.ventasNoCobradas.map((m) => [m.medio, m.total, m.cobrado]), [["FIADO", "6000.00", false]]);
    // 0.10 + 0.20: en coma flotante no da 0.30.
    const centavos = { ...manana, totalVendido: "0.10", ventasEfectivo: "0.10", ventasPorMedio: [], ventasNoCobradas: [] };
    assert.equal(sumarTotalesDeTurno([centavos, { ...centavos, totalVendido: "0.20", ventasEfectivo: "0.20" }])!.totalVendido, "0.30");
  });

  it("CONTRAPRUEBA: un monto que no es el decimal del contrato no se suma", () => {
    const manana = cajasDelDiaDelFixture("hoy").turnos[0]!.totales;
    assert.equal(sumarTotalesDeTurno([manana, { ...manana, totalVendido: "83.000" }]), null);
  });
});

describe("la intención de caja y de ventas por turno", () => {
  const HOY = "2026-10-11";
  const LOCALES: LocalesDeHoy = {
    eventos: [],
    ventas: [
      { localId: 1, grupoId: 1, nombre: "Centro" },
      { localId: 2, grupoId: 1, nombre: "Norte" },
    ],
    caja: [{ localId: 1, grupoId: 1, nombre: "Centro" }],
  };
  const salida = (o: Record<string, unknown>) => ({
    intencion: "caja",
    tipoEvento: null,
    local: "Centro",
    periodo: "hoy",
    desde: null,
    hasta: null,
    turno: null,
    restriccionesNoSoportadas: [],
    ...o,
  });

  it("caja de un local, de un día; el turno es texto corto", () => {
    const i = validarIntencion(salida({ turno: " tarde " }), HOY, LOCALES);
    assert.ok(i.tipo === "CAJA");
    assert.deepEqual([i.locales.map((l) => l.localId), i.todos, i.periodo, i.turno], [[1], false, { tipo: "hoy", desde: HOY, hasta: HOY }, "tarde"]);
    const unDia = validarIntencion(salida({ periodo: "rango", desde: "2026-10-05", hasta: "2026-10-05" }), HOY, LOCALES);
    assert.ok(unDia.tipo === "CAJA");
    const todos = validarIntencion(salida({ local: "todos" }), HOY, LOCALES);
    assert.ok(todos.tipo === "CAJA" && todos.todos && todos.locales.length === 1);
  });

  it("caja de varios días, de un local sin cajas_resumen, o con un turno vacío o largo: NO_ENTIENDO", () => {
    for (const o of [
      { periodo: "rango", desde: "2026-10-05", hasta: "2026-10-06" },
      { local: "Norte" },
      { turno: "   " },
      { turno: "x".repeat(41) },
      { turno: 3 },
      { tipoEvento: "recibidas" },
    ]) {
      assert.equal(validarIntencion(salida(o), HOY, LOCALES).tipo, "NO_ENTIENDO", JSON.stringify(o));
    }
  });

  it("CONTRAPRUEBA: sin la clave turno (la salida de antes), NO_ENTIENDO; las ocho claves, exactas", () => {
    const sinTurno: Record<string, unknown> = salida({});
    delete sinTurno.turno;
    assert.equal(validarIntencion(sinTurno, HOY, LOCALES).tipo, "NO_ENTIENDO");
    assert.equal(validarIntencion({ ...salida({}), otra: 1 }, HOY, LOCALES).tipo, "NO_ENTIENDO");
  });

  it("ventas con turno: por turno solo si es de un día y el local tiene cajas_resumen; si no, como antes", () => {
    const v = (o: Record<string, unknown>) => validarIntencion(salida({ intencion: "ventas", restriccionesNoSoportadas: ["turno"], ...o }), HOY, LOCALES);
    const local = v({ turno: "tarde" });
    assert.ok(local.tipo === "VENTAS");
    assert.deepEqual(local.porTurno, { turno: "tarde", locales: [{ localId: 1, grupoId: 1, nombre: "Centro" }] });
    assert.deepEqual(local.noSeparaPor, ["turno"], "el manejador lo saca cuando lo resuelve");
    const sinCaja = v({ turno: "tarde", local: "Norte" });
    assert.ok(sinCaja.tipo === "VENTAS" && sinCaja.porTurno === null);
    const variosDias = v({ turno: "tarde", periodo: "rango", desde: "2026-10-05", hasta: "2026-10-06" });
    assert.ok(variosDias.tipo === "VENTAS" && variosDias.porTurno === null && variosDias.noSeparaPor.includes("turno"));
    const todos = v({ turno: "tarde", local: "todos" });
    assert.ok(todos.tipo === "VENTAS" && todos.porTurno?.locales.length === 1 && todos.locales.length === 2);
    const sinTurno = v({});
    assert.ok(sinTurno.tipo === "VENTAS" && sinTurno.porTurno === null);
  });
});
