# La interfaz móvil de chats

Tanda 2C. La primera interfaz real de Azul Chat: la lista de chats, la
conversación de un Local y General, con sus estados. Usa la API de chats tal
como quedó aprobada (`docs/CHATS.md`), sin cambiarla. La referencia visual es
el Figma "Azul Chat — Mobile V1" (`DpxKeDtugjdB8IfuGnHZcz`), pantallas 1, 2, 3
y 7, adaptadas a lo que la API de verdad da.

Es para el celular: entre 360 y 430 px de ancho, con una mano. En una pantalla
grande se centra en una columna de 480 px; no hay un diseño de escritorio.

## Qué hay

- **Chats.** General primero y, debajo, exactamente los locales que devuelve
  `GET /api/chats`, en su orden. Cada fila tiene el nombre de hoy, el último
  evento resumido, la hora o fecha, el badge de no leídos (solo si hay) y, si
  traer lo nuevo de ese local se demoró, "Actualización demorada". Un local sin
  eventos dice "Sin novedades". Los filtros "Todos" y "No leídos" trabajan
  sobre lo que ya llegó, sin pedir nada. En el encabezado, "Actualizar" vuelve a
  pedir la lista y "Tu sesión" abre el panel de sesión.
- **Un Local.** Encabezado con volver y el nombre de hoy del local. El historial
  se lee como un chat: lo más viejo arriba y lo más nuevo abajo, con un
  separador por día. La API manda la página al revés (lo más reciente primero,
  para paginar); la interfaz la da vuelta sin tocar el cursor.
- **General.** Encabezado con volver, "General" y "Eventos de todos los
  locales". Cada evento dice de qué local es. Es la misma proyección de la API:
  ningún evento se repite.
- **El evento.** "Transferencia #182 recibida" o "Transferencia #182 recibida
  con diferencias". Si tiene diferencias, "1 línea con diferencia" o "N líneas
  con diferencias": el dato cuenta líneas del remito, no productos. Además, de
  dónde vino y la hora. Sin ids ni datos técnicos.
