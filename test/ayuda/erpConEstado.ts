// Un ERP de mentira CON ESTADO, para los tests de punta a punta de la sesión.
//
// Hace lo que hace el ERP desplegado (8920516) en lo que a Azul Chat le toca,
// y nada más:
//
//   · verifica la firma HMAC de cada solicitud (v1, aplicación, marca dentro
//     de 300 s, cuerpo exacto); sin firma buena, SOLICITUD_NO_AUTENTICADA;
//   · generar un código (autorizar) revoca el vínculo vigente de la persona y
//     crea otro, con su vinculoId, en el MISMO momento: el token viejo deja de
//     valer ahí, no al canjear (erpmanual lib/integraciones/vinculos/vinculos.js,
//     autorizarVinculo). Un vínculo vigente por persona;
//   · canje: el código sirve UNA vez y solo si su vínculo sigue vigente (un
//     código viejo, cuyo vínculo se revocó al generar otro, no canjea);
//   · consultar: el token tiene que ser de un vínculo vigente, si no,
//     VINCULO_NO_VALIDO; `mi_alcance` contesta lo que el test cargó para esa
//     persona, y sin alcance cargado, NO_AUTORIZADO; `transferencias_eventos`
//     contesta, en orden, las respuestas que el test cargó (del fixture
//     erp-25172fe.json, generado ejecutando el ERP), y si no cargó ninguna,
//     hace lo que hace el ERP 25172fe: autoriza solo si el `mi_alcance` de
//     esa persona anuncia `transferencias_eventos` para ese local y grupo
//     (si no, el NO_AUTORIZADO real de `cajeroSinPermiso`) y pagina sobre los
//     eventos que el test cargó para ese local (test/ayuda/paginadorErp.ts);
//   · modos para simular caída (503 del ERP) y cuelgue (no contesta).
//
// Los cuerpos de respuesta y de error son los del fixture generado ejecutando
// el ERP (test/fixtures/erp-8920516.json), no escritos de memoria.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { CursorTransferencias, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { paginarEventos } from "./paginadorErp.ts";
import { DATOS_ERP, FIXTURES_ERP, FIXTURES_ERP_25172FE, SECRETO_PRUEBA, levantarServidorErp, responderErrorErp, responderJson, type ServidorErp } from "./servidorErp.ts";

const RUTA_CANJEAR = "/api/integraciones/azul-chat/vinculo/canjear";
const RUTA_CONSULTAR = "/api/integraciones/azul-chat/consultar";
const VENTANA_S = 300;

export type ModoErp = "normal" | "caido" | "colgado";

type VinculoErp = { usuarioId: number; vinculoId: number; codigo: string; token: string | null; revocado: boolean };

export type ErpConEstado = ServidorErp & {
  ponerModo(m: ModoErp): void;
  /** Lo que contesta `mi_alcance` por persona. Sin entrada: NO_AUTORIZADO. */
  readonly alcances: Map<number, Record<string, unknown>>;
  /** Lo que contesta `transferencias_eventos`, en orden, a un token vigente. Vacía: el portón y la paginación del ERP. */
  readonly respuestasEventos: { status: number; cuerpo: unknown }[];
  /** Una respuesta fija de `transferencias_eventos` para un local (por id), mientras esté cargada: un local que falla y otros que no. */
  readonly respuestaParaLocal: Map<number, { status: number; cuerpo: unknown }>;
  /** Los eventos que el ERP tiene de cada local (por id), para paginar. */
  readonly eventosPorLocal: Map<number, EventoTransferenciaRecibida[]>;
  /** Lo que la persona hace en el ERP: generar un código. */
  emitirCodigo(usuarioId: number): string;
  /** Lo que la persona (o un admin) hace en el ERP: desvincular. */
  revocar(usuarioId: number): void;
  /** El token vigente de la persona, para comparar con lo que viajó. */
  tokenVigente(usuarioId: number): string | null;
  /** Cuántas solicitudes con firma INVÁLIDA llegaron. */
  readonly firmasInvalidas: () => number;
  /** Solicitudes recibidas a una ruta, con el cuerpo parseado. */
  cuerposA(ruta: "canjear" | "consultar"): Record<string, unknown>[];
};

