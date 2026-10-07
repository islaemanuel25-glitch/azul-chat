// CANDADOS DEL CONTRATO `transferencias_eventos` Y DE LAS CAPACIDADES DE `mi_alcance`.
//
// Todo contra el fixture generado EJECUTANDO el ERP desplegado (25172fe) con
// `scripts/generar-fixture-erp.mjs`: los bytes que manda Azul Chat tienen que
// ser exactamente los que el ERP aceptó, y lo que el ERP contestó tiene que
// pasar el validador. Las páginas rotas de abajo salen de una página real con
// UNA cosa cambiada a propósito.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { crearClienteErp } from "../../src/server/erp/cliente.ts";
import { construirCuerpoTransferenciasEventos } from "../../src/server/erp/transferenciasEventos.ts";
import { validarPagina } from "../../src/server/eventos/pagina.ts";
import { aFilaEvento, esPayloadTransferenciaRecibidaV1 } from "../../src/server/eventos/transferenciaRecibida.ts";
import {
  anunciaCapacidad,
  esDatosMiAlcance,
  esDatosTransferenciasEventos,
  type DatosMiAlcance,
  type DatosTransferenciasEventos,
} from "../../src/shared/erp/contrato.ts";
import {
  FIXTURES_ERP,
  FIXTURES_ERP_25172FE,
  SECRETO_PRUEBA,
  TOKEN_PRUEBA,
  levantarServidorErp,
  pedidoConToken,
  responderJson,
  type IntercambioErp,
  type Rompible,
  type Manejador,
  type ServidorErp,
} from "../ayuda/servidorErp.ts";

const TE = FIXTURES_ERP_25172FE.transferenciasEventos;
const MA = FIXTURES_ERP_25172FE.miAlcance;
const datosDe = (i: IntercambioErp) => structuredClone(i.respuesta.cuerpo.datos) as DatosTransferenciasEventos;
/** La entrada del cliente que corresponde al pedido del fixture. */
const entradaDe = (i: IntercambioErp) => {
  const p = i.pedido.parametros as { desde?: unknown; limite?: number };
  return { alcance: i.pedido.alcance, ...(p.desde ? { desde: p.desde } : {}), ...(p.limite !== undefined ? { limite: p.limite } : {}) };
};

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
const cliente = () => crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }, registrar: () => {} });

describe("transferencias_eventos: lo que viaja es lo que el ERP aceptó", () => {
  for (const nombre of ["pagina1", "pagina2", "vacia", "sinDesde", "despuesDelReset"] as const) {
    it(`${nombre}: los bytes del cuerpo son los del fixture, y la respuesta del ERP pasa entera`, async () => {
      const i = TE[nombre];
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().transferenciasEventos(TOKEN_PRUEBA, entradaDe(i));
      assert.equal(erp.recibidas.length, 1);
      assert.equal(erp.recibidas[0]!.cuerpo.toString("utf8"), pedidoConToken(i, TOKEN_PRUEBA));
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(r.datos, i.respuesta.cuerpo.datos);
    });
  }

  it("los rechazos del ERP vuelven con su código, sin inventar otro", async () => {
    for (const [nombre, codigo] of [["cajeroSinPermiso", "NO_AUTORIZADO"], ["otroLocalDelGrupo", "NO_AUTORIZADO"], ["limiteFueraDeRango", "SOLICITUD_INVALIDA"]] as const) {
      const i = TE[nombre];
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().transferenciasEventos(TOKEN_PRUEBA, { alcance: i.pedido.alcance });
      assert.ok(!r.ok && r.origen === "erp" && r.codigo === codigo, nombre);
    }
  });

  it("una entrada que el ERP rechazaría no gasta la llamada: SOLICITUD_INVALIDA local", async () => {
    const alcance = { grupoId: 1, localId: 3 };
    const desde = { fechaRecepcion: "2026-10-07T13:30:15.250Z", transferenciaId: 181 };
    for (const entrada of [
      { alcance, limite: 0 },
      { alcance, limite: 101 },
      { alcance, limite: 1.5 },
      { alcance, desde: { ...desde, extra: 1 } },
      { alcance, desde: { ...desde, fechaRecepcion: "2026-10-07T13:30:15Z" } },
      { alcance, desde: { ...desde, fechaRecepcion: "2026-02-30T00:00:00.000Z" } },
      { alcance, desde: { ...desde, transferenciaId: "181" } },
      { alcance, usuarioId: 9 },
      { alcance: { ...alcance, usuarioId: 9 } },
      { alcance: { grupoId: 1 } },
    ]) {
      assert.equal(construirCuerpoTransferenciasEventos(TOKEN_PRUEBA, entrada), null, JSON.stringify(entrada));
      const r = await cliente().transferenciasEventos(TOKEN_PRUEBA, entrada);
      assert.ok(!r.ok && r.origen === "local" && r.codigo === "SOLICITUD_INVALIDA");
    }
    assert.equal(erp.recibidas.length, 0);
  });
});

