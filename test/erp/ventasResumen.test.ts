import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { construirCuerpoCanje } from "../../src/server/erp/canje.ts";
import { construirCuerpoMiAlcance } from "../../src/server/erp/miAlcance.ts";
import { MAX_DIAS_RANGO, construirCuerpoVentasResumen } from "../../src/server/erp/ventasResumen.ts";
import { CODIGO_PRUEBA, ENTRADA_HOY, TOKEN_PRUEBA } from "../ayuda/servidorErp.ts";

const con = (cambios: Record<string, unknown>) => ({ ...ENTRADA_HOY, ...cambios });
const codigo = (entrada: unknown, token = TOKEN_PRUEBA) => {
  const r = construirCuerpoVentasResumen(token, entrada);
  return r.ok ? "OK" : r.codigo;
};

describe("contrato ventas_resumen: el cuerpo", () => {
  it("32. arma exactamente la forma del ERP desplegado: delegacion.token, sin usuarioId", () => {
    const r = construirCuerpoVentasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.ok(r.ok);
    assert.equal(
      JSON.stringify(r.cuerpo),
      `{"capacidad":"ventas_resumen","delegacion":{"token":"${TOKEN_PRUEBA}"},"alcance":{"grupoId":1,"localId":3},"parametros":{"periodo":{"tipo":"hoy"}}}`,
    );
  });

  it("33. no hay forma de meter un usuarioId ni el código humano", () => {
    const r = construirCuerpoVentasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.ok(r.ok);
    assert.equal(/usuarioId|vinculo/.test(JSON.stringify(r.cuerpo)), false);
    assert.equal(codigo(con({ usuarioId: 9 })), "SOLICITUD_INVALIDA");
    assert.equal(codigo(con({ delegacion: { usuarioId: 9 } })), "SOLICITUD_INVALIDA");
  });

  it("el token tiene que tener la forma del ERP: un código humano no pasa por token", () => {
    for (const malo of [CODIGO_PRUEBA, "", "del1_corto", `${TOKEN_PRUEBA}x`]) {
      assert.equal(codigo(ENTRADA_HOY, malo), "SOLICITUD_INVALIDA", malo);
    }
  });

  it("es JSON canónico: re-serializarlo da el mismo texto (lo que exige el ERP)", () => {
    const r = construirCuerpoVentasResumen(TOKEN_PRUEBA, con({ periodo: { tipo: "rango", desde: "2026-09-01", hasta: "2026-09-30" } }));
    assert.ok(r.ok);
    const texto = JSON.stringify(r.cuerpo);
    assert.equal(JSON.stringify(JSON.parse(texto)), texto);
  });

  it("la capacidad no se puede elegir desde la entrada", () => {
    assert.equal(codigo(con({ capacidad: "caja_resumen" })), "SOLICITUD_INVALIDA");
  });
});

describe("contrato mi_alcance y canje: el cuerpo", () => {
  it("mi_alcance: capacidad, delegacion.token y parametros vacíos; SIN alcance", () => {
    assert.equal(
      JSON.stringify(construirCuerpoMiAlcance(TOKEN_PRUEBA)),
      `{"capacidad":"mi_alcance","delegacion":{"token":"${TOKEN_PRUEBA}"},"parametros":{}}`,
    );
    assert.equal(construirCuerpoMiAlcance(CODIGO_PRUEBA), null);
  });

  it("1. canje: exactamente { codigo }, solo con la forma vin1_ del ERP", () => {
    assert.equal(JSON.stringify(construirCuerpoCanje(CODIGO_PRUEBA)), `{"codigo":"${CODIGO_PRUEBA}"}`);
    for (const malo of [TOKEN_PRUEBA, "", "vin1_corto", 123, null, { codigo: CODIGO_PRUEBA }]) {
      assert.equal(construirCuerpoCanje(malo), null, String(malo));
    }
  });
});

describe("contrato ventas_resumen: claves extra", () => {
  it("rechaza claves extra en la raíz", () => {
    assert.equal(codigo(con({ endpoint: "/api/usuarios" })), "SOLICITUD_INVALIDA");
  });
  it("rechaza claves extra en alcance", () => {
    assert.equal(codigo(con({ alcance: { grupoId: 1, localId: 3, where: {} } })), "SOLICITUD_INVALIDA");
  });
  it("rechaza claves extra en el período", () => {
    assert.equal(codigo(con({ periodo: { tipo: "hoy", desde: "2026-10-01" } })), "PERIODO_INVALIDO");
    assert.equal(codigo(con({ periodo: { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-02", sql: "x" } })), "PERIODO_INVALIDO");
  });
  it("rechaza que falte una sección", () => {
    assert.equal(codigo({ alcance: ENTRADA_HOY.alcance }), "SOLICITUD_INVALIDA");
    assert.equal(codigo({ periodo: ENTRADA_HOY.periodo }), "SOLICITUD_INVALIDA");
  });
  it("rechaza lo que no es un objeto plano", () => {
    for (const v of [null, undefined, 1, "x", [], Object.create(null)]) assert.equal(codigo(v), "SOLICITUD_INVALIDA");
  });
});

describe("contrato ventas_resumen: identificadores", () => {
  const malos = [0, -1, 1.5, "3", Number.NaN, Number.MAX_SAFE_INTEGER + 1, null, undefined];
  it("grupoId tiene que ser entero positivo", () => {
    for (const v of malos) assert.equal(codigo(con({ alcance: { grupoId: v, localId: 3 } })), "SOLICITUD_INVALIDA", String(v));
  });
  it("localId tiene que ser entero positivo", () => {
    for (const v of malos) assert.equal(codigo(con({ alcance: { grupoId: 1, localId: v } })), "SOLICITUD_INVALIDA", String(v));
  });
});

describe("contrato ventas_resumen: período", () => {
  it("hoy es válido", () => {
    assert.equal(codigo(con({ periodo: { tipo: "hoy" } })), "OK");
  });
  it("ayer es válido", () => {
    const r = construirCuerpoVentasResumen(TOKEN_PRUEBA, con({ periodo: { tipo: "ayer" } }));
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
