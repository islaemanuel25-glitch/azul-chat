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

- **Preguntas (Tanda 6A).** Si `chats/local` o `chats/general` traen
  `preguntas: true` (el servidor tiene la IA configurada), hay una caja de texto
  en la barra fija (Figma "Azul Chat — Mobile V1", nodo 1:152): en un Local,
  debajo del chip "Ventas" (o sola, si el local no tiene Ventas), con
  "Preguntá sobre este local…"; en General, sin chip, con "Preguntá sobre tus
  locales…". 300 caracteres como mucho; "Enviar" no anda con la caja vacía ni
  mientras espera. Sin la IA no hay caja: ni deshabilitada ni con aviso.
  Al enviar, la pregunta queda como una burbuja propia a la derecha con la hora
  (nodo 1:124) y debajo "Buscando la respuesta…"; después, la respuesta como
  tarjeta, con los mismos tokens que la de Ventas:
  - ventas de un local: la tarjeta de Ventas (nodo 1:127), con el título del
    período: "Ventas de hoy · Casiano", "Ventas de ayer · Casiano" o "Ventas del
    1/10 al 7/10 · Casiano";
  - ventas de todos (ordenada en la Tanda 6B): el total y la cantidad arriba;
    debajo el subtítulo "Por medio de pago" con una línea por medio; debajo
    "Por local" con una línea por local. Mismas piezas y tokens, sin colores
    nuevos (`SubtituloDeTarjeta`, `.ac-ventas__subtitulo`). Si alguno no se
    pudo consultar, lo dice y NO muestra total ni medios (serían de una suma
    parcial): solo "Por local" y cuáles faltan;
  - eventos: "{local o Todos los locales} · {período}", la cantidad en palabras
    ("3 transferencias recibidas con diferencias"), hasta 10 eventos con el
    mismo resumen de la lista de chats y "y N más";
  - lo que no se separa (Tanda 6B): si la respuesta trae `noSeparaPor`, la
    tarjeta de ventas o de eventos lleva arriba de todo una línea fija
    (`AvisoDeRespuesta`, `.ac-ventas__aviso`): "Día completo: todavía no puedo
    separar por turno." Con varias, "turno ni vendedor" o "turno, hora ni
    vendedor"; con un rango de varios días, "Período completo: …". Los nombres
    son turno, hora, vendedor, producto, categoría, medio de pago y cliente. La
    plantilla es `avisoNoSepara`, en `formato.ts`: el texto nunca lo escribe la
    IA. Sin `noSeparaPor`, no hay aviso;
  - no entendió: "No entendí la pregunta. Podés preguntar, por ejemplo:" y
    cuatro ejemplos fijos;
  - saldo agotado (nodo 1:333): "Saldo de IA agotado" y "Eventos, historial y
    Ventas siguen funcionando.";
  - fallas (nodo 1:329): "La IA no respondió.", "No se pudo consultar ERP
    Azul." o el texto del cupo, con "Reintentar", que solo repite esa pregunta
    si la persona lo toca.

  Las preguntas viven solo en la pantalla: no se guardan (ni en el servidor ni
  en el navegador), salir del chat las descarta, no marcan leído y no agregan
  chips. Una por vez: mientras una espera, no se manda otra (`usePreguntas` y
  `ListaDePreguntas`, en `Preguntas.tsx`; `reducirPreguntas`, en `logica.ts`;
  la decisión de mostrar la caja, en `AccionesDelLocal` y `AccionesDeGeneral`,
  por `iaDisponible`).

- **Notificaciones (Tanda 5A).** En el panel que abre ☰, debajo de los locales,
  una sección "Notificaciones" con UNA fila (Figma pantalla 06, nodo 1:277,
  adaptada): "Avisos en este teléfono", el estado ("Activadas" /
  "Desactivadas") y el botón para cambiarlo. Si el navegador las bloqueó, lo
  dice en una línea y no ofrece un botón que no puede andar. Nada de
  "Privacidad del push", "Horario de silencio", "Sonidos", IA ni saldo. Con los
  tokens de siempre, sin colores escritos (`FilaNotificaciones.tsx`; la lógica,
  en `components/push/notificaciones.ts`).

## Cómo se navega

La vista va en la consulta de la URL: `/`, `/?vista=local&localId=N` y
`/?vista=general`. No hay segmentos de ruta (`test/frontera/rutas.test.ts` no
los admite en `src/app`). Abrir un chat agrega una entrada al historial, así el
"atrás" del teléfono vuelve a la lista. Cada pantalla tiene además su propia
flecha "Volver a chats", que no depende del historial: si la entrada no es de
la app, reemplaza la URL y muestra la lista. Una URL que no se entiende muestra
la lista.

Desde la Tanda 5B, abrir un local desde la lista lleva también su nombre en la
URL (`/?vista=local&localId=N&nombre=…`). Sirve SOLO para el título mientras
carga o si la carga falla: cuando la API contesta, manda el nombre de la API.
Si no se conoce (por ejemplo, al abrir desde un aviso push), el título es
"Chat". Un nombre vacío, de más de 80 caracteres o con caracteres de control se
ignora. No autoriza nada: el local lo decide el servidor.

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

## App instalable y service worker (Tanda 5A)

Azul Chat se puede instalar en el teléfono: `/manifest.webmanifest`
(`src/app/manifest.ts`) con el nombre "Azul Chat", íconos propios
(`public/icono-*.png`, generados por `scripts/generar-iconos.mjs`) y los
colores de los tokens `--ac-color-marca` y `--ac-color-fondo`.

