// CANDADOS DEL CONTRATO DE `pedidos_eventos`, `envios_eventos` Y
// `cancelaciones_eventos` (Tanda 4B).
//
// Todo contra el fixture generado EJECUTANDO la puerta del ERP en producción
// (erpmanual 76b9a71, copiado sin tocar en test/fixtures/erp-76b9a71.json):
// los bytes que manda Azul Chat tienen que ser exactamente los que el ERP
// aceptó, y lo que el ERP contestó tiene que pasar el validador. Las páginas
// rotas salen de una página real con UNA cosa cambiada a propósito.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { crearClienteErp, type ClienteErp } from "../../src/server/erp/cliente.ts";
import { construirCuerpoEventos } from "../../src/server/erp/eventos.ts";
import { INGESTA_CANCELACIONES, INGESTA_ENVIOS, INGESTA_PEDIDOS } from "../../src/server/eventos/capacidades.ts";
import { validarPaginaDe } from "../../src/server/eventos/pagina.ts";
import {
  aFilaPedidoSolicitado,
  aFilaTransferenciaCancelada,
  aFilaTransferenciaEnviada,
  esPayloadPedidoSolicitadoV1,
  esPayloadTransferenciaCanceladaV1,
  esPayloadTransferenciaEnviadaV1,
} from "../../src/server/eventos/pedidosEnviosCancelaciones.ts";
import { clasificarRepetido, type EventoGuardado } from "../../src/server/eventos/repetido.ts";
import type { FilaEvento } from "../../src/server/eventos/transferenciaRecibida.ts";
import {
  anunciaCapacidad,
  esDatosCancelacionesEventos,
  type ContratoEventos,
  esDatosEnviosEventos,
  esDatosMiAlcance,
  esDatosPedidosEventos,
  type DatosCancelacionesEventos,
  type DatosEnviosEventos,
  type DatosMiAlcance,
  type DatosPedidosEventos,
} from "../../src/shared/erp/contrato.ts";
import {
  FIXTURES_ERP_76B9A71,
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

const F = FIXTURES_ERP_76B9A71;
const CAPACIDADES = [
  { capacidad: "pedidos_eventos", metodo: "pedidosEventos", definicion: INGESTA_PEDIDOS, esDatos: esDatosPedidosEventos },
  { capacidad: "envios_eventos", metodo: "enviosEventos", definicion: INGESTA_ENVIOS, esDatos: esDatosEnviosEventos },
  { capacidad: "cancelaciones_eventos", metodo: "cancelacionesEventos", definicion: INGESTA_CANCELACIONES, esDatos: esDatosCancelacionesEventos },
] as const;

/** La entrada del cliente que corresponde al pedido del fixture. */
const entradaDe = (i: IntercambioErp) => {
  const p = i.pedido.parametros as { desde?: unknown; limite?: number };
  return { alcance: i.pedido.alcance, ...(p.desde ? { desde: p.desde } : {}), ...(p.limite !== undefined ? { limite: p.limite } : {}) };
};
const datosDe = (i: IntercambioErp) => structuredClone(i.respuesta.cuerpo.datos) as Rompible<Record<string, unknown>> & { eventos: Record<string, unknown>[] };

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

for (const { capacidad, metodo, definicion, esDatos } of CAPACIDADES) {
  const casos = F[capacidad];
  const contrato = definicion.contrato as unknown as ContratoEventos<string, object, object>;

  describe(`${capacidad}: lo que viaja es lo que el ERP aceptó`, () => {
    for (const nombre of ["pagina1", "pagina2", "vacia", "completa"] as const) {
      it(`${nombre}: el cuerpo es el del fixture, y la respuesta del ERP pasa entera`, async () => {
        const i = casos[nombre];
        manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
        const r = await cliente()[metodo](TOKEN_PRUEBA, entradaDe(i));
        assert.equal(erp.recibidas.length, 1);
        // Como OBJETO y no como bytes: el script del ERP que grabó este fixture
        // armó `parametros` con `limite` antes que `desde`, y Azul Chat manda
        // `desde` primero (el orden de transferencias_eventos, que sí se graba
        // con los bytes de Azul Chat en erp-25172fe.json). El ERP lee
        // `parametros` por nombre (cursorDeEventos.js, leerParametros): el
        // orden no cambia lo que acepta. Lo demás —claves, valores, ninguna de
        // más— tiene que ser idéntico.
        assert.deepEqual(JSON.parse(erp.recibidas[0]!.cuerpo.toString("utf8")), JSON.parse(pedidoConToken(i, TOKEN_PRUEBA)));
        assert.ok(r.ok, JSON.stringify(r));
        assert.deepEqual(r.datos, i.respuesta.cuerpo.datos);
      });
    }

    it("los rechazos del ERP vuelven con su código, sin inventar otro", async () => {
      for (const [nombre, codigo] of [["sinPermiso", "NO_AUTORIZADO"], ["limiteFueraDeRango", "SOLICITUD_INVALIDA"]] as const) {
        const i = casos[nombre];
        manejador = (_s, res) => responderJson(res, i.respuesta.status, i.respuesta.cuerpo);
        const r = await cliente()[metodo](TOKEN_PRUEBA, { alcance: i.pedido.alcance });
        assert.ok(!r.ok && r.origen === "erp" && r.codigo === codigo, nombre);
      }
    });

    it("una entrada que el ERP rechazaría no se manda: límite fuera de rango, desde con una clave de más o con las de otra capacidad", async () => {
      manejador = () => assert.fail("no tenía que llamar");
      const alcance = casos.pagina1.pedido.alcance;
      const desde = (casos.pagina2.pedido.parametros as { desde: Record<string, unknown> }).desde;
      const ajeno = capacidad === "pedidos_eventos" ? { fechaEnvio: "2026-10-10T23:48:23.528Z", transferenciaId: 5 } : { fechaSolicitud: "2026-10-10T23:48:23.528Z", pedidoId: 6 };
      for (const entrada of [
        { alcance, limite: 101 },
        { alcance, limite: 0 },
        { alcance, desde: { ...desde, extra: 1 } },
        { alcance, desde: ajeno },
        { alcance, otro: 1 },
      ]) {
        assert.equal(construirCuerpoEventos(contrato, TOKEN_PRUEBA, entrada), null, JSON.stringify(entrada));
        const r = await cliente()[metodo](TOKEN_PRUEBA, entrada);
        assert.ok(!r.ok && r.origen === "local" && r.codigo === "SOLICITUD_INVALIDA");
      }
      assert.equal(erp.recibidas.length, 0);
    });
  });

  describe(`${capacidad}: una página se acepta entera o no se acepta`, () => {
    const pedido = (i: IntercambioErp) => ({
      localId: (i.pedido.alcance as { localId: number }).localId,
      desde: ((i.pedido.parametros as { desde?: never }).desde ?? null) as never,
      limite: (i.pedido.parametros as { limite?: number }).limite ?? 50,
    });

    it("las respuestas reales pasan", () => {
      for (const nombre of ["pagina1", "pagina2", "vacia", "completa"] as const) {
        const i = casos[nombre];
        assert.ok(esDatos(i.respuesta.cuerpo.datos), nombre);
        assert.ok(validarPaginaDe(contrato, i.respuesta.cuerpo.datos, pedido(i)).ok, nombre);
      }
    });

    it("UNA cosa rota, la página entera es inválida, con su motivo", () => {
      const i = casos.pagina2;
      const campoFecha = contrato.campoFecha;
      const campoId = contrato.campoId;
      const roturas: [string, (d: ReturnType<typeof datosDe>) => void][] = [
        ["clave que no es la del ERP", (d) => (d.eventos[0]!.eventoId = `${String(d.eventos[0]!.eventoId)}x`)],
        ["otro tipo", (d) => (d.eventos[0]!.tipo = "TRANSFERENCIA_RECIBIDA")],
        ["fecha sin milisegundos", (d) => (d.eventos[0]![campoFecha] = "2026-10-10T23:48:23Z")],
        ["origen sin nombre", (d) => (d.eventos[0]!.origen = { id: 1 })],
        ["fuera de orden", (d) => d.eventos.reverse()],
        ["más nuevo que hasta", (d) => (d.hasta = "2026-10-01T00:00:00.000Z")],
        ["siguiente distinto del último", (d) => ((d.siguiente as Record<string, unknown>)[campoId] = 999)],
        ["siguiente con una clave de más", (d) => ((d.siguiente as Record<string, unknown>).extra = 1)],
        ["otra capacidad", (d) => (d.capacidad = "transferencias_eventos")],
        ["otra versión", (d) => (d.version = 2)],
      ];
      if (capacidad !== "cancelaciones_eventos") roturas.push(["líneas negativas", (d) => (d.eventos[0]!.lineas = -1)]);
      if (capacidad !== "pedidos_eventos") roturas.push(["pedidoId de texto", (d) => (d.eventos[0]!.pedidoId = "7")]);
      for (const [que, romper] of roturas) {
        const d = datosDe(i);
        romper(d);
        const r = validarPaginaDe(contrato, d, pedido(i));
        assert.ok(!r.ok && r.motivo === "FORMA", que);
      }
      const otroLocal = datosDe(i);
      otroLocal.local = { id: 99, nombre: "Otro" };
      const r = validarPaginaDe(contrato, otroLocal, pedido(i));
      assert.ok(!r.ok && r.motivo === "OTRO_LOCAL");
      // El primer evento no avanza sobre el desde pedido: la pagina1 contestada a un desde posterior.
      const atrasada = validarPaginaDe(contrato, casos.pagina1.respuesta.cuerpo.datos, pedido(i));
      assert.ok(!atrasada.ok && atrasada.motivo === "NO_AVANZA");
      // Una página vacía que no repite el desde pedido.
      const vacia = validarPaginaDe(contrato, casos.vacia.respuesta.cuerpo.datos, { ...pedido(casos.vacia), desde: null });
      assert.ok(!vacia.ok && vacia.motivo === "SIGUIENTE_DE_PAGINA_VACIA");
    });
  });
}

describe("los payloads se arman de cero y la fila es del local de la respuesta", () => {
  const pedidoReal = (F.pedidos_eventos.completa.respuesta.cuerpo.datos as DatosPedidosEventos).eventos[0]!;
  const envioReal = (F.envios_eventos.completa.respuesta.cuerpo.datos as DatosEnviosEventos).eventos[0]!;
  const cancelacionReal = (F.cancelaciones_eventos.completa.respuesta.cuerpo.datos as DatosCancelacionesEventos).eventos[0]!;

  it("cada tipo guarda exactamente sus campos, la referencia, la fecha y el local pedido; un campo de más del ERP no entra", () => {
    const p = aFilaPedidoSolicitado({ ...pedidoReal, permisos: ["*"] } as typeof pedidoReal, 2);
    assert.deepEqual(p, {
      tipo: "PEDIDO_SOLICITADO",
      claveExterna: pedidoReal.eventoId,
      erpLocalId: 2,
      erpReferenciaId: pedidoReal.pedidoId,
      fechaOperacion: new Date(pedidoReal.fechaSolicitud),
      payloadVersion: 1,
      payload: { origen: pedidoReal.origen, lineas: pedidoReal.lineas },
    } satisfies FilaEvento);
    const e = aFilaTransferenciaEnviada({ ...envioReal, extra: 1 } as typeof envioReal, 2);
    assert.deepEqual(e.payload, { origen: envioReal.origen, lineas: envioReal.lineas, pedidoId: envioReal.pedidoId });
    assert.equal(e.erpReferenciaId, envioReal.transferenciaId);
    assert.equal(e.fechaOperacion.toISOString(), envioReal.fechaEnvio);
    const c = aFilaTransferenciaCancelada({ ...cancelacionReal, motivo: "texto libre" } as typeof cancelacionReal, 2);
    assert.deepEqual(c.payload, { origen: cancelacionReal.origen, pedidoId: cancelacionReal.pedidoId });
    assert.equal(c.fechaOperacion.toISOString(), cancelacionReal.fechaCancelacion);
  });

  it("los guardianes de payload aceptan solo la forma exacta", () => {
    for (const [es, bueno] of [
      [esPayloadPedidoSolicitadoV1, { origen: { id: 1, nombre: "Depósito" }, lineas: 3 }],
      [esPayloadTransferenciaEnviadaV1, { origen: { id: 1, nombre: "Depósito" }, lineas: 3, pedidoId: null }],
      [esPayloadTransferenciaCanceladaV1, { origen: { id: 1, nombre: "Depósito" }, pedidoId: 7 }],
    ] as const) {
      assert.ok(es(bueno));
      assert.ok(!es({ ...bueno, extra: 1 }));
      assert.ok(!es({ ...bueno, origen: { ...bueno.origen, esDeposito: true } }));
      assert.ok(!es({}));
    }
  });
});

describe("una clave que vuelve, por tipo", () => {
  const guardado = (f: FilaEvento, payload: unknown = f.payload): EventoGuardado => ({
    tipo: f.tipo,
    erpLocalId: f.erpLocalId,
    erpReferenciaId: f.erpReferenciaId,
    fechaOperacion: new Date(f.fechaOperacion.getTime()),
    payloadVersion: f.payloadVersion,
    payload: structuredClone(payload),
  });
  const pedidoReal = (F.pedidos_eventos.completa.respuesta.cuerpo.datos as DatosPedidosEventos).eventos[0]!;
  const envioReal = (F.envios_eventos.completa.respuesta.cuerpo.datos as DatosEnviosEventos).eventos[0]!;

  it("PEDIDO_SOLICITADO con otra cantidad de líneas es IGUAL: lo esperado, no una diferencia", () => {
    const primera = aFilaPedidoSolicitado(pedidoReal, 2);
    const otraLectura = aFilaPedidoSolicitado({ ...pedidoReal, lineas: pedidoReal.lineas + 4 }, 2);
    assert.equal(clasificarRepetido(guardado(primera), otraLectura), "IGUAL");
    // El origen sí cuenta: un depósito renombrado es otra foto.
    const renombrado = aFilaPedidoSolicitado({ ...pedidoReal, origen: { ...pedidoReal.origen, nombre: "Otro nombre" } }, 2);
    assert.equal(clasificarRepetido(guardado(primera), renombrado), "CONTENIDO_DIFERENTE");
    // Y la identidad, siempre.
    assert.equal(clasificarRepetido(guardado(primera), aFilaPedidoSolicitado(pedidoReal, 3)), "IDENTIDAD_CONTRADICTORIA");
  });

  it("TRANSFERENCIA_ENVIADA con otra cantidad de líneas es CONTENIDO_DIFERENTE, como siempre", () => {
    const primera = aFilaTransferenciaEnviada(envioReal, 2);
    assert.equal(clasificarRepetido(guardado(primera), aFilaTransferenciaEnviada(envioReal, 2)), "IGUAL");
    assert.equal(clasificarRepetido(guardado(primera), aFilaTransferenciaEnviada({ ...envioReal, lineas: envioReal.lineas + 1 }, 2)), "CONTENIDO_DIFERENTE");
  });

  it("un payload guardado ilegible nunca es IGUAL", () => {
    const primera = aFilaPedidoSolicitado(pedidoReal, 2);
    assert.equal(clasificarRepetido(guardado(primera, { origen: pedidoReal.origen }), primera), "CONTENIDO_DIFERENTE");
  });
});

describe("mi_alcance de 76b9a71 anuncia las capacidades nuevas", () => {
  it("el encargado del fixture las tiene en su local, en el orden del catálogo", () => {
    const d = F.miAlcance.encargado.respuesta.cuerpo.datos as DatosMiAlcance;
    assert.ok(esDatosMiAlcance(d));
    const l = d.locales[0]!;
    for (const c of ["transferencias_eventos", "pedidos_eventos", "envios_eventos", "cancelaciones_eventos"]) assert.ok(anunciaCapacidad(l, c), c);
  });
});
