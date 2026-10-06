import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// El código que puede terminar en el navegador no importa nada de `src/server`.
// Esta regla es la primera barrera (avisa en el editor); la que no se puede
// saltear es `test/frontera/clienteNoImportaServidor.test.ts`, que recorre el
// grafo de imports desde cada archivo "use client".
const SIN_SERVIDOR = {
  patterns: [
    {
      group: ["@/server", "@/server/*", "**/server", "**/server/*", "**/server/**"],
      message: "El código de cliente no puede importar src/server: el cliente ERP y su secreto viven solo en el servidor.",
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/components/**", "src/shared/**"],
    rules: {
      "no-restricted-imports": ["error", SIN_SERVIDOR],
    },
  },
  {
    files: ["src/**"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // El registrador estructurado es el único lugar que escribe en consola.
    files: ["src/server/log.ts", "scripts/**"],
    rules: { "no-console": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),
]);