- **Pedidos, envíos y cancelaciones (Tanda 4B).** El MISMO componente de
  evento (`TarjetaEvento`), sin colores nuevos (Figma pantalla 01: "Pedido #91
  solicitado" y "Transferencia #184 enviada"). Título y, debajo, una sola línea
  chica separada por " · ":
  - "Pedido #N solicitado" · "A {origen}" · "{k} línea(s)" · hora;
  - "Transferencia #N enviada" · "Desde {origen}" · "{k} línea(s)" · hora;
  - "Transferencia #N cancelada" · "Desde {origen}" · hora.

  "1 línea" en singular, "N líneas" en plural. El borde y la marca de alerta
  son SOLO de "recibida con diferencias". En la lista de chats el último evento
  se resume con estos mismos títulos (`resumenDeEvento`, en `formato.ts`), y en
  General cada uno lleva su local arriba. Nada de "Ver detalle", "Abrir en ERP"
  ni acciones.
- **Ventas de hoy (Tanda 3A).** En un Local cuyo `GET /api/chats/local` trae
  `local.ventas: true`, abajo hay una barra fija con UN solo chip, "Ventas"
  (Figma nodo 1:142). Sin el anuncio no hay barra; General no la tiene nunca.
  Tocarlo pide `GET /api/chats/ventas` y, al final del historial, aparece la
  tarjeta (nodo 1:127): "Ventas de hoy · {local}", el total grande en moneda
  es-AR ("$ 1.850.320,00", formateado sobre el texto del ERP, sin pasar por
  number), "N ventas" ("1 venta" en singular), una línea "{medio} · {monto}" por
  medio de pago y, debajo, las advertencias del ERP tal cual. Sin acciones dentro
  de la tarjeta. Mientras consulta, el chip dice "Consultando ventas…" y está
  deshabilitado. Si falla, la tarjeta de error (nodo 1:329): "No se pudo
  consultar ERP Azul." y "Reintentar", que solo pide de nuevo si la persona la
  toca. Tocar "Ventas" otra vez descarta la tarjeta y consulta de nuevo; salir
  del chat la descarta. Sin refresco automático, sin almacenamiento del
  navegador, y no toca la lectura (`useVentas` y `AccionesDelLocal`, en
  `Conversacion.tsx`; `reducirVentas`, en `logica.ts`).

## Cómo se navega

La vista va en la consulta de la URL: `/`, `/?vista=local&localId=N` y
`/?vista=general`. No hay segmentos de ruta (`test/frontera/rutas.test.ts` no
los admite en `src/app`). Abrir un chat agrega una entrada al historial, así el
"atrás" del teléfono vuelve a la lista. Cada pantalla tiene además su propia
flecha "Volver a chats", que no depende del historial: si la entrada no es de
la app, reemplaza la URL y muestra la lista. Una URL que no se entiende muestra
la lista.

## Recarga al cambiar de versión

Tanda 3B. Navegar no recarga la página (es `history.pushState`), así que una
pestaña abierta antes de un despliegue seguiría corriendo el JS viejo: el 10/10
una pestaña con `3d8b849` no mostró la barra de Ventas hasta cerrarla del todo.

- Al arrancar, la app pide `GET /api/version` y guarda EN MEMORIA el commit
  con el que arrancó.
- Lo vuelve a pedir solo en dos momentos: cuando la página vuelve a primer
  plano (`visibilitychange` → `visible`) y al abrir un chat (un Local o
  General; volver a la lista no). Nada de intervalos ni temporizadores.
- Si el commit cambió, `window.location.reload()`, una sola vez.
- Si `/api/version` falla, tarda más de 5 s (lo corta el navegador con
  `AbortSignal.timeout`) o no trae un SHA completo, no pasa nada: ni recarga
  ni error. Si falló el pedido del arranque, el primer commit que se consiga
  después pasa a ser el de referencia.
- Nada se guarda en el navegador. Un pedido en curso no se duplica.

Está en `src/components/chats/version.ts` (sin React: recibe pedir, recargar y
el documento), `pedirVersion` en `clienteChats.ts` y la conexión en
`AzulChat.tsx`.

## Marcar leído

Regla: la interfaz nunca marca como leído un evento que no pueda demostrar que
mostró. Ningún GET marca leído; marcar es `POST /api/chats/leido`, y solo lo
pide un Local.

La lectura del servidor es una marca de agua: marcar hasta un id deja leídos
todos los ids menores de ese local. Por eso no alcanza con marcar "hasta el
mayor id que se ve": si hay más no leídos que los que entraron en pantalla, los
que faltan quedarían leídos sin haberse visto.

**Un Local.** Después de dibujar (desde un efecto), la interfaz cuenta los
eventos mostrados NO HISTÓRICOS (`historico: false`) con `Evento.id` mayor que
`leidoHasta`, comparando como BigInt, nunca la cantidad total de eventos en
pantalla, que puede incluir historia ya leída o historia sin leer. Es la misma
regla con la que cuenta el servidor. Usa el `leidoHasta` y el `noLeidos` de la
respuesta que abrió la conversación (`decidirLecturaLocal`, en
`components/chats/logica.ts`):

- si esa cuenta es menor que `noLeidos`, NO marca. La pantalla dice "Hay más
  eventos sin leer", junto a "Cargar anteriores";
- cuando alcanza (de entrada, o después de cargar anteriores), marca hasta el
  mayor de esos ids, una sola vez por avance;
- con 30 o menos no leídos todo entra en la primera página y marca enseguida,
  como siempre.

Por qué hace falta mirar `historico` (Tanda 4B): cada capacidad de eventos
tiene su propio backfill, y la historia de una capacidad recién anunciada se
ingiere DESPUÉS que lo nuevo de otra, con ids MAYORES. Sin mirar `historico`,
45 pedidos viejos con ids altos en la primera página contarían como "nuevos
mostrados" y se marcaría leído con los no leídos reales sin cargar.

Por qué alcanzar el número basta: el servidor cuenta exactamente los no
históricos con id mayor que lo leído, de los tipos que la persona ve, y la
conversación muestra esos mismos eventos. Si hay N mostrados que cumplen la
regla y el servidor contó N, son todos: marcar hasta el mayor de ELLOS (no
hasta el mayor id de la pantalla) no deja ninguno sin ver. Lo que llega
después de abrir tiene ids mayores, no está a la vista y no queda cubierto:
sigue sin leer. Lo ejercen `test/ui/chats.test.ts` y, contra el servidor,
`test/db/chats.test.ts` (40 nuevos con 30 en la primera página; y desde la
Tanda 4B, el backfill de pedidos con 45 ids altos más 2 recepciones nuevas:
`noLeidos` = 2 y no se marca hasta que las 2 están a la vista).

Si el POST falla, la conversación sigue a la vista y no se cuenta como leído:
el "N sin leer" del encabezado cambia solo con una respuesta buena.

**General.** En la Tanda 2C, General es solo lectura visual: no marca leído al
abrir, al cargar anteriores ni al salir. Su respuesta no dice cuántos no leídos
tiene cada local, así que no puede demostrar que mostró todos los de un local.
Usar los números de la lista de chats tampoco sirve, porque son de otro momento.
Es deliberadamente conservador: los badges de cada local siguen hasta que esa
conversación se lea desde su Local, bajo la regla de arriba.

Los badges de la lista salen siempre de un `GET /api/chats` nuevo, al volver a
ella.

## Paginación

La primera página trae 30 eventos. Si la API devuelve `siguiente`, arriba del
historial aparece "Cargar anteriores", que pide la página siguiente con ese
cursor opaco, agrega los eventos sin repetir ninguno y deja la vista donde
estaba. No hay scroll infinito ni refresco automático.

## Estados

- **Cargando:** "Cargando chats…" o "Cargando conversación…".
- **Vacío:** un Local sin eventos dice "Todavía no hay eventos."; General,
  "Todavía no hay eventos para mostrar."; con el filtro "No leídos" y nada sin
  leer, "No hay chats sin leer.".
- **Actualización demorada:** se ve lo guardado (ya autorizado en esa misma
  solicitud) con un aviso discreto. No es una caída.
- **ERP Azul no responde (P1):** si la API contesta `ERP_NO_DISPONIBLE`, la
  vista entera se reemplaza: "ERP Azul no responde", "Para ver el historial
  hace falta verificar tu acceso." y "Reintentar". No queda historial detrás ni
  una lista vieja a la vista, y no hay caché en el navegador.
- **Sin acceso:** un local que no está entre los de hoy (o que no existe: la API
  no lo distingue) dice "Este chat no está entre los que podés ver hoy." y
  ofrece volver.
- **Sin conexión / no disponible:** con "Reintentar". Si se corta la red al
  cargar anteriores, lo que ya se ve sigue y se avisa debajo del botón.
- **Sin sesión o vínculo inválido:** cualquier `SIN_SESION` vuelve al panel de
  sesión de siempre para vincular de nuevo; si el ERP invalidó el vínculo, el
  panel lo dice. No hay otra autenticación ni se guarda nada en el navegador.

## Cómo está armada

- `src/components/chats/clienteChats.ts`: el único lugar desde donde la
  interfaz llama a las rutas de chats. Devuelve la respuesta buena o la falla
  pública por su código; no sabe nada del ERP ni de tokens.
- `logica.ts`: lo que deciden las pantallas, sin React (filas, orden, páginas,
  cuándo se puede marcar leído, fallas, navegación). `formato.ts`: todos los
  textos de eventos y fechas, en un solo lugar, con `Intl` y la zona del
  teléfono.
- `Piezas.tsx` (badge, avatar, aviso, estados, tarjeta del evento),
  `PantallaChats.tsx`, `Conversacion.tsx` (Local y General) y `AzulChat.tsx`
  (qué pantalla se ve, navegación y sesión). El encabezado es el de
  `ShellMovil`, y la sesión, el `PanelSesion` existente.
- Sin dependencias nuevas ni estado global: `useState`, `useReducer` y efectos.
- Colores, radios, espacios y letras salen de los tokens `--ac-*` de
  `src/app/globals.css`, que se redefinen para el modo oscuro. Los tokens nuevos
  (alerta, marca suave, foco) se agregaron ahí. Las acciones son botones de
  verdad, con etiqueta accesible ("Volver a chats", "Actualizar chats", "Tu
  sesión", "Cargar eventos anteriores"); el badge lleva texto para lectores de
  pantalla y el foco se ve con el token de foco.

## Candados

- `test/ui/chats.test.ts`: la lógica, los componentes dibujados con
  `react-dom/server` (sin navegador) y el cliente HTTP con un `fetch` de prueba.
  Para ventas: la barra con y sin el anuncio, la carga, la tarjeta (singular,
  plural, advertencias), el error con "Reintentar" y la consulta que reemplaza.
- `test/frontera/alcanceUi.test.ts`: la interfaz no muestra "Ver diferencias",
  "Abrir en ERP", "Última transferencia", "Ver detalle", "Comparar", el campo
  "Preguntá…" ni los chips Caja, Transferencias, Pedidos o Stock; "Ventas de
  hoy" se admite SOLO como título de la tarjeta, en `formato.ts`; no tiene refresco
  automático —salvo la recarga por versión, con cada pieza en su único archivo:
  escuchar el primer plano en `version.ts`, el corte por tiempo en el cliente y
  `location.reload` solo como el `recargar` del comprobador en `AzulChat.tsx`—
  ni almacenamiento del navegador; hace HTTP solo desde sus dos
  clientes; no sabe nada de la delegación ni del ERP; y POST leído se llama
  desde un solo lugar, la lectura del Local, que General no usa.
- `test/db/chats.test.ts`: el caso real de 40 no leídos con 30 en la primera
  página, contra el servidor: no se marca hasta tenerlos a la vista, y lo que
  llega después sigue sin leer. Y el de la Tanda 4B: backfill de una capacidad
  nueva con ids altos más 2 nuevos reales.
- `test/ui/chats.test.ts` (Tanda 4B): las tres tarjetas nuevas con sus textos
  exactos, sin alerta ni acciones, con su local en General, y la lista
  resumiendo el último evento con los mismos títulos.
- `test/frontera/secretoSoloServidor.test.ts`: el navegador solo llama a rutas
  propias (`/api/sesion…`, `/api/chats…` y, exacta, `/api/version`), con una
  consulta solo detrás de una constante que vale una ruta propia.
- `test/ui/version.test.ts`: la recarga por versión con un servidor y un
  documento de mentira: igual no recarga, distinta recarga, un fallo no recarga,
  y solo pregunta al volver a primer plano y al abrir un chat.

## Fuera de alcance

No existen todavía, y la interfaz no los muestra ni los insinúa: Pendientes,
buscar en el historial, la configuración completa, el compositor y los mensajes
de personas, la IA, las acciones sobre el ERP ("Ver diferencias", "Abrir en
ERP"), las notificaciones y cualquier actualización en vivo (WebSocket, SSE o
refresco periódico). La recarga por versión no es eso: no trae datos, solo
reemplaza el JS de un despliegue viejo, y solo en los dos momentos de arriba.

De las acciones rápidas del diseño existe solo "Ventas", y solo para hoy. No
existen: los chips Caja, Transferencias, Pedidos y Stock; el campo "Preguntá
sobre este local…"; "Ver detalle" y "Comparar" en la tarjeta de ventas; otros
períodos (ayer, rango); y nada de ventas en General.
