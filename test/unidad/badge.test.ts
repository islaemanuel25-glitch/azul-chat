// CANDADO (Tanda 16): EL BADGE DE LAS NOTIFICACIONES TIENE TRANSPARENCIA.
//
// Android pinta el `badge` de una notificación en la barra de estado usando
// SOLO su canal alfa. Con el ícono opaco (icono-192.png) se veía un círculo
// blanco vacío. El badge es public/badge-96.png: el mismo globo del ícono, en
// blanco, sobre fondo transparente (scripts/generar-iconos.mjs). Se lee el PNG
// de verdad, byte a byte, sin librerías.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

const RAIZ = path.resolve(import.meta.dirname, "../..");

type Png = { lado: number; alto: number; tipoColor: number; canales: number; pixel(x: number, y: number): number[] };

/** Un PNG de 8 bits por canal, RGB o RGBA, con los filtros de fila resueltos. */
function leerPng(archivo: string): Png {
  const b = readFileSync(path.join(RAIZ, archivo));
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${archivo}: no es un PNG`);
  let lado = 0, alto = 0, profundidad = 0, tipoColor = 0;
  const idat: Buffer[] = [];
  for (let i = 8; i < b.length; ) {
    const largo = b.readUInt32BE(i);
    const tipo = b.toString("ascii", i + 4, i + 8);
    const datos = b.subarray(i + 8, i + 8 + largo);
    if (tipo === "IHDR") [lado, alto, profundidad, tipoColor] = [datos.readUInt32BE(0), datos.readUInt32BE(4), datos[8]!, datos[9]!];
    if (tipo === "IDAT") idat.push(datos);
    i += 12 + largo;
  }
  assert.equal(profundidad, 8);
  const canales = tipoColor === 6 ? 4 : tipoColor === 2 ? 3 : 0;
  assert.ok(canales, `${archivo}: tipo de color ${tipoColor} no esperado`);
  const crudo = inflateSync(Buffer.concat(idat));
  const paso = lado * canales;
  const filas: Buffer[] = [];
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (paso + 1)]!;
    const fila = Buffer.from(crudo.subarray(y * (paso + 1) + 1, (y + 1) * (paso + 1)));
    const arriba = filas[y - 1] ?? Buffer.alloc(paso);
    for (let x = 0; x < paso; x++) {
      const a = x >= canales ? fila[x - canales]! : 0;
      const u = arriba[x]!;
      const c = x >= canales ? arriba[x - canales]! : 0;
      const p = a + u - c;
      const pr = Math.abs(p - a) <= Math.abs(p - u) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - u) <= Math.abs(p - c) ? u : c;
      fila[x] = (fila[x]! + [0, a, u, (a + u) >> 1, pr][filtro]!) & 0xff;
    }
    filas.push(fila);
  }
  return { lado, alto, tipoColor, canales, pixel: (x, y) => [...filas[y]!.subarray(x * canales, (x + 1) * canales)] };
}

/** Lo que tiene que cumplir un badge para Android. Devuelve las violaciones. */
function problemasDelBadge(archivo: string): string[] {
  const p = leerPng(archivo);
  const v: string[] = [];
  if (p.lado !== 96 || p.alto !== 96) v.push(`mide ${p.lado}×${p.alto}`);
  if (p.tipoColor !== 6) return [...v, "no tiene canal alfa"];
  let transparentes = 0, opacos = 0, noBlancos = 0;
  for (let y = 0; y < p.alto; y++) {
    for (let x = 0; x < p.lado; x++) {
      const [r, g, b, a] = p.pixel(x, y) as [number, number, number, number];
      if (a === 0) transparentes++;
      if (a === 255) opacos++;
      if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) noBlancos++;
    }
  }
  if (transparentes === 0) v.push("ningún píxel transparente");
  if (opacos === 0) v.push("ningún píxel opaco: no hay silueta");
  if (noBlancos > 0) v.push(`${noBlancos} píxeles visibles que no son blancos`);
  // El fondo es transparente (las esquinas) y el globo, opaco (su centro).
  for (const [x, y] of [[0, 0], [95, 0], [0, 95], [95, 95]] as const) if (p.pixel(x, y)[3] !== 0) v.push(`esquina ${x},${y} no transparente`);
  if (p.pixel(48, 43)[3] !== 255) v.push("el centro del globo no es opaco");
  return v;
}

describe("el badge de las notificaciones", () => {
  it("16. public/badge-96.png: 96×96, RGBA, fondo transparente y la silueta del globo en blanco", () => {
    assert.deepEqual(problemasDelBadge("public/badge-96.png"), []);
  });

  it("es la MISMA forma que el ícono: donde el ícono es blanco, el badge es opaco; donde es color de marca, transparente", () => {
    const icono = leerPng("public/icono-192.png");
    const badge = leerPng("public/badge-96.png");
    let distintos = 0, comparados = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        // Los cuatro píxeles del ícono de 192 que caen en el mismo lugar. En el borde del globo no se compara.
        const rojos = [icono.pixel(2 * x, 2 * y), icono.pixel(2 * x + 1, 2 * y), icono.pixel(2 * x, 2 * y + 1), icono.pixel(2 * x + 1, 2 * y + 1)].map((px) => px[0]);
        const blancoEnIcono = rojos.every((r) => r === 255);
        const marcaEnIcono = rojos.every((r) => r === 0x0f);
        const a = badge.pixel(x, y)[3];
        if (blancoEnIcono || marcaEnIcono) comparados++;
        if ((blancoEnIcono && a !== 255) || (marcaEnIcono && a !== 0)) distintos++;
      }
    }
    assert.equal(distintos, 0);
    assert.ok(comparados > 96 * 96 * 0.9, `solo se compararon ${comparados} píxeles`);
  });

  it("el service worker lo usa como badge de todos los avisos, y el ícono queda como estaba", () => {
    const sw = readFileSync(path.join(RAIZ, "public/sw.js"), "utf8");
    assert.match(sw, /const BADGE = "\/badge-96\.png";/);
    assert.match(sw, /const ICONO = "\/icono-192\.png";/);
    const llamadas = [...sw.matchAll(/showNotification\([^)]*\)/g)].map((m) => m[0]);
    assert.ok(llamadas.length > 0);
    for (const l of llamadas) {
      assert.match(l, /badge: BADGE/, l);
      assert.match(l, /icon: ICONO/, l);
    }
  });

  it("CONTRAPRUEBA: el ícono opaco de antes no pasa como badge", () => {
    assert.ok(problemasDelBadge("public/icono-192.png").includes("no tiene canal alfa"));
  });
});
