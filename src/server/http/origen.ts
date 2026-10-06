// src/server/http/origen.ts
//
// ¿ESTA SOLICITUD QUE CREA O DESTRUYE UNA SESIÓN VIENE DE AZUL CHAT MISMO?
//
// SameSite=Lax en la cookie ya impide que otro sitio la mande en un POST, pero
// no alcanza solo: un subdominio hermano cuenta como "mismo sitio", y Lax no
// cubre a un navegador viejo. Por eso las rutas que crean o destruyen una
// sesión exigen además:
//
//   · Origin presente e IGUAL al origen configurado (AZUL_CHAT_ORIGEN_PUBLICO).
//     No se compara contra el Host de la solicitud ni se refleja lo que venga:
//     un valor que no sea exactamente el configurado se rechaza, también "null".
//   · Sec-Fetch-Site, si el navegador lo manda, en "same-origin".
//
// Una solicitud sin Origin se rechaza: todo navegador actual lo manda en un
// POST o DELETE con fetch, y quien no lo manda no es la interfaz de Azul Chat.

import "server-only";

export function origenPermitido(headers: Headers, origenPublico: string): boolean {
  const origen = headers.get("origin");
  if (!origen || origen !== origenPublico) return false;
  const sitio = headers.get("sec-fetch-site");
  if (sitio !== null && sitio !== "same-origin") return false;
  return true;
}
