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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { GET as getVersion } from "../../src/app/api/version/route.ts";
import { json } from "../../src/server/http/respuestas.ts";
import { CABECERA_COMMIT } from "../../src/shared/version/cabecera.ts";
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

// ── Tanda 6D: el commit en CADA respuesta de la interfaz ────────────────────

describe("6D. toda respuesta de las rutas de la interfaz lleva el commit de la imagen", () => {
  const COMMIT = "0df3441c792fe36676e8f9009228dbdf0824c939";
  /** Las rutas que usa la interfaz: chats, sesión y push. Enumeradas del repo, también las sin commitear. */
  const RUTAS = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src/app/api"], { cwd: RAIZ, encoding: "utf8" })
    .split("\n")
    .filter((f) => /^src\/app\/api\/(chats|sesion|push)(\/.*)?\/route\.ts$/.test(f))
    .sort();
  const METODOS = ["GET", "POST", "DELETE"] as const;
  /** El commit que dice la respuesta, o null. */
  const commitDe = (r: Response) => r.headers.get(CABECERA_COMMIT);

  it("hay rutas que revisar: las de chats, sesión y push", () => {
    for (const r of ["src/app/api/chats/route.ts", "src/app/api/chats/preguntar/route.ts", "src/app/api/sesion/route.ts", "src/app/api/sesion/vincular/route.ts", "src/app/api/push/suscribir/route.ts"]) {
      assert.ok(RUTAS.includes(r), r);
    }
  });

  it("cada método de cada ruta contesta con el commit (aun cuando contesta una falla)", async () => {
    const antes = { ...process.env };
    process.env.APP_BUILD_ID = COMMIT;
    // Sin base ni configuración: cada ruta contesta su falla por json(), que es lo que se mira.
    delete process.env.DATABASE_URL;
    try {
      let revisadas = 0;
      for (const archivo of RUTAS) {
        const modulo = (await import(path.join(RAIZ, archivo))) as Partial<Record<(typeof METODOS)[number], (r: Request) => Response | Promise<Response>>>;
        for (const m of METODOS) {
          const manejar = modulo[m];
          if (!manejar) continue;
          const ruta = archivo.replace(/^src\/app/, "").replace(/\/route\.ts$/, "");
          const r = await manejar(new Request(`https://chat.ejemplo.invalid${ruta}`, { method: m, ...(m === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }) }));
          assert.equal(commitDe(r), COMMIT, `${m} ${ruta} (status ${r.status})`);
          revisadas++;
        }
      }
      assert.ok(revisadas >= 10, `revisadas: ${revisadas}`);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
      Object.assign(process.env, antes);
    }
  });

  it("CONTRAPRUEBA: una respuesta armada sin json() no trae el commit, y sin APP_BUILD_ID json() no lo inventa", () => {
    process.env.APP_BUILD_ID = COMMIT;
    assert.equal(commitDe(json({ estado: "OK" })), COMMIT);
    assert.equal(commitDe(new Response("{}")), null, "lo que no pasa por json() se nota");
    delete process.env.APP_BUILD_ID;
    assert.equal(commitDe(json({ estado: "OK" })), null);
  });

  it("en src/server las respuestas se arman SOLO con json(): la única otra es el 404 de la ruta interna, que no es de la interfaz", () => {
    const archivos = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src/server", "src/app/api"], { cwd: RAIZ, encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".ts"));
    const crudas = archivos.filter((f) => /new Response\(|Response\.json\(|NextResponse/.test(leer(f)));
    assert.deepEqual(crudas.sort(), ["src/server/http/respuestas.ts", "src/server/interno/sincronizar.ts"]);
  });
});

describe("6D. los clientes HTTP de la interfaz pasan cada respuesta a anotarCommitDe", () => {
  const CLIENTES = ["src/components/chats/clienteChats.ts", "src/components/sesion/PanelSesion.tsx", "src/components/push/notificaciones.ts"];

  function problemasDelCliente(codigo: string): string[] {
    const p: string[] = [];
    const directos = codigo.match(/const res = await fetch\(/g)?.length ?? 0;
    const anotados = codigo.match(/const res = await fetch\([\s\S]*?\);\s*anotarCommitDe\(res\);/g)?.length ?? 0;
    if (directos !== anotados) p.push(`${directos - anotados} fetch sin anotar`);
    // Los que van por pedir(): pedir anota la respuesta antes de leerla.
    if (/pedir<[^>]+>\(\(\) => fetch\(/.test(codigo) && !/const res = await hacer\(\);\s*anotarCommitDe\(res\);/.test(codigo)) p.push("pedir() no anota");
    const todos = codigo.match(/(?<![\w-])fetch\(/g)?.length ?? 0;
    const porPedir = codigo.match(/pedir<[^>]+>\(\(\) => fetch\(|\(\) => fetch\(RUTA_LEIDO/g)?.length ?? 0;
    if (todos !== directos + porPedir) p.push("hay un fetch que no es ni directo ni por pedir()");
    return p;
  }

  it("cada fetch de los tres clientes", () => {
    for (const c of CLIENTES) assert.deepEqual(problemasDelCliente(leer(c)), [], c);
  });

  it("CONTRAPRUEBA: sacar un anotarCommitDe, o el de pedir(), es rojo", () => {
    const sesion = leer("src/components/sesion/PanelSesion.tsx");
    const chats = leer("src/components/chats/clienteChats.ts");
    const casos = {
      sesion: sesion.replace(/(const res = await fetch\(RUTA_SESION, \{ method: "DELETE"[^\n]*\n)\s*anotarCommitDe\(res\);/, "$1"),
      pedir: chats.replace(/const res = await hacer\(\);\s*anotarCommitDe\(res\);/, "const res = await hacer();"),
      otroFetch: `${chats}\nexport const x = () => fetch("/api/chats");\n`,
    };
    assert.notEqual(casos.sesion, sesion);
    assert.notEqual(casos.pedir, chats);
    for (const [nombre, codigo] of Object.entries(casos)) assert.notDeepEqual(problemasDelCliente(codigo), [], nombre);
  });
});

describe("6D. qué retiene la recarga en la interfaz: la caja con texto y la pregunta en curso", () => {
  /** La lógica está probada en test/ui/version.test.ts; acá, que la caja y usePreguntas la usen así. */
  function problemasDeLaRetencion(codigo: string): string[] {
    const p: string[] = [];
    if (!/useEffect\(\(\) => retenerRecarga\(clave, !vacia\), \[clave, vacia\]\);/.test(codigo)) p.push("la caja con texto no retiene");
    if (!/useEffect\(\(\) => \(\) => retenerRecarga\(clave, false\), \[clave\]\);/.test(codigo)) p.push("la caja no suelta al desmontarse");
    if (!/retenerRecarga\(clave, true\);\s*void preguntar\(/.test(codigo)) p.push("la pregunta no retiene ANTES de mandarse");
    if (!/enCurso\.current = null;\s*retenerRecarga\(clave, false\);/.test(codigo)) p.push("la respuesta no suelta");
    if (!/enCurso\.current\?\.abort\(\);\s*retenerRecarga\(clave, false\);/.test(codigo)) p.push("salir de la pantalla no suelta");
    return p;
  }

  it("Preguntas.tsx retiene y suelta en esos cinco lugares", () => {
    assert.deepEqual(problemasDeLaRetencion(leer("src/components/chats/Preguntas.tsx")), []);
  });

  it("CONTRAPRUEBA: sacar cualquiera es rojo", () => {
    const codigo = leer("src/components/chats/Preguntas.tsx");
    const casos = [
      codigo.replace("useEffect(() => retenerRecarga(clave, !vacia), [clave, vacia]);", ""),
      codigo.replace(/retenerRecarga\(clave, true\);\s*void preguntar\(/, "void preguntar("),
      codigo.replace(/enCurso\.current = null;\s*retenerRecarga\(clave, false\);/, "enCurso.current = null;"),
    ];
    for (const c of casos) {
      assert.notEqual(c, codigo);
      assert.notDeepEqual(problemasDeLaRetencion(c), []);
    }
  });
});
