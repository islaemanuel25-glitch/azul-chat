// CANDADO: las rutas del navegador son acciones concretas, no un proxy.
//
// Lo que el navegador puede pedir es: ver el estado de su sesión, vincular con
// un código, cerrar, y —desde la Tanda 2B— ver sus chats (la lista, un local,
// General) y marcar leído; desde la Tanda 3A, las ventas de hoy de un local;
// desde la Tanda 5A, activar y desactivar las notificaciones push (y una ruta
// interna que NO es del navegador). No hay una ruta que reciba una capacidad, una URL o un
// camino del ERP y lo reenvíe. Una ruta nueva entra a propósito, con su
// manejador y sus tests, y ese día se actualiza la lista de abajo.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo, especificadores, sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const rel = (f: string) => path.relative(RAIZ, f).split(path.sep).join("/");

/** Las rutas permitidas, con los métodos que exporta cada una y su único manejador. */
const RUTAS = {
  "src/app/api/salud/route.ts": {
    metodos: ["GET"],
    importa: ["../../../server/db.ts", "../../../server/http/respuestas.ts", "../../../server/salud.ts"],
  },
  "src/app/api/version/route.ts": { metodos: ["GET"], importa: ["../../../server/http/respuestas.ts", "../../../server/version.ts"] },
  "src/app/api/sesion/route.ts": {
    metodos: ["DELETE", "GET"],
    importa: ["../../../server/sesion/cerrar.ts", "../../../server/sesion/dependencias.ts", "../../../server/sesion/estado.ts"],
  },
  "src/app/api/sesion/vincular/route.ts": {
    metodos: ["POST"],
    importa: ["../../../../server/sesion/dependencias.ts", "../../../../server/sesion/vincular.ts"],
  },
  // Tanda 2B: los chats. El local va por query (`?localId=`), no por segmento:
  // la regla de abajo sigue sin admitir segmentos dinámicos.
  "src/app/api/chats/route.ts": {
    metodos: ["GET"],
    importa: ["../../../server/chats/manejadores.ts", "../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/chats/local/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/chats/general/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/chats/leido/route.ts": {
    metodos: ["POST"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 3A: las ventas de hoy de un local. Una acción concreta —período fijo
  // "hoy", el local por query—, no un pase genérico a `ventas_resumen`.
  "src/app/api/chats/ventas/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 7B: las cajas de hoy de un local, por turno. Igual que ventas: una
  // acción concreta —período fijo "hoy", el local por query—, no un pase
  // genérico a `cajas_resumen`.
  "src/app/api/chats/caja/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 8B: los productos bajo mínimo de un local. Igual que caja: una acción
  // concreta —modo fijo "bajo_minimo", el local por query—, no un pase genérico
  // a `stock_consulta`. El texto de un producto solo viaja por las preguntas.
  "src/app/api/chats/stock/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 9B: lo pendiente de un local (pedidos sin enviar, cajas a revisar) y
  // de todos. Dos acciones concretas, sin capacidad ni período elegibles: el
  // local por query en una, nada en la otra. No es un pase a ninguna capacidad.
  "src/app/api/chats/pendientes/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/chats/pendientes/general/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../../server/chats/manejadores.ts", "../../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 10: buscar en el historial guardado. Una acción concreta sobre la
  // base propia —texto, filtro, el chat por query y el cursor—, no un pase al
  // ERP: del ERP solo usa `mi_alcance`, como cualquier GET de chats.
  "src/app/api/chats/buscar/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/chats/manejadores.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 6A: una pregunta en lenguaje natural. Una acción concreta —la IA solo
  // elige una intención de un catálogo cerrado; ventas y eventos los arma el
  // código—, no un pase genérico al ERP ni a la IA. Con sesión y Origin.
  "src/app/api/chats/preguntar/route.ts": {
    metodos: ["POST"],
    importa: ["../../../../server/preguntas/manejador.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 5A: notificaciones push. La clave pública VAPID (no es secreta) y
  // suscribir/dar de baja ESTE dispositivo, con sesión y Origin. Ninguna llama
  // al ERP ni recibe una URL que reenviar: el endpoint de push se valida contra
  // una lista cerrada de servicios (src/server/push/suscripcion.ts).
  "src/app/api/push/clave/route.ts": { metodos: ["GET"], importa: ["../../../../server/push/manejadores.ts"] },
  "src/app/api/push/suscribir/route.ts": { metodos: ["DELETE", "POST"], importa: ["../../../../server/push/manejadores.ts"] },
  // Tanda 11: el estado REAL del push de este navegador (¿el servidor lo
  // tiene?), solo lectura; y la configuración de la persona: leerla, guardar
  // el horario de silencio y cerrar las OTRAS sesiones. Ninguna llama al ERP;
  // las que escriben exigen sesión y Origin (src/server/sesion/configuracion.ts).
  "src/app/api/push/estado/route.ts": { metodos: ["GET"], importa: ["../../../../server/push/manejadores.ts"] },
  "src/app/api/sesion/configuracion/route.ts": {
    metodos: ["GET"],
    importa: ["../../../../server/sesion/configuracion.ts", "../../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/sesion/silencio/route.ts": {
    metodos: ["PUT"],
    importa: ["../../../../server/sesion/configuracion.ts", "../../../../server/sesion/dependencias.ts"],
  },
  "src/app/api/sesion/otras/route.ts": {
    metodos: ["DELETE"],
    importa: ["../../../../server/sesion/configuracion.ts", "../../../../server/sesion/dependencias.ts"],
  },
  // Tanda 5A: la sincronización en segundo plano. NO es del navegador: solo el
  // timer del VPS, por 127.0.0.1 y con su secreto; si no, 404 (GET también,
  // para que Next no conteste un 405 que delate que existe). Que el navegador
  // no la llama lo fija secretoSoloServidor.test.ts; que sin secreto, por nginx
  // o desde el navegador no anda, test/db/interno.test.ts.
  "src/app/api/interno/sincronizar/route.ts": { metodos: ["GET", "POST"], importa: ["../../../../server/interno/sincronizar.ts"] },
  // Tanda 12: el vigía de la sincronización. Tampoco es del navegador: la
  // misma puerta que sincronizar (secreto, 127.0.0.1, sin nginx; si no, 404,
  // también por GET). No llama al ERP. Lo prueba test/db/vigia.test.ts.
  "src/app/api/interno/vigia/route.ts": { metodos: ["GET", "POST"], importa: ["../../../../server/interno/vigia.ts"] },
};

const METODOS_HTTP = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

/** Las violaciones de un árbol de archivos (ruta relativa → código). */
function violacionesDeRutas(archivos: Record<string, string>): string[] {
  const malas: string[] = [];
  for (const [archivo, crudo] of Object.entries(archivos)) {
    if (!archivo.startsWith("src/app/")) continue;
    // Ningún segmento dinámico ni comodín en la app: `[...ruta]`, `[[...ruta]]`, `[capacidad]`.
    if (/\[/.test(archivo)) malas.push(`${archivo}: segmento dinámico`);
    if (!/\/route\.(ts|tsx|js|mjs)$/.test(archivo)) continue;
    const esperada = RUTAS[archivo as keyof typeof RUTAS];
    if (!esperada) {
      malas.push(`${archivo}: ruta no declarada`);
      continue;
    }
    const codigo = sinComentarios(crudo);
    const metodos = [...codigo.matchAll(METODOS_HTTP)].map((m) => m[1] ?? m[2]).sort();
    if (JSON.stringify(metodos) !== JSON.stringify(esperada.metodos)) malas.push(`${archivo}: métodos ${metodos.join(",")}`);
    const imports = especificadores(crudo).sort();
    if (JSON.stringify(imports) !== JSON.stringify(esperada.importa)) malas.push(`${archivo}: importa ${imports.join(",")}`);
    // La ruta no toca el ERP ni el cuerpo: delega.
    if (/fetch|\/api\/integraciones|capacidad|request\.(json|text|body)|searchParams/.test(codigo)) malas.push(`${archivo}: no solo delega`);
  }
  return malas;
}

function arbolDeSrcApp(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const f of archivosDelRepo(RAIZ, "src/app")) salida[rel(f)] = /\.(ts|tsx|js|mjs)$/.test(f) ? readFileSync(f, "utf8") : "";
  return salida;
}

describe("las rutas son acciones concretas", () => {
  it("27. existen exactamente las rutas declaradas, sin comodines, y cada una solo delega", () => {
    const arbol = arbolDeSrcApp();
    assert.deepEqual(violacionesDeRutas(arbol), []);
    for (const r of Object.keys(RUTAS)) assert.ok(r in arbol, `falta ${r}`);
  });

  it("CONTRAPRUEBA: atrapa un proxy genérico, una ruta de más, un método de más y una ruta que llama al ERP", () => {
    const arbol = arbolDeSrcApp();
    const vincular = arbol["src/app/api/sesion/vincular/route.ts"]!;
    const casos: Record<string, Record<string, string>> = {
      proxy: { "src/app/api/erp/[...ruta]/route.ts": "export async function POST() {}\n" },
      opcional: { "src/app/api/[[...todo]]/route.ts": "export async function GET() {}\n" },
      nueva: { "src/app/api/consultar/route.ts": "export async function POST() {}\n" },
      metodo: { "src/app/api/sesion/vincular/route.ts": `${vincular}\nexport function GET() {}\n` },
      erp: { "src/app/api/sesion/vincular/route.ts": `${vincular}\nconst x = () => fetch("/api/integraciones/azul-chat/consultar");\n` },
      cuerpo: { "src/app/api/sesion/vincular/route.ts": `${vincular}\nconst y = (request: Request) => request.json();\n` },
      // Tanda 6A: la ruta de preguntas solo delega y solo por POST.
      preguntarGet: { "src/app/api/chats/preguntar/route.ts": `${arbol["src/app/api/chats/preguntar/route.ts"]}\nexport function GET() {}\n` },
      preguntarIa: {
        "src/app/api/chats/preguntar/route.ts": `${arbol["src/app/api/chats/preguntar/route.ts"]}\nconst z = () => fetch("https://generativelanguage.googleapis.com/v1beta/models");\n`,
      },
      preguntarOtra: { "src/app/api/chats/preguntar-libre/route.ts": "export async function POST() {}\n" },
      // Tanda 7B: la ruta de caja solo delega, solo GET, y no recibe la capacidad ni el período.
      cajaPost: { "src/app/api/chats/caja/route.ts": `${arbol["src/app/api/chats/caja/route.ts"]}\nexport function POST() {}\n` },
      cajaErp: {
        "src/app/api/chats/caja/route.ts": `${arbol["src/app/api/chats/caja/route.ts"]}\nconst c = (r: Request) => new URL(r.url).searchParams.get("capacidad");\n`,
      },
      cajaPorSegmento: { "src/app/api/chats/caja/[periodo]/route.ts": "export async function GET() {}\n" },
      // Tanda 8B: la ruta de stock solo delega, solo GET, y no recibe ni el modo ni un texto.
      stockPost: { "src/app/api/chats/stock/route.ts": `${arbol["src/app/api/chats/stock/route.ts"]}\nexport function POST() {}\n` },
      stockTexto: {
        "src/app/api/chats/stock/route.ts": `${arbol["src/app/api/chats/stock/route.ts"]}\nconst t = (r: Request) => new URL(r.url).searchParams.get("texto");\n`,
      },
      stockPorSegmento: { "src/app/api/chats/stock/[texto]/route.ts": "export async function GET() {}\n" },
      // Tanda 9B: las de pendientes solo delegan, solo GET, y no reciben una capacidad ni un local por segmento.
      pendientesPost: { "src/app/api/chats/pendientes/route.ts": `${arbol["src/app/api/chats/pendientes/route.ts"]}\nexport function POST() {}\n` },
      pendientesCapacidad: {
        "src/app/api/chats/pendientes/route.ts": `${arbol["src/app/api/chats/pendientes/route.ts"]}\nconst k = (r: Request) => new URL(r.url).searchParams.get("capacidad");\n`,
      },
      pendientesGeneralErp: {
        "src/app/api/chats/pendientes/general/route.ts": `${arbol["src/app/api/chats/pendientes/general/route.ts"]}\nconst g = () => fetch("/api/integraciones/azul-chat/consultar");\n`,
      },
      pendientesPorSegmento: { "src/app/api/chats/pendientes/[localId]/route.ts": "export async function GET() {}\n" },
      pendientesOtra: { "src/app/api/chats/pendientes/todos/route.ts": "export async function GET() {}\n" },
      // Tanda 10: la de buscar solo delega, solo GET, no lee la consulta ni llama al ERP, y no hay otra al lado.
      buscarPost: { "src/app/api/chats/buscar/route.ts": `${arbol["src/app/api/chats/buscar/route.ts"]}\nexport function POST() {}\n` },
      buscarConsulta: {
        "src/app/api/chats/buscar/route.ts": `${arbol["src/app/api/chats/buscar/route.ts"]}\nconst b = (r: Request) => new URL(r.url).searchParams.get("texto");\n`,
      },
      buscarErp: {
        "src/app/api/chats/buscar/route.ts": `${arbol["src/app/api/chats/buscar/route.ts"]}\nconst e = () => fetch("/api/integraciones/azul-chat/consultar");\n`,
      },
      buscarPorSegmento: { "src/app/api/chats/buscar/[texto]/route.ts": "export async function GET() {}\n" },
      buscarOtra: { "src/app/api/chats/buscar/erp/route.ts": "export async function GET() {}\n" },
      // Tanda 11: cada ruta de configuración, solo su método y solo delegando; ninguna por segmento.
      estadoPushPost: { "src/app/api/push/estado/route.ts": `${arbol["src/app/api/push/estado/route.ts"]}\nexport function POST() {}\n` },
      estadoPushConsulta: {
        "src/app/api/push/estado/route.ts": `${arbol["src/app/api/push/estado/route.ts"]}\nconst q = (r: Request) => new URL(r.url).searchParams.get("endpoint");\n`,
      },
      configuracionPut: { "src/app/api/sesion/configuracion/route.ts": `${arbol["src/app/api/sesion/configuracion/route.ts"]}\nexport function PUT() {}\n` },
      silencioGet: { "src/app/api/sesion/silencio/route.ts": `${arbol["src/app/api/sesion/silencio/route.ts"]}\nexport function GET() {}\n` },
      silencioCuerpo: { "src/app/api/sesion/silencio/route.ts": `${arbol["src/app/api/sesion/silencio/route.ts"]}\nconst c = (request: Request) => request.json();\n` },
      otrasPost: { "src/app/api/sesion/otras/route.ts": `${arbol["src/app/api/sesion/otras/route.ts"]}\nexport function POST() {}\n` },
      otrasErp: { "src/app/api/sesion/otras/route.ts": `${arbol["src/app/api/sesion/otras/route.ts"]}\nconst e2 = () => fetch("/api/integraciones/azul-chat/consultar");\n` },
      otraPorSegmento: { "src/app/api/sesion/otras/[sesionId]/route.ts": "export async function DELETE() {}\n" },
      // Tanda 12: el vigía solo delega en su manejador, sin leer el cuerpo ni llamar al ERP; y no hay otra interna al lado.
      vigiaPut: { "src/app/api/interno/vigia/route.ts": `${arbol["src/app/api/interno/vigia/route.ts"]}\nexport function PUT() {}\n` },
      vigiaErp: { "src/app/api/interno/vigia/route.ts": `${arbol["src/app/api/interno/vigia/route.ts"]}\nconst v = () => fetch("/api/integraciones/azul-chat/consultar");\n` },
      vigiaCuerpo: { "src/app/api/interno/vigia/route.ts": `${arbol["src/app/api/interno/vigia/route.ts"]}\nconst c2 = (request: Request) => request.text();\n` },
      otraInterna: { "src/app/api/interno/avisar/route.ts": "export async function POST() {}\n" },
    };
    for (const [nombre, cambio] of Object.entries(casos)) {
      assert.notDeepEqual(violacionesDeRutas({ ...arbol, ...cambio }), [], nombre);
    }
  });
});

describe("el panel de sesión", () => {
  const PANEL = "src/components/sesion/PanelSesion.tsx";
  const panel = sinComentarios(readFileSync(path.join(RAIZ, PANEL), "utf8"));

  /** Lo que el panel no puede hacer con la sesión ni con el código. */
  function problemasDelPanel(codigo: string): string[] {
    const p: string[] = [];
    if (/localStorage|sessionStorage|indexedDB|document\.cookie/.test(codigo)) p.push("almacenamiento del navegador");
    if (/\bconsole\./.test(codigo)) p.push("consola");
    if (/[?&]codigo=|URLSearchParams|history\.|location\.(href|search|assign|replace)/.test(codigo)) p.push("código en la URL");
    if (/\bmethod:\s*"GET"[^}]*codigo|`[^`]*\$\{\s*(codigo|enviado)/.test(codigo)) p.push("código armado en un texto");
    if (!/body:\s*JSON\.stringify\(\{\s*codigo:\s*enviado\s*\}\)/.test(codigo)) p.push("el código no va en el cuerpo JSON");
    if (/usuarioId|vinculoId|tokenDelegacion|delegacion/.test(codigo)) p.push("manda identidad o token");
    return p;
  }

  it("3/5/6/30. el código va solo en el cuerpo de un POST; nada de URL, almacenamiento ni consola; sin usuarioId ni vinculoId", () => {
    assert.deepEqual(problemasDelPanel(panel), []);
  });

  it("CONTRAPRUEBA: atrapa cada forma de sacar el código o la sesión de donde va", () => {
    const casos = [
      panel.replace("setCodigo(\"\");", 'setCodigo(""); localStorage.setItem("c", enviado);'),
      panel.replace("setCodigo(\"\");", 'setCodigo(""); sessionStorage.setItem("c", enviado);'),
      panel.replace("setCodigo(\"\");", 'setCodigo(""); console.log(enviado);'),
      panel.replace("fetch(RUTA_VINCULAR,", "fetch(`${RUTA_VINCULAR}?codigo=${enviado}`,"),
      panel.replace("JSON.stringify({ codigo: enviado })", "JSON.stringify({ codigo: enviado, usuarioId: 1 })"),
      panel.replace("JSON.stringify({ codigo: enviado })", "new URLSearchParams({ codigo: enviado })"),
    ];
    for (const [i, c] of casos.entries()) {
      assert.notEqual(c, panel, `el reemplazo ${i} no se aplicó`);
      assert.notDeepEqual(problemasDelPanel(c), [], `caso ${i}`);
    }
  });
});
