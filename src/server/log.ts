// src/server/log.ts
//
// EL ÚNICO LUGAR DEL SERVIDOR QUE ESCRIBE EN CONSOLA.
//
// Cada registro tiene un tipo CERRADO. No hay un campo libre donde meter el
// cuerpo, la firma, el secreto, el código de canje, el token, la cookie de
// sesión o un mensaje de error de una librería (que puede llevar cualquiera de
// esas cosas adentro). Agregar algo exige cambiar estos tipos, y los candados de
// `test/` miran que lo emitido no contenga nada de eso.

import "server-only";

/** Una llamada al ERP. */
export type RegistroConsultaErp = {
  readonly evento: "erp.consulta";
  readonly requestId: string;
  readonly operacion: "canjear" | "mi_alcance" | "ventas_resumen";
  /** Milisegundos desde que se empezó a armar la llamada. */
  readonly duracionMs: number;
  /** Status HTTP del ERP, o `null` si no hubo respuesta (timeout, red, config). */
  readonly status: number | null;
  /** `"OK"`, un código público del ERP o un código local. */
  readonly codigo: string;
  /** Solo cuando la configuración es inválida: cuál regla falló. Nunca el valor. */
  readonly motivo?: string;
};

/** Un intento de vincular un dispositivo. Sin el código, ni su hash. */
export type RegistroVinculacion = {
  readonly evento: "sesion.vincular";
  readonly requestId: string;
  /** `"OK"` o el código público que se devolvió. */
  readonly resultado: string;
  /** Solo en fallas locales: qué paso falló. Un nombre fijo, nunca un mensaje. */
  readonly etapa?: "configuracion" | "base" | "persistencia";
};

/** Un vínculo local que se invalidó porque el ERP rechazó su token. */
export type RegistroInvalidacion = {
  readonly evento: "vinculo.invalidado";
  readonly vinculoId: string;
  readonly sesionesRevocadas: number;
};

/** Una falla local al usar un vínculo (clave de cifrado, base). Nombre fijo, nunca un mensaje. */
export type RegistroFallaLocal = {
  readonly evento: "sesion.falla_local";
  readonly etapa: "configuracion" | "descifrado" | "base";
};

export type Registro = RegistroConsultaErp | RegistroVinculacion | RegistroInvalidacion | RegistroFallaLocal;

export type Registrador = (registro: Registro) => void;

const esExito = (r: Registro): boolean =>
  (r.evento === "erp.consulta" && r.codigo === "OK") || (r.evento === "sesion.vincular" && r.resultado === "OK");

export const registrarEnConsola: Registrador = (registro) => {
  const linea = JSON.stringify(registro);
  if (esExito(registro)) console.info(linea);
  else console.warn(linea);
};
