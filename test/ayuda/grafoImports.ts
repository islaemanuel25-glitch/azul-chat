// Recorre el grafo de imports de un archivo y dice a qué archivos llega.
//
// Lo usan los candados de frontera: desde todo lo que puede terminar en el
// navegador, ningún camino puede llegar a `src/server`. Mira imports estáticos,
// `export … from`, `import()` y `require()`, relativos y con el alias `@/`.
// Los comentarios se sacan antes de buscar: un import nombrado en prosa no es
// un import (y uno comentado tampoco).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

export function especificadores(codigo: string): string[] {
  const limpio = sinComentarios(codigo);
  const encontrados: string[] = [];
  const patrones = [
    /\bimport\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^"'`;]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const p of patrones) for (const m of limpio.matchAll(p)) if (m[1]) encontrados.push(m[1]);
  return encontrados;
}

function resolver(raiz: string, desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = path.join(raiz, "src", especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(desde), especificador);
  else return null; // paquete: no es código del repo
  const candidatos = [base, ...EXTENSIONES.map((e) => base + e), ...EXTENSIONES.map((e) => path.join(base, `index${e}`))];
  for (const c of candidatos) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Todos los archivos del repo alcanzables desde `inicio` (incluido). */
export function alcanzables(raiz: string, inicio: string): Set<string> {
  const vistos = new Set<string>();
  const pendientes = [inicio];
  while (pendientes.length) {
    const actual = pendientes.pop()!;
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    for (const esp of especificadores(readFileSync(actual, "utf8"))) {
      const destino = resolver(raiz, actual, esp);
      if (destino && !vistos.has(destino)) pendientes.push(destino);
    }
  }
  return vistos;
}

/** ¿Empieza con la directiva "use client"? (después de comentarios y espacios). */
export function esArchivoCliente(codigo: string): boolean {
  return /^\s*["']use client["']/.test(sinComentarios(codigo));
}

/**
 * Archivos del repo bajo `dir`, INCLUYENDO los que todavía no se commitearon:
 * un candado que solo mira lo trackeado da verde sobre un archivo nuevo.
 */
export function archivosDelRepo(raiz: string, dir: string): string[] {
  const salida = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", dir], {
    cwd: raiz,
    encoding: "utf8",
  });
  return salida
    .split("\n")
    .filter(Boolean)
    .map((f) => path.join(raiz, f))
    .filter((f) => existsSync(f));
}
