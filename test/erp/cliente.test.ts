import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout as esperar } from "node:timers/promises";

import { RUTA_CANJEAR, RUTA_CONSULTAR, crearClienteErp, type DependenciasCliente } from "../../src/server/erp/cliente.ts";
import type { Registro } from "../../src/server/log.ts";
import { CODIGOS_ERROR_ERP } from "../../src/shared/erp/contrato.ts";
import {
  CODIGO_PRUEBA,
  DATOS_ERP,
  ENTRADA_HOY,
  FIXTURES_ERP,
  SECRETO_PRUEBA,
  TOKEN_PRUEBA,
  cuerpoCanjeExitoso,
  levantarServidorErp,
  responderErrorErp,
  responderJson,
  type Manejador,
  type ServidorErp,
} from "../ayuda/servidorErp.ts";

// El servidor de mentira contesta lo que diga `manejador`, que cada test cambia.
const porDefecto: Manejador = (_s, res) => responderJson(res, 200, { ok: true, datos: DATOS_ERP });
let manejador: Manejador = porDefecto;
let erp: ServidorErp;
let registros: Registro[];

before(async () => {
  erp = await levantarServidorErp((s, res) => manejador(s, res));
});
after(async () => {
  await erp.cerrar();
});
beforeEach(() => {
  erp.recibidas.length = 0;
  registros = [];
  manejador = porDefecto;
});

const AHORA_MS = 1_767_225_600_789;

function cliente(extra: DependenciasCliente = {}) {
  return crearClienteErp({
    entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA },
    ahora: () => AHORA_MS,
    registrar: (r) => registros.push(r),
    generarRequestId: () => "req-prueba",
    ...extra,
  });
}

/** El HMAC que calcula el ERP sobre los BYTES recibidos. */
const firmaEsperada = (marca: string, cuerpo: Buffer) =>
  createHmac("sha256", SECRETO_PRUEBA).update(`v1\nazul-chat\n${marca}\n`, "utf8").update(cuerpo).digest("hex");

describe("cliente ERP: lo que viaja", () => {
  it("ventas_resumen: POST a /consultar, con JSON y las tres cabeceras", async () => {
    const r = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.ok(r.ok);
    assert.equal(erp.recibidas.length, 1);
    const s = erp.recibidas[0]!;
    assert.equal(s.metodo, "POST");
    assert.equal(s.ruta, RUTA_CONSULTAR);
    assert.equal(RUTA_CONSULTAR, "/api/integraciones/azul-chat/consultar");
    assert.equal(s.cabeceras["content-type"], "application/json");
    assert.equal(s.cabeceras["x-erp-integracion-aplicacion"], "azul-chat");
  });

  it("la marca es el timestamp en segundos", async () => {
    await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(erp.recibidas[0]!.cabeceras["x-erp-integracion-marca"], "1767225600");
  });

  it("el cuerpo que llegó es el que se firmó, byte por byte", async () => {
    await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    const s = erp.recibidas[0]!;
    assert.equal(s.cabeceras["x-erp-integracion-firma"], firmaEsperada(String(s.cabeceras["x-erp-integracion-marca"]), s.cuerpo));
  });

  it("32 y 33. ventas_resumen viaja con delegacion.token y SIN usuarioId, canónico", async () => {
    await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    const texto = erp.recibidas[0]!.cuerpo.toString("utf8");
    assert.equal(JSON.stringify(JSON.parse(texto)), texto);
    assert.equal(/\s/.test(texto), false);
    assert.deepEqual(Object.keys(JSON.parse(texto)), ["capacidad", "delegacion", "alcance", "parametros"]);
    assert.deepEqual(JSON.parse(texto).delegacion, { token: TOKEN_PRUEBA });
    assert.equal(/usuarioId|vinculo/.test(texto), false);
  });

  it("no manda cookies ni Authorization", async () => {
    await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    const c = erp.recibidas[0]!.cabeceras;
    assert.equal(c.cookie, undefined);
    assert.equal(c.authorization, undefined);
  });

  it("expone exactamente siete operaciones: no hay forma de pedir otra ruta o capacidad", () => {
    // `transferenciasEventos` entró en la Tanda 2 (fundación): un método específico, no un cliente genérico.
    // `pedidosEventos`, `enviosEventos` y `cancelacionesEventos` entraron en la Tanda 4B, uno por capacidad.
    assert.deepEqual(Object.keys(cliente()).sort(), [
      "cancelacionesEventos",
      "canjear",
      "enviosEventos",
      "miAlcance",
      "pedidosEventos",
      "transferenciasEventos",
      "ventasResumen",
    ]);
    assert.ok(Object.isFrozen(cliente()));
  });

  it("no sigue redirecciones: la firma no viaja a otro lado", async () => {
    manejador = (_s, res) => {
      res.writeHead(307, { location: "http://127.0.0.1:1/otro" });
      res.end();
    };
    const r = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(r.ok, false);
    assert.equal(erp.recibidas.length, 1);
  });
});

