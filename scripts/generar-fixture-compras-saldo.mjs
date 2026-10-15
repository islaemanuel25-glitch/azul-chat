// scripts/generar-fixture-compras-saldo.mjs
//
// GENERA test/fixtures/erp-fd1bca1.json EJECUTANDO EL CÓDIGO DEL ERP.
//
// `compras_saldo_eventos` (erpmanual, 2026-10-15): las compras que un local
// recibió dejando saldo con el proveedor. Como `generar-fixture-erp.mjs`: la
// puerta real del ERP de punta a punta —`atenderSolicitud`, con la firma HMAC,
// la lectura canónica del cuerpo, los parámetros, la autorización y el ejecutor
// real `comprasSaldoEventos`— sobre los MISMOS bytes que manda Azul Chat, y
// `aRespuestaPublica`, que es lo que devuelve la ruta del ERP.
//
// Lo único que no es del ERP son las filas de su base: van con la forma exacta
// de `SELECT_EVENTO` de `comprasSaldoEventos.js` (total, pagado y saldo como
// Decimal de 12,2, que Prisma entrega como objeto y el ERP pasa por `Number`;
// acá van como texto con dos decimales, que `Number` lee igual) y de los
// `select` de `miAlcance`. El proveedor es obligatorio en `PedidoProveedor`, así
// que ninguna fila trae proveedor nulo.
//
// Uso, desde la raíz de azul-chat, con un checkout de erpmanual SIN cambios en
// el commit esperado:
//
//   node --import <erpmanual>/scripts/alias-loader.mjs scripts/generar-fixture-compras-saldo.mjs <erpmanual>
//
// No habla con ningún ERP real, no usa secretos reales y no toca ninguna base.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_ERP = "fd1bca1ef4cf27e6d4da82c488e6df40e98770f2";
const SALIDA = path.resolve(import.meta.dirname, "../test/fixtures/erp-fd1bca1.json");

