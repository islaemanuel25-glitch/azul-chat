// scripts/generar-fixture-erp.mjs
//
// GENERA test/fixtures/erp-25172fe.json EJECUTANDO EL CÓDIGO DEL ERP.
//
// Los fixtures de respuesta del ERP no se escriben a mano (CLAUDE.md): salen de
// correr el código real de erpmanual en el commit desplegado. Este script lo
// hace de punta a punta con `atenderSolicitud` del ERP —firma HMAC, lectura
// canónica del cuerpo, parámetros de la capacidad, la puerta de autorización y
// el ejecutor real— sobre los MISMOS bytes que manda Azul Chat, y traduce con
// `aRespuestaPublica`, que es lo que la ruta del ERP devuelve.
//
// Lo único que no es del ERP son las filas que devolvería su base: van en la
// forma exacta de los `select` del ERP (`SELECT_EVENTO`, los del cargador y de
// `miAlcance`), copiada de sus candados, y están marcadas abajo.
//
// Uso, desde la raíz de azul-chat, con un checkout de erpmanual SIN cambios en
// el commit esperado:
//
//   node --import <erpmanual>/scripts/alias-loader.mjs scripts/generar-fixture-erp.mjs <erpmanual>
//
// No habla con ningún ERP real, no usa secretos reales y no toca ninguna base.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_ERP = "25172fe06babd900344686dafc56c824838ec57a";
const SALIDA = path.resolve(import.meta.dirname, "../test/fixtures/erp-25172fe.json");

