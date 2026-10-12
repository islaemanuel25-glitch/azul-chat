-- LA SALUD DE LA SINCRONIZACIÓN DE FONDO Y SU INCIDENTE. Tanda 12.
--
-- Aditiva: una tabla nueva, sin tocar ninguna fila existente. UNA sola fila
-- (no una por corrida): el último éxito, la última falla con un motivo corto,
-- cuántas fallas van seguidas y el incidente que decide el vigía
-- (src/server/interno/vigia.ts), con a quién ya se le avisó, para no repetir
-- el aviso aunque la app se reinicie.
--
-- Lo que Prisma no sabe expresar va al final, a mano: los CHECK.

-- CreateTable
CREATE TABLE "SaludSincronizacion" (
    "unica" BOOLEAN NOT NULL DEFAULT true,
    "ultimoExitoEn" TIMESTAMP(3),
    "ultimaFallaEn" TIMESTAMP(3),
    "ultimaFallaMotivo" TEXT,
    "fallasSeguidas" INTEGER NOT NULL DEFAULT 0,
    "vigiaDesdeEn" TIMESTAMP(3),
    "incidenteDesde" TIMESTAMP(3),
    "incidenteMotivo" TEXT,
    "avisadosApertura" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "pendientesRecuperacion" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaludSincronizacion_pkey" PRIMARY KEY ("unica")
);

-- Una sola fila: la clave solo puede ser true.
ALTER TABLE "SaludSincronizacion" ADD CONSTRAINT "SaludSincronizacion_unica_check" CHECK ("unica" = true);

-- Los motivos son códigos cerrados, nunca un mensaje (que podría traer un
-- secreto o un dato de negocio). La falla y su motivo, juntos.
ALTER TABLE "SaludSincronizacion" ADD CONSTRAINT "SaludSincronizacion_falla_check" CHECK (
  ("ultimaFallaEn" IS NULL) = ("ultimaFallaMotivo" IS NULL)
  AND ("ultimaFallaMotivo" IS NULL OR "ultimaFallaMotivo" IN ('ERP_NO_DISPONIBLE', 'ERP_CUPO_EXCEDIDO', 'BASE'))
);

-- El incidente y su motivo, juntos; las fallas seguidas, nunca negativas.
ALTER TABLE "SaludSincronizacion" ADD CONSTRAINT "SaludSincronizacion_incidente_check" CHECK (
  ("incidenteDesde" IS NULL) = ("incidenteMotivo" IS NULL)
  AND ("incidenteMotivo" IS NULL OR "incidenteMotivo" IN ('ERP_NO_DISPONIBLE', 'ERP_CUPO_EXCEDIDO', 'BASE', 'SIN_CORRIDAS'))
  AND "fallasSeguidas" >= 0
);
