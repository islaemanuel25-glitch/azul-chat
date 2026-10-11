// src/server/interno/sincronizar.ts
//
// POST /api/interno/sincronizar: LA SINCRONIZACIÓN EN SEGUNDO PLANO (Tanda 5A).
//
// No es del navegador: la llama un timer de systemd del VPS cada 2 minutos
// (ops/sincronizar/), por 127.0.0.1:3100 y con su secreto (tarea.ts). Sin esa
// puerta contesta 404, igual que una ruta que no existe, y no toca la base.
//
// No es una ingesta nueva: es un DISPARADOR de la que ya existe. Por cada
// persona con el vínculo vigente y al menos una sesión que vale:
//
//   1. con su token (descifrado en el servidor, como siempre), `mi_alcance`
//      VIVO: los locales y capacidades de HOY (chats/autorizacion.ts);
//   2. la sincronización de chats/sincronizacion.ts: frecuencia mínima por (local, capacidad), arriendo, hasta 3 páginas,
//      backfill, y las mismas reglas por código. VINCULO_NO_VALIDO invalida el
//      vínculo y revoca sus sesiones (sesion/delegacion.ts); caído, lento,
//      cupo o NO_AUTORIZADO no;
//   3. los avisos push de lo nuevo, de los locales y tipos de HOY
//      (push/avisos.ts).
//
// Desde la Tanda 5B es la ÚNICA que ingiere: abrir la app ya no trae nada del
// ERP, solo pide `mi_alcance` para autorizar y lee la base.
//
// EL CUPO DEL ERP (30 consultas por persona por minuto, ventana fija), que la
// app abierta comparte con esta corrida:
//
//   · PRESUPUESTO: por persona, la corrida gasta como mucho 18 consultas
//     (`mi_alcance` + páginas) y le deja 12 a la app (chats/sincronizacion.ts,
//     PRESUPUESTO_FONDO_POR_PERSONA). Lo que no entra queda para la corrida
//     siguiente, que empieza por ahí; la persona cuenta en
//     `personasConPendientes`. No es un error: no se anota nada.
//   · CORTE: si el ERP contesta LIMITE_EXCEDIDO en CUALQUIER consulta
//     —`mi_alcance` o una página—, la corrida se corta ahí: no se le pide nada
//     más a nadie, las capacidades que faltaban de esa persona quedan con ese
//     código en su cursor y la respuesta es 200 con `cortadaPorCupo: true`. La
//     siguiente empieza por los locales que quedaron pendientes.
//
// Sin reintentos: lo que falla en una corrida lo vuelve a intentar la
// siguiente, a los 2 minutos. Correrla dos veces seguidas no hace daño: la
// segunda encuentra todo fresco (no le pide nada al ERP salvo `mi_alcance`) y
// ningún evento ya avisado se vuelve a avisar.
//
// La respuesta y el log dicen solo CUÁNTOS: ni nombres, ni locales, ni ids.

import "server-only";

import type { DependenciasSesion } from "../sesion/dependencias.ts";
import { dependenciasDeProduccion } from "../sesion/dependencias.ts";
import { delegarConContexto } from "../sesion/delegacion.ts";
import { sesionesParaSegundoPlano } from "../sesion/repositorio.ts";
import { autorizacionViva, tiposVisibles } from "../chats/autorizacion.ts";
import { esFalloDeCupo, PRESUPUESTO_FONDO_POR_PERSONA, sincronizarAutorizados } from "../chats/sincronizacion.ts";
import { json } from "../http/respuestas.ts";
import { leerConfigPush, type ConfigPush } from "../push/config.ts";
import { avisarNovedades, borrarSuscripcionesSinSesion } from "../push/avisos.ts";
import type { DependenciasEnvio } from "../push/enviar.ts";
import type { ResultadoConsulta } from "../../shared/erp/contrato.ts";
import { leerPuertaTarea, type PuertaTarea } from "./tarea.ts";

export type DependenciasTarea = DependenciasSesion & {
  readonly puerta: { ok: true; puerta: PuertaTarea } | { ok: false };
  readonly push: { ok: true; config: ConfigPush } | { ok: false };
  /** El `fetch` hacia los servicios de push. En los tests, uno de mentira. */
  readonly transportePush?: DependenciasEnvio["transporte"];
};

export function dependenciasDeTareaProduccion(): DependenciasTarea {
  const puerta = leerPuertaTarea();
  const push = leerConfigPush();
  return {
    ...dependenciasDeProduccion(),
    puerta: puerta.ok ? puerta : { ok: false },
    push: push.ok ? push : { ok: false },
  };
}

/** Lo que contesta una corrida. Solo cuentas. */
export type ResumenTarea = {
  readonly estado: "OK";
  /** Personas (vínculos vigentes con una sesión que vale) que se intentaron. */
  readonly personas: number;
  /** Personas cuyo vínculo el ERP rechazó en esta corrida: quedaron invalidadas. */
  readonly revocadas: number;
  /** Personas cuya autorización o sincronización no se pudo completar (ERP caído, lento, cupo, base). */
  readonly conFalla: number;
  readonly localesDemorados: number;
  readonly avisos: number;
  readonly enviados: number;
  readonly fallidos: number;
  readonly suscripcionesBorradas: number;
  /** El ERP dijo LIMITE_EXCEDIDO y la corrida se cortó ahí; la siguiente retoma por lo pendiente. */
  readonly cortadaPorCupo: boolean;
  /** Personas cuya corrida llegó al presupuesto y dejó locales para la siguiente. */
  readonly personasConPendientes: number;
  /** Consultas al ERP de toda la corrida, `mi_alcance` incluida. Por persona, nunca más que el presupuesto. */
  readonly consultasErp: number;
};

