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
  return esCursorDe(CONTRATO_TRANSFERENCIAS_EVENTOS, v);
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
  return esDatosEventosDe(CONTRATO_TRANSFERENCIAS_EVENTOS, v);
}

// ── Las capacidades de eventos, escritas una vez (Tanda 4B) ──────────────────
//
// Contrato de erpmanual 76b9a71, `lib/integraciones/azul-chat/cursorDeEventos.js`:
// `transferencias_eventos`, `pedidos_eventos`, `envios_eventos` y
// `cancelaciones_eventos` recorren cada una SU columna de fecha con el MISMO
// cursor. Lo único que cambia entre ellas es cómo se llaman la fecha y el id
// (en los eventos y en `desde`/`siguiente`) y la forma de cada evento:
//
//   · orden total por (fecha, id), ascendente;
//   · `siguiente` es la posición del último evento devuelto; sin eventos, el
//     mismo `desde` que se pidió (o null). Se manda tal cual como `desde`;
//   · `desde` lleva EXACTAMENTE esas dos claves: el ERP rechaza una de más;
//   · nada más nuevo que `hasta` (= ahora − 60 s en las cuatro);
//   · `eventoId` = <TIPO>:<id>:<fecha ISO>, que distingue un id reutilizado
//     por reset-operativo.
//
// Fixture: `test/fixtures/erp-76b9a71.json`, copiado sin tocar de erpmanual
// (`docs/integraciones/azul-chat/erp-eventos-tanda-4a.json`).

/** Una posición en el orden de una capacidad de eventos, sin los nombres de sus claves. */
export type PosicionEvento = { readonly fecha: string; readonly id: number };

/** a < b en el orden de los eventos. Los instantes ISO con milisegundos en UTC ordenan como texto. */
export function posicionAnterior(a: PosicionEvento, b: PosicionEvento): boolean {
  return a.fecha < b.fecha || (a.fecha === b.fecha && a.id < b.id);
}

/**
 * Lo que distingue a una capacidad de eventos de otra: su nombre, cómo se
 * llaman la fecha y el id, y el guardián de su evento (que incluye la clave).
 * `E` es el evento y `C` el cursor, `{ [campoFecha]: string, [campoId]: number }`.
 */
export type ContratoEventos<K extends string, E, C> = {
  readonly capacidad: K;
  readonly tipo: string;
  readonly campoFecha: keyof C & keyof E & string;
  readonly campoId: keyof C & keyof E & string;
  readonly esEvento: (v: unknown) => v is E;
};

/** `datos` de una capacidad de eventos, versión 1. */
export type DatosEventos<K extends string, E, C> = {
  readonly capacidad: K;
  readonly version: 1;
  readonly local: { readonly id: number; readonly nombre: string };
  readonly grupoId: number;
  readonly hasta: string;
  readonly eventos: readonly E[];
  readonly siguiente: C | null;
  readonly hayMas: boolean;
};

/** La posición de un evento (o de un cursor) de esa capacidad. */
export function posicionDe<K extends string, E, C>(c: ContratoEventos<K, E, C>, x: E | C): PosicionEvento {
  const o = x as Record<string, unknown>;
  return { fecha: o[c.campoFecha] as string, id: o[c.campoId] as number };
}

/** El cursor de esa capacidad: exactamente sus dos claves, la fecha como instante ISO y el id entero positivo. */
export function esCursorDe<K extends string, E, C>(c: ContratoEventos<K, E, C>, v: unknown): v is C {
  return esObjeto(v) && soloClaves(v, [c.campoFecha, c.campoId]) && esInstanteIso(v[c.campoFecha]) && esEnteroPositivo(v[c.campoId]);
}

/** El cursor armado de cero con las dos claves, en el orden del ERP: lo que se guarda y lo que se manda. */
export function cursorDe<K extends string, E, C>(c: ContratoEventos<K, E, C>, x: E | C): C {
  const p = posicionDe(c, x);
  return { [c.campoFecha]: p.fecha, [c.campoId]: p.id } as C;
}

/** La clave que el ERP le da a cada evento: <TIPO>:<id>:<fecha ISO>. */
export function claveDeEvento(tipo: string, id: number, fecha: string): string {
  return `${tipo}:${id}:${fecha}`;
}

/**
 * La forma de `datos`, y lo que el contrato hace verificable DENTRO de una
 * página: cada evento bien formado, su clave igual a la que arma el ERP, el
 * orden estricto, ninguno más nuevo que `hasta`, y `siguiente` igual al último
 * evento cuando hay eventos. Lo que depende del pedido lo mira la ingesta
 * (src/server/eventos/pagina.ts).
 */
