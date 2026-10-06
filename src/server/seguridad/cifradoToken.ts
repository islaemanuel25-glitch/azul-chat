// src/server/seguridad/cifradoToken.ts
//
// EL TOKEN DE DELEGACIÓN SE GUARDA CIFRADO. AES-256-GCM, con una clave que vive
// solo en el servidor: AZUL_CHAT_TOKEN_ENCRYPTION_KEY.
//
// ── LA CLAVE ───────────────────────────────────────────────────────────────
//
// 32 bytes al azar, escritos en base64 (44 caracteres con el "=" final) o en
// base64url (43 sin relleno). Tiene que decodificar a EXACTAMENTE 32 bytes:
// una clave más corta o más larga es un error de configuración, no algo a
// completar o recortar. Y no puede ser el secreto de la integración
// (AZUL_CHAT_INTEGRACION_SECRET): son dos secretos con dos trabajos distintos,
// y si uno se filtra no tiene que arrastrar al otro. Sin clave, o con una mala,
// no se cifra ni se descifra nada (fail closed).
//
// ── EL FORMATO ─────────────────────────────────────────────────────────────
//
//   v1.<iv>.<cifrado>.<tag>          (cada parte en base64url, sin relleno)
//
//   · "v1": la versión del formato. Si mañana cambia el algoritmo o la clave,
//     el prefijo dice cómo leer lo viejo.
//   · iv: 12 bytes al azar, NUEVOS en cada cifrado (`randomBytes`). Con GCM
//     repetir un IV con la misma clave rompe la confidencialidad y la
//     autenticación: no se deriva, no se cuenta, no se reutiliza.
//   · tag: los 16 bytes de autenticación de GCM. Un byte cambiado en el IV, el
//     cifrado, el tag o el contexto hace fallar el descifrado: no devuelve
//     basura, devuelve error.
//
// ── EL CONTEXTO (AAD) ──────────────────────────────────────────────────────
//
// Se autentica junto con el cifrado, sin cifrarse: la instalación, la persona
// y el vínculo del ERP. Así un token cifrado copiado a la fila de OTRA persona
// no se descifra: el contexto no coincide.
//
// El token claro solo existe en memoria, el tiempo de una llamada al ERP.
// Nunca se loguea ni se devuelve al navegador.

import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { esElSecretoDeIntegracion } from "../erp/config.ts";
import type { Entorno } from "../erp/config.ts";

export const VARIABLE_CLAVE_TOKEN = "AZUL_CHAT_TOKEN_ENCRYPTION_KEY";
export const VERSION_FORMATO = "v1";
const ALGORITMO = "aes-256-gcm";
const BYTES_CLAVE = 32;
const BYTES_IV = 12;
const BYTES_TAG = 16;

export type MotivoClaveInvalida = "CLAVE_AUSENTE" | "CLAVE_MAL_FORMADA" | "CLAVE_ES_EL_SECRETO_DE_INTEGRACION";

/** De quién es el token: se autentica con el cifrado (AAD). */
export type ContextoToken = {
  readonly instalacionId: string;
  readonly erpUsuarioId: number;
  readonly erpVinculoId: number;
};

export type CifradorToken = {
  cifrar(token: string, contexto: ContextoToken): string;
  /** El token claro, o `null` si no se pudo autenticar (manipulado, otro contexto, otra clave). */
  descifrar(cifrado: string, contexto: ContextoToken): string | null;
};

const BASE64 = /^[A-Za-z0-9+/]{43}=$/;
const BASE64URL = /^[A-Za-z0-9_-]{43}$/;

/** La clave, o el motivo por el que no se puede usar. Nunca devuelve el valor en un error. */
export function leerClaveToken(entorno: Entorno = process.env): { ok: true; clave: Buffer } | { ok: false; motivo: MotivoClaveInvalida } {
  const valor = entorno[VARIABLE_CLAVE_TOKEN];
  if (!valor) return { ok: false, motivo: "CLAVE_AUSENTE" };
  if (!BASE64.test(valor) && !BASE64URL.test(valor)) return { ok: false, motivo: "CLAVE_MAL_FORMADA" };
  const clave = Buffer.from(valor, BASE64.test(valor) ? "base64" : "base64url");
  if (clave.length !== BYTES_CLAVE) return { ok: false, motivo: "CLAVE_MAL_FORMADA" };
  if (esElSecretoDeIntegracion(valor, entorno)) return { ok: false, motivo: "CLAVE_ES_EL_SECRETO_DE_INTEGRACION" };
  return { ok: true, clave };
}

const aad = (c: ContextoToken): Buffer =>
  Buffer.from(`azul-chat/token-delegacion/${VERSION_FORMATO}/${c.instalacionId}/${c.erpUsuarioId}/${c.erpVinculoId}`, "utf8");

const FORMATO = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/;

/**
 * Un cifrador atado a una clave ya validada. La clave queda en la clausura: no
 * hay propiedad que un `console.log` o un `JSON.stringify` pueda imprimir.
 */
export function crearCifradorToken(clave: Buffer): CifradorToken {
  if (clave.length !== BYTES_CLAVE) throw new Error("clave de cifrado de tamaño inválido");
  const k = Buffer.from(clave);
  return Object.freeze({
    cifrar(token: string, contexto: ContextoToken): string {
      const iv = randomBytes(BYTES_IV);
      const cifrador = createCipheriv(ALGORITMO, k, iv, { authTagLength: BYTES_TAG });
      cifrador.setAAD(aad(contexto));
      const cifrado = Buffer.concat([cifrador.update(token, "utf8"), cifrador.final()]);
      const tag = cifrador.getAuthTag();
      return [VERSION_FORMATO, iv.toString("base64url"), cifrado.toString("base64url"), tag.toString("base64url")].join(".");
    },
    descifrar(texto: string, contexto: ContextoToken): string | null {
      const m = FORMATO.exec(texto);
      if (!m) return null;
      try {
        const iv = Buffer.from(m[1]!, "base64url");
        const cifrado = Buffer.from(m[2]!, "base64url");
        const tag = Buffer.from(m[3]!, "base64url");
        if (iv.length !== BYTES_IV || tag.length !== BYTES_TAG) return null;
        const descifrador = createDecipheriv(ALGORITMO, k, iv, { authTagLength: BYTES_TAG });
        descifrador.setAAD(aad(contexto));
        descifrador.setAuthTag(tag);
        return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString("utf8");
      } catch {
        // GCM no autenticó: manipulado, otro contexto u otra clave. No hay "casi".
        return null;
      }
    },
  });
}
