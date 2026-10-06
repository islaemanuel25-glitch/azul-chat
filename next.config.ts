import type { NextConfig } from "next";

// Sin `env` ni `publicRuntimeConfig`: nada del entorno del servidor se copia al
// bundle del navegador. El candado `test/frontera/secretoSoloServidor.test.ts`
// lo verifica.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // La imagen de producción (Dockerfile) corre `.next/standalone/server.js`: un
  // servidor mínimo con solo los módulos que el código usa de verdad.
  output: "standalone",
  // Sin source maps en el navegador: no se publica el código fuente original.
  // Es el valor por defecto; se deja escrito para que cambiarlo sea a propósito.
  productionBrowserSourceMaps: false,
  // La app no usa `next/image`. Sin optimizador de imágenes, la ruta
  // /_next/image no existe y `sharp` (~46 MB de binarios nativos) no entra a la
  // imagen de producción.
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
};

export default nextConfig;
