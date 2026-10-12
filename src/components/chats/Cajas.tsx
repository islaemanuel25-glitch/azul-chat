// LA TARJETA DE CAJAS (Tanda 7B): las cajas de un día de un local, por turno.
//
// Figma "Azul Chat — Mobile V1" tiene el chip "Caja" (nodo 1:144) pero no la
// tarjeta: está armada con las MISMAS piezas y clases que la tarjeta de ventas
// (`ac-ventas`, sus líneas, subtítulos y avisos), sin colores nuevos.
//
//   · Una sección por turno operativo: su nombre y el total vendido del turno.
//     "Sin turno asignado" va al final (así lo manda el ERP) y en el tono suave.
//   · Cada caja es una fila PLEGADA —"Ana · Falta $ 500,00" y su total— que se
//     despliega al tocarla (<details>: sin estado propio, accesible): medios
//     (el fiado aparte, "no cobrado"), retiros, y el cierre. Una caja abierta
//     no tiene datos de cierre: dice "Caja abierta".
//   · Las diferencias son de CADA caja: el turno no muestra ninguna.
//
// Sin estado y sin red. Los textos salen de formato.ts.

import type { ReactNode } from "react";

import type { CajaPublica, CajasDelDia, MedioDeCajaPublico, TurnoDeCajas } from "../../shared/chats/api.ts";
import {
  cantidadDeVentas,
  filaDeCaja,
  tituloDeCajas,
  formatearMonto,
  lineaDeMedioDePago,
  lineaDeNoCobrado,
  lineaDeRetiro,
  verificacionDeTesoreria,
} from "./formato.ts";
import type { EstadoCaja } from "./logica.ts";
import { AvisoDeRespuesta, SubtituloDeTarjeta, TarjetaVentasFalla } from "./Piezas.tsx";

/** Los medios cobrados y, aparte, lo no cobrado (fiado). */
function Medios({ cobrados, noCobrados }: { cobrados: readonly MedioDeCajaPublico[]; noCobrados: readonly MedioDeCajaPublico[] }) {
  return (
    <>
      {cobrados.map((m) => (
        <p key={m.medio} className="ac-ventas__linea">
          {lineaDeMedioDePago(m)}
        </p>
      ))}
      {noCobrados.map((m) => (
        <p key={m.medio} className="ac-ventas__advertencia">
          {lineaDeNoCobrado(m)}
        </p>
      ))}
    </>
  );
}

/** Una línea "Rótulo · $ monto", solo si el ERP mandó el monto. */
function Monto({ rotulo, monto }: { rotulo: string; monto: string | null }) {
  if (monto === null) return null;
  return (
    <p className="ac-ventas__linea">
      {rotulo} · {formatearMonto(monto)}
    </p>
  );
}

/** Una caja: la fila plegada y, al tocarla, el detalle. Exportada para los tests. */
export function FilaDeCaja({ caja, zona }: { caja: CajaPublica; zona?: string }) {
  const tesoreria = verificacionDeTesoreria(caja.verificacionTesoreria);
  const abierta = caja.estado === "ABIERTA";
  return (
    <details className="ac-caja">
      <summary className="ac-caja__fila">
        <span className="ac-caja__estado">{filaDeCaja(caja)}</span>
        <span className="ac-caja__total">{formatearMonto(caja.totalVendido)}</span>
      </summary>
      <div className="ac-caja__detalle">
        <p className="ac-ventas__linea">{cantidadDeVentas(caja.cantidadVentas)}</p>
        <Medios cobrados={caja.ventasPorMedio} noCobrados={caja.ventasNoCobradas} />
        <SubtituloDeTarjeta texto="Retiros" />
        {caja.retiros.length === 0 ? (
          <p className="ac-ventas__advertencia">Sin retiros</p>
        ) : (
          caja.retiros.map((r, i) => (
            <p key={i} className="ac-ventas__linea">
              {lineaDeRetiro(r, zona)}
            </p>
          ))
        )}
        {caja.ingresos.length > 0 && (
          <>
            <SubtituloDeTarjeta texto="Ingresos" />
            {caja.ingresos.map((x, i) => (
              <p key={i} className="ac-ventas__linea">
                {lineaDeRetiro({ ...x, aQuien: null }, zona)}
              </p>
            ))}
          </>
        )}
        {abierta ? (
          <p className="ac-ventas__aviso">Caja abierta</p>
        ) : (
          <>
            <SubtituloDeTarjeta texto="Cierre" />
            <Monto rotulo="Efectivo esperado" monto={caja.efectivoEsperado} />
            <Monto rotulo="Efectivo contado" monto={caja.efectivoContado} />
            <Monto rotulo="Retirado al cierre" monto={caja.efectivoRetiradoCierre} />
            <Monto rotulo="Fondo que quedó" monto={caja.fondoDejadoCierre} />
          </>
        )}
        {tesoreria && <p className="ac-ventas__advertencia">{tesoreria}</p>}
      </div>
    </details>
  );
}

