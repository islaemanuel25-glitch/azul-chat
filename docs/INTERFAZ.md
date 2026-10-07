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

## Cómo se navega

La vista va en la consulta de la URL: `/`, `/?vista=local&localId=N` y
`/?vista=general`. No hay segmentos de ruta (`test/frontera/rutas.test.ts` no
los admite en `src/app`). Abrir un chat agrega una entrada al historial, así el
"atrás" del teléfono vuelve a la lista. Cada pantalla tiene además su propia
flecha "Volver a chats", que no depende del historial: si la entrada no es de
la app, reemplaza la URL y muestra la lista. Una URL que no se entiende muestra
la lista.

## Marcar leído

Ningún GET marca leído. La interfaz lo pide con `POST /api/chats/leido`
DESPUÉS de mostrar la conversación (desde un efecto, que corre después de
dibujar):

- un Local: hasta el mayor `Evento.id` que se mostró, y solo si es mayor que lo
  ya leído;
- General: una marca por local, cada una hasta el mayor id de ESE local entre
  los mostrados. Nunca un máximo común, y un local sin eventos mostrados no se
  marca. Si General no tiene no leídos, no se pide nada;
- cargar anteriores no vuelve a marcar lo mismo (cada marca se manda una vez).

Si el POST falla, la conversación sigue a la vista y no se cuenta como leído: el
"N sin leer" del encabezado del Local cambia solo con una respuesta buena. Los
badges de la lista salen siempre de un `GET /api/chats` nuevo, al volver a ella.

La lectura de la API es una marca de agua: marcar hasta un id cubre también los
ids menores de ese local, aunque no se hayan mostrado (por ejemplo, con más de
30 no leídos, o un evento viejo que se conoció tarde y quedó en una página
anterior con un id menor).

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
  marcas, fallas, navegación). `formato.ts`: todos los textos de eventos y
  fechas, en un solo lugar, con `Intl` y la zona del teléfono.
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
- `test/frontera/alcanceUi.test.ts`: la interfaz no muestra "Ver diferencias",
  "Abrir en ERP", "Ventas de hoy" ni "Última transferencia"; no tiene refresco
  automático ni almacenamiento del navegador; hace HTTP solo desde sus dos
  clientes; y no sabe nada de la delegación ni del ERP.
- `test/frontera/secretoSoloServidor.test.ts`: el navegador solo llama a rutas
  propias (`/api/sesion…`, `/api/chats…`), con una consulta solo detrás de una
  constante que vale una ruta propia.

## Fuera de alcance

No existen todavía, y la interfaz no los muestra ni los insinúa: Pendientes,
buscar en el historial, la configuración completa, el compositor y los mensajes
de personas, la IA, las ventas, las acciones sobre el ERP ("Ver diferencias",
"Abrir en ERP", acciones rápidas), las notificaciones y cualquier actualización
en vivo (WebSocket, SSE o refresco periódico).
