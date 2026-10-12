-- EL HORARIO DE SILENCIO DE CADA PERSONA. Tanda 11.
--
-- Aditiva: tres columnas nuevas en "Vinculo" con su valor por defecto, sin
-- tocar ninguna fila existente (todas quedan con el silencio APAGADO). Van en
-- el vínculo y no en una tabla aparte porque son de la persona en esta
-- instalación, una sola vez, y el vínculo ya es esa fila: sobrevive a volver a
-- vincularse (vincular reemplaza el token, no la fila). Mientras está activo y
-- la hora de Argentina cae en [desde, hasta) —que puede cruzar la medianoche—,
-- la sincronización de fondo no manda push (src/server/push/silencio.ts).
--
-- Lo que Prisma no sabe expresar va al final, a mano: los CHECK.

-- AlterTable
ALTER TABLE "Vinculo" ADD COLUMN     "silencioActivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "silencioDesde" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "silencioHasta" INTEGER NOT NULL DEFAULT 7;

-- Horas enteras de Argentina, de 0 a 23, y distintas: un horario de 0 horas o
-- de 24 no es un horario.
ALTER TABLE "Vinculo" ADD CONSTRAINT "Vinculo_silencio_check"
  CHECK ("silencioDesde" BETWEEN 0 AND 23 AND "silencioHasta" BETWEEN 0 AND 23 AND "silencioDesde" <> "silencioHasta");
