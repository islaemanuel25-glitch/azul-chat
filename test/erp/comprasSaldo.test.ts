// CANDADOS DEL CONTRATO DE `compras_saldo_eventos` (ERP fd1bca1, 2026-10-15).
//
// Todo contra test/fixtures/erp-fd1bca1.json, generado EJECUTANDO la puerta
// del ERP (scripts/generar-fixture-compras-saldo.mjs) sobre los mismos bytes
// que manda Azul Chat: lo que viaja tiene que ser BYTE A BYTE lo que el ERP
// aceptó, y lo que el ERP contestó tiene que pasar el validador. Las páginas
// rotas salen de una página real con UNA cosa cambiada a propósito.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { crearClienteErp, type ClienteErp } from "../../src/server/erp/cliente.ts";
import { construirCuerpoEventos } from "../../src/server/erp/eventos.ts";
import { INGESTA_COMPRAS_SALDO, TIPO_DE_CAPACIDAD } from "../../src/server/eventos/capacidades.ts";
import { aFilaCompraConSaldo, esPayloadCompraConSaldoV1 } from "../../src/server/eventos/compraConSaldo.ts";
import { validarPaginaDe } from "../../src/server/eventos/pagina.ts";
import { clasificarRepetido, type EventoGuardado } from "../../src/server/eventos/repetido.ts";
import type { FilaEvento } from "../../src/server/eventos/transferenciaRecibida.ts";
import { resumenDeEvento } from "../../src/shared/chats/textos.ts";
import {
  anunciaCapacidad,
  esDatosComprasSaldoEventos,
  esDatosMiAlcance,
  type ContratoEventos,
  type DatosComprasSaldoEventos,
  type DatosMiAlcance,
} from "../../src/shared/erp/contrato.ts";
import {
  FIXTURES_ERP_FD1BCA1,
  SECRETO_PRUEBA,
  TOKEN_PRUEBA,
  levantarServidorErp,
  pedidoConToken,
  responderJson,
  type IntercambioErp,
  type Manejador,
  type Rompible,
  type ServidorErp,
} from "../ayuda/servidorErp.ts";

const F = FIXTURES_ERP_FD1BCA1.compras_saldo_eventos;
const contrato = INGESTA_COMPRAS_SALDO.contrato as unknown as ContratoEventos<string, object, object>;

const entradaDe = (i: IntercambioErp) => {
  const p = i.pedido.parametros as { desde?: unknown; limite?: number };
  return { alcance: i.pedido.alcance, ...(p.desde ? { desde: p.desde } : {}), ...(p.limite !== undefined ? { limite: p.limite } : {}) };
};
const datosDe = (i: IntercambioErp) => structuredClone(i.respuesta.cuerpo.datos) as Rompible<Record<string, unknown>> & { eventos: Record<string, unknown>[] };
const pedido = (i: IntercambioErp) => ({
  localId: (i.pedido.alcance as { localId: number }).localId,
  desde: ((i.pedido.parametros as { desde?: never }).desde ?? null) as never,
  limite: (i.pedido.parametros as { limite?: number }).limite ?? 50,
});

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