describe("cliente ERP: canje", () => {
  it("1 y 8. POST a /vinculo/canjear, cuerpo exactamente { codigo }, firmado con HMAC", async () => {
    manejador = (_s, res) => responderJson(res, 200, cuerpoCanjeExitoso(TOKEN_PRUEBA));
    const r = await cliente().canjear(CODIGO_PRUEBA);
    assert.ok(r.ok);
    const s = erp.recibidas[0]!;
    assert.equal(s.ruta, RUTA_CANJEAR);
    assert.equal(RUTA_CANJEAR, "/api/integraciones/azul-chat/vinculo/canjear");
    assert.equal(s.cuerpo.toString("utf8"), `{"codigo":"${CODIGO_PRUEBA}"}`);
    assert.equal(s.cabeceras["x-erp-integracion-firma"], firmaEsperada(String(s.cabeceras["x-erp-integracion-marca"]), s.cuerpo));
  });

  it("devuelve la identidad que dice el ERP, con la forma de su respuesta real", async () => {
    manejador = (_s, res) => responderJson(res, FIXTURES_ERP.canje.status, cuerpoCanjeExitoso(TOKEN_PRUEBA));
    const r = await cliente().canjear(CODIGO_PRUEBA);
    assert.ok(r.ok);
    assert.deepEqual(r.datos, { ...FIXTURES_ERP.canje.cuerpo.datos, tokenDelegacion: TOKEN_PRUEBA });
  });

  it("2. CODIGO_NO_VALIDO del ERP llega con su código, no con su texto", async () => {
    manejador = (_s, res) => responderErrorErp(res, "CODIGO_NO_VALIDO");
    const r = await cliente().canjear(CODIGO_PRUEBA);
    assert.ok(!r.ok && r.origen === "erp");
    assert.equal(!r.ok && r.codigo, "CODIGO_NO_VALIDO");
    assert.equal(!r.ok && r.origen === "erp" && r.status, 403);
  });

  it("un código con otra forma no se manda: no gasta la llamada", async () => {
    for (const malo of [TOKEN_PRUEBA, "", "vin1_corto", 123, null]) {
      const r = await cliente().canjear(malo);
      assert.equal(!r.ok && r.codigo, "SOLICITUD_INVALIDA");
    }
    assert.equal(erp.recibidas.length, 0);
  });

  it("una respuesta de éxito sin un token con forma del1_ es RESPUESTA_INVALIDA", async () => {
    for (const token of [CODIGO_PRUEBA, "", "del1_x"]) {
      manejador = (_s, res) => responderJson(res, 200, cuerpoCanjeExitoso(token));
      const r = await cliente().canjear(CODIGO_PRUEBA);
      assert.equal(!r.ok && r.codigo, "RESPUESTA_INVALIDA", token);
    }
  });

  it("38. el canje no se reintenta: un fallo es UNA llamada", async () => {
    manejador = (_s, res) => responderErrorErp(res, "ERROR_AL_CALCULAR");
    await cliente().canjear(CODIGO_PRUEBA);
    await esperar(200);
    assert.equal(erp.recibidas.length, 1);
  });
});

