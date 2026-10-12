// CANDADOS DEL CONTRATO DE `cajas_resumen` (Tanda 7B).
//
// Todo contra el fixture generado EJECUTANDO la puerta del ERP en producción
// (erpmanual 14ae247, copiado sin tocar en test/fixtures/erp-14ae247.json):
// los bytes que manda Azul Chat tienen que ser exactamente los que el ERP
// aceptó, y lo que el ERP contestó tiene que pasar el validador. Las
// respuestas rotas salen de una respuesta real con UNA cosa cambiada a
// propósito: la contraprueba de cada regla de forma.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { construirCuerpoCajasResumen } from "../../src/server/erp/cajasResumen.ts";
import { crearClienteErp, type ClienteErp } from "../../src/server/erp/cliente.ts";
import { anunciaCapacidad, esDatosCajasResumen, esDatosMiAlcance, type DatosMiAlcance } from "../../src/shared/erp/contrato.ts";
import {
  FIXTURES_ERP_14AE247,
  SECRETO_PRUEBA,
  TOKEN_PRUEBA,
  levantarServidorErp,
  pedidoConToken,
  responderJson,
  type IntercambioErp,
  type Manejador,
  type ServidorErp,
} from "../ayuda/servidorErp.ts";

const F = FIXTURES_ERP_14AE247;
type Datos = Record<string, unknown> & { turnosOperativos: (Record<string, unknown> & { cajas: Record<string, unknown>[]; totales: Record<string, unknown> })[] };
const datosDe = (i: IntercambioErp) => structuredClone(i.respuesta.cuerpo.datos) as Datos;
const entradaDe = (i: IntercambioErp) => ({ alcance: i.pedido.alcance, periodo: (i.pedido.parametros as { periodo: unknown }).periodo });

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

