// /manifest.webmanifest — Azul Chat instalable en el teléfono (Tanda 5A).
//
// Los colores son los tokens de src/app/globals.css (`--ac-color-marca` y
// `--ac-color-fondo`), copiados acá porque el manifest no lee CSS; un candado
// (test/frontera/alcanceUi.test.ts) comprueba que sigan siendo los mismos. Los
// íconos son propios (public/icono-*.png), generados por
// scripts/generar-iconos.mjs con esos mismos colores.

import type { MetadataRoute } from "next";

const COLOR_MARCA = "#0fa3a3";
const COLOR_FONDO = "#f4fbfa";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Azul Chat",
    short_name: "Azul Chat",
    description: "Conversaciones operativas de Azul.",
    lang: "es-AR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: COLOR_FONDO,
    theme_color: COLOR_MARCA,
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
