// CANDADO: LA INTERFAZ NO PROMETE LO QUE NO EXISTE Y NO SE SALE DE SU CARRIL.
//
// La Tanda 2C dibuja los chats con lo que la API de verdad da. El diseño de
// Figma tiene más (acciones sobre el ERP, ventas, pendientes, mensajes) y es
// fácil que un texto o un botón de eso se cuele: este candado lo hace rojo.
// Mira el CÓDIGO de src/components y src/app, sin comentarios (la prosa puede
// nombrar lo que falta; el código no lo puede mostrar).
//
// Además: nada de refresco automático (la sincronización ocurre cuando se pide;
// las únicas excepciones son recargar al cambiar de versión, desde la Tanda 3B,
// y el temporizador que LEVANTA la espera de "Reintentar" tras un rechazo por
// cupo, desde la 5B: deshabilita, no pide nada),
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
 * título de la tarjeta, armado en UN lugar (TEXTOS_PERMITIDOS, abajo). Las
 * acciones de la tarjeta del diseño ("Ver detalle", "Comparar") y los otros
 * chips de la barra siguen sin existir.
 *
 * Tanda 6A: existen las preguntas. "Preguntá" (la caja) y "Ventas de ayer" (el
 * título de una respuesta) se admiten, cada uno en UN archivo
 * (TEXTOS_PERMITIDOS); en cualquier otro siguen en rojo.
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
  // Tanda 5A: de la pantalla 06 (Configuración) existe SOLO la fila de
  // notificaciones. El resto de esa pantalla no existe.
  "Privacidad del push",
  "Horario de silencio",
  "Sonidos y vibración",
  "Inteligencia artificial",
  "Saldo asignado",
];

/** Los chips del diseño que no están implementados, como texto visible: literal o hijo de JSX. */
const CHIPS_NO_IMPLEMENTADOS = ["Caja", "Transferencias", "Pedidos", "Stock"];
const comoTextoVisible = (t: string) => new RegExp(`["'\`>]\\s*${t}\\s*["'\`<]`);

/** Textos que existen, cada uno en un solo archivo de la interfaz. */
const TEXTOS_PERMITIDOS: readonly { readonly texto: string; readonly archivo: string }[] = [
  // Tanda 3A: el título de la tarjeta de ventas.
  { texto: "Ventas de hoy", archivo: "src/components/chats/formato.ts" },
  // Tanda 6A: el título de una respuesta de ventas de ayer, y la caja de preguntas.
  { texto: "Ventas de ayer", archivo: "src/components/chats/formato.ts" },
  { texto: "Preguntá", archivo: "src/components/chats/Preguntas.tsx" },
];
const TEXTO_PERMITIDO = TEXTOS_PERMITIDOS[0]!;
/** Tanda 6A: el único campo de texto de los chats es la caja de preguntas. Uno solo. */
const CAMPO_DE_PREGUNTAS = "src/components/chats/Preguntas.tsx";

/** Los únicos archivos de la interfaz que hacen HTTP (a rutas propias; lo controla secretoSoloServidor.test.ts). */
const CLIENTES_HTTP = ["src/components/chats/clienteChats.ts", "src/components/sesion/PanelSesion.tsx", "src/components/push/notificaciones.ts"];

/**
 * Tanda 5A: el service worker y la Push API se tocan en UN solo archivo, el
 * cliente de notificaciones. Ningún otro registra un service worker, se
 * suscribe ni pide permiso de notificaciones.
 */
const CLIENTE_PUSH = "src/components/push/notificaciones.ts";
const PIEZAS_PUSH = /serviceWorker|PushManager|pushManager|requestPermission/;

/**
 * Tanda 3B: la ÚNICA excepción a "nada de refresco automático" es recargar la
 * página cuando el servidor cambió de versión (src/components/chats/version.ts).
 * Cada pieza vive en un solo archivo y con una sola forma: escuchar la vuelta a
 * primer plano en version.ts, cortar el pedido por tiempo (sin temporizador
 * propio) en el cliente, y recargar solo como el `recargar` del comprobador.
 * setInterval, setTimeout, WebSocket y SSE siguen prohibidos en TODOS lados,
 * también en estos archivos.
 */
