// src/server/interno/vigia.ts
//
// POST /api/interno/vigia: EL VIGÍA DE LA SINCRONIZACIÓN DE FONDO (Tanda 12).
//
// No es del navegador: lo llama un timer de systemd del VPS cada 5 minutos
// (ops/vigia/), por 127.0.0.1:3100 y con el MISMO secreto y la MISMA puerta
// que /api/interno/sincronizar (tarea.ts): sin eso contesta 404, igual que una
// ruta que no existe. No llama al ERP.
//
// Mira la salud que anota cada corrida de sincronizar (salud.ts) y decide:
//
//   · HAY INCIDENTE si el último éxito tiene más de 10 minutos, o si van 3 o
//     más fallas seguidas. Sin ningún éxito registrado (base recién migrada,
//     o solo fallas), los 10 minutos cuentan desde la primera vez que el
//     vigía miró (`vigiaDesdeEn`): así una base nueva no avisa de entrada;
//   · al ABRIRSE, UN aviso a cada destinatario: "Azul Chat no se está
//     actualizando desde las HH:MM", con el motivo en palabras simples;
//   · al CERRARSE, UN aviso a quienes recibieron el de apertura: "Azul Chat
//     volvió a actualizarse". Nada de repetir cada 5 minutos: a quién ya se le
//     avisó queda en la base, así que un reinicio de la app no repite nada.
//
// Destinatarios: SOLO las personas de AZUL_CHAT_AVISOS_SISTEMA (erpUsuarioId
// del ERP, separados por coma, como en Vinculo). Vacía, ausente o mal escrita:
// no se manda nada y queda una línea en el log. El envío es el de siempre
// (push/avisos.ts, enviarAVinculo): solo a dispositivos con una sesión que
// vale, y las suscripciones vencidas se borran.
//
// Horario de silencio (push/silencio.ts): a quien está en su horario no se le
// manda; el aviso de apertura le sale cuando termine el silencio SOLO si el
// incidente sigue abierto. Si se abrió y se cerró dentro del silencio, no
// recibe ninguno de los dos. El de recuperación, a quien lo esperaba y está en
// silencio, sale cuando termina.
//
// Tocar el aviso abre la app en la pantalla principal (`/`).
//
// Un error del envío nunca es un 500: el estado del incidente se guarda ANTES
// de mandar, y a cada persona se la anota como avisada antes de su envío. Si
// el envío falla, queda en el log y NO se reintenta: mejor un aviso perdido
// que uno cada 5 minutos.

import "server-only";

import type { Entorno } from "../erp/config.ts";
import { json } from "../http/respuestas.ts";
import { enviarAVinculo } from "../push/avisos.ts";
import { TTL_AVISO_SISTEMA_SEGUNDOS, type Aviso } from "../push/enviar.ts";
import { enSilencio } from "../push/silencio.ts";
import { dependenciasDeTareaProduccion, noExiste, type DependenciasTarea } from "./sincronizar.ts";

export const VARIABLE_AVISOS_SISTEMA = "AZUL_CHAT_AVISOS_SISTEMA";
/** Sin un éxito en este tiempo, hay incidente. */
export const SIN_EXITO_MAXIMO_MS = 10 * 60_000;
/** Con estas fallas seguidas, hay incidente. */
export const FALLAS_PARA_INCIDENTE = 3;

const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";

export type MotivoIncidente = "ERP_NO_DISPONIBLE" | "ERP_CUPO_EXCEDIDO" | "BASE" | "SIN_CORRIDAS";

/** El motivo en palabras simples, para el aviso. */
export const MOTIVO_EN_PALABRAS: Readonly<Record<MotivoIncidente, string>> = Object.freeze({
  SIN_CORRIDAS: "La actualización automática no está corriendo.",
  ERP_NO_DISPONIBLE: "El ERP no responde.",
  ERP_CUPO_EXCEDIDO: "El ERP rechaza por demasiadas consultas seguidas.",
  BASE: "Falla interna de Azul Chat.",
});

export const TEXTO_RECUPERACION = "Azul Chat volvió a actualizarse.";

/** Los destinatarios de AZUL_CHAT_AVISOS_SISTEMA. */
export type Destinatarios = { readonly tipo: "OK"; readonly ids: readonly number[] } | { readonly tipo: "VACIA" } | { readonly tipo: "INVALIDA" };

const LISTA_DE_IDS = /^\s*[1-9][0-9]{0,9}\s*(,\s*[1-9][0-9]{0,9}\s*)*$/;

/** "9, 11" → [9, 11]. Vacía o ausente: VACIA. Cualquier otra cosa: INVALIDA (no se adivina a quién avisar). */
export function leerDestinatarios(entorno: Entorno = process.env): Destinatarios {
  const crudo = entorno[VARIABLE_AVISOS_SISTEMA];
  if (crudo === undefined || crudo.trim() === "") return { tipo: "VACIA" };
  if (!LISTA_DE_IDS.test(crudo)) return { tipo: "INVALIDA" };
  const ids = [...new Set(crudo.split(",").map((x) => Number(x.trim())))];
  return ids.every((n) => Number.isSafeInteger(n) && n <= 2_147_483_647) ? { tipo: "OK", ids } : { tipo: "INVALIDA" };
}