describe("transferencias_eventos: el validador de la forma", () => {
  it("las páginas reales pasan", () => {
    for (const i of Object.values(TE).filter((x) => x.respuesta.status === 200)) assert.ok(esDatosTransferenciasEventos(i.respuesta.cuerpo.datos));
  });

  type Datos = Rompible<DatosTransferenciasEventos>;
  const rota = (cambio: (d: Datos) => void): Datos => {
    const d = datosDe(TE.pagina2) as Datos;
    cambio(d);
    return d;
  };
  const casos: [string, (d: Datos) => void][] = [
    ["G. eventoId mal formado", (d) => (d.eventos[0]!.eventoId = "TRANSFERENCIA_RECIBIDA:182")],
    ["H. eventoId con otra fecha que fechaRecepcion", (d) => (d.eventos[0]!.eventoId = "TRANSFERENCIA_RECIBIDA:182:2026-10-07T13:30:15.000Z")],
    ["H. eventoId con otro id", (d) => (d.eventos[0]!.eventoId = "TRANSFERENCIA_RECIBIDA:999:2026-10-07T13:30:15.250Z")],
    ["fechaRecepcion sin milisegundos", (d) => (d.eventos[0]!.fechaRecepcion = "2026-10-07T13:30:15Z")],
    ["otro tipo", (d) => (d.eventos[0]!.tipo = "TRANSFERENCIA_CORREGIDA" as never)],
    ["transferenciaId no entero", (d) => (d.eventos[0]!.transferenciaId = "182" as never)],
    ["orden roto", (d) => d.eventos.reverse()],
    ["un evento más nuevo que hasta", (d) => (d.hasta = "2026-10-07T13:00:00.000Z")],
    ["siguiente distinto del último", (d) => (d.siguiente = { fechaRecepcion: "2026-10-07T13:30:15.250Z", transferenciaId: 182 })],
    ["siguiente con una clave de más", (d) => Object.assign(d.siguiente!, { extra: 1 })],
    ["hayMas no booleano", (d) => (d.hayMas = "no" as never)],
    ["otra capacidad", (d) => (d.capacidad = "ventas_resumen" as never)],
    ["otra versión", (d) => (d.version = 2 as never)],
    ["sin lineasConDiferencia", (d) => Reflect.deleteProperty(d.eventos[0]!, "lineasConDiferencia")],
    ["lineasConDiferencia negativa", (d) => (d.eventos[0]!.lineasConDiferencia = -1)],
    ["origen sin esDeposito", (d) => Reflect.deleteProperty(d.eventos[0]!.origen, "esDeposito")],
  ];
  for (const [titulo, cambio] of casos) {
    it(`rechaza: ${titulo}`, () => assert.equal(esDatosTransferenciasEventos(rota(cambio)), false));
  }
  it("hayMas sin eventos es imposible por contrato", () => {
    const d = datosDe(TE.vacia) as Datos;
    d.hayMas = true;
    assert.equal(esDatosTransferenciasEventos(d), false);
  });
  it("un campo de más en un evento no rompe la respuesta, y tampoco llega al payload", () => {
    const d = rota((x) => Object.assign(x.eventos[0]!, { nuevoCampo: "x" }));
    assert.ok(esDatosTransferenciasEventos(d));
    assert.ok(!("nuevoCampo" in aFilaEvento(d.eventos[0]!).payload));
  });
});

