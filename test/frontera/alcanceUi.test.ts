// CANDADO: LA INTERFAZ NO PROMETE LO QUE NO EXISTE Y NO SE SALE DE SU CARRIL.
//
// La Tanda 2C dibuja los chats con lo que la API de verdad da. El diseño de
// Figma tiene más (acciones sobre el ERP, ventas, pendientes, mensajes) y es
// fácil que un texto o un botón de eso se cuele: este candado lo hace rojo.
// Mira el CÓDIGO de src/components y src/app, sin comentarios (la prosa puede
// nombrar lo que falta; el código no lo puede mostrar).
//
// Además: nada de refresco automático (la sincronización ocurre cuando se pide),
// nada guardado en el navegador, `fetch` solo en los dos clientes HTTP de la
// interfaz, y ningún rastro de la delegación del ERP.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo, sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const rel = (f: string) => path.relative(RAIZ, f).split(path.sep).join("/");

/** Código sin comentarios de la interfaz: src/components y src/app (sin las rutas de API, que son del servidor). */
function codigoDeLaInterfaz(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const dir of ["src/components", "src/app"]) {
    for (const f of archivosDelRepo(RAIZ, dir)) {
      const r = rel(f);
      if (!/\.(ts|tsx)$/.test(r) || r.startsWith("src/app/api/")) continue;
      salida[r] = sinComentarios(readFileSync(f, "utf8"));
    }
  }
  return salida;
}

/** Lo que todavía no existe y no se puede ofrecer (ni insinuar, como el viejo texto de "Estados"). */
const TEXTOS_FUERA_DE_ALCANCE = ["Ver diferencias", "Abrir en ERP", "Ventas de hoy", "Última transferencia", "Podés leer historial"];

/** Los únicos archivos de la interfaz que hacen HTTP (a rutas propias; lo controla secretoSoloServidor.test.ts). */
const CLIENTES_HTTP = ["src/components/chats/clienteChats.ts", "src/components/sesion/PanelSesion.tsx"];

function problemas(archivos: Record<string, string>): string[] {
  const p: string[] = [];
  for (const [archivo, codigo] of Object.entries(archivos)) {
    for (const t of TEXTOS_FUERA_DE_ALCANCE) if (codigo.includes(t)) p.push(`${archivo}: "${t}"`);
    if (/\b(setInterval|setTimeout|requestIdleCallback)\b|\brefetchInterval\b|WebSocket|EventSource/.test(codigo)) p.push(`${archivo}: refresco automático`);
    if (/localStorage|sessionStorage|indexedDB|document\.cookie|\bcaches\./.test(codigo)) p.push(`${archivo}: almacenamiento del navegador`);
    if (/(?<![\w-])fetch\s*\(/.test(codigo) && !CLIENTES_HTTP.includes(archivo)) p.push(`${archivo}: fetch fuera del cliente`);
    if (/delegaci|tokenDelegacion|\btoken\b|vinculoId|usuarioId|\/api\/integraciones|https?:\/\//i.test(codigo)) p.push(`${archivo}: sabe de la delegación o del ERP`);
  }
  return p;
}

describe("alcance de la interfaz de chats", () => {
  const arbol = codigoDeLaInterfaz();

  it("hay interfaz que revisar", () => {
    assert.ok("src/components/chats/AzulChat.tsx" in arbol);
    assert.ok("src/components/chats/Conversacion.tsx" in arbol);
    assert.ok("src/app/page.tsx" in arbol);
  });

  it("I/J/Z/AA/X. sin textos de lo que no existe, sin refresco automático, sin almacenamiento, fetch solo en el cliente, sin delegación", () => {
    assert.deepEqual(problemas(arbol), []);
  });

  it("CONTRAPRUEBA: cada regla atrapa su caso, y un comentario no cuenta", () => {
    const conversacion = arbol["src/components/chats/Conversacion.tsx"]!;
    const casos: Record<string, string> = {
      ver: conversacion.replace('"Cargar anteriores"', '"Ver diferencias"'),
      abrir: `${conversacion}\nexport const X = () => <button>Abrir en ERP</button>;\n`,
      ventas: `${conversacion}\nconst t = "Ventas de hoy";\n`,
      ultima: `${conversacion}\nconst u = "Última transferencia";\n`,
      p1: `${conversacion}\nconst v = "Podés leer historial.";\n`,
      intervalo: `${conversacion}\nsetInterval(() => {}, 30000);\n`,
      timeout: `${conversacion}\nsetTimeout(() => {}, 30000);\n`,
      almacenamiento: `${conversacion}\nlocalStorage.setItem("x", "y");\n`,
      fetch: `${conversacion}\nvoid fetch("/api/chats");\n`,
      token: `${conversacion}\nconst token = "del1_x";\n`,
      erp: `${conversacion}\nconst u2 = "https://erp.ejemplo.invalid";\n`,
    };
    for (const [nombre, codigo] of Object.entries(casos)) {
      assert.notEqual(codigo, conversacion, nombre);
      assert.notDeepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": codigo }), [], nombre);
    }
    // En prosa no cuenta: el código se mira sin comentarios.
    const conComentario = sinComentarios(`${conversacion}\n// todavía no hay "Ver diferencias" ni setInterval\n`);
    assert.deepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": conComentario }), []);
  });
});