describe("cliente ERP: mi_alcance", () => {
  it("27. viaja a /consultar con el token y SIN alcance; devuelve la forma real del ERP", async () => {
    manejador = (_s, res) => responderJson(res, 200, FIXTURES_ERP.miAlcance);
    const r = await cliente().miAlcance(TOKEN_PRUEBA);
    assert.ok(r.ok);
    assert.deepEqual(r.datos, FIXTURES_ERP.miAlcance.datos);
    const s = erp.recibidas[0]!;
    assert.equal(s.ruta, RUTA_CONSULTAR);
    assert.equal(s.cuerpo.toString("utf8"), `{"capacidad":"mi_alcance","delegacion":{"token":"${TOKEN_PRUEBA}"},"parametros":{}}`);
  });

  it("acepta el alcance GRUPO con su grupoId, y rechaza un modo que no es del contrato", async () => {
    manejador = (_s, res) => responderJson(res, 200, FIXTURES_ERP.miAlcanceGrupo);
    const r = await cliente().miAlcance(TOKEN_PRUEBA);
    assert.ok(r.ok);
    assert.deepEqual(r.datos.alcance, { modo: "GRUPO", grupoId: 2 });
    manejador = (_s, res) => responderJson(res, 200, { ok: true, datos: { ...FIXTURES_ERP.miAlcance.datos, alcance: { modo: "TODO" } } });
    assert.equal((await cliente().miAlcance(TOKEN_PRUEBA)).ok, false);
  });
});

describe("cliente ERP: fail closed", () => {
  it("sin secreto no hace ninguna llamada", async () => {
    let llamadas = 0;
    const c = cliente({
      entorno: { ERP_BASE_URL: erp.origen },
      fetch: async () => {
        llamadas++;
        return new Response("{}");
      },
    });
    for (const r of [await c.ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY), await c.canjear(CODIGO_PRUEBA), await c.miAlcance(TOKEN_PRUEBA)]) {
      assert.deepEqual(r, { ok: false, origen: "local", codigo: "INTEGRACION_NO_CONFIGURADA", requestId: "req-prueba" });
    }
    assert.equal(llamadas, 0);
    assert.equal(erp.recibidas.length, 0);
  });

  it("con secreto corto no hace ninguna llamada", async () => {
    const r = await cliente({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: "corto" } }).ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(!r.ok && r.codigo, "INTEGRACION_NO_CONFIGURADA");
    assert.equal(erp.recibidas.length, 0);
  });

  it("con solo AUTH_SECRET no hace ninguna llamada", async () => {
    const r = await cliente({ entorno: { ERP_BASE_URL: erp.origen, AUTH_SECRET: SECRETO_PRUEBA } }).ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(!r.ok && r.codigo, "INTEGRACION_NO_CONFIGURADA");
    assert.equal(erp.recibidas.length, 0);
  });

  it("una entrada inválida no llega al ERP", async () => {
    const r = await cliente().ventasResumen(TOKEN_PRUEBA, { ...ENTRADA_HOY, extra: 1 });
    assert.equal(!r.ok && r.codigo, "SOLICITUD_INVALIDA");
    assert.equal(erp.recibidas.length, 0);
  });

  it("un rango de más de 31 días no llega al ERP", async () => {
    const r = await cliente().ventasResumen(TOKEN_PRUEBA, { ...ENTRADA_HOY, periodo: { tipo: "rango", desde: "2026-01-01", hasta: "2026-03-01" } });
    assert.deepEqual(r, { ok: false, origen: "local", codigo: "PERIODO_DEMASIADO_LARGO", requestId: "req-prueba" });
    assert.equal(erp.recibidas.length, 0);
  });
});

