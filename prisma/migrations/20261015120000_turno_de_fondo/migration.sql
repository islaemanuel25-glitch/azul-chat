-- Tanda 14: otros dueños como usuarios. Con varias personas vinculadas, la
-- corrida de fondo tiene un tope TOTAL de consultas al ERP (el cupo del ERP por
-- aplicación es uno solo para todas). Si no entran todas, empieza por las que
-- hace más que no les toca: esta columna lo recuerda.
--
-- Aditiva: una columna nula, sin valor por defecto ni CHECK. Las filas que ya
-- están quedan en null, que es "nunca le tocó": van primero en la próxima
-- corrida, en el mismo orden que hasta hoy. El código viejo no la mira.

-- AlterTable
ALTER TABLE "Vinculo" ADD COLUMN     "ultimoTurnoFondoEn" TIMESTAMP(3);
