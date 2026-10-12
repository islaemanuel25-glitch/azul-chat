// CANDADO (Tanda 14): LO DE CADA PERSONA SE LEE Y SE ESCRIBE CON SU VÍNCULO.
//
// Con varios dueños en la misma instalación, tres tablas son de UNA persona:
// las preguntas guardadas (`Pregunta`), lo leído (`LecturaLocal`) y la marca
// de los avisos (`AvisoLocal`). Una consulta sobre ellas que no lleve el
// vínculo de quien pregunta mezcla personas, y ningún otro candado lo ve: los
// tests de base prueban los caminos que existen hoy, no el próximo que se
// escriba. Este mira el código:
//
//   · cada llamada de Prisma a `.pregunta.` lleva `vinculoId` en sus
//     argumentos (la única excepción, con nombre, es la retención de 90 días,
//     que borra por fecha para todos y no devuelve nada);
//   · cada SQL crudo que nombra "LecturaLocal" o "AvisoLocal" lleva el
//     parámetro `${vinculoId}`.
//
// Las rutas que reciben un id del navegador ya las cubren rutas.test.ts (qué
// rutas hay) y test/db/duenos.test.ts (qué devuelven a cada persona).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { archivosDelRepo, sinComentarios } from "../ayuda/grafoImports.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");

/** Las excepciones, con su motivo. Una nueva se agrega acá a sabiendas. */
const EXCEPCIONES_PREGUNTA: readonly { readonly archivo: string; readonly contiene: string; readonly motivo: string }[] = [
  { archivo: "src/server/preguntas/guardadas.ts", contiene: "limiteDeRetencion(ahora)", motivo: "la retención de 90 días borra por fecha, de todos, y no devuelve filas" },
];

/** El texto entre el paréntesis que abre en `desde` y el que lo cierra. */
function argumentos(codigo: string, desde: number): string {
  let nivel = 0;
  for (let i = desde; i < codigo.length; i++) {
    if (codigo[i] === "(") nivel++;
    else if (codigo[i] === ")" && --nivel === 0) return codigo.slice(desde + 1, i);
  }
  return codigo.slice(desde);
}

function problemasPorPersona(archivos: ReadonlyMap<string, string>): string[] {
  const p: string[] = [];
  for (const [archivo, crudo] of archivos) {
    const codigo = sinComentarios(crudo);
    for (const m of codigo.matchAll(/\.pregunta\.(\w+)\(/g)) {
      const args = argumentos(codigo, m.index! + m[0].length - 1);
      if (/\bvinculoId\b/.test(args)) continue;
      if (EXCEPCIONES_PREGUNTA.some((e) => e.archivo === archivo && args.includes(e.contiene))) continue;
      p.push(`${archivo}: .pregunta.${m[1]}(...) sin vinculoId`);
    }
    for (const m of codigo.matchAll(/\$(?:queryRaw|executeRaw)(?:<[^>`]*>)?`([^`]*)`/g)) {
      const sql = m[1]!;
      if (!/"(LecturaLocal|AvisoLocal)"/.test(sql)) continue;
      if (!sql.includes("${vinculoId}")) p.push(`${archivo}: SQL sobre ${/"LecturaLocal"/.test(sql) ? "LecturaLocal" : "AvisoLocal"} sin \${vinculoId}`);
    }
  }
  return p;
}

const archivosDeServidor = (): Map<string, string> =>
  new Map(
    archivosDelRepo(RAIZ, "src/server")
      .filter((f) => /\.ts$/.test(f))
      .map((f) => [path.relative(RAIZ, f), readFileSync(f, "utf8")] as const),
  );

describe("Tanda 14: lo de cada persona, con su vínculo", () => {
  it("las preguntas, lo leído y los avisos se leen y escriben con el vinculoId de quien pregunta", () => {
    const archivos = archivosDeServidor();
    assert.ok([...archivos.values()].some((c) => /\.pregunta\.findMany\(/.test(c)), "el candado mira algo");
    assert.ok([...archivos.values()].some((c) => /"LecturaLocal"/.test(c) && /"AvisoLocal"/.test(c)) || [...archivos.values()].filter((c) => /"(LecturaLocal|AvisoLocal)"/.test(c)).length >= 2);
    assert.deepEqual(problemasPorPersona(archivos), []);
  });

  it("CONTRAPRUEBA: una pregunta leída sin vínculo, un SQL de lo leído sin él, o una excepción en otro archivo, es rojo", () => {
    const archivos = archivosDeServidor();
    const guardadas = archivos.get("src/server/preguntas/guardadas.ts")!;
    const lectura = archivos.get("src/server/eventos/lectura.ts")!;
    const casos: Record<string, Map<string, string>> = {
      preguntaSinVinculo: new Map([...archivos, ["src/server/otro.ts", "await db.pregunta.findMany({ where: { erpLocalId: 3 } });"]]),
      sqlSinVinculo: new Map([...archivos, ["src/server/otro.ts", 'await db.$queryRaw`SELECT * FROM "LecturaLocal" WHERE "erpLocalId" = ${erpLocalId}`;']]),
      avisoSinVinculo: new Map([...archivos, ["src/server/otro.ts", 'await db.$executeRaw`UPDATE "AvisoLocal" SET "avisadoHastaEventoId" = 0`;']]),
      excepcionAjena: new Map([...archivos, ["src/server/otro.ts", "await db.pregunta.findMany({ where: { creadaEn: { lt: limiteDeRetencion(ahora) } } });"]]),
      guardadasSinVinculo: new Map([...archivos, ["src/server/preguntas/guardadas.ts", guardadas.replace("where: { vinculoId: q.vinculoId, erpLocalId: q.erpLocalId,", "where: { erpLocalId: q.erpLocalId,")]]),
      lecturaSinVinculo: new Map([...archivos, ["src/server/eventos/lectura.ts", lectura.replaceAll('l."vinculoId" = ${vinculoId} AND ', "")]]),
    };
    for (const [nombre, caso] of Object.entries(casos)) {
      if (nombre === "guardadasSinVinculo") assert.notEqual(caso.get("src/server/preguntas/guardadas.ts"), guardadas, "el cambio no se aplicó");
      if (nombre === "lecturaSinVinculo") assert.notEqual(caso.get("src/server/eventos/lectura.ts"), lectura, "el cambio no se aplicó");
      assert.notDeepEqual(problemasPorPersona(caso), [], nombre);
    }
  });
});
