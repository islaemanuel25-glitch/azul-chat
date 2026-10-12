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
//     `ventas_resumen` contesta lo que el test cargó en `respuestasVentas` y,
//     si no cargó nada, DATOS_ERP;
//   · `pedidos_eventos`, `envios_eventos` y `cancelaciones_eventos` (Tanda
//     4B): como el ERP 76b9a71, el mismo portón por capacidad (si el local no
//     la anuncia, el NO_AUTORIZADO real de `sinPermiso` del fixture
//     erp-76b9a71.json) y la misma paginación sobre lo que cargó el test;
//   · `cajas_resumen` (Tanda 7B): como el ERP 14ae247, el portón (si el
//     local no la anuncia, el NO_AUTORIZADO real de `sinPermiso` del fixture
//     erp-14ae247.json) y el día del fixture con el local y el grupo pedidos;
//   · modos para simular caída (503 del ERP) y cuelgue (no contesta);
//   · Tanda 5B: el CUPO del ERP, apagado salvo que el test lo prenda
//     (`cupo.activar()`). Es el de erpmanual lib/integraciones/azul-chat/
//     limitador.js, copiado: 30 consultas por delegación (token) y 120 por
//     aplicación, en ventana FIJA de 60 s que arranca con la primera consulta
//     contada; un rechazo NO cuenta. Cuenta después de la firma y antes de
//     mirar el token, como atender.js. El rechazo es el LIMITE_EXCEDIDO del
//     fixture (429). El reloj es inyectable para fijar "el mismo minuto".
//
// Los cuerpos de respuesta y de error son los del fixture generado ejecutando
// el ERP (test/fixtures/erp-8920516.json), no escritos de memoria.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { CursorTransferencias, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { paginarEventos, paginarEventos4a } from "./paginadorErp.ts";
import { DATOS_ERP, FIXTURES_ERP, FIXTURES_ERP_14AE247, FIXTURES_ERP_25172FE, FIXTURES_ERP_76B9A71, SECRETO_PRUEBA, levantarServidorErp, responderErrorErp, responderJson, type ServidorErp } from "./servidorErp.ts";

const RUTA_CANJEAR = "/api/integraciones/azul-chat/vinculo/canjear";
const RUTA_CONSULTAR = "/api/integraciones/azul-chat/consultar";
const VENTANA_S = 300;

export type ModoErp = "normal" | "caido" | "colgado";

export type RespuestaVentasCargada = { readonly status: number; readonly cuerpo: unknown } | { readonly colgar: true };

type VinculoErp = { usuarioId: number; vinculoId: number; codigo: string; token: string | null; revocado: boolean };

/** El cupo del ERP (limitador.js), para prender en un test. */
export type CupoErp = {
  activar(opciones?: { maxPorUsuario?: number; maxPorAplicacion?: number; ventanaMs?: number; ahora?: () => number }): void;
  desactivar(): void;
  /** Cuántas consultas rechazó por cupo desde que se activó. */
  rechazos(): number;
};

