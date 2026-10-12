// src/server/preguntas/cajas.ts
//
// LAS PREGUNTAS DE CAJA Y DE VENTAS POR TURNO (Tanda 7B). Con el ERP, sin IA.
//
// La IA ya interpretó (intencion.ts): un local o todos, UN día y, si la
// pregunta lo nombró, un turno como TEXTO LIBRE ("tarde"). La IA no conoce los
// nombres de los turnos del local: el código pide `cajas_resumen` del DÍA
// ENTERO y elige el turno sobre los nombres que devolvió el ERP:
//
//   · sin acentos y sin mayúsculas; el nombre exacto gana y, si no hay,
//     "contiene" en cualquiera de los dos sentidos ("turno tarde" ↔ "Tarde",
//     "mañana" ↔ "Turno Mañana");
//   · "Sin turno asignado" no es un turno: no se elige por texto;
//   · si no coincide ninguno —o coincide más de uno—, se muestran todos los
//     turnos del día y la interfaz lo avisa con una plantilla fija.
//
// Así una pregunta por turno gasta UNA consulta por local y un turno que no
// existe muestra los que sí. Azul Chat nunca le manda `turnoOperativo` al ERP,
// así que TURNO_OPERATIVO_INVALIDO no llega por acá; si llegara, es un rechazo
// más (ERP_NO_DISPONIBLE).
//
// Cupo: 1 `mi_alcance` + 1 `cajas_resumen` por local. Todos: de a uno, y la
// primera falla por cupo corta las que faltan. Sin reintentos.
//
// Las sumas de "todos los locales" las hace el código en centavos enteros
// (ventas.ts), nunca la IA; las diferencias de caja NO se suman nunca.

import "server-only";

import type { CajasDelDia, MedioDeCajaPublico, TotalesDeTurnoPublico, TurnoDeCajas } from "../../shared/chats/api.ts";
import type { FallaChats } from "../../shared/chats/api.ts";
import { EJEMPLOS_DE_PREGUNTAS, type PeriodoPregunta, type RespuestaPregunta } from "../../shared/chats/preguntas.ts";
import type { PeriodoCajas } from "../../shared/erp/contrato.ts";
import { cajasPublicas, cajasResumenDeSesion } from "../caja/cajasResumen.ts";
import { fallaDeDelegacion, fallaDeRechazo } from "../chats/manejadores.ts";
import { esFalloDeCupo } from "../chats/sincronizacion.ts";
import type { DependenciasSesion } from "../sesion/dependencias.ts";
import type { Intencion, LocalesDeHoy } from "./intencion.ts";
import { aCentavos, deCentavos } from "./ventas.ts";