export function esDatosEventosDe<K extends string, E, C>(c: ContratoEventos<K, E, C>, v: unknown): v is DatosEventos<K, E, C> {
  if (!esObjeto(v)) return false;
  if (v.capacidad !== c.capacidad || v.version !== 1) return false;
  const { local } = v;
  if (!esObjeto(local) || !esEnteroPositivo(local.id) || !esTexto(local.nombre)) return false;
  if (!esEnteroPositivo(v.grupoId) || !esInstanteIso(v.hasta)) return false;
  if (typeof v.hayMas !== "boolean") return false;
  if (v.siguiente !== null && !esCursorDe(c, v.siguiente)) return false;
  if (!Array.isArray(v.eventos) || !v.eventos.every((e) => c.esEvento(e))) return false;

  const eventos = v.eventos as readonly E[];
  const hasta = v.hasta;
  let anterior: PosicionEvento | null = null;
  for (const e of eventos) {
    const pos = posicionDe(c, e);
    if (anterior && !posicionAnterior(anterior, pos)) return false;
    if (pos.fecha > hasta) return false;
    anterior = pos;
  }
  if (anterior) {
    const s = v.siguiente === null ? null : posicionDe(c, v.siguiente as C);
    if (!s || s.fecha !== anterior.fecha || s.id !== anterior.id) return false;
  }
  // `hayMas` sale de haber leído una fila de más: sin eventos no puede haber más.
  if (v.hayMas && eventos.length === 0) return false;
  return true;
}

export const CONTRATO_TRANSFERENCIAS_EVENTOS: ContratoEventos<typeof CAPACIDAD_TRANSFERENCIAS_EVENTOS, EventoTransferenciaRecibida, CursorTransferencias> =
  Object.freeze({
    capacidad: CAPACIDAD_TRANSFERENCIAS_EVENTOS,
    tipo: TIPO_TRANSFERENCIA_RECIBIDA,
    campoFecha: "fechaRecepcion",
    campoId: "transferenciaId",
    esEvento: esEventoTransferenciaRecibida,
  });

/** El origen de un evento de las capacidades de la Tanda 4A del ERP: id y nombre, nada más. */
export type OrigenEvento = { readonly id: number; readonly nombre: string };

const esOrigen = (v: unknown): v is OrigenEvento => esObjeto(v) && esEnteroPositivo(v.id) && esTexto(v.nombre);
const esIdOpcional = (v: unknown): v is number | null => v === null || esEnteroPositivo(v);

// ── pedidos_eventos → PEDIDO_SOLICITADO ──────────────────────────────────────
//
// erpmanual 76b9a71, `pedidosEventos.js`. Un evento del local que PIDIÓ (el
// local de la respuesta; el evento no trae destino). `lineas` es la cantidad
// de líneas del pedido AL LEERLO: dos lecturas del mismo evento pueden traer
// números distintos con la misma clave. Un pedido cancelado se BORRA en el ERP:
// no hay evento de cancelación de pedido.

export const CAPACIDAD_PEDIDOS_EVENTOS = "pedidos_eventos";
export const TIPO_PEDIDO_SOLICITADO = "PEDIDO_SOLICITADO";

export type CursorPedidos = { readonly fechaSolicitud: string; readonly pedidoId: number };

export type EventoPedidoSolicitado = {
  readonly tipo: typeof TIPO_PEDIDO_SOLICITADO;
  readonly eventoId: string;
  readonly pedidoId: number;
  readonly fechaSolicitud: string;
  /** Quien despacha lo pedido (normalmente el depósito). */
  readonly origen: OrigenEvento;
  readonly lineas: number;
};

function esEventoPedidoSolicitado(v: unknown): v is EventoPedidoSolicitado {
  if (!esObjeto(v) || v.tipo !== TIPO_PEDIDO_SOLICITADO) return false;
  if (!esEnteroPositivo(v.pedidoId) || !esInstanteIso(v.fechaSolicitud)) return false;
  if (v.eventoId !== claveDeEvento(TIPO_PEDIDO_SOLICITADO, v.pedidoId, v.fechaSolicitud)) return false;
  return esOrigen(v.origen) && esEnteroNoNegativo(v.lineas);
}

export const CONTRATO_PEDIDOS_EVENTOS: ContratoEventos<typeof CAPACIDAD_PEDIDOS_EVENTOS, EventoPedidoSolicitado, CursorPedidos> = Object.freeze({
  capacidad: CAPACIDAD_PEDIDOS_EVENTOS,
  tipo: TIPO_PEDIDO_SOLICITADO,
  campoFecha: "fechaSolicitud",
  campoId: "pedidoId",
  esEvento: esEventoPedidoSolicitado,
});

export type DatosPedidosEventos = DatosEventos<typeof CAPACIDAD_PEDIDOS_EVENTOS, EventoPedidoSolicitado, CursorPedidos>;

// ── envios_eventos → TRANSFERENCIA_ENVIADA ───────────────────────────────────
//
// erpmanual 76b9a71, `enviosEventos.js`. Un evento del local DESTINO (el de la
// respuesta). `pedidoId` es el pedido del que vino, o null (venta interna).

export const CAPACIDAD_ENVIOS_EVENTOS = "envios_eventos";
export const TIPO_TRANSFERENCIA_ENVIADA = "TRANSFERENCIA_ENVIADA";

export type CursorEnvios = { readonly fechaEnvio: string; readonly transferenciaId: number };

