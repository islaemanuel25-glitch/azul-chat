// LA ESPERA DESPUÉS DE UN RECHAZO POR CUPO DEL ERP (Tanda 5B), COMO HOOK.
//
// La regla vive en logica.ts (ESPERA_TRAS_CUPO_MS, esperaTrasFalla); esto solo
// la sostiene en el tiempo: anota hasta cuándo, y un único temporizador la
// levanta. No pide nada solo: pasada la espera, reintentar sigue siendo un
// toque de la persona.

import { useCallback, useEffect, useState } from "react";

import type { FallaCliente } from "./clienteChats.ts";
import { esperaTrasFalla } from "./logica.ts";

export function useEsperaTrasCupo(): { readonly enEspera: boolean; readonly anotar: (f: FallaCliente) => void } {
  const [hasta, setHasta] = useState<number | null>(null);

  useEffect(() => {
    if (hasta === null) return;
    const t = setTimeout(() => setHasta(null), Math.max(0, hasta - Date.now()));
    return () => clearTimeout(t);
  }, [hasta]);

  const anotar = useCallback((f: FallaCliente) => {
    const h = esperaTrasFalla(f, Date.now());
    if (h !== null) setHasta(h);
  }, []);

  return { enEspera: hasta !== null, anotar };
}
