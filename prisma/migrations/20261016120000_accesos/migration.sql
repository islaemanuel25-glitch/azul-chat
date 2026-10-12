-- Tanda 15: accesos. El dueño decide quién entra a Azul Chat y a qué partes.
--
-- Aditiva: una tabla nueva y una columna nula. No toca ninguna fila.
--
--   · "AccesoPersona": seis permisos por persona del ERP (erpUsuarioId, no el
--     vínculo, así sobreviven a volver a vincularse), todos en false por
--     defecto, y quién y cuándo los cambió por última vez. Una capa MÁS sobre
--     lo que da el ERP: solo resta. Los administradores (variable
--     AZUL_CHAT_ADMINISTRADORES) no dependen de esta tabla.
--   · "Vinculo"."erpNombre": el nombre que dio el ERP la última vez, para la
--     lista de Accesos. Solo se muestra.
--
-- Una persona sin fila no entra (cerrado por defecto). Hoy la única persona
-- vinculada es el dueño, que es administrador por la variable: no hace falta
-- cargar ninguna fila.

-- AlterTable
ALTER TABLE "Vinculo" ADD COLUMN     "erpNombre" TEXT;

-- CreateTable
CREATE TABLE "AccesoPersona" (
    "instalacionId" TEXT NOT NULL,
    "erpUsuarioId" INTEGER NOT NULL,
    "entrar" BOOLEAN NOT NULL DEFAULT false,
    "ventas" BOOLEAN NOT NULL DEFAULT false,
    "caja" BOOLEAN NOT NULL DEFAULT false,
    "stock" BOOLEAN NOT NULL DEFAULT false,
    "pendientes" BOOLEAN NOT NULL DEFAULT false,
    "ia" BOOLEAN NOT NULL DEFAULT false,
    "cambiadoPorErpUsuarioId" INTEGER,
    "cambiadoEn" TIMESTAMP(3),

    CONSTRAINT "AccesoPersona_pkey" PRIMARY KEY ("instalacionId","erpUsuarioId")
);

-- AddForeignKey
ALTER TABLE "AccesoPersona" ADD CONSTRAINT "AccesoPersona_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "Instalacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ids del ERP positivos; quién y cuándo, juntos; un nombre corto y no vacío.
ALTER TABLE "AccesoPersona" ADD CONSTRAINT "AccesoPersona_ids_check"
  CHECK ("erpUsuarioId" > 0 AND ("cambiadoPorErpUsuarioId" IS NULL OR "cambiadoPorErpUsuarioId" > 0));
ALTER TABLE "AccesoPersona" ADD CONSTRAINT "AccesoPersona_cambio_check"
  CHECK (("cambiadoPorErpUsuarioId" IS NULL) = ("cambiadoEn" IS NULL));
ALTER TABLE "Vinculo" ADD CONSTRAINT "Vinculo_erpNombre_check"
  CHECK ("erpNombre" IS NULL OR (char_length("erpNombre") BETWEEN 1 AND 120));
