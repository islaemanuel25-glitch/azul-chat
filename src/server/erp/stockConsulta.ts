// src/server/erp/stockConsulta.ts
//
// LA SOLICITUD DE `stock_consulta` (Tanda 8B): SE CONSTRUYE ACÁ Y EN NINGÚN OTRO LADO.
//
// Forma exacta del ERP en producción (erpmanual 41f702b,
// lib/integraciones/azul-chat/stockConsulta.js, `resolverPedido`):
//
//   {
//     "capacidad":  "stock_consulta",
//     "delegacion": { "token": "del1_…" },
//     "alcance":    { "grupoId": 1, "localId": 3 },
//     "parametros": { "modo": "producto", "texto": "leche" }
//   }
//
// o `"parametros": { "modo": "bajo_minimo" }`, sin texto. El texto es el
// producto tal como lo escribió la persona: lo busca el ERP, con su buscador.
//
// Solo FORMA: enteros positivos, el modo del catálogo y un texto de 2 a 60
// caracteres (sin los espacios de los bordes, como lo cuenta el ERP).

import "server-only";

import type { ModoStock } from "../../shared/erp/contrato.ts";
import { CAPACIDAD_STOCK_CONSULTA, LARGO_MAXIMO_TEXTO_STOCK, LARGO_MINIMO_TEXTO_STOCK } from "../../shared/erp/contrato.ts";
import { esTokenDelegacion } from "./credenciales.ts";
import { esEnteroPositivo, esObjetoPlano, soloEstas, tieneTodas } from "./ventasResumen.ts";

export { CAPACIDAD_STOCK_CONSULTA };

export type ParametrosStock = { readonly modo: "producto"; readonly texto: string } | { readonly modo: "bajo_minimo" };

export type CuerpoStockConsulta = {
  readonly capacidad: typeof CAPACIDAD_STOCK_CONSULTA;
  readonly delegacion: { readonly token: string };
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly parametros: ParametrosStock;
};

/** Lo que el resto de Azul Chat le pasa al cliente: qué local y qué se pregunta. */
export type EntradaStockConsulta = {
  readonly alcance: { readonly grupoId: number; readonly localId: number };
  readonly parametros: ParametrosStock;
};

type Rechazo = { readonly ok: false; readonly codigo: "SOLICITUD_INVALIDA"; readonly detalle: string };

/** ¿Es un texto de búsqueda que el ERP acepta? Lo usan también las preguntas. */
export function esTextoDeStock(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length >= LARGO_MINIMO_TEXTO_STOCK && t.length <= LARGO_MAXIMO_TEXTO_STOCK;
}

function validarParametros(p: unknown): { ok: true; parametros: ParametrosStock } | Rechazo {
  const invalida = (detalle: string): Rechazo => ({ ok: false, codigo: "SOLICITUD_INVALIDA", detalle });
  if (!esObjetoPlano(p)) return invalida("Faltan los parámetros: modo y, para producto, texto.");
  const modo = p.modo as ModoStock | unknown;
  if (modo === "bajo_minimo") {
    if (!soloEstas(p, ["modo"])) return invalida("bajo_minimo no lleva texto.");
    return { ok: true, parametros: { modo: "bajo_minimo" } };
  }
  if (modo !== "producto") return invalida("El modo tiene que ser producto o bajo_minimo.");
  if (!soloEstas(p, ["modo", "texto"]) || !esTextoDeStock(p.texto)) {
    return invalida(`El texto tiene que tener entre ${LARGO_MINIMO_TEXTO_STOCK} y ${LARGO_MAXIMO_TEXTO_STOCK} caracteres.`);
  }
  return { ok: true, parametros: { modo: "producto", texto: (p.texto as string).trim() } };
}

/**
 * Valida la entrada y arma el cuerpo exacto que se firma y se manda.
 *
 * @param token el token de delegación, descifrado en el servidor desde el vínculo de la sesión.
 * @param entrada `{ alcance: { grupoId, localId }, parametros }`.
 */
export function construirCuerpoStockConsulta(token: string, entrada: unknown): { ok: true; cuerpo: CuerpoStockConsulta } | Rechazo {
  const invalida = (detalle: string): Rechazo => ({ ok: false, codigo: "SOLICITUD_INVALIDA", detalle });
  if (!esTokenDelegacion(token)) return invalida("El token de delegación no tiene la forma del ERP.");
  if (!esObjetoPlano(entrada)) return invalida("La entrada tiene que ser un objeto.");
  const CLAVES = ["alcance", "parametros"] as const;
  if (!soloEstas(entrada, CLAVES) || !tieneTodas(entrada, CLAVES)) return invalida("La entrada lleva exactamente alcance y parametros.");
  const { alcance } = entrada;
  if (!esObjetoPlano(alcance) || !soloEstas(alcance, ["grupoId", "localId"])) return invalida("El alcance solo acepta grupoId y localId.");
  if (!esEnteroPositivo(alcance.grupoId) || !esEnteroPositivo(alcance.localId)) return invalida("grupoId y localId tienen que ser enteros positivos.");
  const parametros = validarParametros(entrada.parametros);
  if (!parametros.ok) return parametros;
  return {
    ok: true,
    cuerpo: {
      capacidad: CAPACIDAD_STOCK_CONSULTA,
      delegacion: { token },
      alcance: { grupoId: alcance.grupoId, localId: alcance.localId },
      parametros: parametros.parametros,
    },
  };
}
