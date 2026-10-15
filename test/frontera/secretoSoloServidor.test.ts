// CANDADO: el secreto de la integración y la ruta del ERP viven en UN lugar del
// servidor, y nada los acerca al navegador.
//
// Lo que no se puede ver desde acá —que el bundle compilado no lo contenga— lo
// comprueba `npm run verificar:bundle`, que compila con un secreto canario y lo
// busca en todo lo que baja al navegador.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo, sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const ES_CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const rel = (f: string) => path.relative(RAIZ, f);

/** Archivos de `src` cuyo CÓDIGO (sin comentarios) contiene `patron`. */
function dondeAparece(patron: RegExp): string[] {
  return archivosDelRepo(RAIZ, "src")
    .filter((f) => ES_CODIGO.test(f))
    .filter((f) => patron.test(sinComentarios(readFileSync(f, "utf8"))))
    .map(rel);
}

describe("el secreto solo existe del lado del servidor", () => {
  it("el nombre de la variable se lee en un único archivo, de src/server", () => {
    assert.deepEqual(dondeAparece(/AZUL_CHAT_INTEGRACION_SECRET/), ["src/server/erp/config.ts"]);
  });

  it("la clave de cifrado del token se lee en un único archivo, de src/server, y .env.example no la trae", () => {
    assert.deepEqual(dondeAparece(/AZUL_CHAT_TOKEN_ENCRYPTION_KEY/), ["src/server/seguridad/cifradoToken.ts"]);
    const linea = readFileSync(path.join(RAIZ, ".env.example"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("AZUL_CHAT_TOKEN_ENCRYPTION_KEY="));
    assert.equal(linea, "AZUL_CHAT_TOKEN_ENCRYPTION_KEY=");
  });

  it("6A. la clave de la IA se lee en un único archivo de src/server, y .env.example no la trae", () => {
    assert.deepEqual(dondeAparece(/AZUL_CHAT_GEMINI_API_KEY/), ["src/server/ia/config.ts"]);
    const lineas = readFileSync(path.join(RAIZ, ".env.example"), "utf8").split("\n");
    assert.equal(lineas.find((l) => l.startsWith("AZUL_CHAT_GEMINI_API_KEY=")), "AZUL_CHAT_GEMINI_API_KEY=");
  });

  it("5A. la privada VAPID y el secreto de la tarea se leen cada uno en un único archivo de src/server, y .env.example no los trae", () => {
    assert.deepEqual(dondeAparece(/AZUL_CHAT_VAPID_PRIVADA/), ["src/server/push/config.ts"]);
    assert.deepEqual(dondeAparece(/AZUL_CHAT_TAREA_SECRET/), ["src/server/interno/tarea.ts"]);
    // La pública tampoco sale por otro lado: el navegador la pide a GET /api/push/clave.
    assert.deepEqual(dondeAparece(/AZUL_CHAT_VAPID_PUBLICA/), ["src/server/push/config.ts"]);
    const lineas = readFileSync(path.join(RAIZ, ".env.example"), "utf8").split("\n");
    for (const v of ["AZUL_CHAT_VAPID_PRIVADA", "AZUL_CHAT_TAREA_SECRET", "AZUL_CHAT_VAPID_PUBLICA"]) {
      assert.equal(lineas.find((l) => l.startsWith(`${v}=`)), `${v}=`, v);
    }
  });

  it("12. la lista de a quién avisar del vigía se lee en un único archivo de src/server, y .env.example la trae vacía", () => {
    // No es un secreto, pero son personas reales del ERP: un solo lugar la lee
    // y nada la acerca al navegador.
    assert.deepEqual(dondeAparece(/AZUL_CHAT_AVISOS_SISTEMA/), ["src/server/interno/vigia.ts"]);
    const lineas = readFileSync(path.join(RAIZ, ".env.example"), "utf8").split("\n");
    assert.equal(lineas.find((l) => l.startsWith("AZUL_CHAT_AVISOS_SISTEMA=")), "AZUL_CHAT_AVISOS_SISTEMA=");
  });

  it("15. la lista de administradores se lee en un único archivo de src/server, y .env.example la trae vacía", () => {
    // No es un secreto, pero decide quién administra los accesos: un solo lugar
    // la lee, y nada la acerca al navegador.
    assert.deepEqual(dondeAparece(/AZUL_CHAT_ADMINISTRADORES/), ["src/server/accesos/accesos.ts"]);
    const lineas = readFileSync(path.join(RAIZ, ".env.example"), "utf8").split("\n");
    assert.equal(lineas.find((l) => l.startsWith("AZUL_CHAT_ADMINISTRADORES=")), "AZUL_CHAT_ADMINISTRADORES=");
  });

  it("process.env se lee solo en src/server", () => {
    const fuera = dondeAparece(/process\.env/).filter((f) => !f.startsWith("src/server/"));
    assert.deepEqual(fuera, []);
  });

  it("no hay variables NEXT_PUBLIC_ (son las que Next copia al navegador)", () => {
    assert.deepEqual(dondeAparece(/NEXT_PUBLIC_/), []);
    assert.equal(/NEXT_PUBLIC_/.test(readFileSync(path.join(RAIZ, ".env.example"), "utf8").replace(/^#.*$/gm, "")), false);
  });

  it("next.config no expone variables con `env`", () => {
    const config = sinComentarios(readFileSync(path.join(RAIZ, "next.config.ts"), "utf8"));
    assert.equal(/\benv\s*:/.test(config), false);
    assert.equal(/publicRuntimeConfig/.test(config), false);
  });

  it(".env.example no trae un secreto con valor", () => {
    const linea = readFileSync(path.join(RAIZ, ".env.example"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("AZUL_CHAT_INTEGRACION_SECRET="));
    assert.equal(linea, "AZUL_CHAT_INTEGRACION_SECRET=");
  });

  it("git ignora los .env reales y no ignora .env.example", () => {
    const ignorado = (f: string) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", f], { cwd: RAIZ });
        return true;
      } catch {
        return false;
      }
    };
    for (const f of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development"]) {
      assert.equal(ignorado(f), true, f);
    }
    assert.equal(ignorado(".env.example"), false);
  });

  it("ningún .env real está trackeado", () => {
    const trackeados = execFileSync("git", ["ls-files", "--cached", "--", ".env*", "**/.env*"], { cwd: RAIZ, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => path.basename(f) !== ".env.example");
    assert.deepEqual(trackeados, []);
  });
});

describe("el cliente ERP no es genérico", () => {
  it("la ruta del ERP aparece en un solo archivo", () => {
    assert.deepEqual(dondeAparece(/\/api\/integraciones/), ["src/server/erp/cliente.ts"]);
  });

  // Hasta la tanda de sesión este candado exigía que `fetch` apareciera en un
  // solo archivo. Desde que existe el panel de sesión, el navegador llama a las
  // rutas PROPIAS de Azul Chat. Lo que se defiende sigue siendo lo mismo: al
  // ERP se sale solo desde el cliente firmado. Por eso ahora se separan las
  // dos preguntas: en src/server, HTTP saliente en un único archivo; fuera de
  // src/server, `fetch` solo hacia rutas literales `/api/sesion…`.
  //
  // Tanda 2C: la interfaz de chats llama además a `/api/chats…`, y dos de esas
  // rutas llevan una consulta (`?localId=…&cursor=…`). Se admite UNA forma más,
  // y solo esa: `${CONSTANTE}?${identificador}`, con la constante del mismo
  // archivo valiendo una ruta propia. Después del `?` no se puede cambiar el
  // camino: el destino sigue siendo una ruta propia. Un camino armado
  // (`${RUTA}/${x}`) o una constante que no es ruta propia siguen en rojo.
  //
  // Tanda 3B: el navegador pide además `/api/version` (exacta, sin consulta ni
  // subcamino) para recargar una pestaña que quedó con el JS de otro
  // despliegue. Es ruta propia, pública y sin datos: dice solo el commit.
  //
  // Tanda 5A: dos aperturas más, cada una de un solo lugar.
  //   · El navegador llama además a `/api/push/clave` y `/api/push/suscribir`
  //     (activar o desactivar las notificaciones). NUNCA a `/api/interno/…`:
  //     esa ruta es del timer del VPS.
  //   · En el servidor, además del cliente del ERP, hace HTTP saliente el envío
  //     a los servicios de push (src/server/push/enviar.ts), y solo después de
  //     comprobar que el endpoint es de la lista cerrada de servicios
  //     (`endpointPermitido`). Cualquier otro archivo del servidor con `fetch`
  //     sigue en rojo.
  //
  // Tanda 6A: la IA que interpreta preguntas (src/server/ia/gemini.ts) hace
  // UNA llamada, a UN destino fijo: el `generateContent` del modelo, en
  // generativelanguage.googleapis.com, escrito como constante del archivo. El
  // navegador llama a `/api/chats/preguntar`, que ya es `/api/chats…`.
  it("HTTP saliente: al ERP solo desde el cliente firmado, a push solo desde su envío, a la IA solo desde su destino fijo; el navegador solo a /api/sesion, /api/chats, /api/version y /api/push", () => {
    assert.deepEqual(violacionesHttp(codigoDeSrc()), []);
  });

  it("CONTRAPRUEBA: atrapa un fetch del navegador a otro lado y un segundo cliente en el servidor", () => {
    const base = codigoDeSrc();
    const casos: Record<string, string> = {
      "src/components/x/Directo.tsx": '"use client";\nfetch("https://erp.ejemplo.invalid/api/x");\n',
      "src/components/x/PorVariable.tsx": '"use client";\nconst u = "/api/erp/ventas";\nfetch(u);\n',
      "src/components/x/Armado.tsx": '"use client";\nconst id = 1;\nfetch(`/api/sesion/${id}`);\n',
      "src/components/x/CaminoArmado.tsx": '"use client";\nconst RUTA = "/api/chats/local";\nconst id = "1";\nfetch(`${RUTA}/${id}`);\n',
      "src/components/x/ConsultaAjena.tsx": '"use client";\nconst RUTA = "https://erp.ejemplo.invalid/api";\nconst q = "a=1";\nfetch(`${RUTA}?${q}`);\n',
      "src/components/x/ConsultaSinConstante.tsx": '"use client";\nconst q = "a=1";\nfetch(`${destino()}?${q}`);\n',
      "src/components/x/OtraApi.tsx": '"use client";\nfetch("/api/integraciones/azul-chat/consultar");\n',
      "src/components/x/Subida.tsx": '"use client";\nfetch("/api/chats/../sesion");\n',
      "src/components/x/VersionDeMas.tsx": '"use client";\nfetch("/api/version/erp");\n',
      "src/components/x/Versiones.tsx": '"use client";\nfetch("/api/versiones");\n',
      "src/shared/x/Axios.ts": 'import a from "axios";\nexport const y = a;\n',
      "src/server/otro/cliente2.ts": 'import "server-only";\nexport const z = () => fetch("http://x");\n',
      // Tanda 5A: la ruta interna no es del navegador, ni con constante ni literal.
      "src/components/x/Interna.tsx": '"use client";\nconst RUTA = "/api/interno/sincronizar";\nfetch(RUTA, { method: "POST" });\n',
      "src/components/x/InternaLiteral.tsx": '"use client";\nfetch("/api/interno/sincronizar");\n',
      "src/components/x/PushDeMas.tsx": '"use client";\nfetch("/api/push/enviar");\n',
      "src/components/x/PushEstadoDeOtro.tsx": '"use client";\nfetch("/api/push/estados");\n',
    };
    for (const [archivo, codigo] of Object.entries(casos)) {
      const v = violacionesHttp({ ...base, [archivo]: codigo });
      assert.deepEqual(v, [archivo], archivo);
    }
    // El envío push sin comprobar el endpoint contra la lista es rojo.
    const enviar = base[ENVIO_PUSH]!;
    const sinLista = enviar.replace("if (!endpointPermitido(destino.endpoint))", "if (false)");
    assert.notEqual(sinLista, enviar, "el reemplazo del envío push no se aplicó");
    assert.deepEqual(violacionesHttp({ ...base, [ENVIO_PUSH]: sinLista }), [ENVIO_PUSH]);
    // La IA a otro destino, o una segunda llamada, es rojo.
    const llamadaIa = base[LLAMADA_IA]!;
    for (const [nombre, otra] of [
      ["otro host", llamadaIa.replace(DESTINO_IA, "https://ia.ejemplo.invalid/v1/generate")],
      ["otro modelo", llamadaIa.replace(DESTINO_IA, DESTINO_IA.replace("gemini-3.6-flash", "gemini-3.1-pro-preview"))],
      ["destino armado", llamadaIa.replace("hacerFetch(ENDPOINT_IA,", "hacerFetch(`${ENDPOINT_IA}?x=1`,")],
      ["segunda llamada", `${llamadaIa}\nexport const otra = () => hacerFetch(ENDPOINT_IA, {});\n`],
    ] as const) {
      assert.notEqual(otra, llamadaIa, `el reemplazo ${nombre} no se aplicó`);
      assert.deepEqual(violacionesHttp({ ...base, [LLAMADA_IA]: otra }), [LLAMADA_IA], nombre);
    }
    // Un fetch nombrado en un comentario no cuenta.
    assert.deepEqual(violacionesHttp({ ...base, "src/components/x/C.tsx": "// fetch('https://x')\nexport const c = 1;\n" }), []);
  });

  it("las capacidades que Azul Chat le pide al ERP son estas diez, nada más", () => {
    // Tanda 7B: `cajas_resumen`, con su constructor (src/server/erp/cajasResumen.ts) y su método del cliente.
    // Tanda 8B: `stock_consulta`, igual (src/server/erp/stockConsulta.ts).
    // Tanda 9B: `pedidos_pendientes`, igual (src/server/erp/pedidosPendientes.ts).
    // 2026-10-15: `compras_saldo_eventos`, la quinta de eventos, con el constructor común (src/server/erp/eventos.ts).
    // Una capacidad nueva entra a propósito, con su constructor y sus tests: este candado se actualiza ese día.
    // mi_alcance entró en la tanda de sesión (ERP 8920516). Hasta la Tanda 4B este
    // candado miraba solo src/server, y `transferencias_eventos` (Tanda 2), que
    // vive en src/shared/erp/contrato.ts, se le escapaba sin que se pusiera rojo:
    // ahora mira src entero. Las tres de eventos de la Tanda 4B, también ahí.
    const capacidades = new Set<string>();
    for (const f of archivosDelRepo(RAIZ, "src").filter((x) => ES_CODIGO.test(x))) {
      for (const m of sinComentarios(readFileSync(f, "utf8")).matchAll(/CAPACIDAD_[A-Z_]+\s*=\s*"([^"]+)"/g)) {
        if (m[1]) capacidades.add(m[1]);
      }
    }
    assert.deepEqual([...capacidades].sort(), [
      "cajas_resumen",
      "cancelaciones_eventos",
      "compras_saldo_eventos",
      "envios_eventos",
      "mi_alcance",
      "pedidos_eventos",
      "pedidos_pendientes",
      "stock_consulta",
      "transferencias_eventos",
      "ventas_resumen",
    ]);
  });
});

/** Código (sin comentarios) de cada archivo de src, por ruta relativa. */
function codigoDeSrc(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const f of archivosDelRepo(RAIZ, "src").filter((x) => ES_CODIGO.test(x))) salida[rel(f)] = readFileSync(f, "utf8");
  return salida;
}

const CLIENTE_ERP = "src/server/erp/cliente.ts";
/** Tanda 5A: el envío a los servicios de push, el otro HTTP saliente del servidor. */
const ENVIO_PUSH = "src/server/push/enviar.ts";
/** Tanda 6A: la llamada a la IA, a un destino fijo. */
const LLAMADA_IA = "src/server/ia/gemini.ts";
const DESTINO_IA = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";
/** Tanda 11: también `push/estado`, el estado real de la suscripción de este navegador. */
const RUTA_PROPIA = /^\/api\/((sesion|chats)(\/[a-z]+)*|version|push\/(clave|suscribir|estado))$/;
/** `${CONSTANTE}?${identificador}`: una ruta propia con una consulta (Tanda 2C). */
const RUTA_CON_CONSULTA = /^`\$\{([A-Za-z_$][\w$]*)\}\?\$\{[A-Za-z_$][\w$]*\}`$/;

/** Archivos que hacen HTTP saliente fuera de lo permitido. */
function violacionesHttp(archivos: Record<string, string>): string[] {
  const malos: string[] = [];
  for (const [archivo, crudo] of Object.entries(archivos)) {
    if (archivo === CLIENTE_ERP) continue;
    // El envío push: un solo fetch, al endpoint ya armado, después de la lista cerrada.
    if (archivo === ENVIO_PUSH) {
      const c = sinComentarios(crudo);
      const directas = c.match(/(?<![\w-])fetch\s*\(/g) ?? [];
      const inyectadas = c.match(/\bhacerFetch\s*\(/g) ?? [];
      const permitido = /if \(!endpointPermitido\(destino\.endpoint\)\) return/.test(c);
      if (directas.length !== 0 || inyectadas.length !== 1 || !/hacerFetch\(armado\.endpoint,/.test(c) || !permitido) malos.push(archivo);
      continue;
    }
    // La IA: un solo fetch, a la constante del destino, que vale exactamente el endpoint del modelo.
    if (archivo === LLAMADA_IA) {
      const c = sinComentarios(crudo);
      const directas = c.match(/(?<![\w-])fetch\s*\(/g) ?? [];
      const inyectadas = c.match(/\bhacerFetch\s*\(/g) ?? [];
      const destino = /\bexport const ENDPOINT_IA = "([^"]*)";/.exec(c)?.[1];
      if (directas.length !== 0 || inyectadas.length !== 1 || !/hacerFetch\(ENDPOINT_IA,/.test(c) || destino !== DESTINO_IA) malos.push(archivo);
      continue;
    }
    const codigo = sinComentarios(crudo);
    if (/["']node:https?["']|["']https?["']|undici|axios|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(codigo)) {
      malos.push(archivo);
      continue;
    }
    // `Sec-Fetch-Site` es una cabecera, no una llamada: el guion no cuenta como borde.
    if (!/(?<![\w-])fetch\b(?!-)/.test(codigo)) continue;
    if (archivo.startsWith("src/server/")) {
      malos.push(archivo);
      continue;
    }
    // Fuera del servidor: cada fetch( lleva como destino un literal o una
    // constante del mismo archivo cuyo valor literal es una ruta propia.
    const constantes = new Map<string, string>();
    for (const m of codigo.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"\s*;/g)) constantes.set(m[1]!, m[2]!);
    const usos = [...codigo.matchAll(/(?<![\w-])fetch\b(?!-)\s*(\()?\s*([^,)]*)/g)];
    const bien = usos.every((m) => {
      if (!m[1]) return false; // `fetch` sin llamar: pasado como valor, no se sabe adónde va
      const arg = m[2]!.trim();
      const conConsulta = RUTA_CON_CONSULTA.exec(arg)?.[1];
      const literal = /^"([^"]*)"$/.exec(arg)?.[1] ?? constantes.get(conConsulta ?? arg);
      return literal !== undefined && RUTA_PROPIA.test(literal);
    });
    if (!bien) malos.push(archivo);
  }
  return malos.sort();
}
