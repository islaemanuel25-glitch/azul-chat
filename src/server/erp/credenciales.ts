// src/server/erp/credenciales.ts
//
// LA FORMA DE LAS DOS CREDENCIALES QUE EMITE EL ERP. Copia exacta de
// erpmanual 8920516, `lib/integraciones/vinculos/codigoVinculo.js`:
//
//   · código de canje: "vin1_" + 32 bytes en base64url (43 caracteres).
//     HUMANO: la persona lo copia del ERP. Vale 10 minutos y un canje. Azul
//     Chat lo recibe, lo canjea y lo olvida: no se guarda ni se loguea.
//   · token de delegación: "del1_" + 32 bytes en base64url. DE MÁQUINA: el ERP
//     se lo da al backend de Azul Chat al canjear. Se guarda CIFRADO y nunca
//     sale del servidor.
//
// Validar la forma acá evita gastar una llamada al ERP con algo que no puede
// existir. No dice si existe: eso lo decide el ERP.

import "server-only";

const FORMATO_CODIGO = /^vin1_[A-Za-z0-9_-]{43}$/;
const FORMATO_TOKEN = /^del1_[A-Za-z0-9_-]{43}$/;

export function esCodigoCanje(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_CODIGO.test(valor);
}

export function esTokenDelegacion(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_TOKEN.test(valor);
}
