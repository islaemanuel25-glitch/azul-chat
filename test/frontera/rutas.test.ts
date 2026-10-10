// CANDADO: las rutas del navegador son acciones concretas, no un proxy.
//
// Lo que el navegador puede pedir es: ver el estado de su sesión, vincular con
// un código, cerrar, y —desde la Tanda 2B— ver sus chats (la lista, un local,
// General) y marcar leído; desde la Tanda 3A, las ventas de hoy de un local. No hay una ruta que reciba una capacidad, una URL o un
// camino del ERP y lo reenvíe. Una ruta nueva entra a propósito, con su
// manejador y sus tests, y ese día se actualiza la lista de abajo.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo, especificadores, sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const rel = (f: string) => path.relative(RAIZ, f).split(path.sep).join("/");

/** Las rutas permitidas, con los métodos que exporta cada una y su único manejador. */
const RUTAS = {
  "src/app/api/salud/route.ts": {
    metodos: ["GET"],
    importa: ["../../../server/db.ts", "../../../server/http/respuestas.ts", "../../../server/salud.ts"],
  },
  "src/app/api/version/route.ts": { metodos: ["GET"], importa: ["../../../server/http/respuestas.ts", "../../../server/version.ts"] },
  "src/app/api/sesion/route.ts": {
    metodos: ["DELETE", "GET"],
    importa: ["../../../server/sesion/cerrar.ts", "../../../server/sesion/dependencias.ts", "../../../server/sesion/estado.ts"],
  },
  "src/app/api/sesion/vincular/route.ts": {
    metodos: ["POST"],
    importa: ["../../../../server/sesion/dependencias.ts", "../../../../server/sesion/vincular.ts"],
  },
  // Tanda 2B: los chats. El local va por query (`?localId=`), no por segmento:
  // la regla de abajo sigue sin admitir segmentos dinámicos.
  "src/app/api/chats/route.ts": {
    metodos: ["GET"],
    importa: ["../../../server/chats/manejadores.ts", "../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/chats/local/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/chats/general/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/chats/leido/route.ts": {
    metodos: ["POST"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 3A: las ventas de hoy de un local. Una acción concreta —período fijo
  // "hoy", el local por query—, no un pase genérico a `ventas_resumen`.
  "src/app/api/chats/ventas/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
};

const METODOS_HTTP = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

/** Las violaciones de un árbol de archivos (ruta relativa → código). */
function violacionesDeRutas(archivos: Record<string, string>): string[] {
  const malas: string[] = [];
  for (const [archivo, crudo] of Object.entries(archivos)) {
    if (!archivo.startsWith("src/app/")) continue;
    // Ningún segmento dinámico ni comodín en la app: `[...ruta]`, `[[...ruta]]`, `[capacidad]`.
    if (/\[/.test(archivo)) malas.push(`${archivo}: segmento dinámico`);
    if (!/\/route\.(ts|tsx|js|mjs)$/.test(archivo)) continue;
    const esperada = RUTAS[archivo as keyof typeof RUTAS];
    if (!esperada) {
      malas.push(`${archivo}: ruta no declarada`);
      continue;
    }
    const codigo = sinComentarios(crudo);
    const metodos = [...codigo.matchAll(METODOS_HTTP)].map((m) => m[1] ?? m[2]).sort();
    if (JSON.stringify(metodos) !== JSON.stringify(esperada.metodos)) malas.push(`${archivo}: métodos ${metodos.join(",")}`);
    const imports = especificadores(crudo).sort();
    if (JSON.stringify(imports) !== JSON.stringify(esperada.importa)) malas.push(`${archivo}: importa ${imports.join(",")}`);
    // La ruta no toca el ERP ni el cuerpo: delega.
    if (/fetch|\/api\/integraciones|capacidad|request\.(json|text|body)|searchParams/.test(codigo)) malas.push(`${archivo}: no solo delega`);
  }
  return malas;
}

function arbolDeSrcApp(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const f of archivosDelRepo(RAIZ, "src/app")) salida[rel(f)] = /\.(ts|tsx|js|mjs)$/.test(f) ? readFileSync(f, "utf8") : "";
  return salida;
}

describe("las rutas son acciones concretas", () => {
  it("27. existen exactamente las rutas declaradas, sin comodines, y cada una solo delega", () => {
    const arbol = arbolDeSrcApp();
    assert.deepEqual(violacionesDeRutas(arbol), []);
    for (const r of Object.keys(RUTAS)) assert.ok(r in arbol, `falta ${r}`);
  });

  it("CONTRAPRUEBA: atrapa un proxy genérico, una ruta de más, un método de más y una ruta que llama al ERP", () => {
    const arbol = arbolDeSrcApp();
    const vincular = arbol["src/app/api/sesion/vincular/route.ts"]!;
    const casos: Record<string, Record<string, string>> = {
      proxy: { "src/app/api/erp/[...ruta]/route.ts": "export async function POST() {}\n" },
      opcional: { "src/app/api/[[...todo]]/route.ts": "export async function GET() {}\n" },
      nueva: { "src/app/api/consultar/route.ts": "export async function POST() {}\n" },
      metodo: { "src/app/api/sesion/vincular/route.ts": `${vincular}\nexport function GET() {}\n` },
      erp: { "src/app/api/sesion/vincular/route.ts": `${vincular}\nconst x = () => fetch("/api/integraciones/azul-chat/consultar");\n` },
      cuerpo: { "src/app/api/sesion/vincular/route.ts": `${vincular}\nconst y = (request: Request) => request.json();\n` },
    };
    for (const [nombre, cambio] of Object.entries(casos)) {
      assert.notDeepEqual(violacionesDeRutas({ ...arbol, ...cambio }), [], nombre);
    }
  });
});

describe("el panel de sesión", () => {
  const PANEL = "src/components/sesion/PanelSesion.tsx";
  const panel = sinComentarios(readFileSync(path.join(RAIZ, PANEL), "utf8"));

  /** Lo que el panel no puede hacer con la sesión ni con el código. */
  function problemasDelPanel(codigo: string): string[] {
    const p: string[] = [];
    if (/localStorage|sessionStorage|indexedDB|document\.cookie/.test(codigo)) p.push("almacenamiento del navegador");
    if (/\bconsole\./.test(codigo)) p.push("consola");
    if (/[?&]codigo=|URLSearchParams|history\.|location\.(href|search|assign|replace)/.test(codigo)) p.push("código en la URL");
    if (/\bmethod:\s*"GET"[^}]*codigo|`[^`]*\$\{\s*(codigo|enviado)/.test(codigo)) p.push("código armado en un texto");
    if (!/body:\s*JSON\.stringify\(\{\s*codigo:\s*enviado\s*\}\)/.test(codigo)) p.push("el código no va en el cuerpo JSON");
    if (/usuarioId|vinculoId|tokenDelegacion|delegacion/.test(codigo)) p.push("manda identidad o token");
    return p;
  }

  it("3/5/6/30. el código va solo en el cuerpo de un POST; nada de URL, almacenamiento ni consola; sin usuarioId ni vinculoId", () => {
    assert.deepEqual(problemasDelPanel(panel), []);
  });

  it("CONTRAPRUEBA: atrapa cada forma de sacar el código o la sesión de donde va", () => {
    const casos = [
      panel.replace("setCodigo(\"\");", 'setCodigo(""); localStorage.setItem("c", enviado);'),
      panel.replace("setCodigo(\"\");", 'setCodigo(""); sessionStorage.setItem("c", enviado);'),
      panel.replace("setCodigo(\"\");", 'setCodigo(""); console.log(enviado);'),
      panel.replace("fetch(RUTA_VINCULAR,", "fetch(`${RUTA_VINCULAR}?codigo=${enviado}`,"),
      panel.replace("JSON.stringify({ codigo: enviado })", "JSON.stringify({ codigo: enviado, usuarioId: 1 })"),
      panel.replace("JSON.stringify({ codigo: enviado })", "new URLSearchParams({ codigo: enviado })"),
    ];
    for (const [i, c] of casos.entries()) {
      assert.notEqual(c, panel, `el reemplazo ${i} no se aplicó`);
      assert.notDeepEqual(problemasDelPanel(c), [], `caso ${i}`);
    }
  });
});
