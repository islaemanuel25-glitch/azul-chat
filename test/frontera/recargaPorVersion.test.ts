// CANDADOS DE LO QUE HACE CONFIABLE LA RECARGA POR VERSIÓN (Tanda 6C).
//
// El 11/10 un Android siguió con el JS anterior a dda5b80 trece minutos después
// del despliegue. La pieza que decide (version.ts) se prueba en
// test/ui/version.test.ts; acá, lo que tiene que valer alrededor para que esa
// decisión se tome con datos frescos:
//
//   · GET /api/version contesta `Cache-Control: no-store` (ni el navegador ni
//     Cloudflare la guardan);
//   · la página `/` se arma en cada pedido (`force-dynamic`, que hace que Next
//     conteste no-store) y le pasa a la app el commit de la imagen que la
//     sirve: es la referencia contra la que se compara;
//   · el service worker no intercepta pedidos (alcanceUi.test.ts) y, cuando
//     cambia, toma el control enseguida: skipWaiting al instalarse y
//     clients.claim al activarse.
//
// Cada regla tiene su contraprueba: se rompe a propósito y se ve el rojo.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { GET as getVersion } from "../../src/app/api/version/route.ts";
import { sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const leer = (f: string) => sinComentarios(readFileSync(path.join(RAIZ, f), "utf8"));

/** ¿La respuesta prohíbe guardarla en cualquier caché? */
const esNoStore = (r: Response) => /(^|,)\s*no-store\s*(,|$)/i.test(r.headers.get("cache-control") ?? "");

function problemasDeLaPagina(codigo: string): string[] {
  const p: string[] = [];
  if (!/export const dynamic = "force-dynamic";/.test(codigo)) p.push("la página puede quedar prerenderada o en caché");
  if (!/<AzulChat commit=\{leerVersion\(\)\.commit\} \/>/.test(codigo)) p.push("la app no recibe el commit de la imagen que la sirve");
  return p;
}

function problemasDelServiceWorker(codigo: string): string[] {
  const p: string[] = [];
  if (!/addEventListener\("install", \(\) => \{\s*self\.skipWaiting\(\);\s*\}\);/.test(codigo)) p.push("el service worker nuevo espera a que se cierren las pestañas");
  if (!/addEventListener\("activate", \(event\) => \{\s*event\.waitUntil\(self\.clients\.claim\(\)\);\s*\}\);/.test(codigo)) p.push("el service worker nuevo no toma las pestañas abiertas");
  return p;
}

describe("6C. la recarga por versión se decide con datos frescos", () => {
  it("GET /api/version contesta no-store", () => {
    const r = getVersion();
    assert.equal(r.status, 200);
    assert.ok(esNoStore(r), `cache-control: ${r.headers.get("cache-control")}`);
  });

  it("CONTRAPRUEBA: una respuesta cacheable no pasa", () => {
    assert.equal(esNoStore(new Response("{}", { headers: { "cache-control": "public, max-age=60" } })), false);
    assert.equal(esNoStore(new Response("{}")), false);
    assert.equal(esNoStore(new Response("{}", { headers: { "cache-control": "no-store-ish" } })), false);
  });

  it("la página se arma en cada pedido y le pasa a la app el commit de su imagen", () => {
    assert.deepEqual(problemasDeLaPagina(leer("src/app/page.tsx")), []);
  });

  it("CONTRAPRUEBA: sin force-dynamic, o sin el commit, es rojo", () => {
    const pagina = leer("src/app/page.tsx");
    const casos = {
      estatica: pagina.replace('export const dynamic = "force-dynamic";', ""),
      sinCommit: pagina.replace("<AzulChat commit={leerVersion().commit} />", "<AzulChat />"),
    };
    for (const [nombre, codigo] of Object.entries(casos)) {
      assert.notEqual(codigo, pagina, `el cambio ${nombre} no se aplicó`);
      assert.notDeepEqual(problemasDeLaPagina(codigo), [], nombre);
    }
  });

  it("el service worker nuevo toma el control enseguida (skipWaiting + clients.claim)", () => {
    assert.deepEqual(problemasDelServiceWorker(leer("public/sw.js")), []);
  });

  it("CONTRAPRUEBA: sin skipWaiting o sin clients.claim, es rojo", () => {
    const sw = leer("public/sw.js");
    const casos = {
      sinSkip: sw.replace("self.skipWaiting();", ""),
      sinClaim: sw.replace("event.waitUntil(self.clients.claim());", ""),
    };
    for (const [nombre, codigo] of Object.entries(casos)) {
      assert.notEqual(codigo, sw, `el cambio ${nombre} no se aplicó`);
      assert.notDeepEqual(problemasDelServiceWorker(codigo), [], nombre);
    }
  });
});