/** Un turno: su nombre y su total; con `conMedios`, también su desglose (ventas por turno). Sus cajas, plegadas. */
export function SeccionDeTurno({ turno, conMedios = false, zona }: { turno: TurnoDeCajas; conMedios?: boolean; zona?: string }) {
  return (
    <section className={turno.sinTurnoAsignado ? "ac-turno ac-turno--sin-turno" : "ac-turno"} aria-label={turno.turno.nombre}>
      <p className="ac-turno__titulo">
        {turno.turno.nombre} · {formatearMonto(turno.totales.totalVendido)}
      </p>
      {conMedios && (
        <>
          <p className="ac-ventas__linea">{cantidadDeVentas(turno.totales.cantidadVentas)}</p>
          <Medios cobrados={turno.totales.ventasPorMedio} noCobrados={turno.totales.ventasNoCobradas} />
        </>
      )}
      {turno.cajas.map((c) => (
        <FilaDeCaja key={c.id} caja={c} {...(zona ? { zona } : {})} />
      ))}
    </section>
  );
}

/**
 * Las cajas de un día de un local. `aviso` va arriba (p. ej. el turno no
 * encontrado); `children`, al final. Sin turnos: "No hubo cajas".
 */
export function TarjetaCajas({
  cajas,
  titulo,
  aviso = null,
  conMedios = false,
  zona,
  children,
}: {
  cajas: CajasDelDia;
  titulo: string;
  aviso?: string | null;
  conMedios?: boolean;
  zona?: string;
  children?: ReactNode;
}) {
  return (
    <article className="ac-ventas ac-cajas" aria-label={titulo}>
      {aviso && <AvisoDeRespuesta texto={aviso} />}
      <p className="ac-ventas__titulo">{titulo}</p>
      {cajas.turnos.length === 0 && <p className="ac-ventas__linea">No hubo cajas.</p>}
      {cajas.turnos.map((t) => (
        <SeccionDeTurno key={t.turno.id ?? "sin-turno"} turno={t} conMedios={conMedios} {...(zona ? { zona } : {})} />
      ))}
      {cajas.advertencias.map((a, i) => (
        <p key={i} className="ac-ventas__advertencia">
          {a.mensaje}
        </p>
      ))}
      {children}
    </article>
  );
}

/** Lo que va al final del historial según la consulta del chip "Caja": la tarjeta, o la falla con Reintentar a mano. */
export function ResultadoCaja({ estado, alReintentar, enEspera = false, zona }: { estado: EstadoCaja; alReintentar: () => void; enEspera?: boolean; zona?: string }) {
  if (estado.fase === "LISTA") {
    const c = estado.cajas;
    return <TarjetaCajas cajas={c} titulo={tituloDeCajas({ tipo: "hoy", desde: c.fecha, hasta: c.fecha }, c.local.nombre)} {...(zona ? { zona } : {})} />;
  }
  if (estado.fase === "FALLA") return <TarjetaVentasFalla alReintentar={alReintentar} cupo={estado.cupo} enEspera={enEspera} />;
  return null;
}