const PIEZAS_DE_LA_RECARGA: readonly { readonly patron: RegExp; readonly archivo: string; readonly forma?: RegExp }[] = [
  { patron: /visibilitychange|visibilityState/, archivo: "src/components/chats/version.ts" },
  // Tanda 6C: también la vuelta desde la caché de atrás/adelante y el foco de la ventana, en el mismo lugar.
  { patron: /addEventListener\(\s*["'`](pageshow|focus)["'`]/, archivo: "src/components/chats/version.ts" },
  { patron: /AbortSignal\.timeout/, archivo: "src/components/chats/clienteChats.ts" },
  {
    patron: /location\.reload/,
    archivo: "src/components/chats/AzulChat.tsx",
    // Tanda 6C: recargar deja la marca `#recarga=<commit>` (sin bucle) y es SOLO el `recargar` del comprobador,
    // que compara contra el commit de la página.
    forma:
      /const recargar = \(nueva: string\) => \{\s*window\.history\.replaceState\(window\.history\.state, "", urlConMarca\(window\.location, nueva\)\);\s*window\.location\.reload\(\);\s*\};\s*const comprobador = crearComprobadorDeVersion\(\{ propia: commit, yaRecargadoPor, pedir: pedirVersion, recargar \}\);/,
  },
];

/**
 * Tanda 5B: el ÚNICO temporizador de la interfaz. Después de un rechazo por
 * cupo del ERP, "Reintentar" queda deshabilitado 20 s; un temporizador lo
 * vuelve a habilitar y NADA MÁS: no pide, no recarga. Vive en un solo archivo,
 * es uno solo y tiene exactamente esta forma.
 */
const TEMPORIZADOR_DE_LA_ESPERA = {
  archivo: "src/components/chats/esperaCupo.ts",
  forma: /setTimeout\(\(\) => setHasta\(null\), Math\.max\(0, hasta - Date\.now\(\)\)\)/,
};

function problemas(archivos: Record<string, string>): string[] {
  const p: string[] = [];
  for (const [archivo, codigo] of Object.entries(archivos)) {
    for (const t of TEXTOS_FUERA_DE_ALCANCE) {
      const permiso = TEXTOS_PERMITIDOS.find((x) => x.texto === t);
      if (codigo.includes(t) && archivo !== permiso?.archivo) p.push(`${archivo}: "${t}"`);
    }
    for (const t of CHIPS_NO_IMPLEMENTADOS) if (comoTextoVisible(t).test(codigo)) p.push(`${archivo}: chip "${t}"`);
    for (const permiso of TEXTOS_PERMITIDOS) {
      if (codigo.includes(permiso.texto) && archivo !== permiso.archivo) p.push(`${archivo}: "${permiso.texto}" fuera de su lugar`);
    }
    // En los chats se escribe en UN solo lugar: la caja de preguntas (Tanda 6A), con un único <input> y sin <textarea>.
    if (archivo.startsWith("src/components/chats/")) {
      const campos = codigo.match(/<(input|textarea)\b/g) ?? [];
      const laCaja = archivo === CAMPO_DE_PREGUNTAS && campos.length === 1 && campos[0] === "<input";
      if (campos.length > 0 && !laCaja) p.push(`${archivo}: campo de texto en los chats`);
    }
    const temporizadores = codigo.match(/\b(setInterval|setTimeout|requestIdleCallback)\b|\brefetchInterval\b|WebSocket|EventSource/g) ?? [];
    const laEspera =
      archivo === TEMPORIZADOR_DE_LA_ESPERA.archivo &&
      temporizadores.length === 1 &&
      temporizadores[0] === "setTimeout" &&
      TEMPORIZADOR_DE_LA_ESPERA.forma.test(codigo);
    if (temporizadores.length > 0 && !laEspera) p.push(`${archivo}: refresco automático`);
    for (const pieza of PIEZAS_DE_LA_RECARGA) {
      if (!pieza.patron.test(codigo)) continue;
      if (archivo !== pieza.archivo) p.push(`${archivo}: ${pieza.patron.source} fuera de la recarga por versión`);
      else if (pieza.forma && (codigo.match(new RegExp(pieza.patron.source, "g")) ?? []).length !== 1) p.push(`${archivo}: más de un ${pieza.patron.source}`);
      else if (pieza.forma && !pieza.forma.test(codigo)) p.push(`${archivo}: ${pieza.patron.source} fuera del comprobador de versión`);
    }
    if (/localStorage|sessionStorage|indexedDB|document\.cookie|\bcaches\./.test(codigo)) p.push(`${archivo}: almacenamiento del navegador`);
    if (PIEZAS_PUSH.test(codigo) && archivo !== CLIENTE_PUSH) p.push(`${archivo}: service worker o push fuera de su cliente`);
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
      privacidadPush: `${conversacion}\nconst f = "Privacidad del push";\n`,
      horario: `${conversacion}\nconst h = "Horario de silencio";\n`,
      swEnOtroLado: `${conversacion}\nvoid navigator.serviceWorker.register("/sw.js");\n`,
      suscripcionEnOtroLado: `${conversacion}\nconst r = (x: { pushManager: unknown }) => x.pushManager;\n`,
      permisoEnOtroLado: `${conversacion}\nvoid Notification.requestPermission();\n`,
    };
    for (const [nombre, codigo] of Object.entries(casos)) {
      assert.notEqual(codigo, conversacion, nombre);
      assert.notDeepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": codigo }), [], nombre);
    }
    // El permiso es SOLO el título en su archivo: ahí mismo, lo demás sigue en rojo.
    const formato = arbol[TEXTO_PERMITIDO.archivo]!;
    assert.ok(formato.includes(TEXTO_PERMITIDO.texto), "el título de la tarjeta está donde el permiso dice");
    assert.notDeepEqual(problemas({ ...arbol, [TEXTO_PERMITIDO.archivo]: `${formato}\nexport const x = "Comparar";\n` }), [], "formato con Comparar");
    // Tanda 6A: en la caja de preguntas, un segundo campo o un <textarea> siguen en rojo; y lo demás de la lista también.
    const caja = arbol[CAMPO_DE_PREGUNTAS]!;
    assert.ok(caja.includes("<input") && caja.includes("Preguntá"), "la caja está donde el permiso dice");
    for (const [nombre, codigo] of [
      ["otro campo", `${caja}\nexport const J = () => <input placeholder="y" />;\n`],
      ["un textarea", `${caja}\nexport const T = () => <textarea />;\n`],
      ["un chip de más", `${caja}\nexport const K = () => <button className="ac-chip">Stock</button>;\n`],
      ["texto prohibido", `${caja}\nconst s = "Saldo asignado";\n`],
    ] as const) {
      assert.notDeepEqual(problemas({ ...arbol, [CAMPO_DE_PREGUNTAS]: codigo }), [], nombre);
    }
    // Un texto que solo CONTIENE el nombre de un chip no es el chip: "Transferencia #182 recibida" sigue bien.
    assert.deepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": `${conversacion}\nconst ok = "Transferencias recibidas hoy";\n` }), []);
    // En prosa no cuenta: el código se mira sin comentarios.
    const conComentario = sinComentarios(`${conversacion}\n// todavía no hay "Ver diferencias" ni setInterval\n`);
    assert.deepEqual(problemas({ ...arbol, "src/components/chats/Conversacion.tsx": conComentario }), []);
  });

  it("5B. el temporizador de la espera por cupo existe, solo, y solo vuelve a habilitar", () => {
    assert.match(arbol[TEMPORIZADOR_DE_LA_ESPERA.archivo] ?? "", TEMPORIZADOR_DE_LA_ESPERA.forma);
  });

  it("CONTRAPRUEBA 5B: un segundo temporizador, uno que pide algo, o el mismo en otro archivo, es rojo", () => {
    const ESPERA = TEMPORIZADOR_DE_LA_ESPERA.archivo;
    const espera = arbol[ESPERA]!;
    const casos: Record<string, Record<string, string>> = {
      otroMas: { [ESPERA]: `${espera}
setTimeout(() => {}, 1000);
` },
      intervalo: { [ESPERA]: `${espera}
setInterval(() => {}, 1000);
` },
      quePide: { [ESPERA]: espera.replace("setTimeout(() => setHasta(null),", "setTimeout(() => { setHasta(null); void fetch(\"/api/chats\"); },") },
      enOtroArchivo: { "src/components/chats/Conversacion.tsx": `${arbol["src/components/chats/Conversacion.tsx"]}
const t = setTimeout(() => setHasta(null), Math.max(0, hasta - Date.now()));
` },
    };
    for (const [nombre, cambio] of Object.entries(casos)) {
      const k = Object.keys(cambio)[0]!;
      assert.notEqual(cambio[k], arbol[k], `el reemplazo ${nombre} no se aplicó`);
      assert.notDeepEqual(problemas({ ...arbol, ...cambio }), [], nombre);
    }
  });

  it("3B. la recarga por versión existe, y cada pieza está en su único lugar", () => {
    for (const pieza of PIEZAS_DE_LA_RECARGA) assert.ok(pieza.patron.test(arbol[pieza.archivo] ?? ""), `falta ${pieza.patron.source} en ${pieza.archivo}`);
  });

  it("CONTRAPRUEBA 3B: recargar, escuchar primer plano o cortar por tiempo fuera de su lugar, o un temporizador en la recarga, es rojo", () => {
    const VERSION = "src/components/chats/version.ts";
    const AZUL = "src/components/chats/AzulChat.tsx";
    const CLIENTE = "src/components/chats/clienteChats.ts";
    const conv = arbol["src/components/chats/Conversacion.tsx"]!;
    const casos: Record<string, Record<string, string>> = {
      recargaEnOtroLado: { "src/components/chats/Conversacion.tsx": `${conv}\nconst r = () => window.location.reload();\n` },
      recargaSuelta: { [AZUL]: `${arbol[AZUL]}\nexport const r2 = () => window.location.reload();\n` },
      recargaSinComprobador: { [AZUL]: arbol[AZUL]!.replace("pedir: pedirVersion, recargar });", "pedir: pedirVersion, recargar: () => {} });") },
      sinCommitPropio: { [AZUL]: arbol[AZUL]!.replace("{ propia: commit, yaRecargadoPor, pedir", "{ yaRecargadoPor, pedir") },
      pageshowEnOtroLado: { "src/components/chats/Conversacion.tsx": `${conv}\nwindow.addEventListener("pageshow", () => {});\n` },
      visibleEnOtroLado: { "src/components/chats/Conversacion.tsx": `${conv}\ndocument.addEventListener("visibilitychange", () => {});\n` },
      corteEnOtroLado: { "src/components/chats/Conversacion.tsx": `${conv}\nconst s = AbortSignal.timeout(1000);\n` },
      intervaloEnVersion: { [VERSION]: `${arbol[VERSION]}\nsetInterval(() => {}, 60000);\n` },
      timeoutEnVersion: { [VERSION]: `${arbol[VERSION]}\nsetTimeout(() => {}, 60000);\n` },
      timeoutEnCliente: { [CLIENTE]: `${arbol[CLIENTE]}\nsetTimeout(() => {}, 5000);\n` },
      sseEnVersion: { [VERSION]: `${arbol[VERSION]}\nnew EventSource("/api/version");\n` },
    };
    for (const [nombre, cambio] of Object.entries(casos)) {
      const [archivo, codigo] = Object.entries(cambio)[0]!;
      assert.notEqual(codigo, arbol[archivo], `el cambio ${nombre} no se aplicó`);
      assert.notDeepEqual(problemas({ ...arbol, ...cambio }), [], nombre);
    }
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
      generalConHook: { [CONVERSACION]: conv.replace(general, general.replace("useConversacion(pedirPagina, alPerderSesion, espera.anotar);", "useConversacion(pedirPagina, alPerderSesion, espera.anotar);\n  useLecturaLocal(estado as never, (() => {}) as never, alPerderSesion);")) },
      generalConPost: { [CONVERSACION]: conv.replace(general, general.replace("useConversacion(pedirPagina, alPerderSesion, espera.anotar);", "useConversacion(pedirPagina, alPerderSesion, espera.anotar);\n  void marcarLeido({ marcas: [] });")) },
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

// ── El service worker y la app instalable (Tanda 5A) ─────────────────────────
//
// public/sw.js hace DOS cosas: mostrar un push y abrir el local al tocarlo. No
// intercepta pedidos (sin `fetch`), no cachea, no guarda nada, no importa
// código de otro lado y no tiene temporizadores: no puede servir JS viejo, así
// que la recarga por versión sigue igual. Y el manifest usa los colores de los
// tokens, no otros.

const SW = "public/sw.js";
const MANIFEST = "src/app/manifest.ts";

function problemasDelServiceWorker(crudo: string): string[] {
  const p: string[] = [];
  const codigo = sinComentarios(crudo);
  const eventos = [...codigo.matchAll(/addEventListener\(\s*["'`]([a-z]+)["'`]/g)].map((m) => m[1]).sort();
  if (JSON.stringify(eventos) !== JSON.stringify(["activate", "install", "notificationclick", "push"])) p.push(`escucha: ${eventos.join(", ")}`);
  if (/\bonfetch\b|["'`]fetch["'`]|(?<![\w-])fetch\s*\(/.test(codigo)) p.push("intercepta o hace pedidos");
  if (/\bcaches\b|CacheStorage|indexedDB|localStorage|sessionStorage|cookieStore/.test(codigo)) p.push("guarda algo");
  if (/importScripts|\bimport\s*\(|\bimport\s+/.test(codigo)) p.push("carga código de otro lado");
  if (/\b(setInterval|setTimeout)\b|periodicsync|\bsync\b/.test(codigo)) p.push("trabaja en segundo plano por su cuenta");
  // Lo único que abre es un local de Azul Chat (o la lista): la URL del aviso se valida.
  if (!/const RUTA_LOCAL = \/\^\\\/\\\?vista=local&localId=\[1-9\]\[0-9\]\{0,9\}\$\/;/.test(codigo)) p.push("no valida la URL que abre");
  if (!/openWindow\(url\)/.test(codigo) || /openWindow\((?!url\))/.test(codigo)) p.push("abre otra cosa que la URL validada");
  return p;
}

function tokenDe(css: string, nombre: string): string | undefined {
  const raiz = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  return new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(raiz)?.[1]?.toLowerCase();
}

function problemasDelManifest(manifest: string, css: string, layout: string): string[] {
  const p: string[] = [];
  const marca = tokenDe(css, "ac-color-marca");
  const fondo = tokenDe(css, "ac-color-fondo");
  const constante = (n: string) => new RegExp(`const ${n} = "(#[0-9a-fA-F]{6})";`).exec(manifest)?.[1]?.toLowerCase();
  if (!marca || constante("COLOR_MARCA") !== marca) p.push("el color de marca del manifest no es el token");
  if (!fondo || constante("COLOR_FONDO") !== fondo) p.push("el color de fondo del manifest no es el token");
  if (/#[0-9a-fA-F]{3,8}/.test(manifest.replace(/const COLOR_(MARCA|FONDO) = "#[0-9a-fA-F]{6}";/g, ""))) p.push("el manifest tiene otro color escrito");
  if (!marca || !new RegExp(`themeColor: "${marca}"`, "i").test(layout)) p.push("el themeColor del layout no es el token");
  return p;
}

describe("el service worker y la app instalable", () => {
  const sw = readFileSync(path.join(RAIZ, SW), "utf8");
  const manifest = sinComentarios(readFileSync(path.join(RAIZ, MANIFEST), "utf8"));
  const css = readFileSync(path.join(RAIZ, "src/app/globals.css"), "utf8");
  const layout = sinComentarios(readFileSync(path.join(RAIZ, "src/app/layout.tsx"), "utf8"));

  it("5A. el service worker solo maneja push y el toque: sin fetch, sin caché, sin almacenamiento, sin temporizadores", () => {
    assert.deepEqual(problemasDelServiceWorker(sw), []);
  });

  it("CONTRAPRUEBA: atrapa un fetch, una caché, un almacenamiento, un import, un temporizador y una URL sin validar", () => {
    const casos: Record<string, string> = {
      fetch: `${sw}\nself.addEventListener("fetch", (e) => e.respondWith(fetch(e.request)));\n`,
      cache: `${sw}\nself.addEventListener("install", (e) => e.waitUntil(caches.open("v1")));\n`,
      guardar: `${sw}\nconst db = indexedDB.open("x");\n`,
      importar: `importScripts("/otro.js");\n${sw}`,
      temporizador: `${sw}\nsetInterval(() => {}, 1000);\n`,
      sync: `${sw}\nself.addEventListener("sync", () => {});\n`,
      otraUrl: sw.replace("return self.clients.openWindow(url);", "return self.clients.openWindow(datos.url);"),
      sinValidar: sw.replace("const RUTA_LOCAL = /^\\/\\?vista=local&localId=[1-9][0-9]{0,9}$/;", "const RUTA_LOCAL = /./;"),
    };
    for (const [nombre, codigo] of Object.entries(casos)) {
      assert.notEqual(codigo, sw, `el cambio ${nombre} no se aplicó`);
      assert.notDeepEqual(problemasDelServiceWorker(codigo), [], nombre);
    }
  });

  it("5A. el manifest y el themeColor usan los tokens de color", () => {
    assert.deepEqual(problemasDelManifest(manifest, css, layout), []);
  });

  it("CONTRAPRUEBA: un color que no es el token, en el manifest o en el layout, es rojo", () => {
    assert.notDeepEqual(problemasDelManifest(manifest.replace('const COLOR_MARCA = "#0fa3a3";', 'const COLOR_MARCA = "#123456";'), css, layout), []);
    assert.notDeepEqual(problemasDelManifest(manifest.replace("theme_color: COLOR_MARCA", 'theme_color: "#000000"'), css, layout), []);
    assert.notDeepEqual(problemasDelManifest(manifest, css, layout.replace('themeColor: "#0fa3a3"', 'themeColor: "#ff0000"')), []);
  });
});
