// src/shared/erp/contrato.ts
//
// LO QUE EL ERP CONTESTA, TIPADO. Sin secretos y sin nada que hable con la red:
// es lo único del contrato ERP que la interfaz puede importar para presentar
// una respuesta.
//
// Fuente del contrato: erpmanual en 8920516 (producción), archivos
// `lib/integraciones/azul-chat/respuestaPublica.js` (códigos públicos),
// `ventasResumen.js` y `miAlcance.js` (datos). Los fixtures de
// `test/fixtures/erp-8920516.json` salen de ejecutar ese código.
// Acá no se calcula nada: el ERP calcula y Azul Chat presenta.

/** Los códigos PÚBLICOS de error del ERP. La lógica decide por estos, nunca por el texto. */
export const CODIGOS_ERROR_ERP = Object.freeze([
  "SOLICITUD_INVALIDA",
  "PERIODO_INVALIDO",
  "PERIODO_DEMASIADO_LARGO",
  "SOLICITUD_NO_AUTENTICADA",
  "CAPACIDAD_NO_DISPONIBLE",
  "VINCULO_NO_VALIDO",
  /** Solo en el canje: código inexistente, vencido, usado, revocado o de alguien inactivo. */
  "CODIGO_NO_VALIDO",
  "NO_AUTORIZADO",
  "CUERPO_DEMASIADO_GRANDE",
  "TIPO_DE_CONTENIDO_INVALIDO",
  "LIMITE_EXCEDIDO",
  "ERROR_AL_CALCULAR",
  "INTEGRACION_NO_DISPONIBLE",
] as const);

export type CodigoErrorErp = (typeof CODIGOS_ERROR_ERP)[number];

export function esCodigoErrorErp(v: unknown): v is CodigoErrorErp {
  return typeof v === "string" && (CODIGOS_ERROR_ERP as readonly string[]).includes(v);
}

/**
 * Errores que se producen en Azul Chat, antes o en vez de una respuesta del ERP.
 * Tres repiten nombre con los del ERP a propósito: son la misma falla detectada
 * antes de gastar la llamada, y la interfaz los trata igual.
 */
export const CODIGOS_ERROR_LOCAL = Object.freeze([
  "INTEGRACION_NO_CONFIGURADA",
  "SOLICITUD_INVALIDA",
  "PERIODO_INVALIDO",
  "PERIODO_DEMASIADO_LARGO",
  "TIEMPO_AGOTADO",
  "ERP_INALCANZABLE",
  "RESPUESTA_INVALIDA",
] as const);

export type CodigoErrorLocal = (typeof CODIGOS_ERROR_LOCAL)[number];

export type Periodo =
  | { readonly tipo: "hoy" }
  | { readonly tipo: "ayer" }
  | { readonly tipo: "rango"; readonly desde: string; readonly hasta: string };

export type MedioDePago = {
  readonly medio: string;
  readonly etiqueta: string;
  /** Decimal en string, con dos decimales, como lo manda el ERP. No se convierte a number. */
  readonly total: string;
  readonly cantidadPagos: number;
};

export type Advertencia = { readonly codigo: string; readonly mensaje: string };

/** `datos` de una respuesta exitosa de `ventas_resumen`, versión 1 del contrato. */
export type DatosVentasResumen = {
  readonly capacidad: "ventas_resumen";
  readonly version: 1;
  readonly local: { readonly id: number; readonly nombre: string };
  readonly grupoId: number;
  readonly periodo: {
    readonly tipo: "hoy" | "ayer" | "rango";
    readonly desde: string;
    readonly hasta: string;
    readonly zonaHoraria: string;
  };
  readonly cantidadVentas: number;
  readonly totalVendido: string;
  readonly mediosDePago: readonly MedioDePago[];
  readonly advertencias: readonly Advertencia[];
};

/** El alcance territorial que el ERP le reconoce HOY a la persona. */
export type AlcanceErp =
  | { readonly modo: "LOCAL" }
  | { readonly modo: "GRUPO"; readonly grupoId: number }
  | { readonly modo: "GLOBAL" }
  | { readonly modo: "NINGUNO" };

