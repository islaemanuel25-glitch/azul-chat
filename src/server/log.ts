// src/server/log.ts
//
// EL ÚNICO LUGAR DEL SERVIDOR QUE ESCRIBE EN CONSOLA.
//
// El registro de una consulta al ERP tiene un tipo CERRADO: capacidad,
// duración, status, código y requestId. No hay un campo libre donde meter el
// cuerpo, la firma, el secreto o el vínculo; agregarlo exige cambiar este tipo,
// y el candado `test/erp/logs.test.ts` mira que lo emitido no los contenga.

import "server-only";

export type RegistroConsultaErp = {
  readonly evento: "erp.consulta";
  readonly requestId: string;
  readonly capacidad: string;
  /** Milisegundos desde que se empezó a armar la llamada. */
  readonly duracionMs: number;
  /** Status HTTP del ERP, o `null` si no hubo respuesta (timeout, red, config). */
  readonly status: number | null;
  /** `"OK"`, un código público del ERP o un código local. */
  readonly codigo: string;
  /** Solo cuando la configuración es inválida: cuál regla falló. Nunca el valor. */
  readonly motivo?: string;
};

export type Registrador = (registro: RegistroConsultaErp) => void;

export const registrarEnConsola: Registrador = (registro) => {
  const linea = JSON.stringify(registro);
  if (registro.codigo === "OK") console.info(linea);
  else console.warn(linea);
};
