-- EVENTOS DEL ERP, SU INGESTA Y LA LECTURA DE CADA PERSONA. Tanda 2, fundación.
--
-- Tres tablas, separando lo que son tres hechos distintos:
--   · Evento: un hecho del ERP, guardado UNA vez por instalación. No es de una
--     persona ni de una conversación, y guardarlo no autoriza a nadie a verlo.
--   · CursorIngesta: hasta dónde se trajo cada local, por capacidad. Compartido
--     por todas las personas, con un arriendo para que dos sincronizaciones no
--     pisen el mismo cursor.
--   · LecturaLocal: hasta qué Evento.id leyó cada persona (Vinculo) en cada
--     local. Lo comparten sus dispositivos.
--
-- Nada de permisos, roles, alcance ni capacidades: eso es del ERP y se le
-- pregunta en el momento. Ver docs/EVENTOS.md.
--
-- Lo que Prisma no sabe expresar va al final, a mano: los CHECK.

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('TRANSFERENCIA_RECIBIDA');

-- CreateTable
CREATE TABLE "Evento" (
    "id" BIGSERIAL NOT NULL,
    "instalacionId" TEXT NOT NULL,
    "tipo" "TipoEvento" NOT NULL,
    "claveExterna" TEXT NOT NULL,
    "erpLocalId" INTEGER NOT NULL,
    "erpReferenciaId" INTEGER NOT NULL,
    "fechaOperacion" TIMESTAMP(3) NOT NULL,
    "payloadVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "historico" BOOLEAN NOT NULL,
    "ingeridoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CursorIngesta" (
    "id" TEXT NOT NULL,
    "instalacionId" TEXT NOT NULL,
    "erpLocalId" INTEGER NOT NULL,
    "capacidad" TEXT NOT NULL,
    "cursor" JSONB,
    "backfillCompletoEn" TIMESTAMP(3),
    "ultimaSincronizacionEn" TIMESTAMP(3),
    "arrendadoHasta" TIMESTAMP(3),
    "arrendadoPor" TEXT,
    "ultimoErrorCodigo" TEXT,
    "ultimoErrorEn" TIMESTAMP(3),

    CONSTRAINT "CursorIngesta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LecturaLocal" (
    "vinculoId" TEXT NOT NULL,
    "erpLocalId" INTEGER NOT NULL,
    "leidoHastaEventoId" BIGINT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LecturaLocal_pkey" PRIMARY KEY ("vinculoId","erpLocalId")
);

-- CreateIndex
CREATE INDEX "Evento_instalacionId_erpLocalId_id_idx" ON "Evento"("instalacionId", "erpLocalId", "id");

-- CreateIndex
CREATE INDEX "Evento_instalacionId_erpLocalId_fechaOperacion_id_idx" ON "Evento"("instalacionId", "erpLocalId", "fechaOperacion", "id");

-- CreateIndex
CREATE INDEX "Evento_instalacionId_tipo_erpReferenciaId_idx" ON "Evento"("instalacionId", "tipo", "erpReferenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "Evento_instalacionId_claveExterna_key" ON "Evento"("instalacionId", "claveExterna");

-- CreateIndex
CREATE UNIQUE INDEX "CursorIngesta_instalacionId_erpLocalId_capacidad_key" ON "CursorIngesta"("instalacionId", "erpLocalId", "capacidad");

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "Instalacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "Instalacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LecturaLocal" ADD CONSTRAINT "LecturaLocal_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "Vinculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── A mano ──────────────────────────────────────────────────────────────────

-- Ids del ERP: enteros positivos, como los valida el ERP.
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_erp_ids_check" CHECK ("erpLocalId" > 0 AND "erpReferenciaId" > 0);

-- La clave externa empieza por su tipo. Y la de una TRANSFERENCIA_RECIBIDA es
-- EXACTAMENTE la que arma el ERP con el id y la fecha de la recepción
-- (TRANSFERENCIA_RECIBIDA:<transferenciaId>:<fechaRecepcion ISO con ms, UTC>):
-- una fila cuya clave no coincide con sus columnas es una fila rota.
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_claveExterna_tipo_check"
  CHECK (starts_with("claveExterna", "tipo"::text || ':'));
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_claveExterna_transferencia_check"
  CHECK ("tipo" <> 'TRANSFERENCIA_RECIBIDA' OR "claveExterna" =
    'TRANSFERENCIA_RECIBIDA:' || "erpReferenciaId"::text || ':' || to_char("fechaOperacion", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

-- El payload es un objeto, con una versión desde 1.
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND "payloadVersion" >= 1);

-- El cursor se pagina por local y capacidad; hoy hay una sola.
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_erpLocalId_check" CHECK ("erpLocalId" > 0);
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_capacidad_check" CHECK ("capacidad" IN ('transferencias_eventos'));

-- El cursor es el `siguiente` del ERP: un objeto, o nada antes de la primera página.
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_cursor_check" CHECK ("cursor" IS NULL OR jsonb_typeof("cursor") = 'object');

-- El arriendo y su dueño van juntos; el error y su fecha, también.
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_arriendo_check"
  CHECK (("arrendadoHasta" IS NULL) = ("arrendadoPor" IS NULL));
ALTER TABLE "CursorIngesta" ADD CONSTRAINT "CursorIngesta_error_check"
  CHECK (("ultimoErrorCodigo" IS NULL) = ("ultimoErrorEn" IS NULL));

-- La lectura es un Evento.id (0 = nada leído) de un local real.
ALTER TABLE "LecturaLocal" ADD CONSTRAINT "LecturaLocal_check" CHECK ("leidoHastaEventoId" >= 0 AND "erpLocalId" > 0);
