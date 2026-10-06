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

  it("HTTP saliente (fetch, node:http/https, undici, axios) en un solo archivo de src", () => {
    assert.deepEqual(dondeAparece(/\bfetch\b|["']node:https?["']|["']https?["']|undici|axios/), ["src/server/erp/cliente.ts"]);
  });

  it("la capacidad pedida al ERP es solo ventas_resumen", () => {
    // Una capacidad nueva entra a propósito, con su constructor y sus tests: este candado se actualiza ese día.
    const capacidades = new Set<string>();
    for (const f of archivosDelRepo(RAIZ, "src/server").filter((x) => ES_CODIGO.test(x))) {
      for (const m of sinComentarios(readFileSync(f, "utf8")).matchAll(/CAPACIDAD_[A-Z_]+\s*=\s*"([^"]+)"/g)) {
        if (m[1]) capacidades.add(m[1]);
      }
    }
    assert.deepEqual([...capacidades], ["ventas_resumen"]);
  });
});