export type LocalEnAlcance = {
  readonly id: number;
  readonly nombre: string;
  /** El grupo que el ERP acepta para este local en una capacidad sobre un local. */
  readonly grupoId: number;
  readonly esDeposito: boolean;
  readonly activo: boolean;
  /**
   * Las capacidades sobre un local que la persona puede usar HOY en este local,
   * en el orden del catálogo del ERP (erpmanual 25172fe, Tanda 1B). Las calcula
   * el ERP con su regla de permisos; Azul Chat no las infiere ni las guarda.
   *
   * Es un ANUNCIO para armar la interfaz, no una autorización: cada consulta la
   * vuelve a decidir el ERP. Opcional porque el ERP anterior (8920516) no la
   * manda; sin ella no se anuncia nada. Es una lista ABIERTA de nombres: una
   * capacidad que Azul Chat no conoce no rompe la respuesta.
   */
  readonly capacidades?: readonly string[];
};

/** ¿El ERP anuncia esa capacidad en ese local, en esta respuesta? Sin la lista, no. */
export function anunciaCapacidad(local: LocalEnAlcance, capacidad: string): boolean {
  return Array.isArray(local.capacidades) && local.capacidades.includes(capacidad);
}

/**
 * `datos` de `mi_alcance`, versión 1. Sirve para armar la interfaz; NO es una
 * autorización: cada capacidad sobre un local la vuelve a decidir el ERP.
 */
export type DatosMiAlcance = {
  readonly capacidad: "mi_alcance";
  readonly version: 1;
  readonly usuario: { readonly id: number; readonly nombre: string };
  readonly alcance: AlcanceErp;
  readonly locales: readonly LocalEnAlcance[];
};

export type Exito<T> = { readonly ok: true; readonly datos: T; readonly requestId: string };

export type FalloErp = {
  readonly ok: false;
  readonly origen: "erp";
  readonly codigo: CodigoErrorErp;
  readonly status: number;
  readonly requestId: string;
  /** Solo en ERROR_AL_CALCULAR: la referencia que el ERP dejó en su log. */
  readonly referencia?: string;
  /** Solo en LIMITE_EXCEDIDO. Informativo: Azul Chat no reintenta solo. */
  readonly reintentarEnSegundos?: number;
  /** Texto del ERP, solo para mostrar. Ninguna lógica decide por esto. */
  readonly mensajeErp?: string;
};

export type FalloLocal = {
  readonly ok: false;
  readonly origen: "local";
  readonly codigo: CodigoErrorLocal;
  readonly requestId: string;
  /** El status HTTP, si llegó a haber respuesta (p. ej. una respuesta que no se pudo leer). */
  readonly status?: number;
};

export type ResultadoConsulta<T> = Exito<T> | FalloErp | FalloLocal;

// ── Validación de la respuesta ───────────────────────────────────────────────
//
// Lo que llega de la red no se da por bueno porque tenga `ok: true`. Si la
// forma no es la del contrato, el resultado es RESPUESTA_INVALIDA: es preferible
// no mostrar nada a mostrar un número de un contrato que no se entiende.

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === "string";
const esEnteroNoNegativo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const esEnteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const DECIMAL = /^-?\d+\.\d{2}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esMedioDePago(v: unknown): v is MedioDePago {
  return (
    esObjeto(v) &&
    esTexto(v.medio) &&
    esTexto(v.etiqueta) &&
    esTexto(v.total) &&
    DECIMAL.test(v.total) &&
    esEnteroNoNegativo(v.cantidadPagos)
  );
}

function esAdvertencia(v: unknown): v is Advertencia {
  return esObjeto(v) && esTexto(v.codigo) && esTexto(v.mensaje);
}

export function esDatosVentasResumen(v: unknown): v is DatosVentasResumen {
  if (!esObjeto(v)) return false;
  if (v.capacidad !== "ventas_resumen" || v.version !== 1) return false;
  const { local, periodo } = v;
  if (!esObjeto(local) || !esEnteroPositivo(local.id) || !esTexto(local.nombre)) return false;
  if (!esEnteroPositivo(v.grupoId)) return false;
  if (
    !esObjeto(periodo) ||
    (periodo.tipo !== "hoy" && periodo.tipo !== "ayer" && periodo.tipo !== "rango") ||
    !esTexto(periodo.desde) ||
    !FECHA.test(periodo.desde) ||
    !esTexto(periodo.hasta) ||
    !FECHA.test(periodo.hasta) ||
    !esTexto(periodo.zonaHoraria)
  ) {
    return false;
  }
  if (!esEnteroNoNegativo(v.cantidadVentas)) return false;
  if (!esTexto(v.totalVendido) || !DECIMAL.test(v.totalVendido)) return false;
  if (!Array.isArray(v.mediosDePago) || !v.mediosDePago.every(esMedioDePago)) return false;
  if (!Array.isArray(v.advertencias) || !v.advertencias.every(esAdvertencia)) return false;
  return true;
}

