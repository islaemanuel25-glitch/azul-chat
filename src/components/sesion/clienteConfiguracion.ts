// EL PANEL HABLA CON LAS RUTAS DE CONFIGURACIÓN DESDE ACÁ (Tanda 11).
//
// Tres rutas propias, literales (lo exige secretoSoloServidor.test.ts):
// leer la configuración, guardar el horario de silencio y cerrar las otras
// sesiones. Nada se guarda en el navegador y no hay reintentos: si falla, la
// persona vuelve a tocar.

import type {
  FallaConfiguracion,
  HorarioSilencio,
  RespuestaCerrarOtras,
  RespuestaConfiguracion,
  RespuestaSilencio,
} from "../../shared/sesion/configuracion.ts";
import { anotarCommitDe } from "../chats/version.ts";

const RUTA_CONFIGURACION = "/api/sesion/configuracion";
const RUTA_SILENCIO = "/api/sesion/silencio";
const RUTA_OTRAS = "/api/sesion/otras";

export const RUTAS_DE_CONFIGURACION = Object.freeze({ configuracion: RUTA_CONFIGURACION, silencio: RUTA_SILENCIO, otras: RUTA_OTRAS });

/** La respuesta buena, o la falla de la API, o "RED" si no hubo respuesta. */
export type ResultadoConfiguracion<T> = { readonly ok: true; readonly datos: T } | { readonly ok: false; readonly falla: FallaConfiguracion["estado"] | "RED" };

const OPCIONES = { cache: "no-store", credentials: "same-origin" } as const;

async function pedir<R extends { estado: string }>(hacer: () => Promise<Response>): Promise<ResultadoConfiguracion<Extract<R, { estado: "OK" }>>> {
  try {
    const res = await hacer();
    anotarCommitDe(res); // Tanda 6D: el commit de cada respuesta (chats/version.ts)
    const cuerpo = (await res.json().catch(() => null)) as R | null;
    if (res.ok && cuerpo?.estado === "OK") return { ok: true, datos: cuerpo as Extract<R, { estado: "OK" }> };
    const estados: readonly string[] = ["SIN_SESION", "ORIGEN_NO_PERMITIDO", "SOLICITUD_INVALIDA", "SERVICIO_NO_DISPONIBLE"];
    return { ok: false, falla: cuerpo && estados.includes(cuerpo.estado) ? (cuerpo.estado as FallaConfiguracion["estado"]) : "SERVICIO_NO_DISPONIBLE" };
  } catch {
    return { ok: false, falla: "RED" };
  }
}

/** GET /api/sesion/configuracion. */
export function pedirConfiguracion() {
  return pedir<RespuestaConfiguracion>(() => fetch(RUTA_CONFIGURACION, OPCIONES));
}

/** PUT /api/sesion/silencio: el horario completo, cada vez. */
export function guardarSilencio(h: HorarioSilencio) {
  return pedir<RespuestaSilencio>(() =>
    fetch(RUTA_SILENCIO, { ...OPCIONES, method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: h.activo, desde: h.desde, hasta: h.hasta }) }),
  );
}

/** DELETE /api/sesion/otras: solo después de que la persona lo confirmó. */
export function cerrarOtrasSesiones() {
  return pedir<RespuestaCerrarOtras>(() => fetch(RUTA_OTRAS, { ...OPCIONES, method: "DELETE" }));
}
