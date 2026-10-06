// CANDADO: las piezas HTTP de la sesión. La cookie, el identificador, el
// Origin, el cupo y el cuerpo, cada uno por separado. El camino completo lo
// prueba test/db/.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerObjetoJson } from "../../src/server/http/cuerpo.ts";
import { crearLimitador, ipDeLaSolicitud } from "../../src/server/http/limitador.ts";
import { origenPermitido } from "../../src/server/http/origen.ts";
import {
  DURACION_SESION_MS,
  NOMBRE_COOKIE,
  cookieBorrada,
  cookieDeSesion,
  generarIdSesion,
  hashIdSesion,
  leerIdDeCookie,
} from "../../src/server/sesion/cookie.ts";

const atributos = (cookie: string) => cookie.split("; ").slice(1);

describe("la cookie de sesión", () => {
  const id = generarIdSesion();

  it("18. HttpOnly, SameSite=Lax, Path=/ y vencimiento definido", () => {
    const c = cookieDeSesion(id, { produccion: false });
    assert.equal(c.split("; ")[0], `${NOMBRE_COOKIE}=${id}`);
    assert.deepEqual(atributos(c), ["Path=/", `Max-Age=${DURACION_SESION_MS / 1000}`, "HttpOnly", "SameSite=Lax"]);
    assert.equal(DURACION_SESION_MS, 30 * 24 * 3600 * 1000);
  });

  it("18. Secure en producción", () => {
    assert.ok(atributos(cookieDeSesion(id, { produccion: true })).includes("Secure"));
    assert.ok(atributos(cookieBorrada({ produccion: true })).includes("Secure"));
    assert.equal(atributos(cookieDeSesion(id, { produccion: false })).includes("Secure"), false);
  });

  it("la que borra vence ya, con los mismos atributos", () => {
    assert.deepEqual(cookieBorrada({ produccion: false }).split("; "), [`${NOMBRE_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"]);
  });

  it("19. el identificador es aleatorio: 32 bytes en base64url, sin repetirse", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generarIdSesion()));
    assert.equal(ids.size, 500);
    for (const x of ids) assert.match(x, /^[A-Za-z0-9_-]{43}$/);
  });

  it("20. lo guardado es el SHA-256 en hexadecimal, que no contiene el identificador", () => {
    const h = hashIdSesion(id);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, id);
    assert.equal(hashIdSesion(id), h);
    assert.notEqual(hashIdSesion(generarIdSesion()), h);
  });

  it("se lee de la cabecera Cookie solo si tiene la forma de un identificador", () => {
    const con = (v: string) => leerIdDeCookie(new Headers({ cookie: v }));
    assert.equal(con(`otra=1; ${NOMBRE_COOKIE}=${id}; y=2`), id);
    assert.equal(con(`${NOMBRE_COOKIE}=corto`), null);
    assert.equal(con(`${NOMBRE_COOKIE}=${id}x`), null);
    assert.equal(con(`x${NOMBRE_COOKIE}=${id}`), null);
    assert.equal(con("otra=1"), null);
    assert.equal(leerIdDeCookie(new Headers()), null);
  });
});

describe("el Origin de lo que crea o destruye una sesión", () => {
  const PUBLICO = "https://chat.ejemplo.invalid";
  const permitido = (h: Record<string, string>) => origenPermitido(new Headers(h), PUBLICO);

  it("acepta el origen configurado, exacto", () => {
    assert.equal(permitido({ origin: PUBLICO }), true);
    assert.equal(permitido({ origin: PUBLICO, "sec-fetch-site": "same-origin" }), true);
  });

  it("23. rechaza otro origen, uno parecido, null, y la falta de Origin", () => {
    for (const o of [
      "https://malo.ejemplo.invalid",
      "https://chat.ejemplo.invalid.malo.invalid",
      "http://chat.ejemplo.invalid",
      "https://chat.ejemplo.invalid:8443",
      `${PUBLICO}/`,
      "null",
      "",
    ]) {
      assert.equal(permitido({ origin: o }), false, o);
    }
    assert.equal(permitido({}), false);
  });

  it("23. rechaza Sec-Fetch-Site que no sea same-origin, aunque el Origin coincida", () => {
    for (const s of ["same-site", "cross-site", "none"]) assert.equal(permitido({ origin: PUBLICO, "sec-fetch-site": s }), false, s);
  });
});

describe("el cupo de la vinculación", () => {
  it("24. por IP: la sexta en la ventana se rechaza, con cuándo reintentar", () => {
    const l = crearLimitador({ ventanaMs: 60_000, maxPorIp: 5, maxPorProceso: 100 });
    for (let i = 0; i < 5; i++) assert.deepEqual(l.consumir("1.1.1.1", 1000), { ok: true });
    assert.deepEqual(l.consumir("1.1.1.1", 1000), { ok: false, reintentarEnSegundos: 60 });
    // Otra IP sigue teniendo lugar.
    assert.deepEqual(l.consumir("2.2.2.2", 1000), { ok: true });
    // Pasada la ventana, vuelve.
    assert.deepEqual(l.consumir("1.1.1.1", 61_000), { ok: true });
  });

  it("24. del proceso: rotar IPs no pasa el total", () => {
    const l = crearLimitador({ ventanaMs: 60_000, maxPorIp: 5, maxPorProceso: 15 });
    for (let i = 0; i < 15; i++) assert.deepEqual(l.consumir(`10.0.0.${i}`, 0), { ok: true });
    assert.equal(l.consumir("10.0.1.1", 0).ok, false);
  });

  it("el cupo del proceso queda por debajo del de canjes del ERP (20 por minuto)", () => {
    const l = crearLimitador();
    let pasaron = 0;
    for (let i = 0; i < 100; i++) if (l.consumir(`ip-${i}`, 0).ok) pasaron++;
    assert.ok(pasaron < 20);
  });

  it("la IP sale del primer salto de X-Forwarded-For, o de X-Real-IP", () => {
    assert.equal(ipDeLaSolicitud(new Headers({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" })), "3.3.3.3");
    assert.equal(ipDeLaSolicitud(new Headers({ "x-real-ip": "4.4.4.4" })), "4.4.4.4");
    assert.equal(ipDeLaSolicitud(new Headers()), "desconocida");
  });
});

describe("el cuerpo de la solicitud", () => {
  const pedir = (cuerpo: string, tipo = "application/json") =>
    leerObjetoJson(new Request("http://x/", { method: "POST", headers: { "content-type": tipo }, body: cuerpo }), 64);

  it("lee un objeto JSON chico", async () => {
    assert.deepEqual(await pedir('{"codigo":"x"}'), { codigo: "x" });
    assert.deepEqual(await pedir('{"a":1}', "application/json; charset=utf-8"), { a: 1 });
  });

  it("no interpreta otro tipo, algo que no es objeto, JSON roto ni algo más grande que el tope", async () => {
    assert.equal(await pedir('{"a":1}', "text/plain"), null);
    assert.equal(await pedir('{"a":1}', "application/x-www-form-urlencoded"), null);
    for (const malo of ["[1]", "null", "1", '"x"', "{", ""]) assert.equal(await pedir(malo), null, malo);
    assert.equal(await pedir(JSON.stringify({ a: "x".repeat(100) })), null);
  });
});
