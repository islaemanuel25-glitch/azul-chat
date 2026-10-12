// src/shared/sesion/configuracion.ts
//
// LA CONFIGURACIÓN DEL PANEL ☰ (Tanda 11): lo que contestan las rutas y lo que
// se manda. Es lo único de la configuración que la interfaz puede importar.
//
// Nunca lleva ids internos (ni de sesión, ni de vínculo), el token ni lo que
// se le cobra a la IA en más detalle que el del mes: los dispositivos van sin
// id porque "Cerrar las otras sesiones" no elige ninguno.

/** El horario de silencio: horas enteras de Argentina, de 0 a 23, distintas. Puede cruzar la medianoche. */
export type HorarioSilencio = { readonly activo: boolean; readonly desde: number; readonly hasta: number };

/** ¿Es exactamente un horario válido? `{ activo, desde, hasta }`, sin claves de más. */
export function esHorarioSilencio(v: unknown): v is HorarioSilencio {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== 3) return false;
  const hora = (h: unknown): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;
  return typeof o.activo === "boolean" && hora(o.desde) && hora(o.hasta) && o.desde !== o.hasta;
}

/** Lo gastado en IA en el mes calendario de Argentina. */
export type SaldoIa = {
  /** Lo gastado, en centavos de dólar, redondeado para arriba: nunca se muestra menos de lo que se gastó. */
  readonly gastadoCentavos: number;
  readonly topeCentavos: number;
  /**
   * Tanda 14: las preguntas que hizo ESTA persona este mes (las suyas
   * guardadas). El gasto y el tope son de todo el negocio, uno solo para
   * todas las personas; las preguntas de los demás no se muestran.
   */
  readonly preguntasPropias: number;
  /** Ya no entra una pregunta más: hasta el 1 del mes siguiente no se contesta ninguna. */
  readonly agotado: boolean;
  /** El primer día del mes siguiente, "AAAA-MM-DD": cuándo vuelve a cero. */
  readonly reiniciaEl: string;
};

/** Una sesión vigente de la persona. Sin id ni datos del navegador: Azul Chat no los guarda. */
export type Dispositivo = {
  /** Cuándo se abrió (ISO). */
  readonly creadaEn: string;
  /** Es la sesión de este navegador. */
  readonly esEste: boolean;
};

/** GET /api/sesion/configuracion */
export type RespuestaConfiguracion =
  | {
      readonly estado: "OK";
      readonly silencio: HorarioSilencio;
      /** null: la IA no está configurada en el servidor, y la sección no se muestra. */
      readonly ia: SaldoIa | null;
      /** La de este navegador primero; las demás, de la más nueva a la más vieja. */
      readonly dispositivos: readonly Dispositivo[];
    }
  | FallaConfiguracion;

/** PUT /api/sesion/silencio — la respuesta: lo que quedó guardado. */
export type RespuestaSilencio = { readonly estado: "OK"; readonly silencio: HorarioSilencio } | FallaConfiguracion;

/** DELETE /api/sesion/otras — cuántas sesiones se cerraron (y con ellas, sus avisos). */
export type RespuestaCerrarOtras = { readonly estado: "OK"; readonly cerradas: number } | FallaConfiguracion;

export type FallaConfiguracion =
  | { readonly estado: "SIN_SESION" }
  | { readonly estado: "ORIGEN_NO_PERMITIDO" }
  | { readonly estado: "SOLICITUD_INVALIDA" }
  | { readonly estado: "SERVICIO_NO_DISPONIBLE" };
