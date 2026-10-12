// LOS ACCESOS DE CADA PERSONA (Tanda 15). Compartido entre el servidor y la
// interfaz: los nombres de los permisos, la forma de las respuestas de
// /api/sesion/accesos y la validación del cuerpo que se guarda.
//
// Una capa MÁS sobre lo que da el ERP: solo puede restar. Prender "caja" a
// quien el ERP no le da Caja no le da Caja.

/** Los seis permisos, en el orden de la pantalla. */
export const PERMISOS = ["entrar", "ventas", "caja", "stock", "pendientes", "ia"] as const;
export type Permiso = (typeof PERMISOS)[number];

export type Permisos = { readonly [P in Permiso]: boolean };

export const NINGUN_PERMISO: Permisos = Object.freeze({ entrar: false, ventas: false, caja: false, stock: false, pendientes: false, ia: false });
export const TODOS_LOS_PERMISOS: Permisos = Object.freeze({ entrar: true, ventas: true, caja: true, stock: true, pendientes: true, ia: true });

/** Una persona que alguna vez se vinculó, como la ve un administrador. */
export type PersonaConAcceso = {
  /** Su id de persona del ERP (el `erpUsuarioId` del vínculo): con este se guarda. Lo decide el servidor, no identifica a quien pide. */
  readonly personaId: number;
  /** El nombre que dio el ERP, o "Persona <id>" si nunca dio uno. */
  readonly nombre: string;
  /** Cuándo se vinculó por última vez (ISO). */
  readonly vinculadoEn: string;
  /** Administrador por AZUL_CHAT_ADMINISTRADORES: todo prendido y bloqueado. */
  readonly administrador: boolean;
  readonly permisos: Permisos;
};

export type FallaAccesos =
  | { readonly estado: "SIN_SESION" }
  /** No es administrador (o no entra): la sección no existe para esta persona. */
  | { readonly estado: "SIN_ACCESO" }
  | { readonly estado: "ORIGEN_NO_PERMITIDO" }
  | { readonly estado: "SOLICITUD_INVALIDA" }
  /** La persona elegida es administradora: sus accesos no se tocan (tampoco los propios). */
  | { readonly estado: "ES_ADMINISTRADOR" }
  /** No hay ninguna persona vinculada con ese id. */
  | { readonly estado: "PERSONA_DESCONOCIDA" }
  /** Tanda 16: el ERP, consultado en este pedido, no lo autoriza (o no contesta, o se le pidió mucho seguido). */
  | { readonly estado: "NO_AUTORIZADO" }
  | { readonly estado: "ERP_NO_DISPONIBLE" }
  | { readonly estado: "ERP_CUPO_EXCEDIDO" }
  | { readonly estado: "SERVICIO_NO_DISPONIBLE" };

/** GET /api/sesion/accesos. */
export type RespuestaAccesos = { readonly estado: "OK"; readonly personas: readonly PersonaConAcceso[] } | FallaAccesos;

/** PUT /api/sesion/accesos: los seis permisos de UNA persona, enteros, cada vez. */
export type PedidoAccesos = { readonly personaId: number } & Permisos;

export type RespuestaGuardarAccesos = { readonly estado: "OK"; readonly persona: PersonaConAcceso } | FallaAccesos;

/** ¿Es exactamente `{ personaId, entrar, ventas, caja, stock, pendientes, ia }`, con un id positivo y seis booleanos? */
export function esPedidoAccesos(v: unknown): v is PedidoAccesos {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const claves = Object.keys(o).sort();
  if (JSON.stringify(claves) !== JSON.stringify(["personaId", ...PERMISOS].sort())) return false;
  const id = o.personaId;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return false;
  return PERMISOS.every((p) => typeof o[p] === "boolean");
}

/** ¿Tiene ese permiso? Sin "entrar", ninguno vale. */
export function permite(p: Permisos, permiso: Permiso): boolean {
  return p.entrar && p[permiso];
}
