-- LAS PREGUNTAS EN LENGUAJE NATURAL, GUARDADAS CON SU RESPUESTA. Tanda 6C.
--
-- Una tabla nueva, sin tocar ninguna fila existente: Pregunta, una fila por
-- pregunta contestada, de una persona (vínculo) en un chat (un Local, o
-- General si erpLocalId es null). El resultado es la respuesta que vio la
-- pantalla, tal cual, en JSON versionado; los requisitos dicen de qué locales
-- y capacidades trae datos, para no mostrarla si hoy ya no se pueden ver. Se
-- borran a los 90 días en la corrida de fondo (src/server/preguntas/guardadas.ts).
--
-- Lo que Prisma no sabe expresar va al final, a mano: los CHECK.

-- CreateTable
CREATE TABLE "Pregunta" (
    "id" BIGSERIAL NOT NULL,
    "vinculoId" TEXT NOT NULL,
    "erpLocalId" INTEGER,
    "texto" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultadoVersion" INTEGER NOT NULL,
    "resultado" JSONB NOT NULL,
    "requisitos" JSONB NOT NULL,

    CONSTRAINT "Pregunta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pregunta_vinculoId_erpLocalId_creadaEn_id_idx" ON "Pregunta"("vinculoId", "erpLocalId", "creadaEn" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Pregunta_creadaEn_idx" ON "Pregunta"("creadaEn");

-- AddForeignKey
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "Vinculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- La pregunta tiene de 1 a 300 caracteres (MAX_LARGO_PREGUNTA); el local, si
-- hay, es un id positivo; el resultado es un objeto con su estado y los
-- requisitos, una lista.
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_texto_check" CHECK (char_length("texto") BETWEEN 1 AND 300);
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_erpLocalId_check" CHECK ("erpLocalId" IS NULL OR "erpLocalId" > 0);
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_resultadoVersion_check" CHECK ("resultadoVersion" >= 1);
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_resultado_check"
  -- COALESCE: sin la clave, jsonb_typeof da NULL y un CHECK con NULL pasa.
  CHECK (jsonb_typeof("resultado") = 'object' AND COALESCE(jsonb_typeof("resultado" -> 'estado'), '') = 'string');
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_requisitos_check" CHECK (jsonb_typeof("requisitos") = 'array');
