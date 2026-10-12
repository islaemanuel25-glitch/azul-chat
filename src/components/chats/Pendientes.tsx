// LA TARJETA DE PENDIENTES (Tanda 9B).
//
// Figma "Azul Chat — Mobile V1", pantalla 04 "Pendientes" (nodos 1:204-1:240):
// una fila por pendiente con su pill IMPORTANTE / NORMAL. Sin los botones
// "Ver detalle" / "Abrir en ERP" del Figma: todavía no hay a dónde llevar.
// Armada con las piezas de ventas y stock (`ac-ventas`, sus líneas); la pill
// IMPORTANTE usa la marca de alerta de siempre, NORMAL el tono suave. Ningún
// color nuevo.
//
//   · Pedido: "Pedido #N" · "Pendiente de envío · desde hace …" · "A {origen} · k líneas".
//   · Caja: "Caja de {operador} · {turno} · hoy|ayer" · "Falta $ …" | "Sobra $ …" | "Falta verificar en Tesorería".
//   · Sin pendientes: "Nada pendiente en {local}."
//   · Una fuente que no contestó: el aviso de que la lista puede estar incompleta.
//
// El orden y la etiqueta ya vienen del servidor (src/shared/chats/pendientes.ts).
// Sin estado y sin red. Los textos salen de formato.ts.

import type { EtiquetaPendiente, Pendiente, PendientesDelLocal } from "../../shared/chats/api.ts";
import {
  avisoDeFuentesFaltantes,
  detalleDePedidoPendiente,
  estadoDePedidoPendiente,
  ETIQUETA_PILL,
  motivoDeCajaPendiente,
  nadaPendiente,
  TITULO_PENDIENTES_TODOS,
  tituloDeCajaPendiente,
  tituloDePedidoPendiente,
  tituloDePendientes,
} from "./formato.ts";
import type { EstadoPendientes } from "./logica.ts";
import { AvisoDeRespuesta, SubtituloDeTarjeta, TarjetaVentasFalla } from "./Piezas.tsx";

/** La pill del Figma. IMPORTANTE con la marca de alerta; NORMAL, suave. */
export function PillPendiente({ etiqueta }: { etiqueta: EtiquetaPendiente }) {
  return <span className={etiqueta === "IMPORTANTE" ? "ac-pill ac-pill--importante" : "ac-pill"}>{ETIQUETA_PILL[etiqueta]}</span>;
}

/** Una fila: título, pill y dos líneas. Exportada para los tests. */
export function FilaPendiente({ pendiente: p }: { pendiente: Pendiente }) {
  const titulo = p.tipo === "PEDIDO" ? tituloDePedidoPendiente(p.pedidoId) : tituloDeCajaPendiente(p);
  const lineas = p.tipo === "PEDIDO" ? [estadoDePedidoPendiente(p.antiguedadHoras), detalleDePedidoPendiente(p)] : [motivoDeCajaPendiente(p)];
  return (
    <div className={p.etiqueta === "IMPORTANTE" ? "ac-pendiente ac-pendiente--importante" : "ac-pendiente"}>
      <p className="ac-pendiente__titulo">
        <span>{titulo}</span>
        <PillPendiente etiqueta={p.etiqueta} />
      </p>
      {lineas.map((l) => (
        <p key={l} className="ac-ventas__linea">
          {l}
        </p>
      ))}
    </div>
  );
}

/** Lo de un local, sin la tarjeta: para una tarjeta propia o una sección de "todos". */
export function ContenidoPendientes({ datos }: { datos: PendientesDelLocal }) {
  const aviso = avisoDeFuentesFaltantes(datos.faltaron);
  return (
    <>
      {aviso && <AvisoDeRespuesta texto={aviso} />}
      {datos.pendientes.length === 0 ? (
        <p className="ac-ventas__linea">{nadaPendiente(datos.local.nombre)}</p>
      ) : (
        datos.pendientes.map((p) => <FilaPendiente key={`${p.tipo}-${p.tipo === "PEDIDO" ? p.pedidoId : `${p.dia}-${p.cajaId}`}`} pendiente={p} />)
      )}
    </>
  );
}

/** "Pendientes · {local}". */
export function TarjetaPendientes({ datos, titulo }: { datos: PendientesDelLocal; titulo?: string }) {
  const t = titulo ?? tituloDePendientes(datos.local.nombre);
  return (
    <article className="ac-ventas ac-stock" aria-label={t}>
      <p className="ac-ventas__titulo">{t}</p>
      <ContenidoPendientes datos={datos} />
    </article>
  );
}

/** "Pendientes · Todos los locales": una sección por local, en el orden recibido (los que no tienen nada, al final). */
export function TarjetaPendientesTodos({ locales, titulo = TITULO_PENDIENTES_TODOS }: { locales: readonly PendientesDelLocal[]; titulo?: string }) {
  return (
    <article className="ac-ventas ac-stock" aria-label={titulo}>
      <p className="ac-ventas__titulo">{titulo}</p>
      {locales.map((l) => (
        <section key={l.local.id} className="ac-stock__local" aria-label={l.local.nombre}>
          <SubtituloDeTarjeta texto={l.local.nombre} />
          <ContenidoPendientes datos={l} />
        </section>
      ))}
    </article>
  );
}

/** Lo que va al final del historial según la consulta del chip "Pendientes": la tarjeta, o la falla con Reintentar a mano. */
export function ResultadoPendientes({ estado, alReintentar, enEspera = false }: { estado: EstadoPendientes; alReintentar: () => void; enEspera?: boolean }) {
  if (estado.fase === "LISTA") {
    return estado.pendientes.tipo === "LOCAL" ? <TarjetaPendientes datos={estado.pendientes.datos} /> : <TarjetaPendientesTodos locales={estado.pendientes.locales} />;
  }
  if (estado.fase === "FALLA") return <TarjetaVentasFalla alReintentar={alReintentar} cupo={estado.cupo} enEspera={enEspera} />;
  return null;
}