const raizErp = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!raizErp) {
  console.error("Uso: node --import <erpmanual>/scripts/alias-loader.mjs scripts/generar-fixture-compras-saldo.mjs <erpmanual>");
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
const { comprasSaldoEventos } = await delErp("lib/integraciones/azul-chat/comprasSaldoEventos.js");
const { miAlcance } = await delErp("lib/integraciones/azul-chat/miAlcance.js");
const { generarTokenDelegacion, hashTokenDelegacion } = await delErp("lib/integraciones/vinculos/codigoVinculo.js");
const { DEFAULT_PERMISOS_SISTEMA, CAJERO } = await delErp("lib/rbac/systemRoles.js");

const SECRETO = "secreto-de-prueba-que-no-es-real-0123456789";
const ENTORNO = { AZUL_CHAT_INTEGRACION_SECRET: SECRETO, AUTH_SECRET: "otro-secreto-de-prueba-de-las-sesiones-erp" };
const AHORA = Date.parse("2026-10-15T12:00:00.000Z");

// ── lo que contestaría la base del ERP (forma de sus `select`) ─────────────

// Grupo 1: Casiano (3) y el Depósito Central (9). Grupo 2: Centro (20).
const LOCALES = {
  3: { id: 3, nombre: "Casiano", es_deposito: false, activo: true },
  9: { id: 9, nombre: "Depósito Central", es_deposito: true, activo: true },
  20: { id: 20, nombre: "Centro", es_deposito: false, activo: true },
};
const GRUPO_LOCAL = [{ localId: 3, grupoId: 1 }, { localId: 20, grupoId: 2 }];
const GRUPO_DEPOSITO = [{ localId: 9, grupoId: 1 }];
const grupoDeLocal = async (id) =>
  GRUPO_LOCAL.find((g) => g.localId === id)?.grupoId ?? GRUPO_DEPOSITO.find((g) => g.localId === id)?.grupoId ?? null;
const localIdsDeGrupo = async (gid) => [...GRUPO_LOCAL, ...GRUPO_DEPOSITO].filter((g) => g.grupoId === gid).map((g) => g.localId);

// `finanzas.ver` no lo trae ningún rol por defecto del ERP (lo dice su
// autorizacion.test.mjs): la persona de Casiano lo tiene en un rol propio. El
// cajero, con el rol real, no lo tiene. Y un admin global.
const PERSONAS = {
  7: { id: 7, nombre: "Tesorería Casiano", activo: true, localId: 3, rol: { permisos: ["finanzas.ver"] } },
  8: { id: 8, nombre: "Cajero Casiano", activo: true, localId: 3, rol: { permisos: DEFAULT_PERMISOS_SISTEMA[CAJERO] } },
  9: { id: 9, nombre: "Emanuel", activo: true, localId: null, rol: { permisos: ["*"] } },
};
const TOKEN = Object.fromEntries(Object.keys(PERSONAS).map((id) => [id, generarTokenDelegacion()]));
// La forma del cargador de `autorizarIntegracion`: la delegación trae su vínculo.
const DELEGACIONES = Object.fromEntries(
  Object.entries(TOKEN).map(([id, t], i) => [hashTokenDelegacion(t), { id: 200 + i, vinculo: { id: 100 + i, usuarioId: Number(id), aplicacion: "AZUL_CHAT", revocadoEn: null } }]),
);
const cargador = {
  delegacion: async (hash) => DELEGACIONES[hash] ?? null,
  usuario: async (id) => PERSONAS[id] ?? null,
  grupoDeLocal,
};

const LACTEOS = { id: 41, nombre: "Lácteos del Sur" };
const BEBIDAS = { id: 42, nombre: "Bebidas Norte" };
const compra = (id, localId, confirmadoEn, pedidoProveedorId, proveedor, total, pagado, saldo) => ({
  id,
  localId,
  confirmadoEn: new Date(confirmadoEn),
  pedidoProveedorId,
  total,
  pagado,
  saldo,
  pedido: { proveedor },
});

// Casiano: tres compras con saldo; 12 y 13 confirmadas en el MISMO milisegundo.
// Centro (20) tiene una propia, que no sale en las consultas de Casiano. Y una
// de Casiano demasiado reciente (dentro del margen de 60 s): todavía no sale.
const FILAS = [
  compra(11, 3, "2026-10-15T09:00:00.000Z", 501, LACTEOS, "150000.00", "100000.00", "50000.00"),
  compra(12, 3, "2026-10-15T10:30:15.250Z", 502, BEBIDAS, "80250.50", "30000.00", "50250.50"),
  compra(13, 3, "2026-10-15T10:30:15.250Z", 503, LACTEOS, "42000.00", "2000.00", "40000.00"),
  compra(14, 20, "2026-10-15T10:45:00.000Z", 504, BEBIDAS, "99000.00", "9000.00", "90000.00"),
  compra(15, 3, "2026-10-15T11:59:30.000Z", 505, BEBIDAS, "12000.00", "6000.00", "6000.00"),
];

/** Lo justo de Prisma para el `where`, `orderBy` y `take` del cursor compartido. Revienta ante cualquier otra cosa. */
function baseDeCompras(filas) {
  const vale = (fila, where) =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === "OR") return cond.some((w) => vale(fila, w));
      const v = fila[campo];
      if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
      if (cond === null || typeof cond !== "object") return v === cond;
      return Object.entries(cond).every(([op, x]) => {
        const n = v instanceof Date ? v.getTime() : v;
        const m = x instanceof Date ? x.getTime() : x;
        if (v === null) return false;
        if (op === "gt") return n > m;
        if (op === "lte") return n <= m;
        throw new Error(`operador no previsto: ${op}`);
      });
    });
  return {
    local: { findUnique: async ({ where }) => (LOCALES[where.id] ? { id: LOCALES[where.id].id, nombre: LOCALES[where.id].nombre } : null) },
    compraConSaldo: {
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

async function consultar(personaId, { capacidad, alcance, parametros }) {
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
    compras_saldo_eventos: (a, p, { ahora }) => comprasSaldoEventos(a, p, { db: baseDeCompras(FILAS), ahora }),
    mi_alcance: (a, p) => miAlcance(a, p, { db: baseDeAlcance, grupoDeLocal, localIdsDeGrupo }),
  };
  const r = aRespuestaPublica(await atenderSolicitud({ headers, cuerpo: texto }, { cargador, ejecutores, entorno: ENTORNO, ahora: AHORA }));
  return {
    // El cuerpo que viajó, con el token enmascarado: el fixture no guarda credenciales.
    pedido: JSON.parse(texto.replace(token, "<token>")),
    respuesta: { status: r.status, cuerpo: r.cuerpo },
  };
}

const eventos = (parametros, localId = 3, grupoId = 1) => ({ capacidad: "compras_saldo_eventos", alcance: { grupoId, localId }, parametros });
const exigir = (cond, que) => {
  if (!cond) throw new Error(`el ERP no contestó lo esperado: ${que}`);
};
const datos = (i) => i.respuesta.cuerpo.datos;

const pagina1 = await consultar(7, eventos({ limite: 2 }));
exigir(pagina1.respuesta.status === 200 && datos(pagina1).hayMas === true && datos(pagina1).eventos.length === 2, "pagina1");
const pagina2 = await consultar(7, eventos({ desde: datos(pagina1).siguiente, limite: 2 }));
exigir(pagina2.respuesta.status === 200 && datos(pagina2).hayMas === false && datos(pagina2).eventos.length === 1, "pagina2");
const vacia = await consultar(7, eventos({ desde: datos(pagina2).siguiente, limite: 2 }));
exigir(vacia.respuesta.status === 200 && datos(vacia).eventos.length === 0, "vacia");
const completa = await consultar(7, eventos({}));
exigir(completa.respuesta.status === 200 && datos(completa).eventos.length === 3 && datos(completa).hayMas === false, "completa");
const deCentro = await consultar(9, eventos({}, 20, 2));
exigir(deCentro.respuesta.status === 200 && datos(deCentro).eventos.length === 1, "deCentro");
const sinPermiso = await consultar(8, eventos({}));
exigir(sinPermiso.respuesta.status !== 200, "sinPermiso");
const limiteFueraDeRango = await consultar(7, eventos({ limite: 101 }));
exigir(limiteFueraDeRango.respuesta.status !== 200, "limiteFueraDeRango");

const fixture = {
  _origen:
    `Generado por scripts/generar-fixture-compras-saldo.mjs ejecutando el código de erpmanual en ${SHA_ERP}: atenderSolicitud ` +
    "(firma, cuerpo canónico, parámetros, autorización) con los ejecutores reales comprasSaldoEventos y miAlcance, y aRespuestaPublica. " +
    "Las filas de la base del ERP tienen la forma de sus select y están en el script. finanzas.ver en un rol propio (ningún rol por " +
    "defecto lo trae), CAJERO real y admin (*). No editar a mano: regenerar.",
  ahora: new Date(AHORA).toISOString(),
  compras_saldo_eventos: { pagina1, pagina2, vacia, completa, deCentro, sinPermiso, limiteFueraDeRango },
  miAlcance: {
    tesoreria: await consultar(7, { capacidad: "mi_alcance", parametros: {} }),
    cajero: await consultar(8, { capacidad: "mi_alcance", parametros: {} }),
    adminGlobal: await consultar(9, { capacidad: "mi_alcance", parametros: {} }),
  },
};

writeFileSync(SALIDA, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`escrito ${path.relative(process.cwd(), SALIDA)}`);
