// CANDADOS DE STOCK QUE NO NECESITAN BASE (Tanda 8B).
//
//   · GET /api/chats/stock valida la consulta ANTES de leer la sesión;
//   · la respuesta pública se arma copiando campo por campo lo que dio el ERP,
//     y solo si es del local, el grupo, el modo y el texto pedidos;
//   · STOCK_MINIMO_NO_DISPONIBLE se reconoce por su CÓDIGO;
//   · la intención de la IA se valida: modo del catálogo, texto de 2 a 60, el
//     stock de ahora, un local con `stock_consulta`;
//   · lo que se guarda pide `stock_consulta` para mostrarse.
//
// Los datos son los del fixture del ERP 41f702b (test/fixtures/erp-41f702b.json).

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { manejarStock } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import type { ClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { cumpleRequisitos, requisitosDe } from "../../src/server/preguntas/guardadas.ts";
import { esquemaDeIntencion, instruccionesDeIntencion, validarIntencion, type LocalesDeHoy } from "../../src/server/preguntas/intencion.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import { bajoMinimoPublico, esSinMinimo, productosPublicos, sinMinimoPublico } from "../../src/server/stock/stockConsulta.ts";
import type { DatosStockConsulta } from "../../src/shared/erp/contrato.ts";
import { FIXTURES_ERP_41F702B, type CasosStockProducto } from "../ayuda/servidorErp.ts";
import { bajoMinimoDelFixture, productosDelFixture } from "../ayuda/stock.ts";

const ORIGEN = "https://chat.ejemplo.invalid";
const F = FIXTURES_ERP_41F702B;
const datos = (d: unknown) => structuredClone(d) as DatosStockConsulta;
const LOCAL_FIXTURE = { localId: 1, grupoId: 1, nombre: "Local Centro" };

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

describe("GET /api/chats/stock: la consulta", () => {
  it("sin localId, con uno raro o con claves de más (modo, texto): 400 sin tocar ni la sesión ni el ERP", async () => {
    for (const q of ["", "?localId=0", "?localId=abc", "?localId=3&localId=4", "?localId=3&modo=producto", "?localId=3&texto=leche"]) {
      const res = await manejarStock(new Request(`${ORIGEN}/api/chats/stock${q}`), deps());
      assert.equal(res.status, 400, q);
      assert.deepEqual(await res.json(), { estado: "SOLICITUD_INVALIDA" });
    }
  });
});

describe("la respuesta pública copia lo del ERP, campo por campo", () => {
  it("bajo mínimo: exactamente la forma pública del fixture, con el nombre de hoy", () => {
    const d = datos(F.bajoMinimo.conFaltantes.respuesta.cuerpo.datos);
    assert.deepEqual(bajoMinimoPublico(d, LOCAL_FIXTURE), bajoMinimoDelFixture());
    assert.deepEqual(bajoMinimoPublico(d, { ...LOCAL_FIXTURE, nombre: "Centro (hoy)" })?.local, { id: 1, nombre: "Centro (hoy)" });
  });

  it("cada búsqueda del fixture: exactamente la forma pública", () => {
    for (const caso of Object.keys(F.producto) as (keyof CasosStockProducto)[]) {
      const d = datos(F.producto[caso].respuesta.cuerpo.datos);
      assert.deepEqual(productosPublicos(d, { localId: d.local.id, grupoId: d.grupoId, nombre: d.local.nombre, texto: d.texto! }), productosDelFixture(caso), caso);
    }
  });

  it("CONTRAPRUEBA: de otro local, otro grupo, otro modo u otro texto, no se muestra", () => {
    const bajo = datos(F.bajoMinimo.conFaltantes.respuesta.cuerpo.datos);
    const leche = datos(F.producto.variasCoincidencias.respuesta.cuerpo.datos);
    assert.equal(bajoMinimoPublico(bajo, { ...LOCAL_FIXTURE, localId: 2 }), null);
    assert.equal(bajoMinimoPublico(bajo, { ...LOCAL_FIXTURE, grupoId: 2 }), null);
    assert.equal(bajoMinimoPublico(leche, LOCAL_FIXTURE), null);
    assert.equal(productosPublicos(bajo, { ...LOCAL_FIXTURE, texto: "leche" }), null);
    assert.equal(productosPublicos(leche, { ...LOCAL_FIXTURE, texto: "queso" }), null);
    assert.ok(productosPublicos(leche, { ...LOCAL_FIXTURE, texto: "leche" }));
  });

  it("sin mínimo: por el CÓDIGO del ERP, no por su texto", () => {
    const real = F.bajoMinimo.stockMinimoNoDisponible.respuesta.cuerpo as { codigo: string; error: string };
    assert.equal(esSinMinimo({ ok: false, origen: "erp", codigo: "STOCK_MINIMO_NO_DISPONIBLE", status: 409, requestId: "r" }), true);
    assert.equal(real.codigo, "STOCK_MINIMO_NO_DISPONIBLE");
    // El mismo texto con otro código no es "sin mínimo".
    assert.equal(esSinMinimo({ ok: false, origen: "erp", codigo: "ERROR_AL_CALCULAR", status: 500, requestId: "r", mensajeErp: real.error }), false);
    assert.equal(esSinMinimo({ ok: false, origen: "local", codigo: "TIEMPO_AGOTADO", requestId: "r" }), false);
    assert.deepEqual(sinMinimoPublico(LOCAL_FIXTURE), { local: { id: 1, nombre: "Local Centro" }, sinMinimo: true });
  });
});

describe("la intención de stock", () => {
  const HOY = "2026-10-12";
  const LOCALES: LocalesDeHoy = {
    eventos: [],
    ventas: [{ localId: 1, grupoId: 1, nombre: "Centro" }],
    caja: [],
    stock: [
      { localId: 1, grupoId: 1, nombre: "Centro" },
      { localId: 2, grupoId: 1, nombre: "Depósito" },
    ],
  };
  const salida = (o: Record<string, unknown>) => ({
    intencion: "stock",
    tipoEvento: null,
    local: "Centro",
    periodo: "hoy",
    desde: null,
    hasta: null,
    turno: null,
    modoStock: "producto",
    producto: "leche",
    restriccionesNoSoportadas: [],
    ...o,
  });

  it("un producto en un local: el texto tal como lo escribió la persona, sin espacios de los bordes", () => {
    const i = validarIntencion(salida({ producto: "  Leche Descremada " }), HOY, LOCALES);
    assert.deepEqual(i, { tipo: "STOCK", locales: [LOCALES.stock[0]], todos: false, modo: "producto", texto: "Leche Descremada" });
  });

  it("bajo mínimo de todos: cada local con stock_consulta, sin texto", () => {
    const i = validarIntencion(salida({ modoStock: "bajo_minimo", producto: null, local: "todos" }), HOY, LOCALES);
    assert.deepEqual(i, { tipo: "STOCK", locales: LOCALES.stock, todos: true, modo: "bajo_minimo", texto: null });
  });

  it("lo que no cierra es NO_ENTIENDO", () => {
    for (const [nombre, o] of [
      ["texto de una letra", { producto: "l" }],
      ["texto de 61", { producto: "x".repeat(61) }],
      ["producto sin texto", { producto: null }],
      ["bajo mínimo con texto", { modoStock: "bajo_minimo" }],
      ["otro modo", { modoStock: "todo" }],
      ["stock de ayer", { periodo: "ayer" }],
      ["stock de un rango", { periodo: "rango", desde: HOY, hasta: HOY }],
      ["con turno", { turno: "tarde" }],
      ["con tipo de evento", { tipoEvento: "recibidas" }],
      ["un local sin stock_consulta", { local: "Norte" }],
      ["sin las claves nuevas", { modoStock: undefined }],
    ] as const) {
      const crudo = salida(o as Record<string, unknown>) as Record<string, unknown>;
      if ("modoStock" in o && o.modoStock === undefined) delete crudo.modoStock;
      assert.deepEqual(validarIntencion(crudo, HOY, LOCALES), { tipo: "NO_ENTIENDO" }, nombre);
    }
    // CONTRAPRUEBA: 2 y 60 caracteres sí.
    for (const producto of ["ab", "x".repeat(60)]) assert.equal(validarIntencion(salida({ producto }), HOY, LOCALES).tipo, "STOCK");
  });

  it("en las otras intenciones, modoStock y producto van en null", () => {
    const ventas = { ...salida({ intencion: "ventas" }), modoStock: null, producto: null };
    assert.equal(validarIntencion(ventas, HOY, LOCALES).tipo, "VENTAS");
    assert.equal(validarIntencion({ ...ventas, producto: "leche" }, HOY, LOCALES).tipo, "NO_ENTIENDO");
    assert.equal(validarIntencion({ ...ventas, modoStock: "producto" }, HOY, LOCALES).tipo, "NO_ENTIENDO");
  });

  it("a la IA no le llega ningún dato del stock: el esquema ofrece la intención y el texto libre, nada más", () => {
    const esquema = esquemaDeIntencion(["Centro"]);
    assert.ok(esquema.properties.intencion.enum.includes("stock"));
    assert.deepEqual(esquema.properties.modoStock.enum, ["producto", "bajo_minimo"]);
    const instrucciones = instruccionesDeIntencion({ pregunta: "¿cuánta leche hay?", hoy: "2026-10-12", localActual: "Centro", nombres: ["Centro"] });
    for (const dato of ["Leche Descremada", "30 uds", "stockMinimo", "bultos", "7790001"]) assert.ok(!instrucciones.includes(dato), dato);
  });
});

describe("lo que se guarda pide stock_consulta para mostrarse", () => {
  it("requisitos de una respuesta de stock, y el alcance de hoy los cumple o no", () => {
    const intencion = { tipo: "STOCK", locales: [{ localId: 3, grupoId: 1, nombre: "Casiano" }], todos: false, modo: "bajo_minimo", texto: null } as const;
    const respuesta = { estado: "STOCK", modo: "bajo_minimo", alcance: "LOCAL", resultado: bajoMinimoDelFixture({ id: 3, nombre: "Casiano" }) } as const;
    const req = requisitosDe(intencion, respuesta);
    assert.deepEqual(req, [{ localId: 3, capacidad: "stock_consulta" }]);
    const hoy = (conStock: number[]) => ({ autorizados: [], conVentas: [{ localId: 3 }], conCaja: [{ localId: 3 }], conStock: conStock.map((localId) => ({ localId })) });
    assert.equal(cumpleRequisitos(req, hoy([3])), true);
    assert.equal(cumpleRequisitos(req, hoy([])), false, "con ventas y caja pero sin stock_consulta, no");
  });
});