describe("compras_saldo_eventos: lo que viaja es lo que el ERP aceptó", () => {
  for (const nombre of ["pagina1", "pagina2", "vacia", "completa", "deCentro"] as const) {
    it(`${nombre}: los bytes son los del fixture, y la respuesta del ERP pasa entera`, async () => {
      const i = F[nombre];
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().comprasSaldoEventos(TOKEN_PRUEBA, entradaDe(i));
      assert.equal(erp.recibidas.length, 1);
      // Este fixture se grabó con el orden de claves del cliente de Azul Chat: se compara byte a byte.
      assert.equal(erp.recibidas[0]!.cuerpo.toString("utf8"), pedidoConToken(i, TOKEN_PRUEBA));
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(r.datos, i.respuesta.cuerpo.datos);
    });
  }

  it("los rechazos del ERP vuelven con su código, sin inventar otro", async () => {
    for (const [nombre, codigo] of [["sinPermiso", "NO_AUTORIZADO"], ["limiteFueraDeRango", "SOLICITUD_INVALIDA"]] as const) {
      const i = F[nombre];
      manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
      const r = await cliente().comprasSaldoEventos(TOKEN_PRUEBA, { alcance: i.pedido.alcance });
      assert.ok(!r.ok && r.origen === "erp" && r.codigo === codigo, nombre);
    }
  });

  it("una entrada que el ERP rechazaría no se manda: límite fuera de rango, desde con una clave de más o con el cursor de otra capacidad", async () => {
    manejador = () => assert.fail("no tenía que llamar");
    const alcance = F.pagina1.pedido.alcance;
    const desde = (F.pagina2.pedido.parametros as { desde: Record<string, unknown> }).desde;
    for (const entrada of [
      { alcance, limite: 101 },
      { alcance, limite: 0 },
      { alcance, desde: { ...desde, extra: 1 } },
      { alcance, desde: { fechaSolicitud: desde.confirmadoEn, pedidoId: 6 } },
      { alcance, otro: 1 },
    ]) {
      assert.equal(construirCuerpoEventos(contrato, TOKEN_PRUEBA, entrada), null, JSON.stringify(entrada));
      const r = await cliente().comprasSaldoEventos(TOKEN_PRUEBA, entrada);
      assert.ok(!r.ok && r.origen === "local" && r.codigo === "SOLICITUD_INVALIDA");
    }
    assert.equal(erp.recibidas.length, 0);
  });

  it("mi_alcance del ERP la anuncia solo a quien tiene finanzas.ver: al cajero no", () => {
    const de = (k: "tesoreria" | "cajero" | "adminGlobal") => FIXTURES_ERP_FD1BCA1.miAlcance[k].respuesta.cuerpo.datos as DatosMiAlcance;
    for (const k of ["tesoreria", "cajero", "adminGlobal"] as const) assert.ok(esDatosMiAlcance(de(k)), k);
    assert.ok(anunciaCapacidad(de("tesoreria").locales[0]!, "compras_saldo_eventos"));
    assert.ok(!anunciaCapacidad(de("cajero").locales[0]!, "compras_saldo_eventos"));
    assert.equal(TIPO_DE_CAPACIDAD.compras_saldo_eventos, "COMPRA_CON_SALDO");
  });
});

describe("compras_saldo_eventos: una página se acepta entera o no se acepta", () => {
  it("las respuestas reales pasan", () => {
    for (const nombre of ["pagina1", "pagina2", "vacia", "completa", "deCentro"] as const) {
      const i = F[nombre];
      assert.ok(esDatosComprasSaldoEventos(i.respuesta.cuerpo.datos), nombre);
      assert.ok(validarPaginaDe(contrato, i.respuesta.cuerpo.datos, pedido(i)).ok, nombre);
    }
  });

  it("UNA cosa rota, la página entera es inválida, con su motivo", () => {
    const i = F.pagina1;
    const roturas: [string, (d: ReturnType<typeof datosDe>) => void][] = [
      ["clave que no es la del ERP", (d) => (d.eventos[0]!.eventoId = `${String(d.eventos[0]!.eventoId)}x`)],
      ["otro tipo", (d) => (d.eventos[0]!.tipo = "PEDIDO_SOLICITADO")],
      ["fecha sin milisegundos", (d) => (d.eventos[0]!.confirmadoEn = "2026-10-15T09:00:00Z")],
      ["sin texto", (d) => (d.eventos[0]!.texto = "")],
      ["texto que no es texto", (d) => (d.eventos[0]!.texto = 5)],
      ["monto negativo", (d) => (d.eventos[0]!.saldo = -1)],
      ["monto con tres decimales", (d) => (d.eventos[0]!.total = 1.005)],
      ["monto de texto", (d) => (d.eventos[0]!.pagado = "100")],
      ["proveedor sin nombre", (d) => (d.eventos[0]!.proveedor = { id: 41 })],
      ["pedido de texto", (d) => (d.eventos[0]!.pedidoId = "501")],
      ["fuera de orden", (d) => d.eventos.reverse()],
      ["más nuevo que hasta", (d) => (d.hasta = "2026-10-01T00:00:00.000Z")],
      ["siguiente distinto del último", (d) => ((d.siguiente as Record<string, unknown>).compraConSaldoId = 999)],
      ["otra capacidad", (d) => (d.capacidad = "pedidos_eventos")],
      ["otra versión", (d) => (d.version = 2)],
    ];
    for (const [que, romper] of roturas) {
      const d = datosDe(i);
      romper(d);
      const r = validarPaginaDe(contrato, d, pedido(i));
      assert.ok(!r.ok && r.motivo === "FORMA", que);
    }
    // La página de Centro contestada a un pedido de Casiano: otro local, no se guarda.
    const deCentro = validarPaginaDe(contrato, F.deCentro.respuesta.cuerpo.datos, pedido(F.completa));
    assert.ok(!deCentro.ok && deCentro.motivo === "OTRO_LOCAL");
    // El primer evento no avanza sobre el desde pedido.
    const atrasada = validarPaginaDe(contrato, F.pagina1.respuesta.cuerpo.datos, pedido(F.pagina2));
    assert.ok(!atrasada.ok && atrasada.motivo === "NO_AVANZA");
  });
});

