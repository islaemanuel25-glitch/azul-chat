// CANDADO: el token de delegación se guarda cifrado con AES-256-GCM, con IV
// nuevo en cada cifrado, autenticado con su contexto, y sin clave no hay nada.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { leerConfigAzulChat } from "../../src/server/configuracion.ts";
import { crearCifradorToken, leerClaveToken } from "../../src/server/seguridad/cifradoToken.ts";
import { SECRETO_PRUEBA, TOKEN_PRUEBA } from "../ayuda/servidorErp.ts";

const CLAVE = randomBytes(32);
const CONTEXTO = Object.freeze({ instalacionId: "instalacion-prueba", erpUsuarioId: 7, erpVinculoId: 11 });
const cifrador = crearCifradorToken(CLAVE);

/** Cambia un carácter de la parte `i` (0 = versión, 1 = iv, 2 = cifrado, 3 = tag). */
function tocar(cifrado: string, i: number): string {
  const partes = cifrado.split(".");
  const p = partes[i]!;
  // El primer carácter: en base64url sus 6 bits caen enteros en el primer byte.
  partes[i] = (p[0] === "A" ? "B" : "A") + p.slice(1);
  return partes.join(".");
}

describe("cifrado del token: AES-256-GCM", () => {
  it("13. ida y vuelta, con formato versionado v1.iv.cifrado.tag", () => {
    const c = cifrador.cifrar(TOKEN_PRUEBA, CONTEXTO);
    assert.match(c, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    assert.equal(cifrador.descifrar(c, CONTEXTO), TOKEN_PRUEBA);
  });

  it("21. lo guardado no contiene el token ni partes de él", () => {
    const c = cifrador.cifrar(TOKEN_PRUEBA, CONTEXTO);
    assert.equal(c.includes(TOKEN_PRUEBA), false);
    assert.equal(c.includes(TOKEN_PRUEBA.slice(5, 20)), false);
    assert.equal(c.includes("del1_"), false);
  });

  it("14. el IV es nuevo en cada cifrado: el mismo token da textos distintos", () => {
    const ivs = new Set<string>();
    const textos = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = cifrador.cifrar(TOKEN_PRUEBA, CONTEXTO);
      ivs.add(c.split(".")[1]!);
      textos.add(c);
    }
    assert.equal(ivs.size, 200);
    assert.equal(textos.size, 200);
  });

  it("15. manipular el IV, el cifrado o el tag hace fallar el descifrado (no devuelve basura)", () => {
    const c = cifrador.cifrar(TOKEN_PRUEBA, CONTEXTO);
    for (const i of [1, 2, 3]) assert.equal(cifrador.descifrar(tocar(c, i), CONTEXTO), null, `parte ${i}`);
    assert.equal(cifrador.descifrar(c.replace(/^v1\./, "v2."), CONTEXTO), null);
    assert.equal(cifrador.descifrar(c.split(".").slice(0, 3).join("."), CONTEXTO), null);
    assert.equal(cifrador.descifrar("", CONTEXTO), null);
  });

  it("15. el contexto se autentica: el cifrado de una persona no se descifra en la fila de otra", () => {
    const c = cifrador.cifrar(TOKEN_PRUEBA, CONTEXTO);
    assert.equal(cifrador.descifrar(c, { ...CONTEXTO, erpUsuarioId: 8 }), null);
    assert.equal(cifrador.descifrar(c, { ...CONTEXTO, erpVinculoId: 12 }), null);
    assert.equal(cifrador.descifrar(c, { ...CONTEXTO, instalacionId: "otra-instalacion" }), null);
  });

  it("con otra clave no se descifra", () => {
    const c = cifrador.cifrar(TOKEN_PRUEBA, CONTEXTO);
    assert.equal(crearCifradorToken(randomBytes(32)).descifrar(c, CONTEXTO), null);
  });

  it("el cifrador no expone la clave: ni como propiedad ni al serializarlo", () => {
    assert.deepEqual(Object.keys(cifrador).sort(), ["cifrar", "descifrar"]);
    assert.equal(JSON.stringify(cifrador).includes(CLAVE.toString("base64")), false);
    assert.ok(Object.isFrozen(cifrador));
    assert.throws(() => crearCifradorToken(randomBytes(16)));
  });
});

