// Un ERP de mentira, en un puerto local al azar. Registra cada solicitud tal
// como llegó por la red (cabeceras, método, ruta y BYTES del cuerpo) y contesta
// lo que el test le diga. Ningún test llama al ERP real.

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

export type SolicitudRecibida = {
  metodo: string;
  ruta: string;
  cabeceras: IncomingMessage["headers"];
  cuerpo: Buffer;
};

export type Manejador = (s: SolicitudRecibida, res: ServerResponse) => void | Promise<void>;

export type ServidorErp = {
  origen: string;
  recibidas: SolicitudRecibida[];
  cerrar(): Promise<void>;
};

export function responderJson(res: ServerResponse, status: number, cuerpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

export async function levantarServidorErp(manejador: Manejador): Promise<ServidorErp> {
  const recibidas: SolicitudRecibida[] = [];
  const servidor = createServer(async (req, res) => {
    const partes: Buffer[] = [];
    for await (const p of req) partes.push(p as Buffer);
    const s: SolicitudRecibida = {
      metodo: req.method ?? "",
      ruta: req.url ?? "",
      cabeceras: req.headers,
      cuerpo: Buffer.concat(partes),
    };
    recibidas.push(s);
    await manejador(s, res);
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    origen: `http://127.0.0.1:${port}`,
    recibidas,
    cerrar: () =>
      new Promise<void>((ok) => {
        servidor.closeAllConnections();
        servidor.close(() => ok());
      }),
  };
}

/** Un secreto de prueba, largo y obviamente falso. */
export const SECRETO_PRUEBA = "secreto-de-prueba-que-no-es-real-0123456789";

/** Un código de canje con la forma real (vin1_ + 43), inventado para los tests. */
export const CODIGO_PRUEBA = "vin1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

/** Un token de delegación con la forma real (del1_ + 43), inventado para los tests. */
export const TOKEN_PRUEBA = "del1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

/** La entrada de `ventas_resumen` desde el resto de Azul Chat: qué local y qué período. */
export const ENTRADA_HOY = Object.freeze({
  alcance: { grupoId: 1, localId: 3 },
  periodo: { tipo: "hoy" },
});

/**
 * `datos` tal como los arma el ERP. NO está escrito a mano: es la salida de
 * `armarVentasResumen` de erpmanual (lib/integraciones/azul-chat/ventasResumen.js,
 * commit 06cc951; el archivo no cambió hasta 8920516), ejecutada con dos ventas
 * de ejemplo, copiada sin tocar.
 */
export const DATOS_ERP = Object.freeze({
  capacidad: "ventas_resumen",
  version: 1,
  local: { id: 3, nombre: "Local Centro" },
  grupoId: 1,
  periodo: { tipo: "hoy", desde: "2026-10-06", hasta: "2026-10-06", zonaHoraria: "America/Argentina/Cordoba" },
  cantidadVentas: 2,
  totalVendido: "1500.00",
  mediosDePago: [
    { medio: "EFECTIVO", etiqueta: "Efectivo", total: "1000.00", cantidadPagos: 1 },
    { medio: "MERCADOPAGO", etiqueta: "Mercado Pago", total: "500.00", cantidadPagos: 1 },
  ],
  advertencias: [
    {
      codigo: "DIA_EN_CURSO",
      mensaje: "El período incluye el día de hoy, que todavía no terminó: el total puede crecer.",
    },
  ],
});

/**
 * Respuestas del ERP desplegado (8920516), generadas EJECUTANDO su código:
 * el éxito del canje (atenderCanje + aRespuestaPublica), `mi_alcance`
 * (armarMiAlcance) y el cuerpo de cada código público (rechazoPublico). Ver
 * el campo `_origen` del archivo. No se editan a mano: se regeneran.
 */
export const FIXTURES_ERP = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../fixtures/erp-8920516.json"), "utf8"),
) as {
  canje: { status: number; cuerpo: { ok: true; datos: Record<string, unknown> } };
  miAlcance: { ok: true; datos: Record<string, unknown> };
  miAlcanceGrupo: { ok: true; datos: Record<string, unknown> };
  errores: Record<string, { status: number; cuerpo: Record<string, unknown> }>;
};

/** El cuerpo de éxito de un canje, con un token dado (el fixture lo trae enmascarado). */
export function cuerpoCanjeExitoso(token: string, extra: { usuarioId?: number; vinculoId?: number } = {}) {
  return { ok: true, datos: { ...FIXTURES_ERP.canje.cuerpo.datos, tokenDelegacion: token, ...extra } };
}

/** Responde con el cuerpo y el status exactos de un código público del ERP. */
export function responderErrorErp(res: ServerResponse, codigo: string): void {
  const e = ERRORES_ERP[codigo];
  if (!e) throw new Error(`el fixture no tiene ${codigo}`);
  responderJson(res, e.status, e.cuerpo);
}

/**
 * Una copia de una respuesta real para ROMPERLA a propósito en un test: los
 * mismos tipos del contrato, sin `readonly`. Un valor que el contrato no admite
 * se asigna con `as never`, para que se lea que es deliberado.
 */
export type Rompible<T> = { -readonly [K in keyof T]: Rompible<T[K]> };

/** Un pedido tal como viajó al ERP (token enmascarado) y lo que la ruta del ERP contestó. */
export type IntercambioErp = {
  readonly pedido: Record<string, unknown>;
  readonly respuesta: { readonly status: number; readonly cuerpo: Record<string, unknown> };
};

/**
 * `transferencias_eventos` y `mi_alcance` con capacidades, del ERP desplegado
 * (25172fe), generados por `scripts/generar-fixture-erp.mjs` EJECUTANDO su
 * `atenderSolicitud` de punta a punta sobre los mismos bytes que manda Azul
 * Chat. No se editan a mano: se regeneran.
 */
export const FIXTURES_ERP_25172FE = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../fixtures/erp-25172fe.json"), "utf8"),
) as {
  ahora: string;
  transferenciasEventos: Record<
    "pagina1" | "pagina2" | "vacia" | "sinDesde" | "despuesDelReset" | "cajeroSinPermiso" | "limiteFueraDeRango" | "otroLocalDelGrupo",
    IntercambioErp
  >;
  miAlcance: Record<"encargado" | "cajero" | "adminGlobal", IntercambioErp>;
};