describe("cajas_resumen: lo que viaja es lo que el ERP aceptó", () => {
  for (const nombre of ["hoy", "ayerSinCajas"] as const) {
    it(`${nombre}: los BYTES del cuerpo son los del fixture, y la respuesta del ERP pasa entera`, async () => {
      const i = F.dia[nombre];
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().cajasResumen(TOKEN_PRUEBA, entradaDe(i));
      assert.equal(erp.recibidas.length, 1);
      assert.equal(erp.recibidas[0]!.cuerpo.toString("utf8"), pedidoConToken(i, TOKEN_PRUEBA));
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(r.datos, i.respuesta.cuerpo.datos);
    });
  }

  it("Azul Chat no manda `turnoOperativo`: la entrada con turno se rechaza sin llamar", async () => {
    manejador = () => assert.fail("no tenía que llamar");
    const i = F.dia.turnoTarde;
    const r = await cliente().cajasResumen(TOKEN_PRUEBA, { ...entradaDe(i), turnoOperativo: "Tarde" });
    assert.ok(!r.ok && r.origen === "local" && r.codigo === "SOLICITUD_INVALIDA");
    assert.equal(erp.recibidas.length, 0);
  });

  it("una fecha arma { tipo: fecha, fecha }; rango, fecha falsa, claves de más y alcance raro no se mandan", async () => {
    const alcance = { grupoId: 1, localId: 1 };
    const fecha = construirCuerpoCajasResumen(TOKEN_PRUEBA, { alcance, periodo: { tipo: "fecha", fecha: "2026-10-05" } });
    assert.ok(fecha.ok);
    assert.deepEqual(fecha.cuerpo.parametros, { periodo: { tipo: "fecha", fecha: "2026-10-05" } });
    manejador = () => assert.fail("no tenía que llamar");
    for (const [entrada, codigo] of [
      [{ alcance, periodo: { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-02" } }, "PERIODO_INVALIDO"],
      [{ alcance, periodo: { tipo: "fecha", fecha: "2026-02-30" } }, "PERIODO_INVALIDO"],
      [{ alcance, periodo: { tipo: "hoy", fecha: "2026-10-05" } }, "PERIODO_INVALIDO"],
      [{ alcance, periodo: { tipo: "hoy" }, otro: 1 }, "SOLICITUD_INVALIDA"],
      [{ alcance: { ...alcance, usuarioId: 3 }, periodo: { tipo: "hoy" } }, "SOLICITUD_INVALIDA"],
      [{ alcance: { grupoId: 0, localId: 1 }, periodo: { tipo: "hoy" } }, "SOLICITUD_INVALIDA"],
    ] as const) {
      const r = await cliente().cajasResumen(TOKEN_PRUEBA, entrada);
      assert.ok(!r.ok && r.origen === "local" && r.codigo === codigo, JSON.stringify(entrada));
    }
    assert.equal(erp.recibidas.length, 0);
  });

  it("los rechazos del ERP vuelven con su código: TURNO_OPERATIVO_INVALIDO, PERIODO_INVALIDO y NO_AUTORIZADO", async () => {
    for (const [nombre, codigo] of [
      ["turnoInexistente", "TURNO_OPERATIVO_INVALIDO"],
      ["periodoInvalido", "PERIODO_INVALIDO"],
      ["sinPermiso", "NO_AUTORIZADO"],
    ] as const) {
      const i = F.rechazos[nombre];
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().cajasResumen(TOKEN_PRUEBA, { alcance: i.pedido.alcance, periodo: { tipo: "hoy" } });
      assert.ok(!r.ok && r.origen === "erp" && r.codigo === codigo && r.status === i.respuesta.status, nombre);
    }
  });
});

describe("cajas_resumen: una respuesta se acepta entera o no se acepta", () => {
  it("las tres respuestas reales pasan", () => {
    for (const nombre of ["hoy", "turnoTarde", "ayerSinCajas"] as const) assert.ok(esDatosCajasResumen(F.dia[nombre].respuesta.cuerpo.datos), nombre);
  });

  it("el día real tiene lo que la tarjeta necesita: dos turnos, sin turno al final, una caja con cada estado", () => {
    const d = datosDe(F.dia.hoy);
    assert.deepEqual(
      d.turnosOperativos.map((t) => [(t.turnoOperativo as { nombre: string }).nombre, t.sinTurnoAsignado]),
      [["Mañana", false], ["Tarde", false], ["Sin turno asignado", true]],
    );
    const estados = d.turnosOperativos.flatMap((t) => t.cajas.map((c) => c.estado));
    for (const e of ["ABIERTA", "CORRECTA", "CON_DIFERENCIA"]) assert.ok(estados.includes(e), e);
  });

  it("CONTRAPRUEBA: cada cosa fuera de forma la rechaza", () => {
    const rotas: Record<string, (d: Datos) => void> = {
      capacidad: (d) => (d.capacidad = "ventas_resumen"),
      version: (d) => (d.version = 2),
      periodo: (d) => ((d.periodo as Record<string, unknown>).fecha = "11/10/2026"),
      sinTurnoAlPrincipio: (d) => d.turnosOperativos.unshift(d.turnosOperativos.pop()!),
      sinTurnoConId: (d) => ((d.turnosOperativos.at(-1)!.turnoOperativo as Record<string, unknown>).id = 7),
      turnoSinId: (d) => ((d.turnosOperativos[0]!.turnoOperativo as Record<string, unknown>).id = null),
      totalNoDecimal: (d) => (d.turnosOperativos[0]!.totales.totalVendido = 83000),
      fiadoComoCobrado: (d) => ((d.turnosOperativos[0]!.cajas[0]!.ventasNoCobradas as Record<string, unknown>[])[0]!.cobrado = true),
      diferenciaQueNoDiceElEstado: (d) => (d.turnosOperativos[0]!.cajas[0]!.diferencia = { monto: "100.00", tipo: "FALTA" }),
      abiertaConDiferencia: (d) => (d.turnosOperativos[1]!.cajas[1]!.diferencia = { monto: "0.00", tipo: "NINGUNA" }),
      estadoNuevo: (d) => (d.turnosOperativos[0]!.cajas[0]!.estado = "CERRADA"),
      retiroSinMonto: (d) => ((d.turnosOperativos[0]!.cajas[0]!.retiros as Record<string, unknown>[])[0]!.monto = null),
      retiroTipoNuevo: (d) => ((d.turnosOperativos[0]!.cajas[0]!.retiros as Record<string, unknown>[])[0]!.tipo = "OTRO"),
      horaNoIso: (d) => ((d.turnosOperativos[0]!.cajas[0]!.retiros as Record<string, unknown>[])[0]!.hora = "20:39"),
      operadorNumero: (d) => (d.turnosOperativos[0]!.cajas[0]!.operador = 4),
      verificacionNueva: (d) => (d.turnosOperativos[0]!.cajas[0]!.verificacionTesoreria = "SI"),
      advertenciaRara: (d) => (d.advertencias = [{ codigo: "X", mensaje: "y", cajaId: "2" }]),
    };
    for (const [nombre, romper] of Object.entries(rotas)) {
      const d = datosDe(F.dia.hoy);
      romper(d);
      assert.equal(esDatosCajasResumen(d), false, nombre);
    }
    // Una advertencia que nombra su caja es de la forma real del ERP.
    const conCaja = datosDe(F.dia.hoy);
    conCaja.advertencias = [{ codigo: "DESGLOSE_NO_CUADRA", mensaje: "x", cajaId: 2 }];
    assert.ok(esDatosCajasResumen(conCaja));
  });
});

describe("mi_alcance del ERP 14ae247 anuncia cajas_resumen solo a quien la puede usar", () => {
  it("la tesorera la tiene en su local; el encargado no", () => {
    for (const [nombre, tiene] of [["tesoreria", true], ["encargado", false]] as const) {
      const d = F.miAlcance[nombre].respuesta.cuerpo.datos;
      assert.ok(esDatosMiAlcance(d), nombre);
      assert.equal((d as DatosMiAlcance).locales.some((l) => anunciaCapacidad(l, "cajas_resumen")), tiene, nombre);
    }
  });
});
