// LA HUELLA DE LA INGESTA DE TRANSFERENCIA_RECIBIDA (Tanda 4B).
//
// La Tanda 4B generalizó la ingesta para cuatro capacidades. La regla era que
// `transferencias_eventos` se ingiriera EXACTAMENTE igual que antes. Este
// candado lo fija con un número: recorre un guion determinista —backfill en
// varias visitas, eventos nuevos, claves repetidas con la misma foto y con
// otra, cada página inválida, un rechazo del ERP— y resume en un
// sha256 todo lo observable: el resultado de cada sincronización, cada pedido
// que se le mandó al ERP, y las filas de Evento y CursorIngesta tal como
// quedaron (con el JSON del payload y del cursor como texto de PostgreSQL).
//
// La huella se tomó con el código ANTERIOR a la generalización (4b5c150) y no
// se cambió después. Si se pone rojo, cambió algo de lo que se guarda o de lo
// que se le pide al ERP para transferencias: no se ajusta el número, se
// entiende qué cambió.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, it } from "node:test";

import { sincronizarTransferenciasLocal, type ConsultarPagina } from "../../src/server/eventos/ingesta.ts";
import { validarPagina } from "../../src/server/eventos/pagina.ts";
import type { DatosTransferenciasEventos, EventoTransferenciaRecibida } from "../../src/shared/erp/contrato.ts";
import { crearBaseDescartable, type BaseDescartable } from "../ayuda/baseDescartable.ts";
import { paginarEventos, recepcion } from "../ayuda/paginadorErp.ts";
import { FIXTURES_ERP_25172FE, type Rompible } from "../ayuda/servidorErp.ts";

/** sha256 del guion de abajo, con el código de 4b5c150. */
const HUELLA = "1763849a49a9f2071f87f54795c6935ed2a73baadac2471ad23fb35e916cdf02";

const TE = FIXTURES_ERP_25172FE.transferenciasEventos;
const INSTALACION = "instalacion-huella";
const LOCAL = { id: 3, nombre: "Casiano" };
const ALCANCE = { grupoId: 1, localId: 3 };
const datosDe = (n: keyof typeof TE) => structuredClone(TE[n].respuesta.cuerpo.datos) as DatosTransferenciasEventos;
const HISTORIA = datosDe("sinDesde").eventos;

let base: BaseDescartable;
before(async () => {
  base = await crearBaseDescartable();
});
after(async () => {
  await base?.borrar();
});