const noExiste = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

type DeUnaPersona = {
  localesDemorados: number;
  avisos: number;
  enviados: number;
  fallidos: number;
  borradas: number;
  cortadaPorCupo: boolean;
  conPendientes: boolean;
  consultas: number;
};

export async function manejarSincronizar(request: Request, deps: DependenciasTarea): Promise<Response> {
  // La puerta primero, antes de mirar el método o la base: sin ella, la ruta no existe.
  if (!deps.puerta.ok || !deps.puerta.puerta.admite(request.headers) || request.method !== "POST") return noExiste();
  if (!deps.config.ok || !deps.db) return json({ estado: "SERVICIO_NO_DISPONIBLE" }, { status: 503 });
  const { config } = deps.config;
  const db = deps.db;
  const inicio = deps.ahora();
  const ahora = new Date(inicio);
  const envio = deps.push.ok ? { config: deps.push.config, ...(deps.transportePush ? { transporte: deps.transportePush } : {}) } : null;

  const resumen = {
    personas: 0,
    revocadas: 0,
    conFalla: 0,
    localesDemorados: 0,
    avisos: 0,
    enviados: 0,
    fallidos: 0,
    suscripcionesBorradas: 0,
    cortadaPorCupo: false,
    personasConPendientes: 0,
    consultasErp: 0,
  };
  try {
    resumen.suscripcionesBorradas += await borrarSuscripcionesSinSesion(db, ahora);
    const sesiones = await sesionesParaSegundoPlano(db, config.instalacionId, ahora);
    for (const sesion of sesiones) {
      resumen.personas += 1;
      let r;
      try {
        r = await delegarConContexto<DeUnaPersona>({ config, db, sesion }, deps, async (token, contexto): Promise<ResultadoConsulta<DeUnaPersona>> => {
          resumen.consultasErp += 1; // mi_alcance, también cuando falla
          const a = await autorizacionViva(deps, token, contexto);
          if (!a.ok) return a;
          // `mi_alcance` ya gastó una del presupuesto de esta persona.
          const s = await sincronizarAutorizados(deps, a.datos, a.datos.autorizados, PRESUPUESTO_FONDO_POR_PERSONA - 1);
          if (!s.ok) return s.fallo; // VINCULO_NO_VALIDO: delegarConContexto invalida
          const av = await avisarNovedades(
            db,
            sesion.vinculo.id,
            s.locales.map((l) => ({ localId: l.localId, nombre: l.nombre, tipos: tiposVisibles(l.capacidades) })),
            envio,
            new Date(deps.ahora()),
          );
          return {
            ok: true,
            requestId: a.requestId,
            datos: {
              localesDemorados: s.locales.filter((l) => l.corrida === "DEMORADA").length,
              avisos: av.avisos,
              enviados: av.enviados,
              fallidos: av.fallidos,
              borradas: av.borradas,
              cortadaPorCupo: s.cortadaPorCupo,
              conPendientes: s.locales.some((l) => l.corrida === "PENDIENTE"),
              consultas: s.gastadas,
            },
          };
        });
      } catch {
        // La base de una persona falló: las demás siguen.
        deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
        resumen.conFalla += 1;
        continue;
      }
      if (r.tipo === "OK") {
        resumen.localesDemorados += r.datos.localesDemorados;
        resumen.avisos += r.datos.avisos;
        resumen.enviados += r.datos.enviados;
        resumen.fallidos += r.datos.fallidos;
        resumen.suscripcionesBorradas += r.datos.borradas;
        resumen.cortadaPorCupo = r.datos.cortadaPorCupo;
        resumen.consultasErp += r.datos.consultas;
        if (r.datos.conPendientes) resumen.personasConPendientes += 1;
      } else if (r.tipo === "SIN_SESION" && r.vinculoInvalidado) {
        resumen.revocadas += 1;
      } else {
        resumen.conFalla += 1;
        // `mi_alcance` mismo sin cupo: tampoco se sigue con las demás personas.
        if (r.tipo === "RECHAZO_ERP" && esFalloDeCupo(r.resultado)) resumen.cortadaPorCupo = true;
      }
      if (resumen.cortadaPorCupo) break;
    }
  } catch {
    deps.registrar({ evento: "sesion.falla_local", etapa: "base" });
    return json({ estado: "SERVICIO_NO_DISPONIBLE" }, { status: 503 });
  }
  deps.registrar({ evento: "tarea.sincronizar", duracionMs: Math.max(0, deps.ahora() - inicio), ...resumen });
  const cuerpo: ResumenTarea = { estado: "OK", ...resumen };
  return json(cuerpo);
}
