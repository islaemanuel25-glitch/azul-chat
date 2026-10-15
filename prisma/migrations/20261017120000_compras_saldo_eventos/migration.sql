-- COMPRA_CON_SALDO: la capacidad `compras_saldo_eventos` del ERP (2026-10-15).
--
-- Contrato: erpmanual fd1bca1, lib/integraciones/azul-chat/comprasSaldoEventos.js.
-- La misma maquinaria que las otras cuatro: su cursor por local en
-- CursorIngesta y sus eventos en Evento.
--
-- No toca datos: agrega un valor al enum y amplía o agrega CHECKs. Las filas
-- que ya existen cumplen todos.

ALTER TYPE "TipoEvento" ADD VALUE 'COMPRA_CON_SALDO';

-- Las cinco capacidades que se paginan.
ALTER TABLE "CursorIngesta" DROP CONSTRAINT "CursorIngesta_capacidad_check";
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_capacidad_check"
  CHECK ("capacidad" IN ('transferencias_eventos', 'pedidos_eventos', 'envios_eventos', 'cancelaciones_eventos', 'compras_saldo_eventos'));

-- La clave externa es EXACTAMENTE la que arma el ERP con la referencia y la
-- fecha: COMPRA_CON_SALDO:<compraConSaldoId>:<confirmadoEn ISO con ms, UTC>.
-- El tipo se compara como TEXTO: un valor de enum recién agregado no se puede
-- usar dentro de la misma transacción.
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_claveExterna_compra_con_saldo_check"
  CHECK ("tipo"::text <> 'COMPRA_CON_SALDO' OR "claveExterna" =
    'COMPRA_CON_SALDO:' || "erpReferenciaId"::text || ':' || to_char("fechaOperacion", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
