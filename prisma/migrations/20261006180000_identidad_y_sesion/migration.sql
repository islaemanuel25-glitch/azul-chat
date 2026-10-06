-- IDENTIDAD Y SESIÓN PROPIAS DE AZUL CHAT. Migración inicial.
--
-- Tres tablas: la instalación (una sola fila), el vínculo de cada persona del
-- ERP con su token de delegación CIFRADO, y las sesiones de cada dispositivo
-- con el hash de su identificador. Nada de rol, permisos, locales ni grupos:
-- eso es del ERP y se le pregunta en el momento.
--
-- Lo que Prisma no sabe expresar va al final, a mano: los CHECK.

-- CreateEnum
CREATE TYPE "MotivoInvalidacion" AS ENUM ('TOKEN_RECHAZADO_POR_ERP');

-- CreateTable
CREATE TABLE "Instalacion" (
    "id" TEXT NOT NULL,
    "unica" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instalacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vinculo" (
    "id" TEXT NOT NULL,
    "instalacionId" TEXT NOT NULL,
    "erpUsuarioId" INTEGER NOT NULL,
    "erpVinculoId" INTEGER NOT NULL,
    "tokenCifrado" TEXT NOT NULL,
    "vinculadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erpCanjeadoEn" TIMESTAMP(3) NOT NULL,
    "invalidadoEn" TIMESTAMP(3),
    "motivoInvalidacion" "MotivoInvalidacion",

    CONSTRAINT "Vinculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sesion" (
    "id" TEXT NOT NULL,
    "idHash" TEXT NOT NULL,
    "vinculoId" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadaEn" TIMESTAMP(3),

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Instalacion_unica_key" ON "Instalacion"("unica");

-- CreateIndex
CREATE UNIQUE INDEX "Vinculo_instalacionId_erpUsuarioId_key" ON "Vinculo"("instalacionId", "erpUsuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Vinculo_instalacionId_erpVinculoId_key" ON "Vinculo"("instalacionId", "erpVinculoId");

-- CreateIndex
CREATE UNIQUE INDEX "Sesion_idHash_key" ON "Sesion"("idHash");

-- CreateIndex
CREATE INDEX "Sesion_vinculoId_idx" ON "Sesion"("vinculoId");

-- AddForeignKey
ALTER TABLE "Vinculo" ADD CONSTRAINT "Vinculo_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "Instalacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "Vinculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── A mano ──────────────────────────────────────────────────────────────────

-- Una sola instalación: `unica` es única y solo puede ser true. Y el id tiene
-- la forma que exige AZUL_CHAT_INSTALACION_ID.
ALTER TABLE "Instalacion" ADD CONSTRAINT "Instalacion_unica_check" CHECK ("unica" = true);
ALTER TABLE "Instalacion" ADD CONSTRAINT "Instalacion_id_check" CHECK ("id" ~ '^[a-z0-9][a-z0-9-]{2,62}$');

-- Ids del ERP: enteros positivos.
ALTER TABLE "Vinculo" ADD CONSTRAINT "Vinculo_erp_ids_check" CHECK ("erpUsuarioId" > 0 AND "erpVinculoId" > 0);

-- El token entra SOLO cifrado: "v1." + IV de 12 bytes + cifrado + tag de 16
-- bytes, en base64url. Un token claro ("del1_…") no tiene esta forma.
ALTER TABLE "Vinculo" ADD CONSTRAINT "Vinculo_tokenCifrado_check"
  CHECK ("tokenCifrado" ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$');

-- Invalidado y su motivo van juntos: un hecho, contado una vez.
ALTER TABLE "Vinculo" ADD CONSTRAINT "Vinculo_invalidacion_check"
  CHECK (("invalidadoEn" IS NULL) = ("motivoInvalidacion" IS NULL));

-- La sesión guarda solo el SHA-256 de su identificador.
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_idHash_check" CHECK ("idHash" ~ '^[0-9a-f]{64}$');

-- Fechas coherentes: vence después de crearse, y no se revoca antes de existir.
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_fechas_check"
  CHECK ("expiraEn" > "creadaEn" AND ("revocadaEn" IS NULL OR "revocadaEn" >= "creadaEn"));
