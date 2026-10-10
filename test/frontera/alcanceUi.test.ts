// CANDADO: LA INTERFAZ NO PROMETE LO QUE NO EXISTE Y NO SE SALE DE SU CARRIL.
//
// La Tanda 2C dibuja los chats con lo que la API de verdad da. El diseño de
// Figma tiene más (acciones sobre el ERP, ventas, pendientes, mensajes) y es
// fácil que un texto o un botón de eso se cuele: este candado lo hace rojo.
// Mira el CÓDIGO de src/components y src/app, sin comentarios (la prosa puede
// nombrar lo que falta; el código no lo puede mostrar).
//
// Además: nada de refresco automático (la sincronización ocurre cuando se pide),
// nada guardado en el navegador, `fetch` solo en los dos clientes HTTP de la
// interfaz, y ningún rastro de la delegación del ERP.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo, sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const rel = (f: string) => path.relative(RAIZ, f).split(path.sep).join("/");

/** Código sin comentarios de la interfaz: src/components y src/app (sin las rutas de API, que son del servidor). */
function codigoDeLaInterfaz(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const dir of ["src/components", "src/app"]) {
    for (const f of archivosDelRepo(RAIZ, dir)) {
      const r = rel(f);
      if (!/\.(ts|tsx)$/.test(r) || r.startsWith("src/app/api/")) continue;
      salida[r] = sinComentarios(readFileSync(f, "utf8"));
    }
  }
  return salida;
}

/**
 * Lo que todavía no existe y no se puede ofrecer (ni insinuar, como el viejo texto de "Estados").
 *
 * Tanda 3A: "Ventas de hoy" SALE de esta lista porque existe, y solo eso: el
 * título de la tarjeta, armado en UN lugar (TEXTO_PERMITIDO, abajo). Las
 * acciones de la tarjeta del diseño ("Ver detalle", "Comparar"), los otros
 * chips de la barra y el campo de preguntas siguen sin existir.
 */
const TEXTOS_FUERA_DE_ALCANCE = [
  "Ver diferencias",
  "Abrir en ERP",
  "Última transferencia",
  "Podés leer historial",
  "Ver detalle",
  "Comparar",
  "Preguntá",
  "Ventas de ayer",
];

/** Los chips del diseño que no están implementados, como texto visible: literal o hijo de JSX. */
const CHIPS_NO_IMPLEMENTADOS = ["Caja", "Transferencias", "Pedidos", "Stock"];
const comoTextoVisible = (t: string) => new RegExp(`["'\`>]\\s*${t}\\s*["'\`<]`);

/** "Ventas de hoy" existe en un solo archivo de la interfaz: el que arma el título de la tarjeta. */
const TEXTO_PERMITIDO = { texto: "Ventas de hoy", archivo: "src/components/chats/formato.ts" };

/** Los únicos archivos de la interfaz que hacen HTTP (a rutas propias; lo controla secretoSoloServidor.test.ts). */
const CLIENTES_HTTP = ["src/components/chats/clienteChats.ts", "src/components/sesion/PanelSesion.tsx"];