describe("la página contra lo que se pidió (antes de guardar)", () => {
  const desdeDe = (i: IntercambioErp) => ((i.pedido.parametros as { desde?: never }).desde ?? null);
  const pedidoDe = (i: IntercambioErp) => ({ localId: 3, desde: desdeDe(i), limite: 2 });

  it("las páginas reales, con su pedido, pasan", () => {
    for (const n of ["pagina1", "pagina2", "vacia"] as const) assert.ok(validarPagina(datosDe(TE[n]), pedidoDe(TE[n])).ok, n);
  });
  it("E. el local de la respuesta no es el pedido", () => {
    const r = validarPagina(datosDe(TE.pagina1), { ...pedidoDe(TE.pagina1), localId: 20 });
    assert.deepEqual(r, { ok: false, codigo: "RESPUESTA_INVALIDA", motivo: "OTRO_LOCAL" });
  });
  it("F. un evento de otro destino, aunque el local diga el pedido", () => {
    const d = datosDe(TE.pagina1) as Rompible<DatosTransferenciasEventos>;
    d.eventos[1]!.destino = { id: 20, nombre: "Centro" };
    assert.deepEqual(validarPagina(d, pedidoDe(TE.pagina1)), { ok: false, codigo: "RESPUESTA_INVALIDA", motivo: "OTRO_DESTINO" });
  });
  it("una página que no avanza sobre el desde mandado", () => {
    assert.equal((validarPagina(datosDe(TE.pagina1), pedidoDe(TE.pagina2)) as { motivo?: string }).motivo, "NO_AVANZA");
  });
  it("una página vacía que no repite el desde", () => {
    assert.equal((validarPagina(datosDe(TE.vacia), pedidoDe(TE.pagina2)) as { motivo?: string }).motivo, "SIGUIENTE_DE_PAGINA_VACIA");
  });
  it("más eventos que el límite, y hayMas con la página sin llenar", () => {
    assert.equal((validarPagina(datosDe(TE.pagina1), { ...pedidoDe(TE.pagina1), limite: 1 }) as { motivo?: string }).motivo, "DEMASIADOS_EVENTOS");
    assert.equal((validarPagina(datosDe(TE.pagina1), { ...pedidoDe(TE.pagina1), limite: 3 }) as { motivo?: string }).motivo, "HAY_MAS_SIN_PAGINA_LLENA");
  });
});

describe("el payload v1", () => {
  it("se arma solo con origen, destino y las dos diferencias, y su guardián lo acepta", () => {
    const fila = aFilaEvento(datosDe(TE.pagina2).eventos[0]!);
    assert.deepEqual(fila, {
      tipo: "TRANSFERENCIA_RECIBIDA",
      claveExterna: "TRANSFERENCIA_RECIBIDA:182:2026-10-07T13:30:15.250Z",
      erpLocalId: 3,
      erpReferenciaId: 182,
      fechaOperacion: new Date("2026-10-07T13:30:15.250Z"),
      payloadVersion: 1,
      payload: { origen: { id: 9, nombre: "Depósito Central", esDeposito: true }, destino: { id: 3, nombre: "Casiano" }, tieneDiferencias: true, lineasConDiferencia: 3 },
    });
    assert.ok(esPayloadTransferenciaRecibidaV1(fila.payload));
  });
  it("AC. el guardián rechaza lo que no es el objeto v1", () => {
    for (const malo of [[], "x", null, 1, {}, { ...aFilaEvento(datosDe(TE.pagina2).eventos[0]!).payload, permisos: ["*"] }]) {
      assert.equal(esPayloadTransferenciaRecibidaV1(malo), false, JSON.stringify(malo));
    }
  });
});

describe("mi_alcance: las capacidades de cada local (ERP 25172fe)", () => {
  const datos = (n: keyof typeof MA) => MA[n].respuesta.cuerpo.datos as DatosMiAlcance;

  it("las respuestas reales pasan; el encargado anuncia transferencias_eventos y el cajero no", () => {
    for (const n of ["encargado", "cajero", "adminGlobal"] as const) assert.ok(esDatosMiAlcance(datos(n)), n);
    assert.equal(anunciaCapacidad(datos("encargado").locales[0]!, "transferencias_eventos"), true);
    assert.equal(anunciaCapacidad(datos("cajero").locales[0]!, "transferencias_eventos"), false);
    assert.ok(datos("adminGlobal").locales.every((l) => anunciaCapacidad(l, "transferencias_eventos")));
  });
  it("compatible: la respuesta del ERP anterior (8920516), sin capacidades, sigue valiendo y no anuncia nada", () => {
    const viejo = FIXTURES_ERP.miAlcance.datos as unknown as DatosMiAlcance;
    assert.ok(esDatosMiAlcance(viejo));
    assert.ok(viejo.locales.every((l) => !anunciaCapacidad(l, "transferencias_eventos")));
  });
  it("una capacidad que Azul Chat no conoce no rompe; una lista que no es de textos sí", () => {
    const d = structuredClone(datos("encargado")) as Rompible<DatosMiAlcance>;
    d.locales[0]!.capacidades!.push("pedidos_eventos");
    assert.ok(esDatosMiAlcance(d));
    d.locales[0]!.capacidades = "transferencias_eventos" as never;
    assert.equal(esDatosMiAlcance(d), false);
    d.locales[0]!.capacidades = [1] as never;
    assert.equal(esDatosMiAlcance(d), false);
  });
});
