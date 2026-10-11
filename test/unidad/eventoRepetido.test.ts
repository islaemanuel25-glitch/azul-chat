// CANDADOS DE `clasificarRepetido`: una clave que vuelve, ¿cuenta la misma verdad?
//
// Es la capa más baja de la decisión. Acá se prueban también los casos que la
// ingesta nunca deja llegar —otra referencia u otra fecha bajo la misma clave
// (el contrato exige que la clave sea TIPO:id:fecha, y la base lo exige con un
// CHECK), y otro tipo (el enum tiene uno solo)—, para que la comparación no
// dependa de esas defensas de afuera.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clasificarRepetido, type EventoGuardado } from "../../src/server/eventos/repetido.ts";
import { aFilaEvento, type FilaEvento, type PayloadTransferenciaRecibidaV1 } from "../../src/server/eventos/transferenciaRecibida.ts";
import type { DatosTransferenciasEventos } from "../../src/shared/erp/contrato.ts";
import { FIXTURES_ERP_25172FE, type Rompible } from "../ayuda/servidorErp.ts";

/** El evento 182 real del fixture del ERP, como fila. */
const NUEVA: FilaEvento<PayloadTransferenciaRecibidaV1> = aFilaEvento((FIXTURES_ERP_25172FE.transferenciasEventos.pagina2.respuesta.cuerpo.datos as DatosTransferenciasEventos).eventos[0]!);
/** Lo guardado: la misma fila, con el tipo como texto, como sale de la base. */
const guardado = (cambio: Partial<EventoGuardado> = {}): EventoGuardado => ({
  tipo: NUEVA.tipo,
  erpLocalId: NUEVA.erpLocalId,
  erpReferenciaId: NUEVA.erpReferenciaId,
  fechaOperacion: new Date(NUEVA.fechaOperacion.getTime()),
  payloadVersion: NUEVA.payloadVersion,
  payload: structuredClone(NUEVA.payload),
  ...cambio,
});
const conPayload = (p: (x: Rompible<PayloadTransferenciaRecibidaV1>) => void) => {
  const payload = structuredClone(NUEVA.payload) as Rompible<PayloadTransferenciaRecibidaV1>;
  p(payload);
  return guardado({ payload });
};

describe("una clave que vuelve", () => {
  it("AG. misma identidad y misma foto: IGUAL", () => {
    assert.equal(clasificarRepetido(guardado(), NUEVA), "IGUAL");
  });

  it("AV. el mismo payload con las claves en otro orden es IGUAL (no se compara texto)", () => {
    const p = NUEVA.payload;
    const reordenado = {
      lineasConDiferencia: p.lineasConDiferencia,
      tieneDiferencias: p.tieneDiferencias,
      destino: { nombre: p.destino.nombre, id: p.destino.id },
      origen: { esDeposito: p.origen.esDeposito, nombre: p.origen.nombre, id: p.origen.id },
    };
    assert.notEqual(JSON.stringify(reordenado), JSON.stringify(p), "el texto difiere de verdad");
    assert.equal(clasificarRepetido(guardado({ payload: reordenado }), NUEVA), "IGUAL");
  });

  it("AH/AI/AJ/AK. otro local, otra referencia, otra fecha u otro tipo: IDENTIDAD_CONTRADICTORIA", () => {
    assert.equal(clasificarRepetido(guardado({ erpLocalId: 5 }), NUEVA), "IDENTIDAD_CONTRADICTORIA", "AH");
    assert.equal(clasificarRepetido(guardado({ erpReferenciaId: 999 }), NUEVA), "IDENTIDAD_CONTRADICTORIA", "AI");
    assert.equal(clasificarRepetido(guardado({ fechaOperacion: new Date(NUEVA.fechaOperacion.getTime() + 1) }), NUEVA), "IDENTIDAD_CONTRADICTORIA", "AJ");
    assert.equal(clasificarRepetido(guardado({ tipo: "OTRO_TIPO" }), NUEVA), "IDENTIDAD_CONTRADICTORIA", "AK");
  });

  it("la identidad manda sobre la foto: otro local con otro payload sigue siendo contradicción", () => {
    assert.equal(clasificarRepetido({ ...conPayload((x) => (x.lineasConDiferencia = 0)), erpLocalId: 5 }, NUEVA), "IDENTIDAD_CONTRADICTORIA");
  });

  it("AO/AP/AQ/AR. misma identidad y otra foto: CONTENIDO_DIFERENTE, nunca contradicción", () => {
    assert.equal(clasificarRepetido(conPayload((x) => (x.tieneDiferencias = !x.tieneDiferencias)), NUEVA), "CONTENIDO_DIFERENTE", "AO");
    assert.equal(clasificarRepetido(conPayload((x) => (x.lineasConDiferencia += 1)), NUEVA), "CONTENIDO_DIFERENTE", "AP");
    assert.equal(clasificarRepetido(conPayload((x) => (x.origen.nombre = "Depósito Norte")), NUEVA), "CONTENIDO_DIFERENTE", "AQ");
    assert.equal(clasificarRepetido(conPayload((x) => (x.destino.nombre = "Casiano Casas")), NUEVA), "CONTENIDO_DIFERENTE", "AR");
    assert.equal(clasificarRepetido(conPayload((x) => (x.origen.esDeposito = false)), NUEVA), "CONTENIDO_DIFERENTE");
    assert.equal(clasificarRepetido(guardado({ payloadVersion: 2 }), NUEVA), "CONTENIDO_DIFERENTE", "otra versión de payload");
    assert.equal(clasificarRepetido(guardado({ payload: [] }), NUEVA), "CONTENIDO_DIFERENTE", "un payload guardado ilegible no es IGUAL");
  });
});
