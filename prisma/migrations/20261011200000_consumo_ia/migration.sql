-- LO QUE SE GASTA EN LA IA QUE INTERPRETA PREGUNTAS. Tanda 6A.
--
-- Una tabla nueva, sin tocar ninguna fila existente: ConsumoIa, una fila por
-- mes calendario de Argentina con los tokens, el costo estimado en
-- millonésimas de dólar y cuántas preguntas llegaron al modelo. El tope
-- mensual (AZUL_CHAT_IA_TOPE_USD) se aplica sobre esta fila con un UPDATE
-- condicionado (src/server/ia/consumo.ts).
--
-- Lo que Prisma no sabe expresar va al final, a mano: los CHECK.

-- CreateTable
CREATE TABLE "ConsumoIa" (
    "mes" TEXT NOT NULL,
    "tokensEntrada" BIGINT NOT NULL DEFAULT 0,
    "tokensSalida" BIGINT NOT NULL DEFAULT 0,
    "costoMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "preguntas" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumoIa_pkey" PRIMARY KEY ("mes")
);


-- El mes es "AAAA-MM" con un mes real; ninguna cuenta es negativa.
ALTER TABLE "ConsumoIa" ADD CONSTRAINT "ConsumoIa_mes_check" CHECK ("mes" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "ConsumoIa" ADD CONSTRAINT "ConsumoIa_cuentas_check"
  CHECK ("tokensEntrada" >= 0 AND "tokensSalida" >= 0 AND "costoMicroUsd" >= 0 AND "preguntas" >= 0);
