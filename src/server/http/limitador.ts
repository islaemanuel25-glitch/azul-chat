// src/server/http/limitador.ts
//
// EL CUPO DE LA VINCULACIÓN. EN MEMORIA DEL PROCESO.
//
// Adivinar un código de canje (256 bits) no es posible con ningún cupo. Lo que
// esto frena es a alguien que golpea la ruta de vincular para gastar el cupo de
// canjes que el ERP le da a Azul Chat (20 por minuto para toda la aplicación):
// si se lo gasta, nadie más puede vincularse. Dos cupos, ventana fija, y hay
// que tener lugar en LOS DOS:
//
//   · por IP: una persona golpeando no le saca el lugar a las demás;
//   · del proceso, en total, por debajo del cupo del ERP: rotar IPs no sirve
//     para pasar más.
//
// ── LO QUE NO HACE ─────────────────────────────────────────────────────────
//
// Es por PROCESO: con varias réplicas cada una cuenta lo suyo, y un reinicio lo
// vacía. Para un despliegue de un solo contenedor alcanza; uno compartido pide
// infraestructura (Redis o la base) que esta tanda no agrega.
//
// La IP sale de X-Forwarded-For (primer salto) o X-Real-IP, que pone el proxy
// de delante. Sin un proxy que las pise, el cliente las puede inventar: por eso
// el cupo del proceso, que no depende de la IP, es el que de verdad protege.

import "server-only";

export const VENTANA_MS = 60 * 1000;
export const MAX_POR_IP = 5;
export const MAX_POR_PROCESO = 15;
const MAX_CLAVES = 10_000;

export type Limitador = {
  consumir(ip: string, ahora?: number): { ok: true } | { ok: false; reintentarEnSegundos: number };
};

export function crearLimitador({ ventanaMs = VENTANA_MS, maxPorIp = MAX_POR_IP, maxPorProceso = MAX_POR_PROCESO } = {}): Limitador {
  const cupos = new Map<string, { cuenta: number; resetAt: number }>();
  const vigente = (clave: string, ahora: number) => {
    const c = cupos.get(clave);
    return !c || ahora >= c.resetAt ? { cuenta: 0, resetAt: ahora + ventanaMs } : c;
  };
  return {
    consumir(ip: string, ahora = Date.now()) {
      if (cupos.size > MAX_CLAVES) for (const [k, c] of cupos) if (ahora >= c.resetAt) cupos.delete(k);
      const total = vigente("proceso", ahora);
      const deIp = vigente(`ip:${ip}`, ahora);
      if (total.cuenta >= maxPorProceso || deIp.cuenta >= maxPorIp) {
        const lleno = total.cuenta >= maxPorProceso ? total : deIp;
        return { ok: false, reintentarEnSegundos: Math.max(1, Math.ceil((lleno.resetAt - ahora) / 1000)) };
      }
      cupos.set("proceso", { cuenta: total.cuenta + 1, resetAt: total.resetAt });
      cupos.set(`ip:${ip}`, { cuenta: deIp.cuenta + 1, resetAt: deIp.resetAt });
      return { ok: true };
    },
  };
}

/** La IP que informa el proxy de delante, o "desconocida". Ver la cabecera del archivo. */
export function ipDeLaSolicitud(headers: Headers): string {
  const reenviada = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return reenviada || headers.get("x-real-ip")?.trim() || "desconocida";
}