export type DependenciasVigia = DependenciasTarea & { readonly destinatarios: Destinatarios };

export function dependenciasDeVigiaProduccion(): DependenciasVigia {
  return { ...dependenciasDeTareaProduccion(), destinatarios: leerDestinatarios() };
}

/** "desde las 14:05", o "desde el 12/10 a las 23:40" si no fue hoy (en Argentina). */
export function desdeCuando(desde: Date, ahora: Date): string {
  const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_ARGENTINA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hora = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_ARGENTINA, hour: "2-digit", minute: "2-digit", hour12: false }).format(desde);
  if (dia(desde) === dia(ahora)) return `desde las ${hora}`;
  const dm = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_ARGENTINA, day: "numeric", month: "numeric" }).format(desde);
  return `desde el ${dm} a las ${hora}`;
}

/** Los dos avisos. Etiqueta común: el de recuperación reemplaza al de apertura en la bandeja. */
// La apertura lleva el id del incidente: la hora desde la que no se actualiza,
// en ISO, que es única por incidente (cerrarlo exige un éxito más nuevo). El
// service worker no lo necesita para decidir: una apertura vieja que llega
// después de su recuperación se descarta por `creadoEn` (Tanda 13).
export function avisoDeApertura(desde: Date, motivo: MotivoIncidente, ahora: Date): Aviso {
  return {
    titulo: "Azul Chat",
    cuerpo: `Azul Chat no se está actualizando ${desdeCuando(desde, ahora)}. ${MOTIVO_EN_PALABRAS[motivo]}`,
    url: "/",
    etiqueta: "sistema",
    incidente: desde.toISOString(),
  };
}
export const AVISO_RECUPERACION: Aviso = Object.freeze({ titulo: "Azul Chat", cuerpo: TEXTO_RECUPERACION, url: "/", etiqueta: "sistema" });

type Salud = {
  ultimoExitoEn: Date | null;
  ultimaFallaEn: Date | null;
  ultimaFallaMotivo: string | null;
  fallasSeguidas: number;
  vigiaDesdeEn: Date | null;
  incidenteDesde: Date | null;
  incidenteMotivo: string | null;
  avisadosApertura: number[];
  pendientesRecuperacion: number[];
};

/** ¿Hay incidente con esta salud, ahora? Y si hay, desde cuándo y por qué. Sin efectos: lo prueban los tests. */
export function evaluar(s: Salud, ahora: Date): { hay: false } | { hay: true; desde: Date; motivo: MotivoIncidente } {
  const referencia = s.ultimoExitoEn ?? s.vigiaDesdeEn;
  if (!referencia) return { hay: false };
  const vencido = ahora.getTime() - referencia.getTime() > SIN_EXITO_MAXIMO_MS;
  if (!vencido && s.fallasSeguidas < FALLAS_PARA_INCIDENTE) return { hay: false };
  const fallaMasNueva = s.ultimaFallaEn !== null && (s.ultimoExitoEn === null || s.ultimaFallaEn > s.ultimoExitoEn);
  const motivo = (fallaMasNueva ? s.ultimaFallaMotivo : "SIN_CORRIDAS") as MotivoIncidente;
  return { hay: true, desde: referencia, motivo };
}

export type ResumenVigia = {
  readonly estado: "OK";
  readonly incidente: "SIN_INCIDENTE" | "ABIERTO" | "SIGUE" | "CERRADO";
  readonly avisosApertura: number;
  readonly avisosRecuperacion: number;
  readonly enSilencio: number;
};

