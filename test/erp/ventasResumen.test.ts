import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_DIAS_RANGO, construirCuerpoVentasResumen } from "../../src/server/erp/ventasResumen.ts";
import { ENTRADA_HOY, VINCULO_PRUEBA } from "../ayuda/servidorErp.ts";

const con = (cambios: Record<string, unknown>) => ({ ...ENTRADA_HOY, ...cambios });
const codigo = (entrada: unknown) => {
  const r = construirCuerpoVentasResumen(entrada);
  return r.ok ? "OK" : r.codigo;
};

describe("contrato ventas_resumen: el cuerpo", () => {
  it("arma exactamente la forma del ERP, con la capacidad fija", () => {
    const r = construirCuerpoVentasResumen(ENTRADA_HOY);
    assert.ok(r.ok);
    assert.equal(
      JSON.stringify(r.cuerpo),
      `{"capacidad":"ventas_resumen","delegacion":{"usuarioId":7,"vinculo":"${VINCULO_PRUEBA}"},"alcance":{"grupoId":1,"localId":3},"parametros":{"periodo":{"tipo":"hoy"}}}`,
    );
  });

  it("es JSON canónico: re-serializarlo da el mismo texto (lo que exige el ERP)", () => {
    const r = construirCuerpoVentasResumen(con({ periodo: { tipo: "rango", desde: "2026-09-01", hasta: "2026-09-30" } }));
    assert.ok(r.ok);
    const texto = JSON.stringify(r.cuerpo);
    assert.equal(JSON.stringify(JSON.parse(texto)), texto);
  });

  it("la capacidad no se puede elegir desde la entrada", () => {
    assert.equal(codigo(con({ capacidad: "caja_resumen" })), "SOLICITUD_INVALIDA");
  });
});

describe("contrato ventas_resumen: claves extra", () => {
  it("rechaza claves extra en la raíz", () => {
    assert.equal(codigo(con({ endpoint: "/api/usuarios" })), "SOLICITUD_INVALIDA");
  });
  it("rechaza claves extra en delegación", () => {
    assert.equal(codigo(con({ delegacion: { usuarioId: 7, vinculo: VINCULO_PRUEBA, rol: "admin" } })), "SOLICITUD_INVALIDA");
  });
  it("rechaza claves extra en alcance", () => {
    assert.equal(codigo(con({ alcance: { grupoId: 1, localId: 3, where: {} } })), "SOLICITUD_INVALIDA");
  });
  it("rechaza claves extra en el período", () => {
    assert.equal(codigo(con({ periodo: { tipo: "hoy", desde: "2026-10-01" } })), "PERIODO_INVALIDO");
    assert.equal(codigo(con({ periodo: { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-02", sql: "x" } })), "PERIODO_INVALIDO");
  });
  it("rechaza que falte una sección", () => {
    const { periodo: _p, ...sinPeriodo } = ENTRADA_HOY;
    void _p;
    assert.equal(codigo(sinPeriodo), "SOLICITUD_INVALIDA");
  });
  it("rechaza lo que no es un objeto plano", () => {
    for (const v of [null, undefined, 1, "x", [], Object.create(null)]) assert.equal(codigo(v), "SOLICITUD_INVALIDA");
  });
});

describe("contrato ventas_resumen: identificadores", () => {
  const malos = [0, -1, 1.5, "3", Number.NaN, Number.MAX_SAFE_INTEGER + 1, null, undefined];
  it("usuarioId tiene que ser entero positivo", () => {
    for (const v of malos) {
      assert.equal(codigo(con({ delegacion: { usuarioId: v, vinculo: VINCULO_PRUEBA } })), "SOLICITUD_INVALIDA", String(v));
    }
  });
  it("grupoId tiene que ser entero positivo", () => {
    for (const v of malos) assert.equal(codigo(con({ alcance: { grupoId: v, localId: 3 } })), "SOLICITUD_INVALIDA", String(v));
  });
  it("localId tiene que ser entero positivo", () => {
    for (const v of malos) assert.equal(codigo(con({ alcance: { grupoId: 1, localId: v } })), "SOLICITUD_INVALIDA", String(v));
  });
  it("vinculo tiene que ser texto no vacío", () => {
    for (const v of ["", 123, null, "x".repeat(257)]) {
      assert.equal(codigo(con({ delegacion: { usuarioId: 7, vinculo: v } })), "SOLICITUD_INVALIDA");
    }
  });
});

describe("contrato ventas_resumen: período", () => {
  it("hoy es válido", () => {
    assert.equal(codigo(con({ periodo: { tipo: "hoy" } })), "OK");
  });
  it("ayer es válido", () => {
    const r = construirCuerpoVentasResumen(con({ periodo: { tipo: "ayer" } }));
    assert.ok(r.ok);
    assert.deepEqual(r.cuerpo.parametros, { periodo: { tipo: "ayer" } });
  });
  it("un rango de un día y uno de 31 días son válidos", () => {
    assert.equal(codigo(con({ periodo: { tipo: "rango", desde: "2026-09-10", hasta: "2026-09-10" } })), "OK");
    assert.equal(MAX_DIAS_RANGO, 31);
    assert.equal(codigo(con({ periodo: { tipo: "rango", desde: "2026-08-01", hasta: "2026-08-31" } })), "OK");
  });
  it("un rango de 32 días se rechaza antes de llamar al ERP", () => {
    assert.equal(codigo(con({ periodo: { tipo: "rango", desde: "2026-08-01", hasta: "2026-09-01" } })), "PERIODO_DEMASIADO_LARGO");
  });
  it("un rango que empieza después de terminar es inválido", () => {
    assert.equal(codigo(con({ periodo: { tipo: "rango", desde: "2026-09-02", hasta: "2026-09-01" } })), "PERIODO_INVALIDO");
  });
  it("fechas que no existen o mal escritas son inválidas", () => {
    for (const [desde, hasta] of [
      ["2026-02-30", "2026-03-01"],
      ["2026-9-1", "2026-09-02"],
      ["2026-09-01T00:00:00Z", "2026-09-02"],
      [20260901, "2026-09-02"],
    ]) {
      assert.equal(codigo(con({ periodo: { tipo: "rango", desde, hasta } })), "PERIODO_INVALIDO", String(desde));
    }
  });
  it("un tipo que no es hoy, ayer ni rango es inválido", () => {
    for (const tipo of ["semana", "mes", "", undefined]) {
      assert.equal(codigo(con({ periodo: { tipo } })), "PERIODO_INVALIDO", String(tipo));
    }
  });
  it("el futuro NO se valida acá: es cuenta del ERP (día argentino)", () => {
    // Si este test se rompe porque alguien agregó la regla, la regla es del ERP: no duplicarla.
    assert.equal(codigo(con({ periodo: { tipo: "rango", desde: "2999-01-01", hasta: "2999-01-02" } })), "OK");
  });
});