function problemas(archivos: Record<string, string>): string[] {
  const p: string[] = [];
  for (const [archivo, codigo] of Object.entries(archivos)) {
    for (const t of TEXTOS_FUERA_DE_ALCANCE) if (codigo.includes(t)) p.push(`${archivo}: "${t}"`);
    for (const t of CHIPS_NO_IMPLEMENTADOS) if (comoTextoVisible(t).test(codigo)) p.push(`${archivo}: chip "${t}"`);
    if (codigo.includes(TEXTO_PERMITIDO.texto) && archivo !== TEXTO_PERMITIDO.archivo) p.push(`${archivo}: "${TEXTO_PERMITIDO.texto}" fuera de su lugar`);
    // El campo de preguntas del diseño: en los chats no hay dónde escribir.
    if (archivo.startsWith("src/components/chats/") && /<(input|textarea)\b/.test(codigo)) p.push(`${archivo}: campo de texto en los chats`);
    if (/\b(setInterval|setTimeout|requestIdleCallback)\b|\brefetchInterval\b|WebSocket|EventSource/.test(codigo)) p.push(`${archivo}: refresco automático`);
    if (/localStorage|sessionStorage|indexedDB|document\.cookie|\bcaches\./.test(codigo)) p.push(`${archivo}: almacenamiento del navegador`);
    if (/(?<![\w-])fetch\s*\(/.test(codigo) && !CLIENTES_HTTP.includes(archivo)) p.push(`${archivo}: fetch fuera del cliente`);
    if (/delegaci|tokenDelegacion|\btoken\b|vinculoId|usuarioId|\/api\/integraciones|https?:\/\//i.test(codigo)) p.push(`${archivo}: sabe de la delegación o del ERP`);
  }
  return p;
}

describe("alcance de la interfaz de chats", () => {
  const arbol = codigoDeLaInterfaz();

  it("hay interfaz que revisar", () => {
    assert.ok("src/components/chats/AzulChat.tsx" in arbol);
    assert.ok("src/components/chats/Conversacion.tsx" in arbol);
    assert.ok("src/app/page.tsx" in arbol);
  });

  it("I/J/Z/AA/X/3A. sin textos de lo que no existe (\"Ventas de hoy\" solo como título de la tarjeta), sin otros chips ni campo de preguntas, sin refresco automático, sin almacenamiento, fetch solo en el cliente, sin delegación", () => {
    assert.deepEqual(problemas(arbol), []);
  });

  it("CONTRAPRUEBA: cada regla atrapa su caso, y un comentario no cuenta", () => {
    const conversacion = arbol["src/components/chats/Conversacion.tsx"]!;
    const casos: Record<string, string> = {
      ver: conversacion.replace('"Cargar anteriores"', '"Ver diferencias"'),
      abrir: `${conversacion}\nexport const X = () => <button>Abrir en ERP</button>;\n`,
      ventasFueraDeLugar: `${conversacion}\nconst t = "Ventas de hoy";\n`,
      ventasAyer: `${conversacion}\nconst t2 = "Ventas de ayer";\n`,
      verDetalle: `${conversacion}\nexport const D = () => <button>Ver detalle</button>;\n`,
      comparar: `${conversacion}\nexport const C = () => <button>Comparar</button>;\n`,
      pregunta: `${conversacion}\nconst ph = "Preguntá sobre este local…";\n`,
      campo: `${conversacion}\nexport const I = () => <input placeholder="x" />;\n`,
      chipCaja: `${conversacion}\nexport const K = () => <button className="ac-chip">Caja</button>;\n`,
      chipStock: `${conversacion}\nconst chips = ["Ventas", "Stock"];\n`,
      chipPedidos: `${conversacion}\nexport const P = () => <button>\n  Pedidos\n</button>;\n`,
      chipTransferencias: `${conversacion}\nconst tr = 'Transferencias';\n`,
      ultima: `${conversacion}\nconst u = "Última transferencia";\n`,
      p1: `${conversacion}\nconst v = "Podés leer historial.";\n`,
      intervalo: `${conversacion}\nsetInterval(() => {}, 30000);\n`,
      timeout: `${conversacion}\nsetTimeout(() => {}, 30000);\n`,
      almacenamiento: `${conversacion}\nlocalStorage.setItem("x", "y");\n`,
      fetch: `${conversacion}\nvoid fetch("/api/chats");\n`,
      token: `${conversacion}\nconst token = "del1_x";\n`,
      erp: `${conversacion}\nconst u2 = "https://erp.ejemplo.invalid";\n`,
    };
    for (const [nombre, codigo] of Object.entries(casos)) {
      assert.notEqual(codigo, conversacion, nombre);
      assert.notDeepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": codigo }), [], nombre);
    }
    // El permiso es SOLO el título en su archivo: ahí mismo, lo demás sigue en rojo.
    const formato = arbol[TEXTO_PERMITIDO.archivo]!;
    assert.ok(formato.includes(TEXTO_PERMITIDO.texto), "el título de la tarjeta está donde el permiso dice");
    assert.notDeepEqual(problemas({ ...arbol, [TEXTO_PERMITIDO.archivo]: `${formato}\nexport const x = "Comparar";\n` }), [], "formato con Comparar");
    // Un texto que solo CONTIENE el nombre de un chip no es el chip: "Transferencia #182 recibida" sigue bien.
    assert.deepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": `${conversacion}\nconst ok = "Transferencias recibidas hoy";\n` }), []);
    // En prosa no cuenta: el código se mira sin comentarios.
    const conComentario = sinComentarios(`${conversacion}\n// todavía no hay "Ver diferencias" ni setInterval\n`);
    assert.deepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": conComentario }), []);
  });
});

// ── General no marca leído (Tanda 2C) ────────────────────────────────────────
//
// GET /api/chats/general no dice cuántos no leídos tiene cada local, así que
// General no puede demostrar que mostró todos los de un local: no marca nunca,
// ni al abrir, ni al cargar anteriores, ni al salir. Sin navegador no se pueden
// correr los efectos de React, así que el candado mira el código: hay UN solo
// lugar que llama a POST /api/chats/leido, el hook de lectura del Local, y
// General no lo usa. Si alguien agrega una marca en General (o una función que
// calcule marcas por local desde eventos de General), se pone rojo.

const CONVERSACION = "src/components/chats/Conversacion.tsx";
const LOGICA = "src/components/chats/logica.ts";

/** El texto de una función de primer nivel (exportada o no), hasta la siguiente. */
function cuerpoDe(codigo: string, nombre: string): string {
  const i = codigo.search(new RegExp(`\\nfunction ${nombre}[<(]|\\nexport function ${nombre}[<(]`));
  if (i < 0) return "";
  const resto = codigo.slice(i + 1);
  const fin = resto.search(/\n(export )?function /);
  return fin < 0 ? codigo.slice(i) : codigo.slice(i, i + 1 + fin);
}

function problemasDeLectura(archivos: Record<string, string>): string[] {
  const p: string[] = [];
  // Llamadas, no la declaración del cliente (`export function marcarLeido(`).
  const llamadas = Object.entries(archivos).flatMap(([a, c]) => [...c.matchAll(/(?<!function )\bmarcarLeido\s*\(/g)].map(() => a));
  if (JSON.stringify(llamadas) !== JSON.stringify([CONVERSACION])) p.push(`marcarLeido se llama desde: ${llamadas.join(", ") || "ningún lado"}`);
  const conversacion = archivos[CONVERSACION] ?? "";
  const hook = cuerpoDe(conversacion, "useLecturaLocal");
  if (!/\bmarcarLeido\s*\(/.test(hook)) p.push("la única llamada no está en useLecturaLocal");
  const general = cuerpoDe(conversacion, "PantallaGeneral");
  if (!general) p.push("no se encontró PantallaGeneral");
  if (/useLecturaLocal|marcarLeido|decidirLectura|LEIDO/.test(general)) p.push("PantallaGeneral marca leído");
  if (!/useLecturaLocal\(/.test(cuerpoDe(conversacion, "PantallaLocal"))) p.push("PantallaLocal no usa useLecturaLocal");
  // La decisión se recalcula en cada render (con los eventos que haya, también
  // después de cargar anteriores) y el efecto corre cuando cambia la marca.
  if (!/const decision = decidirLecturaLocal\(estado\);/.test(hook)) p.push("useLecturaLocal no recalcula la decisión con el estado actual");
  if (!/\}, \[clave,/.test(hook)) p.push("el efecto de lectura no depende de la marca calculada");
  const logica = archivos[LOGICA] ?? "";
  if (/marcasDeGeneral|EventoGeneral[^\n]*\)\s*:\s*Marca/.test(logica)) p.push("logica.ts calcula marcas para General");
  return p;
}

describe("General no marca leído", () => {
  const arbol = codigoDeLaInterfaz();

  it("AI/AJ/AK. una sola llamada a POST leído, en la lectura del Local; General (al abrir, al cargar anteriores o al salir) no la alcanza", () => {
    assert.deepEqual(problemasDeLectura(arbol), []);
  });

  it("CONTRAPRUEBA: atrapa una marca en General, una llamada suelta y una función de marcas para General", () => {
    const conv = arbol[CONVERSACION]!;
    const general = cuerpoDe(conv, "PantallaGeneral");
    const casos: Record<string, Record<string, string>> = {
      generalConHook: { [CONVERSACION]: conv.replace(general, general.replace("useConversacion(pedirPagina, alPerderSesion);", "useConversacion(pedirPagina, alPerderSesion);\n  useLecturaLocal(estado as never, (() => {}) as never, alPerderSesion);")) },
      generalConPost: { [CONVERSACION]: conv.replace(general, general.replace("useConversacion(pedirPagina, alPerderSesion);", "useConversacion(pedirPagina, alPerderSesion);\n  void marcarLeido({ marcas: [] });")) },
      otraLlamada: { "src/components/chats/AzulChat.tsx": `${arbol["src/components/chats/AzulChat.tsx"]}\nvoid marcarLeido({ marcas: [] });\n` },
      sinRecalcular: { [CONVERSACION]: conv.replace("}, [clave, despachar, alPerderSesion]);", "}, []);") },
      decisionFija: { [CONVERSACION]: conv.replace("const decision = decidirLecturaLocal(estado);", "const decision = useRef(decidirLecturaLocal(estado)).current;") },
      funcionGeneral: { [LOGICA]: `${arbol[LOGICA]}\nexport function marcasDeGeneral(e: readonly EventoGeneral[]): Marca[] { return []; }\n` },
    };
    for (const [nombre, cambio] of Object.entries(casos)) {
      const c = Object.values(cambio)[0]!;
      assert.notEqual(c, arbol[Object.keys(cambio)[0]!], `el reemplazo ${nombre} no se aplicó`);
      assert.notDeepEqual(problemasDeLectura({ ...arbol, ...cambio }), [], nombre);
    }
  });
});