/** Los casos que el ERP grabó para cada capacidad de eventos de la Tanda 4A. */
export type CasosEventosTanda4a = Record<"pagina1" | "pagina2" | "vacia" | "sinPermiso" | "limiteFueraDeRango" | "completa", IntercambioErp>;

/**
 * `pedidos_eventos`, `envios_eventos`, `cancelaciones_eventos` y `mi_alcance`
 * con esas capacidades, del ERP en producción (erpmanual 76b9a71, PR #167).
 * Es una COPIA SIN TOCAR de `docs/integraciones/azul-chat/erp-eventos-tanda-4a.json`
 * de ese commit (sha256 65dfb952…0685, el mismo byte a byte): lo generó
 * `scripts/pruebas-db/azulChatEventosTanda4a.mjs` del ERP EJECUTANDO su puerta
 * (`atenderSolicitudAzulChat`) contra una base descartable, en cf44d68 (ver su
 * `_origen`; el código de las tres capacidades no cambió hasta 76b9a71). No se
 * edita a mano: se vuelve a copiar.
 */
export const FIXTURES_ERP_76B9A71 = JSON.parse(readFileSync(path.join(import.meta.dirname, "../fixtures/erp-76b9a71.json"), "utf8")) as {
  ahora: string;
  pedidos_eventos: CasosEventosTanda4a;
  envios_eventos: CasosEventosTanda4a;
  cancelaciones_eventos: CasosEventosTanda4a;
  miAlcance: Record<"encargado", IntercambioErp>;
};

/** El cuerpo de un pedido del fixture con un token de verdad en lugar de la máscara, como bytes. */
export function pedidoConToken(i: IntercambioErp, token: string): string {
  return JSON.stringify(i.pedido).replace('"<token>"', JSON.stringify(token));
}

/** Las cajas de un día que el ERP grabó: el día con dos turnos, el filtro por turno y ayer sin cajas. */
export type CasosCajasDelDia = Record<"hoy" | "turnoTarde" | "ayerSinCajas", IntercambioErp>;

/**
 * `cajas_resumen` y `mi_alcance` con esa capacidad, del ERP en producción
 * (erpmanual 14ae247, PR #169, Tanda 7A). Es una COPIA SIN TOCAR de
 * `docs/integraciones/azul-chat/erp-cajas-resumen.json` de ese commit (sha256
 * c7c6470c…e292, el mismo byte a byte): lo generó
 * `scripts/pruebas-db/azulChatCajasResumen.mjs` del ERP EJECUTANDO su puerta
 * contra una base descartable, en b6190d5 (ver su `_origen`; el merge 14ae247
 * no cambió el código de la capacidad). Un día con Mañana (correcta y
 * verificada, falta, sobra, con fiado), Tarde (cerrada con destino y una
 * abierta) y una caja sin turno asignado. No se edita a mano: se vuelve a copiar.
 */