export async function manejarVigia(request: Request, deps: DependenciasVigia): Promise<Response> {
  // La puerta primero, igual que sincronizar: sin ella, la ruta no existe.
  if (!deps.puerta.ok || !deps.puerta.puerta.admite(request.headers) || request.method !== "POST") return noExiste();
  if (!deps.config.ok || !deps.db) return json({ estado: "SERVICIO_NO_DISPONIBLE" }, { status: 503 });
  const db = deps.db;
  const instalacionId = deps.config.config.instalacionId;
  const ahora = new Date(deps.ahora());

  // 1. El estado del incidente, guardado ANTES de mandar nada.
  let s: Salud;
  let incidente: ResumenVigia["incidente"];
  try {
    await db.saludSincronizacion.upsert({ where: { unica: true }, create: { unica: true }, update: {} });
    s = await db.saludSincronizacion.findUniqueOrThrow({ where: { unica: true } });
    if (!s.ultimoExitoEn && !s.vigiaDesdeEn) {
      s = await db.saludSincronizacion.update({ where: { unica: true }, data: { vigiaDesdeEn: ahora } });
    }
    const e = evaluar(s, ahora);
    const abierto = s.incidenteDesde !== null;
    if (e.hay && !abierto) {
      incidente = "ABIERTO";
      // Quien esperaba la recuperación de uno anterior recibe ahora la apertura de este.
      s = await db.saludSincronizacion.update({
        where: { unica: true },
        data: { incidenteDesde: e.desde, incidenteMotivo: e.motivo, avisadosApertura: [], pendientesRecuperacion: [] },
      });
    } else if (e.hay) {
      incidente = "SIGUE";
    } else if (abierto) {
      incidente = "CERRADO";
      // Solo a quien se le avisó la apertura se le avisa que volvió.
      const pendientes = [...new Set([...s.pendientesRecuperacion, ...s.avisadosApertura])];
      s = await db.saludSincronizacion.update({
        where: { unica: true },
        data: { incidenteDesde: null, incidenteMotivo: null, avisadosApertura: [], pendientesRecuperacion: pendientes },
      });
    } else {
      incidente = "SIN_INCIDENTE";
    }
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return json({ estado: "SERVICIO_NO_DISPONIBLE" }, { status: 503 });
  }

  // 2. Los avisos. Nada de acá es un 500: lo que falla se anota y se reintenta en la próxima corrida.
  const cuentas = { avisosApertura: 0, avisosRecuperacion: 0, enSilencio: 0, enviados: 0, fallidos: 0, suscripcionesBorradas: 0 };
  let sinEnvio: "SIN_DESTINATARIOS" | "DESTINATARIOS_INVALIDOS" | "PUSH_NO_CONFIGURADO" | undefined;
  const hayQueMandar = s.incidenteDesde !== null || s.pendientesRecuperacion.length > 0;
  if (hayQueMandar) {
    if (deps.destinatarios.tipo === "VACIA") sinEnvio = "SIN_DESTINATARIOS";
    else if (deps.destinatarios.tipo === "INVALIDA") sinEnvio = "DESTINATARIOS_INVALIDOS";
    else if (!deps.push.ok) sinEnvio = "PUSH_NO_CONFIGURADO";
  }
  if (hayQueMandar && !sinEnvio && deps.destinatarios.tipo === "OK" && deps.push.ok) {
    const envio = { config: deps.push.config, ...(deps.transportePush ? { transporte: deps.transportePush } : {}) };
    try {
      const vinculos = await db.vinculo.findMany({
        where: { instalacionId, erpUsuarioId: { in: [...deps.destinatarios.ids] }, invalidadoEn: null },
        select: { id: true, erpUsuarioId: true, silencioActivo: true, silencioDesde: true, silencioHasta: true },
      });
      const callado = (v: (typeof vinculos)[number]) => enSilencio({ activo: v.silencioActivo, desde: v.silencioDesde, hasta: v.silencioHasta }, ahora);
      const mandar = async (v: (typeof vinculos)[number], aviso: Aviso) => {
        const r = await enviarAVinculo(db, v.id, [aviso], envio, ahora, TTL_AVISO_SISTEMA_SEGUNDOS);
        cuentas.enviados += r.enviados;
        cuentas.fallidos += r.fallidos;
        cuentas.suscripcionesBorradas += r.borradas;
      };
      if (s.incidenteDesde !== null && s.incidenteMotivo !== null) {
        const aviso = avisoDeApertura(s.incidenteDesde, s.incidenteMotivo as MotivoIncidente, ahora);
        for (const v of vinculos) {
          if (s.avisadosApertura.includes(v.erpUsuarioId)) continue;
          if (callado(v)) {
            cuentas.enSilencio += 1;
            continue;
          }
          // Primero se anota y después se manda: si el envío falla, no se repite cada 5 minutos.
          await db.saludSincronizacion.update({ where: { unica: true }, data: { avisadosApertura: { push: v.erpUsuarioId } } });
          cuentas.avisosApertura += 1;
          await mandar(v, aviso);
        }
      }
      if (s.pendientesRecuperacion.length > 0) {
        const quedan: number[] = [];
        for (const id of s.pendientesRecuperacion) {
          const v = vinculos.find((x) => x.erpUsuarioId === id);
          if (!v) continue; // ya no es destinatario, o no tiene vínculo: no se le puede avisar
          if (callado(v)) {
            cuentas.enSilencio += 1;
            quedan.push(id);
            continue;
          }
          cuentas.avisosRecuperacion += 1;
          await mandar(v, AVISO_RECUPERACION);
        }
        await db.saludSincronizacion.update({ where: { unica: true }, data: { pendientesRecuperacion: quedan } });
      }
    } catch {
      deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    }
  }

  deps.registrar({
    evento: "tarea.vigia",
    incidente,
    motivo: s.incidenteMotivo,
    ...(sinEnvio ? { sinEnvio } : {}),
    ...cuentas,
  });
  const cuerpo: ResumenVigia = { estado: "OK", incidente, avisosApertura: cuentas.avisosApertura, avisosRecuperacion: cuentas.avisosRecuperacion, enSilencio: cuentas.enSilencio };
  return json(cuerpo);
}