const raizErp = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!raizErp) {
  console.error("Uso: node --import <erpmanual>/scripts/alias-loader.mjs scripts/generar-fixture-erp.mjs <erpmanual>");
  process.exit(2);
}
const git = (...args) => execFileSync("git", ["-C", raizErp, ...args], { encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== SHA_ERP) {
  console.error(`erpmanual tiene que estar en ${SHA_ERP} (está en ${git("rev-parse", "HEAD")}).`);
  process.exit(2);
}
if (git("status", "--porcelain", "--untracked-files=no") !== "") {
  console.error("erpmanual tiene cambios sin commitear: el fixture no sería del commit.");
  process.exit(2);
}

const delErp = (rel) => import(pathToFileURL(path.join(raizErp, rel)).href);
const { atenderSolicitud } = await delErp("lib/integraciones/azul-chat/atender.js");
const { firmarSolicitud, CABECERAS } = await delErp("lib/integraciones/azul-chat/autenticacionAplicacion.js");
const { aRespuestaPublica } = await delErp("lib/integraciones/azul-chat/respuestaPublica.js");
const { transferenciasEventos } = await delErp("lib/integraciones/azul-chat/transferenciasEventos.js");
const { miAlcance } = await delErp("lib/integraciones/azul-chat/miAlcance.js");
const { generarTokenDelegacion, hashTokenDelegacion } = await delErp("lib/integraciones/vinculos/codigoVinculo.js");
const { DEFAULT_PERMISOS_SISTEMA, ENCARGADO, CAJERO } = await delErp("lib/rbac/systemRoles.js");

const SECRETO = "secreto-de-prueba-que-no-es-real-0123456789";
const ENTORNO = { AZUL_CHAT_INTEGRACION_SECRET: SECRETO, AUTH_SECRET: "otro-secreto-de-prueba-de-las-sesiones-erp" };
const AHORA = Date.parse("2026-10-08T12:00:00.000Z");

// ── lo que contestaría la base del ERP (forma de sus `select`) ─────────────

// Grupo 1: Casiano (3), Belgrano (5, inactivo) y el Depósito Central (9). Grupo 2: Centro (20).
const LOCALES = {
  3: { id: 3, nombre: "Casiano", es_deposito: false, activo: true },
  5: { id: 5, nombre: "Belgrano", es_deposito: false, activo: false },
  9: { id: 9, nombre: "Depósito Central", es_deposito: true, activo: true },
  20: { id: 20, nombre: "Centro", es_deposito: false, activo: true },
};
const GRUPO_LOCAL = [{ localId: 3, grupoId: 1 }, { localId: 5, grupoId: 1 }, { localId: 20, grupoId: 2 }];
const GRUPO_DEPOSITO = [{ localId: 9, grupoId: 1 }];
const grupoDeLocal = async (id) =>
  GRUPO_LOCAL.find((g) => g.localId === id)?.grupoId ?? GRUPO_DEPOSITO.find((g) => g.localId === id)?.grupoId ?? null;
const localIdsDeGrupo = async (gid) => [...GRUPO_LOCAL, ...GRUPO_DEPOSITO].filter((g) => g.grupoId === gid).map((g) => g.localId);

// Personas con los roles REALES del ERP: encargado y cajero de Casiano, y un admin global.
const PERSONAS = {
  7: { id: 7, nombre: "Encargada Casiano", activo: true, localId: 3, rol: { permisos: DEFAULT_PERMISOS_SISTEMA[ENCARGADO] } },
  8: { id: 8, nombre: "Cajero Casiano", activo: true, localId: 3, rol: { permisos: DEFAULT_PERMISOS_SISTEMA[CAJERO] } },
  9: { id: 9, nombre: "Emanuel", activo: true, localId: null, rol: { permisos: ["*"] } },
};
const TOKEN = Object.fromEntries(Object.keys(PERSONAS).map((id) => [id, generarTokenDelegacion()]));
const DELEGACIONES = Object.fromEntries(
  Object.entries(TOKEN).map(([id, t], i) => [hashTokenDelegacion(t), { id: 200 + i, vinculo: { id: 100 + i, usuarioId: Number(id), aplicacion: "AZUL_CHAT", revocadoEn: null } }])
);
const cargador = {
  delegacion: async (hash) => DELEGACIONES[hash] ?? null,
  usuario: async (id) => PERSONAS[id] ?? null,
  grupoDeLocal,
};

/** Una línea del remito con la forma de `SELECT_EVENTO.detalle`: 10 enviadas, `recibido` contadas. */
const linea = (recibido) => ({
  cantidad: 10,
  recibido,
  recibidoUnidadesSueltas: null,
  precioCosto: 100,
  unidadEnviada: "UNIDAD",
  presentacionEnvio: "UNIDAD",
  cantidadPresentada: 10,
  factorPresentacion: 1,
  sueltasEnviadas: 0,
  pesoPiezaKg: null,
  agregadoEnRecepcion: false,
  revisadoEnRecepcion: true,
  productoId: 1,
  producto: { precio_costo: 100, nombre: "Producto", base: { unidad_medida: "unidad", factor_pack: 1, nombre: "Producto" } },
});
const DEPOSITO = { id: 9, nombre: "Depósito Central", es_deposito: true };
const BELGRANO = { id: 5, nombre: "Belgrano", es_deposito: false };
const CASIANO = { id: 3, nombre: "Casiano" };
const transferencia = (id, fechaRecepcion, extra = {}) => ({
  id,
  estado: "Recibida",
  fechaEnvio: new Date(Date.parse(fechaRecepcion) - 3_600_000),
  fechaRecepcion: new Date(fechaRecepcion),
  createdAt: new Date(Date.parse(fechaRecepcion) - 3_600_000),
  destinoId: 3,
  tieneDiferencias: false,
  origen: DEPOSITO,
  destino: CASIANO,
  detalle: [linea(10)],
  ...extra,
});

// La historia de Casiano. 181 y 182 se recibieron en el MISMO milisegundo.
const ANTES_DEL_RESET = [
  transferencia(180, "2026-10-07T12:00:00.000Z"),
  transferencia(181, "2026-10-07T13:30:15.250Z", { tieneDiferencias: true, detalle: [linea(7), linea(12), linea(10)] }),
  transferencia(182, "2026-10-07T13:30:15.250Z", { tieneDiferencias: true, detalle: [linea(9), linea(8), linea(11)] }),
  transferencia(183, "2026-10-07T14:10:00.000Z", { origen: BELGRANO }),
  // Las que la capacidad NO publica: otra en camino y una de otro destino.
  transferencia(184, "2026-10-07T15:00:00.000Z", { estado: "Recibiendo", fechaRecepcion: null }),
  transferencia(185, "2026-10-07T15:30:00.000Z", { destinoId: 20, destino: { id: 20, nombre: "Centro" } }),
];
// Después de un reset-operativo el id 180 vuelve a existir, con otra recepción.
const DESPUES_DEL_RESET = [transferencia(180, "2026-10-08T10:00:00.000Z", { tieneDiferencias: true, detalle: [linea(6)] })];

/** Lo justo de Prisma para el `where`, `orderBy` y `take` de `transferenciasEventos`. Revienta ante cualquier otra cosa. */
function baseDeTransferencias(filas) {
  const vale = (fila, where) =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === "OR") return cond.some((w) => vale(fila, w));
      const v = fila[campo];
      if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
      if (cond === null || typeof cond !== "object") return v === cond;
      return Object.entries(cond).every(([op, x]) => {
        const n = v instanceof Date ? v.getTime() : v;
        const m = x instanceof Date ? x.getTime() : x;
        if (op === "not") return x === null ? v !== null : n !== m;
        if (v === null) return false;
        if (op === "gt") return n > m;
        if (op === "lte") return n <= m;
        throw new Error(`operador no previsto: ${op}`);
      });
    });
  return {
    local: { findUnique: async ({ where }) => (LOCALES[where.id] ? { id: LOCALES[where.id].id, nombre: LOCALES[where.id].nombre } : null) },
    transferencia: {
      findMany: async ({ where, orderBy, take }) => {
        const elegidas = filas.filter((f) => vale(f, where));
        elegidas.sort((a, b) => {
          for (const o of orderBy) {
            const [[campo, dir]] = Object.entries(o);
            const x = a[campo] instanceof Date ? a[campo].getTime() : a[campo];
            const y = b[campo] instanceof Date ? b[campo].getTime() : b[campo];
            if (x !== y) return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
          }
          return 0;
        });
        return elegidas.slice(0, take);
      },
    },
  };
}
const baseDeAlcance = {
  usuario: { findUnique: async ({ where }) => (PERSONAS[where.id] ? { id: where.id, nombre: PERSONAS[where.id].nombre } : null) },
  grupoLocal: { findMany: async () => GRUPO_LOCAL.map((g) => ({ localId: g.localId })) },
  grupoDeposito: { findMany: async () => GRUPO_DEPOSITO.map((g) => ({ localId: g.localId })) },
  local: { findMany: async ({ where }) => where.id.in.map((id) => LOCALES[id]).filter(Boolean) },
};