function firmaValida(cabeceras: Record<string, string | string[] | undefined>, cuerpo: Buffer): boolean {
  const app = cabeceras["x-erp-integracion-aplicacion"];
  const marca = cabeceras["x-erp-integracion-marca"];
  const firma = cabeceras["x-erp-integracion-firma"];
  if (app !== "azul-chat" || typeof marca !== "string" || typeof firma !== "string") return false;
  if (!/^\d+$/.test(marca) || Math.abs(Date.now() / 1000 - Number(marca)) > VENTANA_S) return false;
  const esperada = createHmac("sha256", SECRETO_PRUEBA)
    .update(Buffer.concat([Buffer.from(`v1\n${app}\n${marca}\n`, "utf8"), cuerpo]))
    .digest();
  const recibida = Buffer.from(firma, "hex");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

const nuevo = (prefijo: string) => `${prefijo}${randomBytes(32).toString("base64url")}`;

export async function levantarErpConEstado(): Promise<ErpConEstado> {
  const vinculos: VinculoErp[] = [];
  let siguienteVinculo = 41;
  let invalidas = 0;
  const alcances = new Map<number, Record<string, unknown>>();
  const respuestasEventos: { status: number; cuerpo: unknown }[] = [];
  const eventosPorLocal = new Map<number, EventoTransferenciaRecibida[]>();
  const respuestaParaLocal = new Map<number, { status: number; cuerpo: unknown }>();

  const estado = { modo: "normal" as ModoErp };

  const servidor = await levantarServidorErp((s, res) => {
    if (estado.modo === "colgado") return; // no contesta: el cliente corta por tiempo
    if (!firmaValida(s.cabeceras, s.cuerpo)) {
      invalidas++;
      return responderErrorErp(res, "SOLICITUD_NO_AUTENTICADA");
    }
    if (estado.modo === "caido") return responderErrorErp(res, "INTEGRACION_NO_DISPONIBLE");
    let cuerpo: Record<string, unknown>;
    try {
      cuerpo = JSON.parse(s.cuerpo.toString("utf8"));
    } catch {
      return responderErrorErp(res, "SOLICITUD_INVALIDA");
    }

    if (s.ruta === RUTA_CANJEAR) {
      const codigo = cuerpo.codigo;
      if (Object.keys(cuerpo).length !== 1 || typeof codigo !== "string") return responderErrorErp(res, "SOLICITUD_INVALIDA");
      const v = vinculos.find((x) => x.codigo === codigo);
      // Inexistente, de un vínculo revocado o ya canjeado: para afuera, el mismo código.
      if (!v || v.revocado || v.token !== null) return responderErrorErp(res, "CODIGO_NO_VALIDO");
      v.token = nuevo("del1_");
      const plantilla = FIXTURES_ERP.canje.cuerpo.datos;
      return responderJson(res, 200, {
        ok: true,
        datos: { ...plantilla, usuarioId: v.usuarioId, vinculoId: v.vinculoId, tokenDelegacion: v.token },
      });
    }

    if (s.ruta === RUTA_CONSULTAR) {
      const delegacion = cuerpo.delegacion as { token?: unknown } | undefined;
      const v = vinculos.find((x) => x.token !== null && x.token === delegacion?.token && !x.revocado);
      if (!v) return responderErrorErp(res, "VINCULO_NO_VALIDO");
      if (cuerpo.capacidad === "mi_alcance") {
        const datos = alcances.get(v.usuarioId);
        if (!datos) return responderErrorErp(res, "NO_AUTORIZADO");
        return responderJson(res, 200, { ok: true, datos });
      }
      if (cuerpo.capacidad === "ventas_resumen") return responderJson(res, 200, { ok: true, datos: DATOS_ERP });
      if (cuerpo.capacidad === "transferencias_eventos") {
        // Las páginas las carga el test, salidas del fixture generado con el ERP (erp-25172fe.json).
        const r = respuestasEventos.shift();
        if (r) return responderJson(res, r.status, r.cuerpo);
        const pedido = cuerpo.alcance as { grupoId?: unknown; localId?: unknown } | undefined;
        const fija = typeof pedido?.localId === "number" ? respuestaParaLocal.get(pedido.localId) : undefined;
        if (fija) return responderJson(res, fija.status, fija.cuerpo);
        // El portón del ERP: el local tiene que estar en el alcance de la persona, con la capacidad.
        const parametros = (cuerpo.parametros ?? {}) as { desde?: CursorTransferencias; limite?: number };
        const locales = (alcances.get(v.usuarioId)?.locales ?? []) as { id: number; nombre: string; grupoId: number; capacidades?: unknown }[];
        const local = locales.find((l) => l.id === pedido?.localId && l.grupoId === pedido?.grupoId);
        if (!local || !Array.isArray(local.capacidades) || !local.capacidades.includes("transferencias_eventos")) {
          const negado = FIXTURES_ERP_25172FE.transferenciasEventos.cajeroSinPermiso.respuesta;
          return responderJson(res, negado.status, negado.cuerpo);
        }
        const datos = paginarEventos({
          universo: eventosPorLocal.get(local.id) ?? [],
          local: { id: local.id, nombre: local.nombre },
          grupoId: local.grupoId,
          desde: parametros.desde,
          limite: parametros.limite,
        });
        return responderJson(res, 200, { ok: true, datos });
      }
      return responderErrorErp(res, "CAPACIDAD_NO_DISPONIBLE");
    }

    responderJson(res, 404, { ok: false });
  });

  return Object.assign(servidor, {
    ponerModo(m: ModoErp) {
      estado.modo = m;
    },
    alcances,
    respuestasEventos,
    eventosPorLocal,
    respuestaParaLocal,
    emitirCodigo(usuarioId: number) {
      // Como autorizarVinculo: revoca el vigente y crea otro, en el mismo paso.
      for (const x of vinculos) if (x.usuarioId === usuarioId) x.revocado = true;
      const codigo = nuevo("vin1_");
      vinculos.push({ usuarioId, vinculoId: siguienteVinculo++, codigo, token: null, revocado: false });
      return codigo;
    },
    revocar(usuarioId: number) {
      for (const v of vinculos) if (v.usuarioId === usuarioId) v.revocado = true;
    },
    tokenVigente(usuarioId: number) {
      return vinculos.find((v) => v.usuarioId === usuarioId && !v.revocado && v.token !== null)?.token ?? null;
    },
    firmasInvalidas: () => invalidas,
    cuerposA(ruta: "canjear" | "consultar") {
      const r = ruta === "canjear" ? RUTA_CANJEAR : RUTA_CONSULTAR;
      return servidor.recibidas.filter((s) => s.ruta === r).map((s) => JSON.parse(s.cuerpo.toString("utf8")) as Record<string, unknown>);
    },
  }) as ErpConEstado;
}
