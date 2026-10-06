// CANDADO: el secreto de la integración y la ruta del ERP viven en UN lugar del
// servidor, y nada los acerca al navegador.
//
// Lo que no se puede ver desde acá —que el bundle compilado no lo contenga— lo
// comprueba `npm run verificar:bundle`, que compila con un secreto canario y lo
// busca en todo lo que baja al navegador.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo, sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const ES_CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const rel = (f: string) => path.relative(RAIZ, f);

/** Archivos de `src` cuyo CÓDIGO (sin comentarios) contiene `patron`. */
function dondeAparece(patron: RegExp): string[] {
  return archivosDelRepo(RAIZ, "src")
    .filter((f) => ES_CODIGO.test(f))
    .filter((f) => patron.test(sinComentarios(readFileSync(f, "utf8"))))
    .map(rel);
}

describe("el secreto solo existe del lado del servidor", () => {
  it("el nombre de la variable se lee en un único archivo, de src/server", () => {
    assert.deepEqual(dondeAparece(/AZUL_CHAT_INTEGRACION_SECRET/), ["src/server/erp/config.ts"]);
  });

  it("la clave de cifrado del token se lee en un único archivo, de src/server, y .env.example no la trae", () => {
    assert.deepEqual(dondeAparece(/AZUL_CHAT_TOKEN_ENCRYPTION_KEY/), ["src/server/seguridad/cifradoToken.ts"]);
    const linea = readFileSync(path.join(RAIZ, ".env.example"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("AZUL_CHAT_TOKEN_ENCRYPTION_KEY="));
    assert.equal(linea, "AZUL_CHAT_TOKEN_ENCRYPTION_KEY=");
  });

  it("process.env se lee solo en src/server", () => {
    const fuera = dondeAparece(/process\.env/).filter((f) => !f.startsWith("src/server/"));
    assert.deepEqual(fuera, []);
  });

  it("no hay variables NEXT_PUBLIC_ (son las que Next copia al navegador)", () => {
    assert.deepEqual(dondeAparece(/NEXT_PUBLIC_/), []);
    assert.equal(/NEXT_PUBLIC_/.test(readFileSync(path.join(RAIZ, ".env.example"), "utf8").replace(/^#.*$/gm, "")), false);
  });

  it("next.config no expone variables con `env`", () => {
    const config = sinComentarios(readFileSync(path.join(RAIZ, "next.config.ts"), "utf8"));
    assert.equal(/\benv\s*:/.test(config), false);
    assert.equal(/publicRuntimeConfig/.test(config), false);
  });

  it(".env.example no trae un secreto con valor", () => {
    const linea = readFileSync(path.join(RAIZ, ".env.example"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("AZUL_CHAT_INTEGRACION_SECRET="));
    assert.equal(linea, "AZUL_CHAT_INTEGRACION_SECRET=");
  });

  it("git ignora los .env reales y no ignora .env.example", () => {
    const ignorado = (f: string) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", f], { cwd: RAIZ });
        return true;
      } catch {
        return false;
      }
    };
    for (const f of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development"]) {
      assert.equal(ignorado(f), true, f);
    }
    assert.equal(ignorado(".env.example"), false);
  });

  it("ningún .env real está trackeado", () => {
    const trackeados = execFileSync("git", ["ls-files", "--cached", "--", ".env*", "**/.env*"], { cwd: RAIZ, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => path.basename(f) !== ".env.example");
    assert.deepEqual(trackeados, []);
  });
});

describe("el cliente ERP no es genérico", () => {
  it("la ruta del ERP aparece en un solo archivo", () => {
    assert.deepEqual(dondeAparece(/\/api\/integraciones/), ["src/server/erp/cliente.ts"]);
  });

  // Hasta la tanda de sesión este candado exigía que `fetch` apareciera en un
  // solo archivo. Desde que existe el panel de sesión, el navegador llama a las
  // rutas PROPIAS de Azul Chat. Lo que se defiende sigue siendo lo mismo: al
  // ERP se sale solo desde el cliente firmado. Por eso ahora se separan las
  // dos preguntas: en src/server, HTTP saliente en un único archivo; fuera de
  // src/server, `fetch` solo hacia rutas literales `/api/sesion…`.
  it("HTTP saliente: al ERP solo desde el cliente firmado; el navegador solo a /api/sesion", () => {
    assert.deepEqual(violacionesHttp(codigoDeSrc()), []);
  });

  it("CONTRAPRUEBA: atrapa un fetch del navegador a otro lado y un segundo cliente en el servidor", () => {
    const base = codigoDeSrc();
    const casos: Record<string, string> = {
      "src/components/x/Directo.tsx": '"use client";\nfetch("https://erp.ejemplo.invalid/api/x");\n',
      "src/components/x/PorVariable.tsx": '"use client";\nconst u = "/api/erp/ventas";\nfetch(u);\n',
      "src/components/x/Armado.tsx": '"use client";\nconst id = 1;\nfetch(`/api/sesion/${id}`);\n',
      "src/shared/x/Axios.ts": 'import a from "axios";\nexport const y = a;\n',
      "src/server/otro/cliente2.ts": 'import "server-only";\nexport const z = () => fetch("http://x");\n',
    };
    for (const [archivo, codigo] of Object.entries(casos)) {
      const v = violacionesHttp({ ...base, [archivo]: codigo });
      assert.deepEqual(v, [archivo], archivo);
    }
    // Un fetch nombrado en un comentario no cuenta.
    assert.deepEqual(violacionesHttp({ ...base, "src/components/x/C.tsx": "// fetch('https://x')\nexport const c = 1;\n" }), []);
  });

  it("la capacidad pedida al ERP es ventas_resumen o mi_alcance, nada más", () => {
    // Una capacidad nueva entra a propósito, con su constructor y sus tests: este candado se actualiza ese día.
    // mi_alcance entró en la tanda de sesión (ERP 8920516).
    const capacidades = new Set<string>();
    for (const f of archivosDelRepo(RAIZ, "src/server").filter((x) => ES_CODIGO.test(x))) {
      for (const m of sinComentarios(readFileSync(f, "utf8")).matchAll(/CAPACIDAD_[A-Z_]+\s*=\s*"([^"]+)"/g)) {
        if (m[1]) capacidades.add(m[1]);
      }
    }
    assert.deepEqual([...capacidades].sort(), ["mi_alcance", "ventas_resumen"]);
  });
});

/** Código (sin comentarios) de cada archivo de src, por ruta relativa. */
function codigoDeSrc(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const f of archivosDelRepo(RAIZ, "src").filter((x) => ES_CODIGO.test(x))) salida[rel(f)] = readFileSync(f, "utf8");
  return salida;
}

const CLIENTE_ERP = "src/server/erp/cliente.ts";
const RUTA_PROPIA = /^\/api\/sesion(\/[a-z]+)*$/;

/** Archivos que hacen HTTP saliente fuera de lo permitido. */
function violacionesHttp(archivos: Record<string, string>): string[] {
  const malos: string[] = [];
  for (const [archivo, crudo] of Object.entries(archivos)) {
    if (archivo === CLIENTE_ERP) continue;
    const codigo = sinComentarios(crudo);
    if (/["']node:https?["']|["']https?["']|undici|axios|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(codigo)) {
      malos.push(archivo);
      continue;
    }
    // `Sec-Fetch-Site` es una cabecera, no una llamada: el guion no cuenta como borde.
    if (!/(?<![\w-])fetch\b(?!-)/.test(codigo)) continue;
    if (archivo.startsWith("src/server/")) {
      malos.push(archivo);
      continue;
    }
    // Fuera del servidor: cada fetch( lleva como destino un literal o una
    // constante del mismo archivo cuyo valor literal es una ruta propia.
    const constantes = new Map<string, string>();
    for (const m of codigo.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"\s*;/g)) constantes.set(m[1]!, m[2]!);
    const usos = [...codigo.matchAll(/(?<![\w-])fetch\b(?!-)\s*(\()?\s*([^,)]*)/g)];
    const bien = usos.every((m) => {
      if (!m[1]) return false; // `fetch` sin llamar: pasado como valor, no se sabe adónde va
      const arg = m[2]!.trim();
      const literal = /^"([^"]*)"$/.exec(arg)?.[1] ?? constantes.get(arg);
      return literal !== undefined && RUTA_PROPIA.test(literal);
    });
    if (!bien) malos.push(archivo);
  }
  return malos.sort();
}