// ── la llamada, como la hace Azul Chat ────────────────────────────────────

/**
 * Lo que devuelve la ruta del ERP para ese cuerpo: status y cuerpo públicos.
 * El cuerpo se serializa UNA vez, se firma y se manda tal cual, como el cliente.
 */
async function consultar(personaId, { capacidad, alcance, parametros }, filas = ANTES_DEL_RESET) {
  // El orden de las claves es el del cliente de Azul Chat: capacidad, delegacion, alcance, parametros.
  const token = TOKEN[personaId];
  const texto = JSON.stringify({ capacidad, delegacion: { token }, ...(alcance ? { alcance } : {}), parametros });
  const marca = String(Math.floor(AHORA / 1000));
  const headers = new Headers({
    "content-type": "application/json",
    [CABECERAS.aplicacion]: "azul-chat",
    [CABECERAS.marca]: marca,
    [CABECERAS.firma]: firmarSolicitud({ secreto: SECRETO, aplicacion: "azul-chat", marca, cuerpo: texto }),
  });
  const ejecutores = {
    transferencias_eventos: (a, p, { ahora }) => transferenciasEventos(a, p, { db: baseDeTransferencias(filas), ahora }),
    mi_alcance: (a, p) => miAlcance(a, p, { db: baseDeAlcance, grupoDeLocal, localIdsDeGrupo }),
  };
  const r = aRespuestaPublica(await atenderSolicitud({ headers, cuerpo: texto }, { cargador, ejecutores, entorno: ENTORNO, ahora: AHORA }));
  return {
    // El cuerpo que viajó, con el token enmascarado: el fixture no guarda credenciales.
    pedido: JSON.parse(texto.replace(token, "<token>")),
    respuesta: { status: r.status, cuerpo: r.cuerpo },
  };
}

const eventos = (parametros) => ({ capacidad: "transferencias_eventos", alcance: { grupoId: 1, localId: 3 }, parametros });
const exigir = (cond, que) => {
  if (!cond) throw new Error(`el ERP no contestó lo esperado: ${que}`);
};

const pagina1 = await consultar(7, eventos({ limite: 2 }));
exigir(pagina1.respuesta.status === 200 && pagina1.respuesta.cuerpo.datos.hayMas === true, "pagina1");
const pagina2 = await consultar(7, eventos({ desde: pagina1.respuesta.cuerpo.datos.siguiente, limite: 2 }));
exigir(pagina2.respuesta.status === 200 && pagina2.respuesta.cuerpo.datos.hayMas === false, "pagina2");
const vacia = await consultar(7, eventos({ desde: pagina2.respuesta.cuerpo.datos.siguiente, limite: 2 }));
exigir(vacia.respuesta.status === 200 && vacia.respuesta.cuerpo.datos.eventos.length === 0, "vacia");
const sinDesde = await consultar(7, eventos({}));
exigir(sinDesde.respuesta.status === 200 && sinDesde.respuesta.cuerpo.datos.hayMas === false, "sinDesde");
const despuesDelReset = await consultar(7, eventos({ desde: pagina2.respuesta.cuerpo.datos.siguiente }), DESPUES_DEL_RESET);
exigir(despuesDelReset.respuesta.cuerpo.datos?.eventos?.length === 1, "despuesDelReset");

const fixture = {
  _origen:
    `Generado por scripts/generar-fixture-erp.mjs ejecutando el código de erpmanual en ${SHA_ERP}: atenderSolicitud ` +
    "(firma, cuerpo canónico, parámetros, autorización) con los ejecutores reales transferenciasEventos y miAlcance, y aRespuestaPublica. " +
    "Las filas de la base del ERP tienen la forma de sus select y están en el script. Roles reales: ENCARGADO, CAJERO y admin (*). " +
    "No editar a mano: regenerar.",
  ahora: new Date(AHORA).toISOString(),
  transferenciasEventos: {
    pagina1,
    pagina2,
    vacia,
    sinDesde,
    despuesDelReset,
    cajeroSinPermiso: await consultar(8, eventos({})),
    limiteFueraDeRango: await consultar(7, eventos({ limite: 101 })),
    otroLocalDelGrupo: await consultar(7, { ...eventos({}), alcance: { grupoId: 1, localId: 5 } }),
  },
  miAlcance: {
    encargado: await consultar(7, { capacidad: "mi_alcance", parametros: {} }),
    cajero: await consultar(8, { capacidad: "mi_alcance", parametros: {} }),
    adminGlobal: await consultar(9, { capacidad: "mi_alcance", parametros: {} }),
  },
};

writeFileSync(SALIDA, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`escrito ${path.relative(process.cwd(), SALIDA)}`);
