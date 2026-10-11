-- Tanda 4B: PEDIDO_SOLICITADO, TRANSFERENCIA_ENVIADA y TRANSFERENCIA_CANCELADA.
--
-- Contrato: erpmanual 76b9a71, lib/integraciones/azul-chat/pedidosEventos.js,
-- enviosEventos.js y cancelacionesEventos.js. Cada tipo tiene su capacidad y
-- su cursor por local, con la misma maquinaria que transferencias_eventos.
--
-- No toca datos: solo agrega valores al enum y amplía o agrega CHECKs. Las
-- filas que ya existen (TRANSFERENCIA_RECIBIDA y su cursor) cumplen todos.

-- Los tres tipos nuevos.
ALTER TYPE "TipoEvento" ADD VALUE 'PEDIDO_SOLICITADO';
ALTER TYPE "TipoEvento" ADD VALUE 'TRANSFERENCIA_ENVIADA';
ALTER TYPE "TipoEvento" ADD VALUE 'TRANSFERENCIA_CANCELADA';

-- Las cuatro capacidades que se paginan.
ALTER TABLE "CursorIngesta" DROP CONSTRAINT "CursorIngesta_capacidad_check";
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_capacidad_check"
  CHECK ("capacidad" IN ('transferencias_eventos', 'pedidos_eventos', 'envios_eventos', 'cancelaciones_eventos'));

-- La clave externa de cada tipo nuevo es EXACTAMENTE la que arma el ERP con
-- la referencia y la fecha (<TIPO>:<id>:<fecha ISO con ms, UTC>), igual que
-- la de TRANSFERENCIA_RECIBIDA. El tipo se compara como TEXTO: un valor de
-- enum recién agregado no se puede usar dentro de la misma transacción.
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_claveExterna_pedido_solicitado_check"
  CHECK ("tipo"::text <> 'PEDIDO_SOLICITADO' OR "claveExterna" =
    'PEDIDO_SOLICITADO:' || "erpReferenciaId"::text || ':' || to_char("fechaOperacion", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_claveExterna_transferencia_enviada_check"
  CHECK ("tipo"::text <> 'TRANSFERENCIA_ENVIADA' OR "claveExterna" =
    'TRANSFERENCIA_ENVIADA:' || "erpReferenciaId"::text || ':' || to_char("fechaOperacion", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_claveExterna_transferencia_cancelada_check"
  CHECK ("tipo"::text <> 'TRANSFERENCIA_CANCELADA' OR "claveExterna" =
    'TRANSFERENCIA_CANCELADA:' || "erpReferenciaId"::text || ':' || to_char("fechaOperacion", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