describe("compras_saldo_eventos: la fila, el payload y el texto", () => {
  const real = (F.completa.respuesta.cuerpo.datos as DatosComprasSaldoEventos).eventos[1]!;

  it("guarda exactamente sus campos y el local pedido; un campo de más del ERP no entra", () => {
    const fila = aFilaCompraConSaldo({ ...real, confirmadoPor: "Ana", permisos: ["*"], proveedor: { ...real.proveedor!, cuit: "1" } } as typeof real, 3);
    assert.deepEqual(fila, {
      tipo: "COMPRA_CON_SALDO",
      claveExterna: real.eventoId,
      erpLocalId: 3,
      erpReferenciaId: real.compraConSaldoId,
      fechaOperacion: new Date(real.confirmadoEn),
      payloadVersion: 1,
      payload: { pedidoId: real.pedidoId, proveedor: real.proveedor, total: real.total, pagado: real.pagado, saldo: real.saldo, texto: real.texto },
    } satisfies FilaEvento);
    assert.ok(esPayloadCompraConSaldoV1(fila.payload));
    assert.ok(!esPayloadCompraConSaldoV1({ ...fila.payload, extra: 1 }));
  });

  it("una clave repetida: igual si cuenta lo mismo, foto distinta si cambió algo, contradicción si cambió el local", () => {
    const fila = aFilaCompraConSaldo(real, 3);
    const guardado = (f: FilaEvento): EventoGuardado => ({ ...f, tipo: f.tipo as string });
    assert.equal(clasificarRepetido(guardado(fila), aFilaCompraConSaldo(structuredClone(real), 3)), "IGUAL");
    assert.equal(clasificarRepetido(guardado(fila), aFilaCompraConSaldo({ ...real, texto: `${real.texto}.` }, 3)), "CONTENIDO_DIFERENTE");
    assert.equal(clasificarRepetido(guardado(fila), aFilaCompraConSaldo({ ...real, saldo: real.saldo + 1 }, 3)), "CONTENIDO_DIFERENTE");
    assert.equal(clasificarRepetido(guardado(fila), aFilaCompraConSaldo(real, 20)), "IDENTIDAD_CONTRADICTORIA");
  });

  it("el título (el de la tarjeta y el del push) es el texto del ERP, tal cual", () => {
    assert.equal(
      resumenDeEvento({ id: "1", fecha: real.confirmadoEn, historico: false, tipo: "COMPRA_CON_SALDO", pedidoId: real.pedidoId, proveedor: real.proveedor, texto: real.texto }),
      "Bebidas Norte: pedido $80.250,50 · pagado $30.000,00 · quedan $50.250,50 a deber",
    );
  });
});
