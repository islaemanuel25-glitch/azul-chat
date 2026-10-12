// src/server/erp/pedidosPendientes.ts
//
// LA SOLICITUD DE `pedidos_pendientes` (Tanda 9B): SE CONSTRUYE ACÁ Y EN NINGÚN OTRO LADO.
//
// Forma exacta del ERP en producción (erpmanual ccf2894,
// lib/integraciones/azul-chat/pedidosPendientes.js; la puerta rechaza
// cualquier clave en `parametros`):
//
//   {
//     "capacidad":  "pedidos_pendientes",
//     "delegacion": { "token": "del1_…" },
//     "alcance":    { "grupoId": 1, "localId": 3 },
//     "parametros": {}
//   }
//
// Solo FORMA: enteros positivos. Quien llama elige solo QUÉ local.

import "server-only";

import { CAPACIDAD_PEDIDOS_PENDIENTES } from "../../shared/erp/contrato.ts";
import { esTokenDelegacion } from "./credenciales.ts";
import { esEnteroPositivo, esObjetoPlano, soloEstas, tieneTodas } from "./ventasResumen.ts";

export { CAPACIDAD_PEDIDOS_PENDIENTES };

export type CuerpoPedidosPendientes = {
  readonly capacidad: typeof CAPACIDAD_PEDIDOS_PENDIENTES;
  readonly delegacion: { readonly token: string };
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly parametros: Record<string, never>;
};

/** Lo que el resto de Azul Chat le pasa al cliente: qué local. */
export type EntradaPedidosPendientes = { readonly alcance: { readonly grupoId: number; readonly localId: number } };

type Rechazo = { readonly ok: false; readonly codigo: "SOLICITUD_INVALIDA"; readonly detalle: string };

/**
 * Valida la entrada y arma el cuerpo exacto que se firma y se manda.
 *
 * @param token el token de delegación, descifrado en el servidor desde el vínculo de la sesión.
 * @param entrada `{ alcance: { grupoId, localId } }`.
 */
export function construirCuerpoPedidosPendientes(token: string, entrada: unknown): { ok: true; cuerpo: CuerpoPedidosPendientes } | Rechazo {
  const invalida = (detalle: string): Rechazo => ({ ok: false, codigo: "SOLICITUD_INVALIDA", detalle });
  if (!esTokenDelegacion(token)) return invalida("El token de delegación no tiene la forma del ERP.");
  if (!esObjetoPlano(entrada)) return invalida("La entrada tiene que ser un objeto.");
  if (!soloEstas(entrada, ["alcance"]) || !tieneTodas(entrada, ["alcance"])) return invalida("La entrada lleva exactamente alcance.");
  const { alcance } = entrada;
  if (!esObjetoPlano(alcance) || !soloEstas(alcance, ["grupoId", "localId"])) return invalida("El alcance solo acepta grupoId y localId.");
  if (!esEnteroPositivo(alcance.grupoId) || !esEnteroPositivo(alcance.localId)) return invalida("grupoId y localId tienen que ser enteros positivos.");
  return {
    ok: true,
    cuerpo: {
      capacidad: CAPACIDAD_PEDIDOS_PENDIENTES,
      delegacion: { token },
      alcance: { grupoId: alcance.grupoId, localId: alcance.localId },
      parametros: {},
    },
  };
}
