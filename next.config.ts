import type { NextConfig } from "next";

// Sin `env` ni `publicRuntimeConfig`: nada del entorno del servidor se copia al
// bundle del navegador. El candado `test/frontera/secretoSoloServidor.test.ts`
// lo verifica.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