const soloClaves = (obj: Record<string, unknown>, claves: readonly string[]): boolean =>
  Object.keys(obj).length === claves.length && claves.every((k) => Object.prototype.hasOwnProperty.call(obj, k));

function esAlcanceErp(v: unknown): v is AlcanceErp {
  if (!esObjeto(v)) return false;
  if (v.modo === "GRUPO") return soloClaves(v, ["modo", "grupoId"]) && esEnteroPositivo(v.grupoId);
  return (v.modo === "LOCAL" || v.modo === "GLOBAL" || v.modo === "NINGUNO") && soloClaves(v, ["modo"]);
}

function esLocalEnAlcance(v: unknown): v is LocalEnAlcance {
  return (
    esObjeto(v) &&
    esEnteroPositivo(v.id) &&
    esTexto(v.nombre) &&
    esEnteroPositivo(v.grupoId) &&
    typeof v.esDeposito === "boolean" &&
    typeof v.activo === "boolean" &&
    (v.capacidades === undefined || (Array.isArray(v.capacidades) && v.capacidades.every(esTexto)))
  );
}

export function esDatosMiAlcance(v: unknown): v is DatosMiAlcance {
  if (!esObjeto(v)) return false;
  if (v.capacidad !== "mi_alcance" || v.version !== 1) return false;
  const { usuario } = v;
  if (!esObjeto(usuario) || !esEnteroPositivo(usuario.id) || !esTexto(usuario.nombre)) return false;
  if (!esAlcanceErp(v.alcance)) return false;
  return Array.isArray(v.locales) && v.locales.every(esLocalEnAlcance);
}

// ── transferencias_eventos ───────────────────────────────────────────────────
//
// Contrato de erpmanual 25172fe, `lib/integraciones/azul-chat/transferenciasEventos.js`
// (Tanda 1). Fixture: `test/fixtures/erp-25172fe.json`, generado ejecutando ese
// código. Lo que importa para no perder ni repetir eventos:
//
//   · orden total por (fechaRecepcion, transferenciaId), ascendente;
//   · `siguiente` es la posición del último evento devuelto y se manda tal
//     cual como `desde` en el pedido siguiente; sin eventos, repite el `desde`;
//   · solo salen recepciones con fechaRecepcion <= `hasta` (= ahora − 60 s);
//   · `eventoId` = TRANSFERENCIA_RECIBIDA:<transferenciaId>:<fechaRecepcion>,
//     que distingue un id reutilizado por reset-operativo.

export const CAPACIDAD_TRANSFERENCIAS_EVENTOS = "transferencias_eventos";
export const TIPO_TRANSFERENCIA_RECIBIDA = "TRANSFERENCIA_RECIBIDA";

/** La posición en el orden de los eventos: lo que el ERP devuelve en `siguiente` y acepta en `desde`. */
export type CursorTransferencias = {
  readonly fechaRecepcion: string;
  readonly transferenciaId: number;
};

export type EventoTransferenciaRecibida = {
  readonly tipo: typeof TIPO_TRANSFERENCIA_RECIBIDA;
  readonly eventoId: string;
  readonly transferenciaId: number;
  readonly fechaRecepcion: string;
  readonly origen: { readonly id: number; readonly nombre: string; readonly esDeposito: boolean };
  readonly destino: { readonly id: number; readonly nombre: string };
  /** La columna que escribió la confirmación en el ERP. */
  readonly tieneDiferencias: boolean;
  /** El conteo canónico del ERP. No se fuerza a coincidir con `tieneDiferencias`. */
  readonly lineasConDiferencia: number;
};

/** `datos` de `transferencias_eventos`, versión 1. */
export type DatosTransferenciasEventos = {
  readonly capacidad: typeof CAPACIDAD_TRANSFERENCIAS_EVENTOS;
  readonly version: 1;
  readonly local: { readonly id: number; readonly nombre: string };
  readonly grupoId: number;
  readonly hasta: string;
  readonly eventos: readonly EventoTransferenciaRecibida[];
  readonly siguiente: CursorTransferencias | null;
  readonly hayMas: boolean;
};

