// CANDADOS DE GET /api/chats/ventas QUE NO NECESITAN BASE (Tanda 3A).
//
// La consulta se valida ANTES de leer la sesión: una clave de más, repetida o
// un localId que no es un entero positivo es 400 sin tocar la base ni el ERP.
// Y la respuesta pública se arma copiando, campo por campo, lo que dio el ERP,
// solo si es del local, el grupo y el período pedidos.
//
// El camino completo (sesión, `mi_alcance`, ventas, revocación) está en
// test/db/ventas.test.ts.

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { manejarVentas, ventasPublicas } from "../../src/server/chats/manejadores.ts";
import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import type { ClienteErp } from "../../src/server/erp/cliente.ts";
import { crearLimitador } from "../../src/server/http/limitador.ts";
import { NOMBRE_COOKIE } from "../../src/server/sesion/cookie.ts";
import type { DependenciasSesion } from "../../src/server/sesion/dependencias.ts";
import type { DatosVentasResumen } from "../../src/shared/erp/contrato.ts";
import { DATOS_ERP, type Rompible } from "../ayuda/servidorErp.ts";

const ORIGEN = "https://chat.ejemplo.invalid";

/** Un ERP que no se puede llamar: si una solicitud inválida llega hasta él, el test se cae. */
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
    // Sin base: lo que se prueba acá tiene que contestar antes de necesitarla.
    db: null,
    erp: erpIntocable,
    limitador: crearLimitador({ maxPorIp: 1000, maxPorProceso: 1000 }),
    ahora: Date.now,
    registrar: () => {},
    generarRequestId: randomUUID,
  };
}

const ventas = async (consulta: string, cookie: string | null = "x".repeat(43)) => {
  const res = await manejarVentas(new Request(`${ORIGEN}/api/chats/ventas${consulta}`, { headers: cookie ? { cookie: `${NOMBRE_COOKIE}=${cookie}` } : {} }), deps());
  return { status: res.status, cuerpo: (await res.json()) as unknown };
};

describe("GET /api/chats/ventas: la consulta", () => {
  it("3A-400. período fijo: cualquier clave de más, repetida o mal formada es 400 SOLICITUD_INVALIDA, sin sesión ni ERP", async () => {
    for (const q of [
      "",
      "?",
      "?localId=",
      "?localId=0",
      "?localId=-3",
      "?localId=3.5",
      "?localId=abc",
      "?localId=03",
      "?localId=12345678901",
      "?localId=3&periodo=ayer",
      "?localId=3&periodo=hoy",
      "?localId=3&grupoId=1",
      "?localId=3&localId=3",
      "?localId=3&cursor=x",
      "?localid=3",
    ]) {
      assert.deepEqual(await ventas(q), { status: 400, cuerpo: { estado: "SOLICITUD_INVALIDA" } }, q);
    }
  });

  it("sin cookie: 401 SIN_SESION, sin base ni ERP", async () => {
    assert.deepEqual(await ventas("?localId=3", null), { status: 401, cuerpo: { estado: "SIN_SESION" } });
  });
});

describe("GET /api/chats/ventas: lo que ve el navegador", () => {
  const CASIANO = { localId: 3, grupoId: 1, nombre: "Casiano", esDeposito: false } as const;
  const datos = () => structuredClone(DATOS_ERP) as unknown as Rompible<DatosVentasResumen>;

  it("copia los números del ERP tal cual, con el nombre de mi_alcance, y nada más", () => {
    const r = ventasPublicas(datos() as DatosVentasResumen, CASIANO);
    assert.deepEqual(r, {
      estado: "OK",
      local: { id: 3, nombre: "Casiano" },
      periodo: { desde: "2026-10-06", hasta: "2026-10-06" },
      cantidadVentas: 2,
      totalVendido: "1500.00",
      mediosDePago: [
        { medio: "EFECTIVO", etiqueta: "Efectivo", total: "1000.00", cantidadPagos: 1 },
        { medio: "MERCADOPAGO", etiqueta: "Mercado Pago", total: "500.00", cantidadPagos: 1 },
      ],
      advertencias: [{ codigo: "DIA_EN_CURSO", mensaje: "El período incluye el día de hoy, que todavía no terminó: el total puede crecer." }],
    });
    // Ni el grupo, ni la zona, ni la versión del contrato: lo que la tarjeta no usa no sale.
    assert.equal(JSON.stringify(r).includes("grupoId"), false);
    assert.equal(JSON.stringify(r).includes("zonaHoraria"), false);
  });

  it("un campo de más en un medio o una advertencia no viaja", () => {
    const d = datos();
    (d.mediosDePago[0] as Record<string, unknown>).interno = 99;
    (d.advertencias[0] as Record<string, unknown>).detalle = "x";
    const r = ventasPublicas(d as DatosVentasResumen, CASIANO);
    assert.ok(r);
    assert.deepEqual(Object.keys(r.mediosDePago[0]!), ["medio", "etiqueta", "total", "cantidadPagos"]);
    assert.deepEqual(Object.keys(r.advertencias[0]!), ["codigo", "mensaje"]);
  });

  it("si no es del local, del grupo o del período pedidos, no se muestra nada", () => {
    const otroLocal = datos();
    otroLocal.local.id = 9;
    const otroGrupo = datos();
    otroGrupo.grupoId = 2;
    const ayer = datos();
    ayer.periodo.tipo = "ayer";
    for (const d of [otroLocal, otroGrupo, ayer]) assert.equal(ventasPublicas(d as DatosVentasResumen, CASIANO), null);
  });
});
