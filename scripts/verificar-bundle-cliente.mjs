// scripts/verificar-bundle-cliente.mjs
//
// ¿ALGÚN SECRETO LLEGA AL NAVEGADOR? Se compila con valores CANARIO para cada
// variable sensible —el secreto de la integración, la clave de cifrado del
// token y la URL de la base— y se los busca en todo lo que el navegador puede
// bajar: `.next/static` (JS y CSS) y las páginas prerenderizadas (`.html`,
// `.rsc`) de `.next/server/app`.
//
// También se busca el NOMBRE de cada variable: que aparezca en el bundle de
// cliente significaría que algún código de cliente intenta leerla.
//
// Uso: npm run verificar:bundle   (sale con 1 si encuentra algo)
//
// Los canarios se generan al azar en cada corrida y no son secretos reales.
// La URL canario apunta a un host .invalid: el build no se conecta a la base.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const canario = () => `canario-${randomBytes(24).toString("hex")}`;
const CANARIOS = {
  AZUL_CHAT_INTEGRACION_SECRET: canario(),
  AZUL_CHAT_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  DATABASE_URL: `postgresql://canario:${canario()}@base.ejemplo.invalid:5432/azulchat`,
};

const build = spawnSync("npx", ["next", "build"], {
  cwd: RAIZ,
  stdio: "inherit",
  env: {
    ...process.env,
    ERP_BASE_URL: "https://erp.ejemplo.invalid",
    AZUL_CHAT_INSTALACION_ID: "instalacion-canario",
    AZUL_CHAT_ORIGEN_PUBLICO: "https://chat.ejemplo.invalid",
    ...CANARIOS,
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
  for (const [variable, valor] of Object.entries(CANARIOS)) {
    if (contenido.includes(valor)) hallazgos.push(`${path.relative(RAIZ, f)}: contiene el valor de ${variable}`);
    if (contenido.includes(variable)) hallazgos.push(`${path.relative(RAIZ, f)}: nombra la variable ${variable}`);
  }
}

if (hallazgos.length) {
  console.error("verificar:bundle: un secreto llega al navegador:\n" + hallazgos.join("\n"));
  process.exit(1);
}
console.log(`verificar:bundle: ${archivos.length} archivos de cliente revisados; ninguno de los ${Object.keys(CANARIOS).length} secretos canario aparece.`);
