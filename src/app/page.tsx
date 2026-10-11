import { AzulChat } from "@/components/chats/AzulChat";

import { leerVersion } from "../server/version.ts";

// Tanda 6C: la página se arma en cada pedido, nunca se sirve prerenderada ni
// desde una caché. Así el HTML lleva el commit de la imagen que lo sirve (el
// mismo que dice /api/version) y Next contesta con Cache-Control no-store: el
// navegador no guarda una página vieja entre despliegues. Los chunks de
// /_next/static tienen hash en el nombre y siguen inmutables.
export const dynamic = "force-dynamic";

export default function Inicio() {
  return <AzulChat commit={leerVersion().commit} />;
}