/** Sin acentos, sin mayúsculas, sin espacios de más. */
export function normalizarTurno(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

/** El turno del día que nombra el texto, o null si no coincide ninguno o coincide más de uno. */
export function elegirTurno(texto: string, turnos: readonly TurnoDeCajas[]): TurnoDeCajas | null {
  const t = normalizarTurno(texto);
  if (t.length === 0) return null;
  const candidatos = turnos.filter((x) => !x.sinTurnoAsignado && normalizarTurno(x.turno.nombre).length > 0);
  // El nombre exacto gana: "tarde extendida" es ese turno, aunque también contenga "Tarde".
  const exactos = candidatos.filter((x) => normalizarTurno(x.turno.nombre) === t);
  if (exactos.length === 1) return exactos[0]!;
  const coinciden = candidatos.filter((x) => {
    const n = normalizarTurno(x.turno.nombre);
    return n.includes(t) || t.includes(n);
  });
  return coinciden.length === 1 ? coinciden[0]! : null;
}

/** El período de la pregunta → el de `cajas_resumen`: un día. */
export function aPeriodoCajas(p: PeriodoPregunta): PeriodoCajas {
  return p.tipo === "rango" ? { tipo: "fecha", fecha: p.desde } : { tipo: p.tipo };
}

/** El período que se muestra: el día que dijo el ERP. */
const periodoDelDia = (tipo: PeriodoPregunta["tipo"], fecha: string): PeriodoPregunta => ({ tipo, desde: fecha, hasta: fecha });

/** El ERP rechazó el período (forma o futuro): es una pregunta que no se puede contestar así. */
const CODIGOS_DE_PERIODO = new Set(["PERIODO_INVALIDO", "SOLICITUD_INVALIDA"]);

type LocalDeCaja = LocalesDeHoy["caja"][number];
type Consulta = { readonly tipo: "OK"; readonly cajas: CajasDelDia } | { readonly tipo: "NO_ENTIENDO" } | { readonly tipo: "FALLA"; readonly falla: FallaChats; readonly corta: boolean };

/** UNA `cajas_resumen` de un local y un día, copiada si es lo pedido. */
async function consultarCajas(headers: Headers, deps: DependenciasSesion, l: LocalDeCaja, periodo: PeriodoCajas): Promise<Consulta> {
  const r = await cajasResumenDeSesion(headers, { alcance: { grupoId: l.grupoId, localId: l.localId }, periodo }, deps);
  if (r.tipo === "SIN_SESION" || r.tipo === "SERVICIO_NO_DISPONIBLE") return { tipo: "FALLA", falla: fallaDeDelegacion(r), corta: true };
  if (r.tipo === "RECHAZO_ERP" && CODIGOS_DE_PERIODO.has(r.resultado.codigo)) return { tipo: "NO_ENTIENDO" };
  if (r.tipo === "OK") {
    const c = cajasPublicas(r.datos, { localId: l.localId, grupoId: l.grupoId, periodo });
    // El nombre de HOY, de `mi_alcance`, como en el resto de los chats.
    if (c) return { tipo: "OK", cajas: { ...c, local: { id: l.localId, nombre: l.nombre } } };
    return { tipo: "FALLA", falla: { estado: "ERP_NO_DISPONIBLE" }, corta: false };
  }
  // NO_AUTORIZADO a un local que mi_alcance anunció, TURNO_OPERATIVO_INVALIDO o cualquier otro: no disponible. El cupo, el suyo.
  const cupo = esFalloDeCupo(r.resultado);
  return { tipo: "FALLA", falla: cupo ? fallaDeRechazo(r.resultado) : { estado: "ERP_NO_DISPONIBLE" }, corta: cupo };
}

type Recorrido = { readonly bien: CajasDelDia[]; readonly fallidos: { id: number; nombre: string }[] } | { readonly respuesta: RespuestaPregunta } | { readonly falla: FallaChats };

/** Una consulta por local, de a una. Un local: cualquier falla es la de la pregunta. Todos: se dice cuáles fallaron. */
async function recorrer(headers: Headers, deps: DependenciasSesion, locales: readonly LocalDeCaja[], todos: boolean, periodo: PeriodoCajas): Promise<Recorrido> {
  const bien: CajasDelDia[] = [];
  const fallidos: { id: number; nombre: string }[] = [];
  let primeraFalla: FallaChats | null = null;
  for (const [i, l] of locales.entries()) {
    const c = await consultarCajas(headers, deps, l, periodo);
    if (c.tipo === "NO_ENTIENDO") return { respuesta: { estado: "NO_ENTIENDO", ejemplos: EJEMPLOS_DE_PREGUNTAS } };
    if (c.tipo === "OK") {
      bien.push(c.cajas);
      continue;
    }
    if (c.falla.estado === "SIN_SESION" || c.falla.estado === "SERVICIO_NO_DISPONIBLE") return { falla: c.falla };
    primeraFalla ??= c.falla;
    if (!todos) return { falla: c.falla };
    fallidos.push({ id: l.localId, nombre: l.nombre });
    if (c.corta) {
      for (const resto of locales.slice(i + 1)) fallidos.push({ id: resto.localId, nombre: resto.nombre });
      break;
    }
  }
  if (bien.length === 0) return { falla: primeraFalla ?? { estado: "ERP_NO_DISPONIBLE" } };
  return { bien, fallidos };
}

/** Las cajas con solo el turno elegido, o con todos si no se eligió. */
const soloElTurno = (c: CajasDelDia, turno: TurnoDeCajas | null): CajasDelDia => (turno ? { ...c, turnos: [turno] } : c);

export type ResultadoCajas = { readonly respuesta: RespuestaPregunta } | { readonly falla: FallaChats };

/** Intención CAJA: las cajas del día, de un local o de todos, con el turno pedido si se encontró. */
export async function cajasDePregunta(headers: Headers, deps: DependenciasSesion, intencion: Extract<Intencion, { tipo: "CAJA" }>): Promise<ResultadoCajas> {
  const periodo = aPeriodoCajas(intencion.periodo);
  const r = await recorrer(headers, deps, intencion.locales, intencion.todos, periodo);
  if (!("bien" in r)) return r;
  const turnoPedido = intencion.turno;
  const elegidos = r.bien.map((c) => (turnoPedido === null ? null : elegirTurno(turnoPedido, c.turnos)));
  // Con turno: se muestra el turno donde está; si no está en NINGUNO, todos los turnos y el aviso.
  const encontrado = turnoPedido === null || elegidos.some((t) => t !== null);
  const locales = r.bien.map((c, i) => (turnoPedido !== null && encontrado ? { ...c, turnos: elegidos[i] ? [elegidos[i]!] : [] } : c));
  const p = periodoDelDia(intencion.periodo.tipo, r.bien[0]!.fecha);
  if (!intencion.todos) {
    return { respuesta: { estado: "CAJA", alcance: "LOCAL", periodo: p, turnoPedido, turnoNoEncontrado: !encontrado, cajas: locales[0]! } };
  }
  return { respuesta: { estado: "CAJA", alcance: "TODOS", periodo: p, turnoPedido, turnoNoEncontrado: !encontrado, locales, fallidos: r.fallidos } };
}

/** La suma de los totales de varios turnos, por código y en centavos. null si algún monto no se puede leer. */
export function sumarTotalesDeTurno(totales: readonly TotalesDeTurnoPublico[]): TotalesDeTurnoPublico | null {
  let cantidad = 0;
  let total = 0n;
  let efectivo = 0n;
  const sumarMedios = (listas: readonly (readonly MedioDeCajaPublico[])[], cobrado: boolean): MedioDeCajaPublico[] | null => {
    const medios = new Map<string, { etiqueta: string; total: bigint; cantidadPagos: number }>();
    for (const lista of listas) {
      for (const m of lista) {
        const c = aCentavos(m.total);
        if (c === null) return null;
        const previo = medios.get(m.medio);
        medios.set(m.medio, { etiqueta: previo?.etiqueta ?? m.etiqueta, total: (previo?.total ?? 0n) + c, cantidadPagos: (previo?.cantidadPagos ?? 0) + m.cantidadPagos });
      }
    }
    return [...medios].map(([medio, m]) => ({ medio, etiqueta: m.etiqueta, total: deCentavos(m.total), cantidadPagos: m.cantidadPagos, cobrado }));
  };
  for (const t of totales) {
    const tv = aCentavos(t.totalVendido);
    const te = aCentavos(t.ventasEfectivo);
    if (tv === null || te === null) return null;
    cantidad += t.cantidadVentas;
    total += tv;
    efectivo += te;
  }
  const cobrados = sumarMedios(totales.map((t) => t.ventasPorMedio), true);
  const noCobrados = sumarMedios(totales.map((t) => t.ventasNoCobradas), false);
  if (!cobrados || !noCobrados) return null;
  return { cantidadVentas: cantidad, totalVendido: deCentavos(total), ventasEfectivo: deCentavos(efectivo), ventasPorMedio: cobrados, ventasNoCobradas: noCobrados };
}

/**
 * Intención VENTAS con turno (`porTurno`): las ventas de ese turno, de
 * `cajas_resumen`. Un local: el turno con sus cajas. Todos: la suma por código
 * de ese turno en cada local, sin total si algún local falló; un local que no
 * tuvo ese turno ese día aporta cero y se ve vacío.
 */
export async function ventasPorTurnoDePregunta(
  headers: Headers,
  deps: DependenciasSesion,
  intencion: Extract<Intencion, { tipo: "VENTAS" }>,
): Promise<ResultadoCajas> {
  const porTurno = intencion.porTurno!;
  const periodo = aPeriodoCajas(intencion.periodo);
  const r = await recorrer(headers, deps, porTurno.locales, intencion.todos, periodo);
  if (!("bien" in r)) return r;
  const elegidos = r.bien.map((c) => elegirTurno(porTurno.turno, c.turnos));
  const encontrado = elegidos.some((t) => t !== null);
  // El turno ya no va en "no separa": o se separó, o el aviso de turno no encontrado lo dice.
  const noSeparaPor = intencion.noSeparaPor.filter((x) => x !== "turno");
  const p = periodoDelDia(intencion.periodo.tipo, r.bien[0]!.fecha);
  if (!intencion.todos) {
    const turno = elegidos[0] ?? null;
    return {
      respuesta: {
        estado: "VENTAS_TURNO",
        alcance: "LOCAL",
        periodo: p,
        turnoPedido: porTurno.turno,
        turnoNoEncontrado: turno === null,
        noSeparaPor,
        cajas: soloElTurno(r.bien[0]!, turno),
      },
    };
  }
  const locales = r.bien.map((c, i) => (encontrado ? { ...c, turnos: elegidos[i] ? [elegidos[i]!] : [] } : c));
  const total = encontrado && r.fallidos.length === 0 ? sumarTotalesDeTurno(elegidos.filter((t): t is TurnoDeCajas => t !== null).map((t) => t.totales)) : null;
  return {
    respuesta: {
      estado: "VENTAS_TURNO",
      alcance: "TODOS",
      periodo: p,
      turnoPedido: porTurno.turno,
      turnoNoEncontrado: !encontrado,
      noSeparaPor,
      total,
      locales,
      fallidos: r.fallidos,
    },
  };
}