El service worker (`public/sw.js`) es mínimo a propósito: maneja `push`
(muestra el aviso) y `notificationclick` (abre o trae al frente Azul Chat en
ese local, y solo una URL `/?vista=local&localId=N` validada). **No tiene
`fetch` ni caché**: no intercepta ningún pedido, así que no puede servir JS
viejo y la recarga por versión sigue igual; tampoco guarda nada. Se registra
recién al activar las notificaciones, con `updateViaCache: "none"`.

Activar: pedir permiso, pedir la clave a `GET /api/push/clave`, suscribirse y
mandar la suscripción a `POST /api/push/suscribir`; si el servidor no la
guarda, se deshace en el navegador. Desactivar: `DELETE` y baja en el
navegador. Al abrir el panel con una suscripción hecha se vuelve a mandar
(idempotente), por si se volvió a vincular.

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
  solicitud) con un aviso discreto. No es una caída. Desde la Tanda 5B lo
  decide el estado que dejó la sincronización de fondo (un error, o más de 3
  corridas sin sincronizar; `docs/CHATS.md`), no un intento del pedido: abrir o
  "Actualizar" no traen nada del ERP.
- **ERP Azul no responde (P1):** si la API contesta `ERP_NO_DISPONIBLE`, la
  vista entera se reemplaza: "ERP Azul no responde", "Para ver el historial
  hace falta verificar tu acceso." y "Reintentar". No queda historial detrás ni
  una lista vieja a la vista, y no hay caché en el navegador.
- **Muchas consultas al ERP (Tanda 5B):** si la API contesta
  `ERP_CUPO_EXCEDIDO` (el ERP rechazó por cupo), la vista se reemplaza igual
  (P1), con "Muchas consultas seguidas al ERP. Probá de nuevo en un minuto." y
  "Reintentar", que queda DESHABILITADO 20 s (`ESPERA_TRAS_CUPO_MS`); en un
  Local, también "Ventas" y el "Reintentar" de su tarjeta, y en la lista, el ↻.
  Es un límite a la persona para no repetir el pedido en ráfaga, no un
  reintento automático: pasada la espera, pedir sigue siendo un toque. La
  tarjeta de Ventas usa el mismo texto si el rechazo por cupo fue suyo.
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
  "Abrir en ERP", "Última transferencia", "Ver detalle", "Comparar" ni los chips
  Caja, Transferencias, Pedidos o Stock; "Ventas de hoy" y "Ventas de ayer" se
  admiten SOLO como títulos de la tarjeta, en `formato.ts`; "Preguntá" y el
  único `<input>`, SOLO en la caja de `Preguntas.tsx` (Tanda 6A); no tiene refresco
  automático —salvo la recarga por versión, con cada pieza en su único archivo:
  escuchar el primer plano en `version.ts`, el corte por tiempo en el cliente y
  `location.reload` solo como el `recargar` del comprobador en `AzulChat.tsx`—;
  el único temporizador es el que levanta la espera por cupo (Tanda 5B), uno
  solo, en `esperaCupo.ts`, con una sola forma: vuelve a habilitar y nada más;
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

- `test/ui/notificaciones.test.ts` (Tanda 5A): la fila en cada estado y el
  cliente de notificaciones con un navegador de mentira.
- `test/ui/chats.test.ts` (Tanda 5B, casos (d)): el texto del cupo en la lista,
  en un Local y en General, sin historial detrás; "Reintentar" deshabilitado
  con la espera y habilitado sin ella; la espera de 20 s solo tras un cupo;
  Ventas con el mismo texto y en espera; el cliente leyendo el 429; y el
  título con el nombre de la lista (por la URL), "Chat" sin él.
- `test/frontera/alcanceUi.test.ts` (Tanda 5A): el service worker solo escucha
  push y el toque, sin fetch, caché, almacenamiento ni temporizadores; service
  worker y Push API solo en su cliente; el manifest con los colores de los
  tokens; y los textos de la pantalla 06 que no existen siguen prohibidos.

- `test/ui/chats.test.ts` (Tanda 6A): sin IA no hay caja ni burbujas (con
  preguntas en curso igual); con IA, la caja debajo del chip y su texto en un
  Local y en General; la burbuja con la hora; cada respuesta (un local, todos,
  todos con uno caído y sin total, eventos con "y N más", no entendí, saldo
  agotado, las fallas con y sin espera); el cliente HTTP de la pregunta. Tanda
  6B: la plantilla del aviso (una, varias, día o período), el aviso arriba de
  la tarjeta de un local, de todos y de eventos, ninguno sin `noSeparaPor`, y
  la tarjeta de todos con "Por medio de pago" y "Por local" en su orden.

## Fuera de alcance

No existen todavía, y la interfaz no los muestra ni los insinúa: Pendientes,
buscar en el historial, la configuración completa, el compositor y los mensajes
de personas, la IA más allá de interpretar una pregunta, las acciones sobre el ERP ("Ver diferencias", "Abrir en
ERP"), las notificaciones y cualquier actualización en vivo (WebSocket, SSE o
refresco periódico). La recarga por versión no es eso: no trae datos, solo
reemplaza el JS de un despliegue viejo, y solo en los dos momentos de arriba.

De las acciones rápidas del diseño existe solo "Ventas", y solo para hoy; otros
períodos (ayer, rango) y las ventas de todos los locales se piden con una
pregunta (Tanda 6A), no con un chip. No existen: los chips Caja,
Transferencias, Pedidos y Stock; "Ver detalle" y "Comparar" en la tarjeta de
ventas; y el chip "Ventas" en General.
