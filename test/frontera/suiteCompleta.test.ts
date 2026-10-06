// CANDADO: todo archivo de test lo corre algún script.
//
// `npm test` enumera carpetas (erp, frontera, unidad) porque test/db/ necesita
// una base y va aparte, en `npm run test:db`. Una carpeta nueva de tests que no
// entre en ninguna de las dos listas no correría nunca, y su verde sería
// indistinguible de uno bueno. Este candado lo hace rojo.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");

/** Las carpetas de test/ que cubren los globs de `scripts` (forma "test/<carpeta>/**\/*.test.ts"). */
function carpetasCubiertas(scripts: Record<string, string>): Set<string> {
  const cubiertas = new Set<string>();
  for (const nombre of ["test", "test:db"]) {
    for (const m of (scripts[nombre] ?? "").matchAll(/"test\/([a-z]+)\/\*\*\/\*\.test\.ts"/g)) cubiertas.add(m[1]!);
  }
  return cubiertas;
}

function sinCubrir(archivos: string[], scripts: Record<string, string>): string[] {
  const cubiertas = carpetasCubiertas(scripts);
  return archivos.filter((f) => {
    const [raiz, carpeta, ...resto] = f.split("/");
    return raiz !== "test" || resto.length === 0 || !cubiertas.has(carpeta!);
  });
}

describe("la suite corre todos los tests", () => {
  const scripts = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")).scripts as Record<string, string>;
  const tests = archivosDelRepo(RAIZ, ".")
    .map((f) => path.relative(RAIZ, f).split(path.sep).join("/"))
    .filter((f) => f.endsWith(".test.ts") && !f.startsWith("node_modules/"));

  it("cada *.test.ts del repo está bajo una carpeta que npm test o npm run test:db corren", () => {
    assert.ok(tests.length > 10);
    assert.deepEqual(sinCubrir(tests, scripts), []);
    assert.ok(carpetasCubiertas(scripts).has("db"));
  });

  it("CONTRAPRUEBA: una carpeta nueva, un test suelto en test/ o fuera de test/ se ven", () => {
    assert.deepEqual(sinCubrir([...tests, "test/nueva/x.test.ts"], scripts), ["test/nueva/x.test.ts"]);
    assert.deepEqual(sinCubrir([...tests, "test/suelto.test.ts"], scripts), ["test/suelto.test.ts"]);
    assert.deepEqual(sinCubrir([...tests, "src/x.test.ts"], scripts), ["src/x.test.ts"]);
  });
});