export type EventoTransferenciaEnviada = {
  readonly tipo: typeof TIPO_TRANSFERENCIA_ENVIADA;
  readonly eventoId: string;
  readonly transferenciaId: number;
  readonly fechaEnvio: string;
  readonly origen: OrigenEvento;
  readonly lineas: number;
  readonly pedidoId: number | null;
};

function esEventoTransferenciaEnviada(v: unknown): v is EventoTransferenciaEnviada {
  if (!esObjeto(v) || v.tipo !== TIPO_TRANSFERENCIA_ENVIADA) return false;
  if (!esEnteroPositivo(v.transferenciaId) || !esInstanteIso(v.fechaEnvio)) return false;
  if (v.eventoId !== claveDeEvento(TIPO_TRANSFERENCIA_ENVIADA, v.transferenciaId, v.fechaEnvio)) return false;
  return esOrigen(v.origen) && esEnteroNoNegativo(v.lineas) && esIdOpcional(v.pedidoId);
}

export const CONTRATO_ENVIOS_EVENTOS: ContratoEventos<typeof CAPACIDAD_ENVIOS_EVENTOS, EventoTransferenciaEnviada, CursorEnvios> = Object.freeze({
  capacidad: CAPACIDAD_ENVIOS_EVENTOS,
  tipo: TIPO_TRANSFERENCIA_ENVIADA,
  campoFecha: "fechaEnvio",
  campoId: "transferenciaId",
  esEvento: esEventoTransferenciaEnviada,
});

export type DatosEnviosEventos = DatosEventos<typeof CAPACIDAD_ENVIOS_EVENTOS, EventoTransferenciaEnviada, CursorEnvios>;

// ── cancelaciones_eventos → TRANSFERENCIA_CANCELADA ──────────────────────────
//
// erpmanual 76b9a71, `cancelacionesEventos.js`. Un evento del local DESTINO.
// Una cancelación anterior al 2026-08-20 no tiene fecha y no sale.

export const CAPACIDAD_CANCELACIONES_EVENTOS = "cancelaciones_eventos";
export const TIPO_TRANSFERENCIA_CANCELADA = "TRANSFERENCIA_CANCELADA";

export type CursorCancelaciones = { readonly fechaCancelacion: string; readonly transferenciaId: number };

export type EventoTransferenciaCancelada = {
  readonly tipo: typeof TIPO_TRANSFERENCIA_CANCELADA;
  readonly eventoId: string;
  readonly transferenciaId: number;
  readonly fechaCancelacion: string;
  readonly origen: OrigenEvento;
  readonly pedidoId: number | null;
};

function esEventoTransferenciaCancelada(v: unknown): v is EventoTransferenciaCancelada {
  if (!esObjeto(v) || v.tipo !== TIPO_TRANSFERENCIA_CANCELADA) return false;
  if (!esEnteroPositivo(v.transferenciaId) || !esInstanteIso(v.fechaCancelacion)) return false;
  if (v.eventoId !== claveDeEvento(TIPO_TRANSFERENCIA_CANCELADA, v.transferenciaId, v.fechaCancelacion)) return false;
  return esOrigen(v.origen) && esIdOpcional(v.pedidoId);
}

export const CONTRATO_CANCELACIONES_EVENTOS: ContratoEventos<
  typeof CAPACIDAD_CANCELACIONES_EVENTOS,
  EventoTransferenciaCancelada,
  CursorCancelaciones
> = Object.freeze({
  capacidad: CAPACIDAD_CANCELACIONES_EVENTOS,
  tipo: TIPO_TRANSFERENCIA_CANCELADA,
  campoFecha: "fechaCancelacion",
  campoId: "transferenciaId",
  esEvento: esEventoTransferenciaCancelada,
});

export type DatosCancelacionesEventos = DatosEventos<typeof CAPACIDAD_CANCELACIONES_EVENTOS, EventoTransferenciaCancelada, CursorCancelaciones>;

/** Las cuatro capacidades de eventos, en el orden del catálogo del ERP. */
export const CAPACIDADES_EVENTOS = Object.freeze([
  CAPACIDAD_TRANSFERENCIAS_EVENTOS,
  CAPACIDAD_PEDIDOS_EVENTOS,
  CAPACIDAD_ENVIOS_EVENTOS,
  CAPACIDAD_CANCELACIONES_EVENTOS,
] as const);

export type CapacidadEventos = (typeof CAPACIDADES_EVENTOS)[number];

export function esDatosPedidosEventos(v: unknown): v is DatosPedidosEventos {
  return esDatosEventosDe(CONTRATO_PEDIDOS_EVENTOS, v);
}
export function esDatosEnviosEventos(v: unknown): v is DatosEnviosEventos {
  return esDatosEventosDe(CONTRATO_ENVIOS_EVENTOS, v);
}
export function esDatosCancelacionesEventos(v: unknown): v is DatosCancelacionesEventos {
  return esDatosEventosDe(CONTRATO_CANCELACIONES_EVENTOS, v);
}
