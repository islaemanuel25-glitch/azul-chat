// Las cajas del fixture del ERP (erp-14ae247.json) en la forma PÚBLICA que
// contesta Azul Chat (`CajasDelDia`), para los tests de la interfaz, que no
// pueden importar src/server (server-only).
//
// No es una copia de la lógica: es el mismo dato con UN nombre cambiado
// (`turnoOperativo` → `turno`) y las claves del contrato público, nada más.
// test/unidad/cajasChats.test.ts comprueba que `cajasPublicas` —la función
// del servidor— da EXACTAMENTE esto para cada día del fixture: si alguna vez
// difieren, ese candado se pone rojo.

import type { CajasDelDia } from "../../src/shared/chats/api.ts";
import type { DatosCajasResumen } from "../../src/shared/erp/contrato.ts";
import { FIXTURES_ERP_14AE247, type CasosCajasDelDia } from "./servidorErp.ts";

export function cajasDelDiaDelFixture(caso: keyof CasosCajasDelDia, nombreLocal?: string): CajasDelDia {
  const d = structuredClone(FIXTURES_ERP_14AE247.dia[caso].respuesta.cuerpo.datos) as unknown as DatosCajasResumen;
  return {
    local: { id: d.local.id, nombre: nombreLocal ?? d.local.nombre },
    fecha: d.periodo.fecha,
    turnos: d.turnosOperativos.map(({ turnoOperativo, ...t }) => ({ turno: turnoOperativo, ...t })),
    advertencias: d.advertencias.map((a) => ({ codigo: a.codigo, mensaje: a.mensaje })),
  };
}
