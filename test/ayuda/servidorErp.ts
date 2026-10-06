// Un ERP de mentira, en un puerto local al azar. Registra cada solicitud tal
// como llegó por la red (cabeceras, método, ruta y BYTES del cuerpo) y contesta
// lo que el test le diga. Ningún test llama al ERP real.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

/** Un vínculo con la forma real, inventado para los tests. */
export const VINCULO_PRUEBA = "vin1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

export const ENTRADA_HOY = Object.freeze({
  delegacion: { usuarioId: 7, vinculo: VINCULO_PRUEBA },
  alcance: { grupoId: 1, localId: 3 },
  periodo: { tipo: "hoy" },
});

/**
 * `datos` tal como los arma el ERP. NO está escrito a mano: es la salida de
 * `armarVentasResumen` de erpmanual (lib/integraciones/azul-chat/ventasResumen.js,
 * commit 06cc951), ejecutada con dos ventas de ejemplo, copiada sin tocar.
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
