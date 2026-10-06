// CANDADO: nada que pueda llegar al navegador alcanza `src/server`.
//
// El navegador habla con el backend de Azul Chat; el backend habla con el ERP.
// El cliente ERP y su secreto están en `src/server`, y cada archivo de ahí
// importa "server-only" (Next rompe el build si un componente de cliente lo
// arrastra). Este candado es la segunda barrera y no depende de Next: recorre
// el grafo de imports desde cada raíz de cliente.
//
// Raíces: todo archivo con "use client", y todo `src/components` y
// `src/shared`, que por definición pueden terminar en el navegador.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { alcanzables, archivosDelRepo, esArchivoCliente } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const ES_CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function raicesDeCliente(raiz: string): string[] {
  const todos = archivosDelRepo(raiz, "src").filter((f) => ES_CODIGO.test(f));
  return todos.filter((f) => {
    const rel = path.relative(raiz, f);
    return rel.startsWith(`src${path.sep}components${path.sep}`) || rel.startsWith(`src${path.sep}shared${path.sep}`) || esArchivoCliente(readFileSync(f, "utf8"));
  });
}

function violaciones(raiz: string): string[] {
  const servidor = path.join(raiz, "src", "server") + path.sep;
  const malas: string[] = [];
  for (const r of raicesDeCliente(raiz)) {
    for (const f of alcanzables(raiz, r)) {
      if (f.startsWith(servidor)) malas.push(`${path.relative(raiz, r)} → ${path.relative(raiz, f)}`);
    }
  }
  return malas;
}

describe("frontera cliente/servidor", () => {
  it("hay raíces de cliente que revisar (si no, el candado no mira nada)", () => {
    const raices = raicesDeCliente(RAIZ).map((f) => path.relative(RAIZ, f));
    assert.ok(raices.length > 0);
    assert.ok(raices.some((r) => r.includes("shared")));
    assert.ok(raices.some((r) => r.includes("components")));
  });

  it("ningún código de cliente alcanza src/server", () => {
    assert.deepEqual(violaciones(RAIZ), []);
  });

  it("cada archivo de src/server importa server-only", () => {
    const sinGuardia = archivosDelRepo(RAIZ, "src/server")
      .filter((f) => ES_CODIGO.test(f))
      .filter((f) => !/^import\s+["']server-only["'];?$/m.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(RAIZ, f));
    assert.deepEqual(sinGuardia, []);
  });

  it("CONTRAPRUEBA: detecta un componente de cliente que importa el cliente ERP, directo o de rebote", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "azul-frontera-"));
    try {
      execGitInit(tmp);
      mkdirSync(path.join(tmp, "src/server/erp"), { recursive: true });
      mkdirSync(path.join(tmp, "src/app"), { recursive: true });
      mkdirSync(path.join(tmp, "src/lib"), { recursive: true });
      writeFileSync(path.join(tmp, "src/server/erp/cliente.ts"), 'import "server-only";\nexport const x = 1;\n');
      // De rebote: un archivo neutro que reexporta el servidor, usado por un "use client".
      writeFileSync(path.join(tmp, "src/lib/puente.ts"), 'export { x } from "@/server/erp/cliente";\n');
      writeFileSync(path.join(tmp, "src/app/Boton.tsx"), '"use client";\nimport { x } from "../lib/puente.ts";\nexport const B = x;\n');
      // Un import comentado no cuenta.
      writeFileSync(path.join(tmp, "src/app/Otro.tsx"), '"use client";\n// import { x } from "@/server/erp/cliente";\nexport const O = 1;\n');
      assert.deepEqual(violaciones(tmp), [`src/app/Boton.tsx → src/server/erp/cliente.ts`]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function execGitInit(dir: string) {
  // `archivosDelRepo` enumera con git; un repo vacío alcanza (los archivos entran como untracked).
  execFileSync("git", ["init", "-q"], { cwd: dir });
}
