-- NOTIFICACIONES PUSH CON LA APP CERRADA. Tanda 5A.
--
-- Dos tablas nuevas, sin tocar ninguna fila existente:
--   · PushSuscripcion: la suscripción Web Push de un dispositivo, colgada de
--     su SESIÓN (y del vínculo). Cerrar la sesión o que venza corta los avisos
--     de ese dispositivo. Si el servicio de push contesta 404 o 410, se borra.
--   · AvisoLocal: hasta qué Evento.id se consideró para avisar, por persona y
--     local. Es lo que hace que cada evento se avise UNA sola vez.
--
-- Lo que Prisma no sabe expresar va al final, a mano: los CHECK.

-- CreateTable
CREATE TABLE "PushSuscripcion" (
    "id" TEXT NOT NULL,
    "vinculoId" TEXT NOT NULL,
    "sesionId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoEnvioEn" TIMESTAMP(3),
    "ultimoErrorEn" TIMESTAMP(3),
    "ultimoErrorCodigo" TEXT,

    CONSTRAINT "PushSuscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvisoLocal" (
    "vinculoId" TEXT NOT NULL,
    "erpLocalId" INTEGER NOT NULL,
    "avisadoHastaEventoId" BIGINT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvisoLocal_pkey" PRIMARY KEY ("vinculoId","erpLocalId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSuscripcion_endpoint_key" ON "PushSuscripcion"("endpoint");

-- CreateIndex
CREATE INDEX "PushSuscripcion_vinculoId_idx" ON "PushSuscripcion"("vinculoId");

-- CreateIndex
CREATE INDEX "PushSuscripcion_sesionId_idx" ON "PushSuscripcion"("sesionId");

-- AddForeignKey
ALTER TABLE "PushSuscripcion" ADD CONSTRAINT "PushSuscripcion_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "Vinculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSuscripcion" ADD CONSTRAINT "PushSuscripcion_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "Sesion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvisoLocal" ADD CONSTRAINT "AvisoLocal_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "Vinculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- La suscripción: el endpoint es https (la lista de servicios conocidos la
-- aplica el servidor; acá, la forma), las claves tienen la forma que entrega el
-- navegador (P-256 sin comprimir, 65 bytes, y 16 bytes de auth, en base64url
-- sin relleno), y un error lleva su fecha y su código juntos.
ALTER TABLE "PushSuscripcion" ADD CONSTRAINT "PushSuscripcion_endpoint_check"
  CHECK (starts_with("endpoint", 'https://') AND length("endpoint") <= 2048);
ALTER TABLE "PushSuscripcion" ADD CONSTRAINT "PushSuscripcion_claves_check"
  CHECK ("p256dh" ~ '^[A-Za-z0-9_-]{87}$' AND "auth" ~ '^[A-Za-z0-9_-]{22}$');
ALTER TABLE "PushSuscripcion" ADD CONSTRAINT "PushSuscripcion_error_check"
  CHECK (("ultimoErrorEn" IS NULL) = ("ultimoErrorCodigo" IS NULL));

-- La marca de agua de avisos: ids positivos y una marca que no es negativa.
ALTER TABLE "AvisoLocal" ADD CONSTRAINT "AvisoLocal_check" CHECK ("avisadoHastaEventoId" >= 0 AND "erpLocalId" > 0);
