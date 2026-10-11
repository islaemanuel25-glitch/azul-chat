// scripts/generar-iconos.mjs
//
// LOS ÍCONOS DE AZUL CHAT INSTALADA (Tanda 5A): un globo de chat blanco sobre
// el color de marca (`--ac-color-marca` y `--ac-color-sobre-marca` de
// src/app/globals.css). Sin dependencias: dibuja los píxeles y escribe el PNG
// con zlib. Los PNG se commitean en public/; este script es cómo se rehacen.
//
// Uso: node scripts/generar-iconos.mjs
//
// El globo ocupa el centro: entra entero en la zona segura de un ícono
// "maskable" (el círculo del 80 %), así que el mismo dibujo sirve para los dos.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const RAIZ = path.resolve(import.meta.dirname, "..");
const MARCA = [0x0f, 0xa3, 0xa3];
const SOBRE_MARCA = [0xff, 0xff, 0xff];
const MUESTRAS = 4; // 4×4 muestras por píxel: bordes suaves

/** ¿El punto (x, y), en unidades del ícono (0..1), cae dentro del globo? */
function dentroDelGlobo(x, y) {
  // Cuerpo: rectángulo redondeado centrado.
  const [x0, y0, x1, y1, r] = [0.24, 0.27, 0.76, 0.63, 0.1];
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  // Cola: triángulo abajo a la izquierda.
  const [ax, ay, bx, by, qx, qy] = [0.33, 0.62, 0.47, 0.62, 0.31, 0.75];
  const lado = (px, py, qx2, qy2, rx, ry) => (px - rx) * (qy2 - ry) - (qx2 - rx) * (py - ry);
  const d1 = lado(x, y, ax, ay, bx, by);
  const d2 = lado(x, y, bx, by, qx, qy);
  const d3 = lado(x, y, qx, qy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function png(lado) {
  const filas = [];
  for (let py = 0; py < lado; py++) {
    const fila = Buffer.alloc(1 + lado * 3); // filtro 0 + RGB
    for (let px = 0; px < lado; px++) {
      let dentro = 0;
      for (let sy = 0; sy < MUESTRAS; sy++) {
        for (let sx = 0; sx < MUESTRAS; sx++) {
          if (dentroDelGlobo((px + (sx + 0.5) / MUESTRAS) / lado, (py + (sy + 0.5) / MUESTRAS) / lado)) dentro++;
        }
      }
      const t = dentro / (MUESTRAS * MUESTRAS);
      for (let c = 0; c < 3; c++) fila[1 + px * 3 + c] = Math.round(MARCA[c] * (1 - t) + SOBRE_MARCA[c] * t);
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(Buffer.concat(filas), { level: 9 })),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

for (const [nombre, lado] of [
  ["icono-192.png", 192],
  ["icono-512.png", 512],
  ["icono-maskable-512.png", 512],
]) {
  writeFileSync(path.join(RAIZ, "public", nombre), png(lado));
  console.log(`public/${nombre}: ${lado}×${lado}`);
}