export const FIXTURES_ERP_14AE247 = JSON.parse(readFileSync(path.join(import.meta.dirname, "../fixtures/erp-14ae247.json"), "utf8")) as {
  ahora: string;
  dia: CasosCajasDelDia;
  rechazos: Record<"turnoInexistente" | "periodoInvalido" | "sinPermiso", IntercambioErp>;
  miAlcance: Record<"tesoreria" | "encargado", IntercambioErp>;
};

/** Lo que el ERP grabó para `stock_consulta` en modo producto: un caso por texto. */
export type CasosStockProducto = Record<
  "variasCoincidencias" | "unaPorCodigo" | "ninguna" | "hayMas" | "enUnidadesYKg" | "enUnidadesEnElLocal" | "enBultosEnElDeposito",
  IntercambioErp
>;

/**
 * `stock_consulta` y `mi_alcance` con esa capacidad, del ERP en producción
 * (erpmanual 41f702b, PR #170, Tanda 8A). Es una COPIA SIN TOCAR de
 * `docs/integraciones/azul-chat/erp-stock-consulta.json` de ese commit (sha256
 * 593aca1e…6c1a5, el mismo byte a byte): lo generó
 * `scripts/pruebas-db/azulChatStockConsulta.mjs` del ERP EJECUTANDO su puerta
 * contra una base descartable, en c3ebeb5 (ver su `_origen`; el merge 41f702b
 * no cambió el código de la capacidad). Un local con leches (dos con mínimo y
 * faltantes), un queso en kg, una cerveza pack x12 y doce alfajores; un
 * depósito con la cerveza en bultos y sin ningún mínimo ajustado. No se edita a
 * mano: se vuelve a copiar.
 */
export const FIXTURES_ERP_41F702B = JSON.parse(readFileSync(path.join(import.meta.dirname, "../fixtures/erp-41f702b.json"), "utf8")) as {
  ahora: string;
  producto: CasosStockProducto;
  bajoMinimo: Record<"conFaltantes" | "stockMinimoNoDisponible", IntercambioErp>;
  rechazos: Record<"textoCorto" | "modoInvalido" | "sinPermiso", IntercambioErp>;
  miAlcance: Record<"encargado" | "cajero", IntercambioErp>;
};

/**
 * `pedidos_pendientes` del ERP en producción (erpmanual ccf2894, PR #171,
 * Tanda 9A). Es una COPIA SIN TOCAR de
 * `docs/integraciones/azul-chat/erp-pedidos-pendientes.json` de ese commit: lo
 * generó `scripts/pruebas-db/azulChatPedidosPendientes.mjs` del ERP EJECUTANDO
 * su puerta contra una base descartable, en 3f19c48 (ver su `_origen`; el merge
 * ccf2894 no cambió el código de la capacidad), con el reloj de la consulta
 * 26 h 30 min después. Varios pendientes de dos orígenes, ninguno, un cancelado
 * que no aparece, sin permiso y con un parámetro de más. No se edita a mano: se
 * vuelve a copiar.
 */
export const FIXTURES_ERP_CCF2894 = JSON.parse(readFileSync(path.join(import.meta.dirname, "../fixtures/erp-ccf2894.json"), "utf8")) as {
  ahora: string;
  canceladoQueNoAparece: { id: number; estado: string };
  varios: IntercambioErp;
  ninguno: IntercambioErp;
  sinPermiso: IntercambioErp;
  conParametro: IntercambioErp;
};

/**
 * Los códigos públicos del ERP en producción, con su status y su cuerpo
 * reales: los de 8920516, más TURNO_OPERATIVO_INVALIDO, que agregó 14ae247, y
 * STOCK_MINIMO_NO_DISPONIBLE, que agregó 41f702b (`respuestaPublica.js`), con
 * la respuesta que grabó su fixture.
 */
export const ERRORES_ERP: Record<string, { status: number; cuerpo: Record<string, unknown> }> = {
  ...FIXTURES_ERP.errores,
  TURNO_OPERATIVO_INVALIDO: FIXTURES_ERP_14AE247.rechazos.turnoInexistente.respuesta,
  STOCK_MINIMO_NO_DISPONIBLE: FIXTURES_ERP_41F702B.bajoMinimo.stockMinimoNoDisponible.respuesta,
};