it("transferencias_eventos se ingiere exactamente igual que antes de la Tanda 4B", async () => {
  await base.db.$executeRawUnsafe(`INSERT INTO "Instalacion" (id) VALUES ('${INSTALACION}')`);
  const traza: unknown[] = [];
  let reloj = Date.parse(FIXTURES_ERP_25172FE.ahora);
  let ids = 0;

  // El universo del ERP: la historia real de Casiano más recepciones con la forma del fixture.
  let universo: EventoTransferenciaRecibida[] = [
    ...HISTORIA,
    recepcion({ local: LOCAL, transferenciaId: 190, fecha: "2026-10-07T15:00:00.000Z", tieneDiferencias: true, lineasConDiferencia: 2 }),
    recepcion({ local: LOCAL, transferenciaId: 191, fecha: "2026-10-07T15:00:00.000Z" }),
    recepcion({ local: LOCAL, transferenciaId: 192, fecha: "2026-10-07T16:00:00.000Z" }),
  ];
  let forzada: ((d: DatosTransferenciasEventos) => unknown) | null = null;
  let falla: unknown = null;
  const consultar: ConsultarPagina = async (entrada) => {
    traza.push({ pedido: entrada });
    if (falla) return falla as never;
    const d = paginarEventos({ universo, local: LOCAL, grupoId: 1, desde: entrada.desde, limite: entrada.limite });
    return { ok: true, datos: (forzada ? forzada(structuredClone(d)) : d) as DatosTransferenciasEventos, requestId: "huella" };
  };
  const sincronizar = async (limitePorPagina: number, maxPaginas: number) => {
    reloj += 31_000;
    const r = await sincronizarTransferenciasLocal({
      db: base.db,
      instalacionId: INSTALACION,
      alcance: ALCANCE,
      consultar,
      ahora: () => reloj,
      generarId: () => `huella-${++ids}`,
      limitePorPagina,
      maxPaginas,
    });
    traza.push({ resultado: r });
    traza.push({ estado: await estado() });
  };
  const estado = () =>
    Promise.all([
      base.db.$queryRawUnsafe(
        `SELECT "id"::text, "tipo"::text, "claveExterna", "erpLocalId", "erpReferenciaId", "fechaOperacion", "payloadVersion",
                "payload"::text AS "payload", "historico"
         FROM "Evento" ORDER BY "id"`,
      ),
      base.db.$queryRawUnsafe(
        `SELECT "erpLocalId", "capacidad", "cursor"::text AS "cursor", "backfillCompletoEn", "ultimaSincronizacionEn",
                "ultimoErrorCodigo", "ultimoErrorEn", "ultimaDiferenciaContenidoClave", "ultimaDiferenciaContenidoEn",
                "arrendadoHasta", "arrendadoPor"
         FROM "CursorIngesta" ORDER BY "id"`,
      ),
    ]);

  // Backfill en tres visitas de a una página de 2, y la cuarta la completa.
  for (let i = 0; i < 4; i++) await sincronizar(2, 1);
  // Dos recepciones nuevas: ya no son historia.
  universo = [
    ...universo,
    recepcion({ local: LOCAL, transferenciaId: 193, fecha: "2026-10-08T10:00:00.000Z", tieneDiferencias: true, lineasConDiferencia: 1 }),
    recepcion({ local: LOCAL, transferenciaId: 194, fecha: "2026-10-08T10:00:00.001Z" }),
  ];
  await sincronizar(100, 3);
  // Una recepción nueva, y el cursor vuelto al principio: todo lo ya guardado
  // vuelve a llegar, y el 180 con otra foto (origen renombrado). Se conserva la
  // primera y se anota; los demás son duplicados.
  universo = [...universo, recepcion({ local: LOCAL, transferenciaId: 195, fecha: "2026-10-08T11:00:00.000Z" })];
  await base.db.$executeRawUnsafe(`UPDATE "CursorIngesta" SET "cursor" = NULL`);
  forzada = (d) => ({ ...d, eventos: d.eventos.map((e) => (e.transferenciaId === 180 ? { ...e, origen: { ...e.origen, nombre: "Renombrado" } } : e)) });
  await sincronizar(3, 3);
  forzada = null;
  await sincronizar(100, 3);
  // Cada página inválida.
  const roturas: ((d: Rompible<DatosTransferenciasEventos>) => unknown)[] = [
    (d) => ({ ...d, local: { id: 4, nombre: "Otro" } }),
    (d) => ({ ...d, eventos: [{ ...universo[universo.length - 1]!, transferenciaId: 300, eventoId: `TRANSFERENCIA_RECIBIDA:300:2026-10-08T11:30:00.000Z`, fechaRecepcion: "2026-10-08T11:30:00.000Z", destino: { id: 4, nombre: "Otro" } }], siguiente: { fechaRecepcion: "2026-10-08T11:30:00.000Z", transferenciaId: 300 } }),
    (d) => ({ ...d, eventos: [HISTORIA[0]], siguiente: { fechaRecepcion: HISTORIA[0]!.fechaRecepcion, transferenciaId: HISTORIA[0]!.transferenciaId } }),
    (d) => ({ ...d, eventos: [], siguiente: { fechaRecepcion: "2026-10-08T11:58:00.000Z", transferenciaId: 1 }, hayMas: false }),
    (d) => ({ ...d, hayMas: true, eventos: [], siguiente: d.siguiente }),
    (d) => ({ ...d, capacidad: "otra" }),
  ];
  for (const romper of roturas) {
    forzada = romper as never;
    await sincronizar(100, 1);
  }
  forzada = null;
  // Un rechazo del ERP, tal cual el fixture.
  const negado = TE.cajeroSinPermiso.respuesta.cuerpo as { codigo: string };
  falla = { ok: false, origen: "erp", codigo: negado.codigo, status: TE.cajeroSinPermiso.respuesta.status, requestId: "huella" };
  await sincronizar(100, 1);
  falla = null;
  await sincronizar(100, 3);

  // La validación de página, sola, sobre las respuestas reales y rotas.
  for (const n of ["pagina1", "pagina2", "vacia", "sinDesde", "despuesDelReset"] as const) {
    const p = TE[n].pedido.parametros as { desde?: never; limite?: number };
    traza.push({ validar: n, r: validarPagina(datosDe(n), { localId: 3, desde: p.desde ?? null, limite: p.limite ?? 50 }) });
  }

  const huella = createHash("sha256")
    .update(JSON.stringify(traza, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))
    .digest("hex");
  assert.equal(huella, HUELLA);
});
