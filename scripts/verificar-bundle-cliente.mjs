// scripts/verificar-bundle-cliente.mjs
//
// ¿EL SECRETO LLEGA AL NAVEGADOR? Se compila con un secreto CANARIO y se lo
// busca en todo lo que el navegador puede bajar: `.next/static` (JS y CSS) y
// las páginas prerenderizadas (`.html`, `.rsc`) de `.next/server/app`.
//
// También se busca el NOMBRE de la variable: que aparezca en el bundle de
// cliente significaría que algún código de cliente intenta leerla.
//
// Uso: npm run verificar:bundle   (sale con 1 si encuentra algo)
//
// El canario se genera al azar en cada corrida y no es un secreto real.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const CANARIO = `canario-${randomBytes(24).toString("hex")}`;

const build = spawnSync("npx", ["next", "build"], {
  cwd: RAIZ,
  stdio: "inherit",
  env: {
    ...process.env,
    ERP_BASE_URL: "https://erp.ejemplo.invalid",
    AZUL_CHAT_INTEGRACION_SECRET: CANARIO,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
if (build.status !== 0) {
  console.error("verificar:bundle: el build falló.");
  process.exit(1);
}

function* recorrer(dir) {
  if (!existsSync(dir)) return;
  for (const nombre of readdirSync(dir)) {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) yield* recorrer(p);
    else yield p;
  }
}

const archivos = [
  ...recorrer(path.join(RAIZ, ".next", "static")),
  ...[...recorrer(path.join(RAIZ, ".next", "server", "app"))].filter((f) => /\.(html|rsc|body|meta)$/.test(f)),
];
if (archivos.length === 0) {
  console.error("verificar:bundle: no hay archivos de cliente para revisar; el build no dejó lo esperado.");
  process.exit(1);
}

const hallazgos = [];
for (const f of archivos) {
  const contenido = readFileSync(f, "latin1");
  if (contenido.includes(CANARIO)) hallazgos.push(`${path.relative(RAIZ, f)}: contiene el valor del secreto`);
  if (contenido.includes("AZUL_CHAT_INTEGRACION_SECRET")) hallazgos.push(`${path.relative(RAIZ, f)}: nombra la variable del secreto`);
}

if (hallazgos.length) {
  console.error("verificar:bundle: el secreto llega al navegador:\n" + hallazgos.join("\n"));
  process.exit(1);
}
console.log(`verificar:bundle: ${archivos.length} archivos de cliente revisados; el secreto no aparece en ninguno.`);
