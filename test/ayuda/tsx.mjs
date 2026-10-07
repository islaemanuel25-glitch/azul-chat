// Deja que `node --test` importe componentes .tsx, para los tests de test/ui/.
//
// Node quita los tipos de los .ts por su cuenta, pero no entiende JSX. Este
// gancho transpila SOLO los .tsx con el TypeScript del repo (transpileModule:
// sin chequeo de tipos; eso lo hace `npm run typecheck`) y deja todo lo demás
// como está. Se carga con `node --import ./test/ayuda/tsx.mjs`.
//
// Los tests de test/ui/ corren SIN `--conditions=react-server`: con esa
// condición React no exporta los hooks del cliente.

import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const ts = createRequire(import.meta.url)("typescript");

registerHooks({
  load(url, context, next) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context);
    const archivo = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(archivo, "utf8"), {
      fileName: archivo,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