describe("la clave del token: fail closed", () => {
  const base64 = CLAVE.toString("base64");
  const base64url = CLAVE.toString("base64url");

  it("acepta 32 bytes en base64 o base64url y da la misma clave", () => {
    const a = leerClaveToken({ AZUL_CHAT_TOKEN_ENCRYPTION_KEY: base64 });
    const b = leerClaveToken({ AZUL_CHAT_TOKEN_ENCRYPTION_KEY: base64url });
    assert.ok(a.ok && b.ok);
    assert.ok(a.clave.equals(CLAVE) && b.clave.equals(CLAVE));
  });

  it("16. sin clave, no hay cifrador", () => {
    assert.deepEqual(leerClaveToken({}), { ok: false, motivo: "CLAVE_AUSENTE" });
    assert.deepEqual(leerClaveToken({ AZUL_CHAT_TOKEN_ENCRYPTION_KEY: "" }), { ok: false, motivo: "CLAVE_AUSENTE" });
  });

  it("16. una clave de otro tamaño o mal escrita se rechaza, no se completa ni se recorta", () => {
    for (const mala of [
      randomBytes(16).toString("base64"),
      randomBytes(31).toString("base64url"),
      randomBytes(33).toString("base64url"),
      randomBytes(48).toString("base64"),
      "una frase cualquiera que no es una clave en absoluto!!",
      `${base64url.slice(0, 42)}*`,
      ` ${base64url}`,
    ]) {
      const r = leerClaveToken({ AZUL_CHAT_TOKEN_ENCRYPTION_KEY: mala });
      assert.deepEqual(r, { ok: false, motivo: "CLAVE_MAL_FORMADA" }, mala.length.toString());
    }
  });

  it("17. el secreto de la integración no sirve como clave aunque tenga la forma", () => {
    // Un secreto HMAC válido de 43 caracteres base64url decodifica a 32 bytes: la forma sola no alcanza.
    assert.equal(base64url.length, 43);
    const r = leerClaveToken({ AZUL_CHAT_TOKEN_ENCRYPTION_KEY: base64url, AZUL_CHAT_INTEGRACION_SECRET: base64url });
    assert.deepEqual(r, { ok: false, motivo: "CLAVE_ES_EL_SECRETO_DE_INTEGRACION" });
    // Contraprueba: con un secreto distinto, la misma clave sí se acepta.
    assert.ok(leerClaveToken({ AZUL_CHAT_TOKEN_ENCRYPTION_KEY: base64url, AZUL_CHAT_INTEGRACION_SECRET: SECRETO_PRUEBA }).ok);
  });

  it("el motivo de rechazo nunca trae el valor", () => {
    const r = leerClaveToken({ AZUL_CHAT_TOKEN_ENCRYPTION_KEY: base64url.slice(0, 40) });
    assert.equal(JSON.stringify(r).includes(base64url.slice(0, 40)), false);
  });
});

describe("la configuración de Azul Chat: fail closed", () => {
  const completa = {
    AZUL_CHAT_INSTALACION_ID: "instalacion-prueba",
    AZUL_CHAT_ORIGEN_PUBLICO: "https://chat.ejemplo.invalid",
    AZUL_CHAT_TOKEN_ENCRYPTION_KEY: CLAVE.toString("base64"),
  };

  it("completa, arma la configuración; producción solo con NODE_ENV=production", () => {
    const r = leerConfigAzulChat(completa);
    assert.ok(r.ok);
    assert.equal(r.config.instalacionId, "instalacion-prueba");
    assert.equal(r.config.origenPublico, "https://chat.ejemplo.invalid");
    assert.equal(r.config.produccion, false);
    const p = leerConfigAzulChat({ ...completa, NODE_ENV: "production" });
    assert.ok(p.ok && p.config.produccion);
  });

  it("falta o está mal cualquier pieza: no hay configuración", () => {
    const casos: [Record<string, string | undefined>, string][] = [
      [{ ...completa, AZUL_CHAT_INSTALACION_ID: undefined }, "INSTALACION_AUSENTE"],
      [{ ...completa, AZUL_CHAT_INSTALACION_ID: "Con Mayúsculas" }, "INSTALACION_MAL_FORMADA"],
      [{ ...completa, AZUL_CHAT_ORIGEN_PUBLICO: undefined }, "ORIGEN_PUBLICO_AUSENTE"],
      [{ ...completa, AZUL_CHAT_ORIGEN_PUBLICO: "http://chat.ejemplo.invalid" }, "ORIGEN_PUBLICO_INVALIDO"],
      [{ ...completa, AZUL_CHAT_ORIGEN_PUBLICO: "https://chat.ejemplo.invalid/app" }, "ORIGEN_PUBLICO_INVALIDO"],
      [{ ...completa, AZUL_CHAT_TOKEN_ENCRYPTION_KEY: undefined }, "CLAVE_AUSENTE"],
    ];
    for (const [entorno, motivo] of casos) assert.deepEqual(leerConfigAzulChat(entorno), { ok: false, motivo }, motivo);
  });
});