describe("cliente ERP: respuestas", () => {
  it("éxito: devuelve los datos tal como los calculó el ERP", async () => {
    const r = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.deepEqual(r, { ok: true, datos: DATOS_ERP, requestId: "req-prueba" });
  });

  it("el contrato local tiene exactamente los códigos públicos del ERP desplegado", () => {
    assert.deepEqual([...CODIGOS_ERROR_ERP].sort(), Object.keys(FIXTURES_ERP.errores).sort());
  });

  it("cada código público del ERP llega sin perderse, con su status real", async () => {
    for (const codigo of CODIGOS_ERROR_ERP) {
      manejador = (_s, res) => responderErrorErp(res, codigo);
      const r = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
      assert.ok(!r.ok && r.origen === "erp", codigo);
      assert.equal(!r.ok && r.codigo, codigo);
      assert.equal(!r.ok && r.origen === "erp" && r.status, FIXTURES_ERP.errores[codigo]!.status, codigo);
    }
  });

  it("conserva referencia y reintentarEnSegundos", async () => {
    manejador = (_s, res) => responderErrorErp(res, "ERROR_AL_CALCULAR");
    const r1 = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(!r1.ok && r1.origen === "erp" && r1.referencia, FIXTURES_ERP.errores.ERROR_AL_CALCULAR!.cuerpo.referencia);
    manejador = (_s, res) => responderErrorErp(res, "LIMITE_EXCEDIDO");
    const r2 = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(!r2.ok && r2.origen === "erp" && r2.reintentarEnSegundos, 30);
  });

  it("la lógica decide por el código, no por el texto", async () => {
    manejador = (_s, res) => responderJson(res, 403, { ok: false, codigo: "NO_AUTORIZADO", error: "VINCULO_NO_VALIDO" });
    const r = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(!r.ok && r.codigo, "NO_AUTORIZADO");
  });

  it("un código que no está en el contrato no se inventa: RESPUESTA_INVALIDA", async () => {
    manejador = (_s, res) => responderJson(res, 418, { ok: false, codigo: "CODIGO_NUEVO" });
    const r = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.deepEqual(r, { ok: false, origen: "local", codigo: "RESPUESTA_INVALIDA", requestId: "req-prueba", status: 418 });
  });

  it("una respuesta que no es JSON o no cumple el contrato es RESPUESTA_INVALIDA", async () => {
    for (const responder of [
      ((_s, res) => {
        res.writeHead(502, { "content-type": "text/html" });
        res.end("<html>Bad gateway</html>");
      }) as Manejador,
      ((_s, res) => responderJson(res, 200, { ok: true, datos: { ...DATOS_ERP, totalVendido: 1500 } })) as Manejador,
      ((_s, res) => responderJson(res, 200, { ok: true, datos: { ...DATOS_ERP, version: 2 } })) as Manejador,
      ((_s, res) => responderJson(res, 200, [])) as Manejador,
    ]) {
      manejador = responder;
      const r = await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
      assert.equal(!r.ok && r.codigo, "RESPUESTA_INVALIDA");
    }
  });

  it("ERP caído: ERP_INALCANZABLE", async () => {
    const r = await cliente({ entorno: { ERP_BASE_URL: "http://127.0.0.1:1", AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA } }).ventasResumen(
      TOKEN_PRUEBA,
      ENTRADA_HOY,
    );
    assert.equal(!r.ok && r.codigo, "ERP_INALCANZABLE");
  });
});

describe("cliente ERP: timeout y reintentos", () => {
  it("si el ERP no contesta a tiempo, aborta con TIEMPO_AGOTADO", async () => {
    manejador = async (_s, res) => {
      await esperar(1000);
      if (!res.destroyed) responderJson(res, 200, { ok: true, datos: DATOS_ERP });
    };
    const inicio = performance.now();
    const r = await cliente({ timeoutMs: 100, ahora: Date.now }).ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    const duracion = performance.now() - inicio;
    assert.equal(!r.ok && r.codigo, "TIEMPO_AGOTADO");
    assert.ok(duracion < 900, `tardó ${duracion} ms: no abortó`);
  });

  it("el timeout también corta una respuesta que se queda a mitad del cuerpo", async () => {
    manejador = async (_s, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"ok":true,');
      await esperar(1000);
      if (!res.destroyed) res.end("}");
    };
    const r = await cliente({ timeoutMs: 100 }).ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(!r.ok && r.codigo, "TIEMPO_AGOTADO");
  });

  it("38. no reintenta: ni de inmediato ni después", async () => {
    manejador = (_s, res) => responderErrorErp(res, "ERROR_AL_CALCULAR");
    await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(erp.recibidas.length, 1);
    await esperar(300);
    assert.equal(erp.recibidas.length, 1);

    manejador = async (_s, res) => {
      await esperar(500);
      if (!res.destroyed) responderJson(res, 200, { ok: true, datos: DATOS_ERP });
    };
    erp.recibidas.length = 0;
    await cliente({ timeoutMs: 50 }).ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    await esperar(600);
    assert.equal(erp.recibidas.length, 1);
  });
});