export type ErpConEstado = ServidorErp & {
  ponerModo(m: ModoErp): void;
  readonly cupo: CupoErp;
  /** Lo que contesta `mi_alcance` por persona. Sin entrada: NO_AUTORIZADO. */
  readonly alcances: Map<number, Record<string, unknown>>;
  /** Lo que contesta `transferencias_eventos`, en orden, a un token vigente. Vacía: el portón y la paginación del ERP. */
  readonly respuestasEventos: { status: number; cuerpo: unknown }[];
  /** Una respuesta fija de `transferencias_eventos` para un local (por id), mientras esté cargada: un local que falla y otros que no. */
  readonly respuestaParaLocal: Map<number, { status: number; cuerpo: unknown }>;
  /** Lo que contesta `ventas_resumen`, en orden, a un token vigente; `colgar`: esa no contesta. Vacía: DATOS_ERP (salida real de armarVentasResumen). */
  readonly respuestasVentas: RespuestaVentasCargada[];
  /** Los eventos que el ERP tiene de cada local (por id), para paginar. */
  readonly eventosPorLocal: Map<number, EventoTransferenciaRecibida[]>;
  /** Tanda 4B: los eventos de `pedidos_eventos`, `envios_eventos` y `cancelaciones_eventos`, por `"<capacidad>:<localId>"`. */
  readonly eventosPorCapacidad: Map<string, object[]>;
  /** Tanda 4B: una respuesta fija para `"<capacidad>:<localId>"`, mientras esté cargada (una capacidad que falla y otras que no). */
  readonly respuestaParaCapacidad: Map<string, { status: number; cuerpo: unknown }>;
  /**
   * Tanda 7B: lo que contesta `cajas_resumen`, en orden; `colgar`: esa no
   * contesta. Vacía: el portón y el día del fixture erp-14ae247.json. Una fija
   * por local va en `respuestaParaCapacidad` con `"cajas_resumen:<localId>"`.
   */
  readonly respuestasCajas: RespuestaVentasCargada[];
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
  const respuestasVentas: RespuestaVentasCargada[] = [];
  const eventosPorCapacidad = new Map<string, object[]>();
  const respuestaParaCapacidad = new Map<string, { status: number; cuerpo: unknown }>();
  const respuestasCajas: RespuestaVentasCargada[] = [];

  const estado = { modo: "normal" as ModoErp };

  // El cupo, como limitador.js: ventana fija por clave, y hay que tener lugar en las dos.
  type Cuenta = { cuenta: number; resetAt: number };
  const cupo = {
    activo: false,
    maxPorUsuario: 30,
    maxPorAplicacion: 120,
    ventanaMs: 60_000,
    ahora: () => Date.now(),
    cuentas: new Map<string, Cuenta>(),
    rechazos: 0,
  };
  const consumir = (clave: string): boolean => {
    const ahora = cupo.ahora();
    const vigente = (k: string): Cuenta => {
      const c = cupo.cuentas.get(k);
      return !c || ahora >= c.resetAt ? { cuenta: 0, resetAt: ahora + cupo.ventanaMs } : c;
    };
    const app = vigente("app:azul-chat");
    const usr = vigente(`usr:azul-chat:${clave}`);
    if (app.cuenta >= cupo.maxPorAplicacion || usr.cuenta >= cupo.maxPorUsuario) return false;
    cupo.cuentas.set("app:azul-chat", { cuenta: app.cuenta + 1, resetAt: app.resetAt });
    cupo.cuentas.set(`usr:azul-chat:${clave}`, { cuenta: usr.cuenta + 1, resetAt: usr.resetAt });
    return true;
  };

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
      if (cupo.activo && !consumir(`del:${String(delegacion?.token)}`)) {
        cupo.rechazos++;
        return responderErrorErp(res, "LIMITE_EXCEDIDO");
      }
      const v = vinculos.find((x) => x.token !== null && x.token === delegacion?.token && !x.revocado);
      if (!v) return responderErrorErp(res, "VINCULO_NO_VALIDO");
      if (cuerpo.capacidad === "mi_alcance") {
        const datos = alcances.get(v.usuarioId);
        if (!datos) return responderErrorErp(res, "NO_AUTORIZADO");
        return responderJson(res, 200, { ok: true, datos });
      }
      if (cuerpo.capacidad === "ventas_resumen") {
        // Tanda 3A: una respuesta cargada por el test (un error del fixture, una forma rota) va primero.
        const r = respuestasVentas.shift();
        if (r && "colgar" in r) return; // solo esta consulta no contesta: el cliente corta por tiempo
        if (r) return responderJson(res, r.status, r.cuerpo);
        return responderJson(res, 200, { ok: true, datos: DATOS_ERP });
      }
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
      if (cuerpo.capacidad === "pedidos_eventos" || cuerpo.capacidad === "envios_eventos" || cuerpo.capacidad === "cancelaciones_eventos") {
        // Tanda 4B: lo mismo que el ERP 76b9a71 para las tres. Una respuesta
        // fija para (capacidad, local) va primero; si no, el portón —el local
        // tiene que anunciar ESA capacidad— y la paginación sobre lo cargado.
        const capacidad = cuerpo.capacidad;
        const pedido = cuerpo.alcance as { grupoId?: unknown; localId?: unknown } | undefined;
        const fija = typeof pedido?.localId === "number" ? respuestaParaCapacidad.get(`${capacidad}:${pedido.localId}`) : undefined;
        if (fija) return responderJson(res, fija.status, fija.cuerpo);
        const parametros = (cuerpo.parametros ?? {}) as { desde?: object; limite?: number };
        const locales = (alcances.get(v.usuarioId)?.locales ?? []) as { id: number; nombre: string; grupoId: number; capacidades?: unknown }[];
        const local = locales.find((l) => l.id === pedido?.localId && l.grupoId === pedido?.grupoId);
        if (!local || !Array.isArray(local.capacidades) || !local.capacidades.includes(capacidad)) {
          const negado = FIXTURES_ERP_76B9A71[capacidad].sinPermiso.respuesta;
          return responderJson(res, negado.status, negado.cuerpo);
        }
        const datos = paginarEventos4a(capacidad, {
          universo: eventosPorCapacidad.get(`${capacidad}:${local.id}`) ?? [],
          local: { id: local.id, nombre: local.nombre },
          grupoId: local.grupoId,
          desde: parametros.desde,
          limite: parametros.limite,
        });
        return responderJson(res, 200, { ok: true, datos });
      }
      if (cuerpo.capacidad === "cajas_resumen") {
        // Tanda 7B: lo que hace el ERP 14ae247. Una respuesta cargada por el
        // test va primero (por local, o en orden); si no, el portón —el local
        // anuncia `cajas_resumen`— y el día del fixture: hoy (dos turnos y
        // una caja sin turno) o ayer (sin cajas), con el local y el grupo
        // pedidos, como los devuelve el ERP.
        const pedido = cuerpo.alcance as { grupoId?: unknown; localId?: unknown } | undefined;
        const fija = typeof pedido?.localId === "number" ? respuestaParaCapacidad.get(`cajas_resumen:${pedido.localId}`) : undefined;
        if (fija) return responderJson(res, fija.status, fija.cuerpo);
        const r = respuestasCajas.shift();
        if (r && "colgar" in r) return;
        if (r) return responderJson(res, r.status, r.cuerpo);
        const locales = (alcances.get(v.usuarioId)?.locales ?? []) as { id: number; nombre: string; grupoId: number; capacidades?: unknown }[];
        const local = locales.find((l) => l.id === pedido?.localId && l.grupoId === pedido?.grupoId);
        if (!local || !Array.isArray(local.capacidades) || !local.capacidades.includes("cajas_resumen")) {
          const negado = FIXTURES_ERP_14AE247.rechazos.sinPermiso.respuesta;
          return responderJson(res, negado.status, negado.cuerpo);
        }
        const parametros = (cuerpo.parametros ?? {}) as { periodo?: { tipo?: string; fecha?: string } };
        const tipo = parametros.periodo?.tipo;
        const caso = tipo === "ayer" ? FIXTURES_ERP_14AE247.dia.ayerSinCajas : FIXTURES_ERP_14AE247.dia.hoy;
        const datos = structuredClone(caso.respuesta.cuerpo.datos) as Record<string, unknown> & { periodo: Record<string, unknown> };
        datos.local = { id: local.id, nombre: local.nombre };
        datos.grupoId = local.grupoId;
        if (tipo === "fecha") datos.periodo = { ...datos.periodo, tipo: "fecha", fecha: parametros.periodo?.fecha };
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
    cupo: {
      activar(o: { maxPorUsuario?: number; maxPorAplicacion?: number; ventanaMs?: number; ahora?: () => number } = {}) {
        Object.assign(cupo, { activo: true, maxPorUsuario: 30, maxPorAplicacion: 120, ventanaMs: 60_000, ahora: () => Date.now(), rechazos: 0 }, o);
        cupo.cuentas.clear();
      },
      desactivar() {
        cupo.activo = false;
        cupo.cuentas.clear();
      },
      rechazos: () => cupo.rechazos,
    },
    alcances,
    respuestasEventos,
    eventosPorLocal,
    respuestaParaLocal,
    respuestasVentas,
    eventosPorCapacidad,
    respuestaParaCapacidad,
    respuestasCajas,
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
