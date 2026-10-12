// LAS TARJETAS DE STOCK (Tanda 8B).
//
// Figma "Azul Chat — Mobile V1" tiene el chip "Stock" (nodo 1:150) pero no las
// tarjetas: están armadas con las MISMAS piezas y clases que las de ventas y
// cajas (`ac-ventas`, sus líneas y subtítulos), sin colores nuevos.
//
//   · "Bajo mínimo · {local}": cuántos productos están por debajo del mínimo y
//     los primeros 10 —nombre · lo que hay · "mín. N"—; "Ver todos (n)"
//     despliega el resto de lo que mandó el ERP (hasta 50), con <details>: sin
//     estado propio. Sin mínimo cargado, o con nada por debajo, se dice así.
//   · Productos (preguntas): una fila por resultado —nombre, código, lo que hay
//     y, si está bajo mínimo, la MISMA marca de alerta que "recibida con
//     diferencias"—. Más coincidencias o ninguna, con su texto fijo.
//
// Sin estado y sin red. Los textos salen de formato.ts.

import type { ReactNode } from "react";

import type { BajoMinimoDelLocal, ProductoDeStockPublico, ProductosDelLocal } from "../../shared/chats/api.ts";
import {
  cantidadDeProducto,
  lineaDeBajoMinimo,
  minimoDeProducto,
  noEncontre,
  PRIMEROS_BAJO_MINIMO,
  seMuestranDe,
  TEXTO_BAJO_MINIMO,
  TEXTO_HAY_MAS_COINCIDENCIAS,
  TEXTO_NADA_BAJO_MINIMO,
  TEXTO_SIN_MINIMO,
  tituloDeBajoMinimo,
  tituloDeProductos,
  totalBajoMinimo,
  verTodos,
} from "./formato.ts";
import type { EstadoStock } from "./logica.ts";
import { AvisoDeRespuesta, TarjetaVentasFalla } from "./Piezas.tsx";

/** Lo de un local, sin la tarjeta: para una tarjeta propia o una sección de "todos". */
export function ContenidoBajoMinimo({ datos }: { datos: BajoMinimoDelLocal }) {
  if (datos.sinMinimo) return <p className="ac-ventas__linea">{TEXTO_SIN_MINIMO}</p>;
  if (datos.total === 0) return <p className="ac-ventas__linea">{TEXTO_NADA_BAJO_MINIMO}</p>;
  const primeros = datos.productos.slice(0, PRIMEROS_BAJO_MINIMO);
  const resto = datos.productos.slice(PRIMEROS_BAJO_MINIMO);
  const linea = (p: ProductoDeStockPublico) => (
    <p key={p.productoId} className="ac-ventas__linea">
      {lineaDeBajoMinimo(p)}
    </p>
  );
  return (
    <>
      <p className="ac-stock__nombre">{totalBajoMinimo(datos.total)}</p>
      {primeros.map(linea)}
      {resto.length > 0 && (
        <details className="ac-stock__mas">
          <summary>{verTodos(datos.productos.length)}</summary>
          {resto.map(linea)}
        </details>
      )}
      {datos.hayMas && <p className="ac-ventas__advertencia">{seMuestranDe(datos.productos.length, datos.total)}</p>}
    </>
  );
}

/** "Bajo mínimo · {local}". `aviso` va arriba; `children`, al final. */
export function TarjetaBajoMinimo({ datos, titulo, aviso = null, children }: { datos: BajoMinimoDelLocal; titulo?: string; aviso?: string | null; children?: ReactNode }) {
  const t = titulo ?? tituloDeBajoMinimo(datos.local.nombre);
  return (
    <article className="ac-ventas ac-stock" aria-label={t}>
      {aviso && <AvisoDeRespuesta texto={aviso} />}
      <p className="ac-ventas__titulo">{t}</p>
      <ContenidoBajoMinimo datos={datos} />
      {children}
    </article>
  );
}

/** Un producto: nombre, código, lo que hay y, si está bajo mínimo, la marca de alerta. Exportado para los tests. */
export function FilaDeProducto({ producto }: { producto: ProductoDeStockPublico }) {
  const bajo = producto.bajoMinimo === true;
  const detalle = [producto.codigo, cantidadDeProducto(producto), minimoDeProducto(producto)].filter((x): x is string => !!x).join(" · ");
  return (
    <div className={bajo ? "ac-stock__producto ac-stock__producto--bajo" : "ac-stock__producto"}>
      <p className="ac-stock__nombre">{producto.nombre}</p>
      <p className="ac-ventas__linea">{detalle}</p>
      {bajo && (
        <p className="ac-stock__bajo">
          <span className="ac-evento__marca" aria-hidden="true">
            ⚠
          </span>
          {TEXTO_BAJO_MINIMO}
        </p>
      )}
    </div>
  );
}

/** Lo que encontró el ERP en un local, sin la tarjeta. */
export function ContenidoProductos({ datos }: { datos: ProductosDelLocal }) {
  if (datos.productos.length === 0) return <p className="ac-ventas__linea">{noEncontre(datos.texto, datos.local.nombre)}</p>;
  return (
    <>
      {datos.productos.map((p) => (
        <FilaDeProducto key={p.productoId} producto={p} />
      ))}
      {datos.hayMas && <p className="ac-ventas__advertencia">{TEXTO_HAY_MAS_COINCIDENCIAS}</p>}
    </>
  );
}

/** "Stock de «texto» · {local}": una fila por resultado. */
export function TarjetaProductos({ datos, titulo }: { datos: ProductosDelLocal; titulo?: string }) {
  const t = titulo ?? tituloDeProductos(datos.texto, datos.local.nombre);
  return (
    <article className="ac-ventas ac-stock" aria-label={t}>
      <p className="ac-ventas__titulo">{t}</p>
      <ContenidoProductos datos={datos} />
    </article>
  );
}

/** Lo que va al final del historial según la consulta del chip "Stock": la tarjeta, o la falla con Reintentar a mano. */
export function ResultadoStock({ estado, alReintentar, enEspera = false }: { estado: EstadoStock; alReintentar: () => void; enEspera?: boolean }) {
  if (estado.fase === "LISTA") return <TarjetaBajoMinimo datos={estado.stock} />;
  if (estado.fase === "FALLA") return <TarjetaVentasFalla alReintentar={alReintentar} cupo={estado.cupo} enEspera={enEspera} />;
  return null;
}