describe("cliente ERP: logs", () => {
  const prohibidos = () => {
    const lista = [SECRETO_PRUEBA, TOKEN_PRUEBA, CODIGO_PRUEBA];
    for (const s of erp.recibidas) lista.push(String(s.cabeceras["x-erp-integracion-firma"]), s.cuerpo.toString("utf8"));
    return lista;
  };

  it("un renglón por llamada, con solo campos técnicos", async () => {
    await cliente().ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
    assert.equal(registros.length, 1);
    const r = registros[0]!;
    assert.ok(r.evento === "erp.consulta");
    assert.deepEqual(Object.keys(r).sort(), ["codigo", "duracionMs", "evento", "operacion", "requestId", "status"]);
    assert.equal(r.codigo, "OK");
    assert.equal(r.status, 200);
    assert.equal(r.operacion, "ventas_resumen");
  });

  it("4. ni en éxito ni en error contiene secreto, firma, código de canje, token ni cuerpo", async () => {
    const casos: [Manejador, (c: ReturnType<typeof cliente>) => Promise<unknown>][] = [
      [(_s, res) => responderJson(res, 200, { ok: true, datos: DATOS_ERP }), (c) => c.ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY)],
      [(_s, res) => responderErrorErp(res, "VINCULO_NO_VALIDO"), (c) => c.miAlcance(TOKEN_PRUEBA)],
      [(_s, res) => responderJson(res, 200, cuerpoCanjeExitoso(TOKEN_PRUEBA)), (c) => c.canjear(CODIGO_PRUEBA)],
      [(_s, res) => responderErrorErp(res, "CODIGO_NO_VALIDO"), (c) => c.canjear(CODIGO_PRUEBA)],
      [(_s, res) => responderJson(res, 200, { nada: true }), (c) => c.canjear(CODIGO_PRUEBA)],
    ];
    for (const [caso, llamar] of casos) {
      manejador = caso;
      erp.recibidas.length = 0;
      registros = [];
      await llamar(cliente());
      const texto = JSON.stringify(registros);
      for (const p of prohibidos()) assert.equal(texto.includes(p), false, `el log contiene ${p.slice(0, 12)}…`);
    }
  });

  it("el registrador por defecto escribe a consola sin datos sensibles", async () => {
    const capturado: string[] = [];
    const originales = { info: console.info, warn: console.warn, error: console.error, log: console.log };
    const capturar = (...a: unknown[]) => void capturado.push(a.map(String).join(" "));
    Object.assign(console, { info: capturar, warn: capturar, error: capturar, log: capturar });
    try {
      const c = crearClienteErp({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA } });
      await c.ventasResumen(TOKEN_PRUEBA, ENTRADA_HOY);
      manejador = (_s, res) => responderJson(res, 200, cuerpoCanjeExitoso(TOKEN_PRUEBA));
      await c.canjear(CODIGO_PRUEBA);
    } finally {
      Object.assign(console, originales);
    }
    assert.equal(capturado.length, 2);
    const texto = capturado.join("\n");
    for (const p of prohibidos()) assert.equal(texto.includes(p), false);
  });

  it("con configuración inválida dice qué regla falló, nunca el valor", async () => {
    await cliente({ entorno: { ERP_BASE_URL: erp.origen, AZUL_CHAT_INTEGRACION_SECRET: "corto-pero-secreto" } }).ventasResumen(
      TOKEN_PRUEBA,
      ENTRADA_HOY,
    );
    const r = registros[0]!;
    assert.ok(r.evento === "erp.consulta");
    assert.equal(r.motivo, "SECRETO_CORTO");
    assert.equal(JSON.stringify(registros).includes("corto-pero-secreto"), false);
  });
});