/** Un instante como lo escribe `Date.toISOString()`: con milisegundos y en UTC. */
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function esInstanteIso(v: unknown): v is string {
  if (typeof v !== "string" || !INSTANTE_ISO.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString() === v;
}

/** La clave que el ERP le da a cada recepción. */
export function claveDeTransferenciaRecibida(transferenciaId: number, fechaRecepcion: string): string {
  return `${TIPO_TRANSFERENCIA_RECIBIDA}:${transferenciaId}:${fechaRecepcion}`;
}

/** Exactamente `{ fechaRecepcion, transferenciaId }`: es lo que se le vuelve a mandar al ERP, que rechaza una clave de más. */
export function esCursorTransferencias(v: unknown): v is CursorTransferencias {
  return esObjeto(v) && soloClaves(v, ["fechaRecepcion", "transferenciaId"]) && esInstanteIso(v.fechaRecepcion) && esEnteroPositivo(v.transferenciaId);
}

/** a < b en el orden de los eventos. Los instantes ISO con milisegundos en UTC ordenan como texto. */
export function cursorAnterior(a: CursorTransferencias, b: CursorTransferencias): boolean {
  return a.fechaRecepcion < b.fechaRecepcion || (a.fechaRecepcion === b.fechaRecepcion && a.transferenciaId < b.transferenciaId);
}

function esEventoTransferenciaRecibida(v: unknown): v is EventoTransferenciaRecibida {
  if (!esObjeto(v)) return false;
  if (v.tipo !== TIPO_TRANSFERENCIA_RECIBIDA) return false;
  if (!esEnteroPositivo(v.transferenciaId) || !esInstanteIso(v.fechaRecepcion)) return false;
  if (v.eventoId !== claveDeTransferenciaRecibida(v.transferenciaId, v.fechaRecepcion)) return false;
  const { origen, destino } = v;
  if (!esObjeto(origen) || !esEnteroPositivo(origen.id) || !esTexto(origen.nombre) || typeof origen.esDeposito !== "boolean") return false;
  if (!esObjeto(destino) || !esEnteroPositivo(destino.id) || !esTexto(destino.nombre)) return false;
  return typeof v.tieneDiferencias === "boolean" && esEnteroNoNegativo(v.lineasConDiferencia);
}

/**
 * La forma de `datos`, y lo que el contrato hace verificable DENTRO de una
 * página: cada evento bien formado, su clave igual a la que arma el ERP, el
 * orden estricto, ninguno más nuevo que `hasta`, y `siguiente` igual al último
 * evento cuando hay eventos.
 *
 * Lo que depende del pedido —que el local sea el pedido, que el destino sea ese
 * local, que una página vacía repita el `desde`— lo mira la ingesta, que sabe
 * qué se pidió. Un campo de más en un evento no rompe la respuesta; tampoco se
 * guarda: la ingesta copia solo los campos de acá.
 */
export function esDatosTransferenciasEventos(v: unknown): v is DatosTransferenciasEventos {
  if (!esObjeto(v)) return false;
  if (v.capacidad !== CAPACIDAD_TRANSFERENCIAS_EVENTOS || v.version !== 1) return false;
  const { local } = v;
  if (!esObjeto(local) || !esEnteroPositivo(local.id) || !esTexto(local.nombre)) return false;
  if (!esEnteroPositivo(v.grupoId) || !esInstanteIso(v.hasta)) return false;
  if (typeof v.hayMas !== "boolean") return false;
  if (v.siguiente !== null && !esCursorTransferencias(v.siguiente)) return false;
  if (!Array.isArray(v.eventos) || !v.eventos.every(esEventoTransferenciaRecibida)) return false;

  const eventos = v.eventos as readonly EventoTransferenciaRecibida[];
  const hasta = v.hasta;
  let anterior: CursorTransferencias | null = null;
  for (const e of eventos) {
    const pos = { fechaRecepcion: e.fechaRecepcion, transferenciaId: e.transferenciaId };
    if (anterior && !cursorAnterior(anterior, pos)) return false;
    if (e.fechaRecepcion > hasta) return false;
    anterior = pos;
  }
  if (anterior) {
    const s = v.siguiente as CursorTransferencias | null;
    if (!s || s.fechaRecepcion !== anterior.fechaRecepcion || s.transferenciaId !== anterior.transferenciaId) return false;
  }
  // `hayMas` sale de haber leído una fila de más: sin eventos no puede haber más.
  if (v.hayMas && eventos.length === 0) return false;
  return true;
}
