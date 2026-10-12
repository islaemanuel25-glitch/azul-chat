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
- **Buscar (Tanda 10).** Figma pantalla 05, "Buscar historial" (1:241–1:270).
  La lupa "⌕" del encabezado de un Local y de General abre Buscar en ESE chat:
  título "Buscar", el nombre del local (o "General") debajo, y "Volver al
  chat". Debajo, el campo ("Número o texto", el mismo de la caja de
  preguntas), las pills Todos · Transferencias · Pedidos · Preguntas (los
  chips de la lista), el contador "N resultados" —el total de la búsqueda, no
  lo cargado— y la lista, del más nuevo al más viejo con un separador por día.
  Cada resultado es la MISMA tarjeta del chat: el evento (`TarjetaEvento`) o la
  pregunta guardada como foto (`PreguntaGuardadaVista`); en General, con el
  local arriba ("General" si la pregunta se hizo ahí). Busca al enviar (botón
  o Enter), nunca mientras se escribe; cambiar de pill vuelve a buscar el
  mismo texto. Hasta 50 y "Ver más". Sin resultados: "No encontré «X».".
  Antes de buscar: "Buscá por número de transferencia o de pedido, o por
  texto.". Una falla reemplaza los resultados, con los mismos estados que la
  conversación. No lleva al punto del historial. Las pills del diseño "Caja"
  y "Ventas" no están: caja y ventas no se guardan, así que no hay nada que
  buscar. Qué encuentra cada texto: `docs/CHATS.md`, `GET /api/chats/buscar`.
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
- **Cajas de hoy (Tanda 7B).** Si `chats/local` trae `local.caja: true`, la
  barra lleva un segundo chip, "Caja", al lado de "Ventas" (Figma nodo 1:144);
  sin el anuncio no está, y un local puede tener uno solo de los dos. Tocarlo
  pide `GET /api/chats/caja` y aparece al final del historial la tarjeta
  "Cajas de hoy · {local}". El Figma no la dibuja: está armada con las MISMAS
  piezas y tokens que la de Ventas (`ac-ventas`, `SubtituloDeTarjeta`, las
  líneas de medio), sin colores nuevos. Una sección por turno operativo con
  "{turno} · {total vendido del turno}"; dentro, cada caja como fila PLEGADA
  (`<details>`): "{operador} · Abierta | Correcta | Falta $ X | Sobra $ X" y su
  total vendido. Al tocarla se despliega: una línea por medio (Efectivo,
  Débito…), el fiado aparte con "· no cobrado"; "Retiros", una línea por retiro
  "monto · motivo · a quién · hora" (a quién solo si viene) o "Sin retiros";
  "Ingresos" si hay; y "Cierre": Efectivo esperado, Efectivo contado, Retirado
  al cierre y Fondo que quedó. Una caja abierta no tiene cierre: dice "Caja
  abierta". "Tesorería: Verificada" o "Tesorería: Falta verificar" solo cuando
  aplica, como dato aparte. "Sin turno asignado" va al final, en el tono suave.
  La diferencia es de CADA caja: no hay diferencia por turno ni por local, y
  nada la compensa. Los estados son los de Ventas: "Consultando cajas…" en el
  chip, la tarjeta de error con "Reintentar" a mano y el texto del cupo con su
  espera (`TarjetaCajas` y `ResultadoCaja`, en `Cajas.tsx`; `useCaja`, en
  `Conversacion.tsx`; `reducirCaja`, en `logica.ts`; los textos, en
  `formato.ts`).
- **Bajo mínimo (Tanda 8B).** Si `chats/local` trae `local.stock: true`, la
  barra lleva el chip "Stock" después de "Ventas" y "Caja" (Figma nodo 1:150);
  sin el anuncio no está. Tocarlo pide `GET /api/chats/stock` y aparece al
  final del historial la tarjeta "Bajo mínimo · {local}". El Figma no la
  dibuja: está armada con las MISMAS piezas y tokens que Ventas y Caja
  (`ac-ventas`), sin colores nuevos. Dice "{total} productos por debajo del
  mínimo" ("1 producto…" en singular), muestra los primeros 10 —"{nombre} ·
  {lo que hay} · mín. {mínimo}"— y, si vinieron más, "Ver todos ({n})" los
  despliega (`<details>`, hasta 50, lo que manda el ERP); si el ERP tiene más
  de 50, "Se muestran 50 de {total}.". "Lo que hay" es la `equivalencia` del
  ERP, el texto de su pantalla de stock ("3 uds", "2 bultos + 6 uds"), con
  los números en es-AR (Tanda 8C): el ERP manda punto decimal y sin miles, y
  "-613.826 kg" se leería como miles; acá dice "-613,826 kg", "-0,775 kg",
  "1.250,5 kg", "1.250 uds". `formatearEquivalencia` (en `formato.ts`) lo
  lee de forma estricta —número y unidad (kg, uds, pzs, bulto, bultos),
  partes unidas por " + ", decimales solo en kg— y un texto que no tiene esa
  forma se muestra tal cual. Es solo presentación: lo que manda el ERP y lo
  que se guarda no cambian, y vale igual en la tarjeta de producto, en la de
  todos y en las preguntas guardadas. Los negativos se muestran como vienen y
  en el orden del ERP. Sin mínimo cargado en el local: "Este local no tiene stock mínimo
  cargado."; con mínimo y nada por debajo: "Nada por debajo del mínimo.". Los
  estados son los de Ventas: "Consultando stock…" en el chip, la tarjeta de
  error con "Reintentar" a mano y el texto del cupo con su espera
  (`TarjetaBajoMinimo` y `ResultadoStock`, en `Stock.tsx`; `useStock`, en
  `Conversacion.tsx`; `reducirStock`, en `logica.ts`; los textos, en
  `formato.ts`).
- **Pendientes (Tanda 9B).** Figma "Azul Chat — Mobile V1", pantalla 04
  "Pendientes" (nodos 1:204-1:240). Si `chats/local` trae
  `local.pendientes: true` (el local anuncia `pedidos_pendientes` o
  `cajas_resumen`), la barra lleva el chip "Pendientes" al final, después de
  "Stock". En General, si `chats/general` trae `pendientes: true` (algún local
  lo anuncia), la barra de General lleva el mismo chip —General no tenía
  chips: es el primero—, con la caja de preguntas debajo si hay IA. Tocarlo
  pide `GET /api/chats/pendientes?localId=N` (o `/general`) y aparece al final
  la tarjeta "Pendientes · {local}" (o "Pendientes · Todos los locales", con
  una sección por local y los que no tienen nada al final). No se guarda,
  como Ventas. Cada fila lleva su pill: IMPORTANTE con la marca de alerta de
  siempre (borde y fondo de alerta, la de "recibida con diferencias" y "bajo
  mínimo"), NORMAL con el tono suave; sin colores nuevos. IMPORTANTE arriba y,
  dentro de cada grupo, lo más viejo primero (lo ordena el servidor). Las
  filas:
  - pedido: "Pedido #N", "Pendiente de envío · desde hace {X días | Y h}" (con
    menos de una hora, "menos de 1 h") y "A {origen} · {k} línea(s)";
  - caja: "Caja de {operador} · {Turno} · {hoy | ayer}" (sin operador, el
    nombre de la caja del ERP; "Sin turno asignado" como está) y "Falta $ …",
    "Sobra $ …" o "Falta verificar en Tesorería".
  Sin pendientes: "Nada pendiente en {local}.". Si una fuente no contestó,
  debajo del título: "No se pudo consultar: los pedidos, las cajas de hoy… La
  lista puede estar incompleta." y lo que sí llegó. Sin los botones "Ver
  detalle" / "Abrir en ERP" del Figma: todavía no hay a dónde llevar. Los
  estados son los de Ventas: "Consultando pendientes…" en el chip, la tarjeta
  de error con "Reintentar" a mano y el texto del cupo con su espera
  (`TarjetaPendientes`, `TarjetaPendientesTodos` y `ResultadoPendientes`, en
  `Pendientes.tsx`; `usePendientes`, en `Conversacion.tsx`;
  `reducirPendientes`, en `logica.ts`; los textos, en `formato.ts`).

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
  - caja (Tanda 7B): la misma tarjeta de cajas del día ("Cajas de hoy",
    "Cajas de ayer" o "Cajas del 11/10 · {local}"), una por local si es de
    todos, con cuáles no se pudieron consultar;
  - stock (Tanda 8B): de un producto, "Stock de «{texto}» · {local}" con una
    fila por resultado —nombre; código · lo que hay · mín. {mínimo}— y, si
    está bajo mínimo, "⚠ Bajo mínimo" con la MISMA marca de alerta que
    "recibida con diferencias" (`ac-evento__marca`) y el borde de alerta; si
    el ERP encontró más de 10, "Hay más coincidencias: escribí el nombre más
    completo."; si ninguno, "No encontré «{texto}» en {local}.". Lo que hay es
    la equivalencia del ERP o, si no viniera, la existencia con su unidad. De
    bajo mínimo, la tarjeta del chip. De todos: UNA tarjeta ("… · Todos los
    locales") con una sección por local, cada uno con lo suyo, sin sumas, y
    cuáles no se pudieron consultar;
  - pendientes (Tanda 9B): la misma tarjeta que el chip, de un local o de
    todos;
  - ventas de un turno (Tanda 7B): "Turno {turno} · {período} · {local}" (si
    el nombre del turno ya empieza con "turno", sin repetirlo: "Turno mañana",
    no "Turno Turno mañana"; Tanda 8B, `nombreDeTurno`), el
    total del turno por medio y debajo sus cajas; de todos, la suma por medio
    y una sección por local, sin total si falta alguno. Si el turno no está
    entre los del día, arriba el aviso fijo "No encontré el turno «{texto}».
    Estos son los turnos del día." (`avisoTurnoNoEncontrado`) y todos los
    turnos;
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

  En el navegador no se guarda nada: desde la Tanda 6C las guarda el servidor
  y vuelven con el historial (abajo). No marcan leído y no agregan chips. Una por vez: mientras una espera, no se manda otra (`usePreguntas` y
  `ListaDePreguntas`, en `Preguntas.tsx`; `reducirPreguntas`, en `logica.ts`;
  la decisión de mostrar la caja, en `AccionesDelLocal` y `AccionesDeGeneral`,
  por `iaDisponible`).

- **Preguntas guardadas (Tanda 6C).** Al volver a entrar a un Local o a
  General, las preguntas que la persona hizo ahí aparecen en el historial,
  intercaladas por hora con los eventos: la burbuja propia con la hora, la
  tarjeta tal cual se vio entonces y, debajo, "Respuesta del 7/10 a las
  10:00": es una foto, no se recalcula. Una falla guardada se muestra sin
  "Reintentar". Una pregunta recién hecha va al final como siempre y, si el
  historial ya la trae (por su `guardadaId`), no se repite. "Cargar
  anteriores" trae preguntas y eventos más viejos juntos. Un chat con
  preguntas guardadas y sin eventos no dice que está vacío
  (`PreguntaGuardadaVista` en `Preguntas.tsx`; `elementosEnOrden` y
  `sinLasGuardadas` en `logica.ts`).

- **Versión (Tanda 6E).** Al pie del panel que abre ☰, debajo de "Ver chats"
  y "Cerrar sesión", una línea chica: "Versión " y los primeros 7 caracteres
  del commit con que se armó la página. Es la misma referencia que usa la
  recarga por versión (el `commit` que `src/app/page.tsx` le pasa a la app):
  no se le pide nada al servidor. Sirve para ver a simple vista si el teléfono
  tomó un despliegue. Sin commit (desarrollo), no se muestra
  (`VersionDeLaPagina`, en `PanelSesion.tsx`).

- **Notificaciones (Tanda 5A).** En el panel que abre ☰, debajo de los locales,
  una sección "Notificaciones" con UNA fila (Figma pantalla 06, nodo 1:277,
  adaptada): "Avisos en este teléfono", el estado ("Activadas" /
  "Desactivadas") y el botón para cambiarlo. Si el navegador las bloqueó, lo
  dice en una línea y no ofrece un botón que no puede andar (desde la Tanda
  11, con el estado real y el horario de silencio: ver Configuración). Con los
  tokens de siempre, sin colores escritos (`FilaNotificaciones.tsx`; la lógica,
  en `components/push/notificaciones.ts`).

- **Configuración (Tanda 11).** Figma pantalla 06 (1:271–1:315), dentro del
  mismo panel ☰ y debajo de "Ver chats", en tres secciones
  (`components/sesion/Configuracion.tsx`); "Versión" sigue al pie.
  - *Notificaciones.* El estado es el REAL: con una suscripción en el
    navegador, el panel le pregunta al servidor (`GET /api/push/estado`) si la
    tiene para esta sesión. "Activadas" solo si la tiene. Si el navegador está
    suscripto y el servidor no —se cerró sesión, venció, o el servicio de push
    dijo 410—, "No están llegando", una línea que explica por qué y
    "Reactivar", que vuelve a mandar la MISMA suscripción sin pedir permiso. Ya
    no se vuelve a mandar sola al abrir el panel: el 11/10 eso hizo que el
    panel dijera "Activadas" sin que llegara nada.
  - *Horario de silencio,* debajo, en la misma sección: un interruptor
    (apagado por defecto) y, prendido, "Desde" y "Hasta" en horas enteras de
    Argentina; puede cruzar la medianoche (00 h a 07 h, 22 h a 07 h). La hora
    del otro extremo no se puede elegir. Se guarda al cambiarlo; si falla,
    vuelve a lo de antes y lo dice. Lo que llega en ese horario queda sin leer
    y no se avisa después.
  - *Inteligencia artificial,* solo si el servidor tiene la IA configurada:
    "Gastado este mes: US$ X de US$ {tope}", "Preguntas este mes: N" y, si una
    pregunta más ya no entra, "Saldo agotado hasta el 1/{mes siguiente}".
  - *Sesiones.* "Dispositivos": cuántas sesiones abiertas y, de cada una,
    "Este dispositivo" u "Otro dispositivo" y desde cuándo (Azul Chat no guarda
    la última actividad ni el navegador, así que no se muestran). "Cerrar las
    otras sesiones", solo si hay otras, y "Cerrar sesión": las dos piden una
    confirmación PROPIA de la app, en el lugar del botón, con "Cancelar"; la de
    cerrar sesión dice "¿Cerrar sesión en este teléfono? Vas a tener que volver
    a poner el código del ERP y las notificaciones de este teléfono se
    desactivan.". Nunca `confirm()` del navegador. La misma confirmación tiene
    el "Cerrar sesión" del panel cuando el ERP no responde.
  - No están "Privacidad del push" (los avisos no traen montos ni datos
    sensibles) ni "Sonidos y vibración" (los maneja el sistema del teléfono).

## Cómo se navega

La vista va en la consulta de la URL: `/`, `/?vista=local&localId=N` y
`/?vista=general`; desde la Tanda 10 también Buscar, `/?vista=buscar&localId=N`
(con `&nombre=…` si se conoce) y `/?vista=buscar&general=1`, cuya flecha
"Volver al chat" vuelve a ese Local o a General (con el "atrás" si la entrada
es de la app; si no, reemplaza la URL por la del chat). No hay segmentos de ruta (`test/frontera/rutas.test.ts` no
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

**Tanda 6C: la referencia es el commit de la página.** El 11/10, 13 minutos
después de desplegar `dda5b80`, un Android siguió con el JS anterior y no
recargó ni al volver a primer plano ni al abrir un chat. La causa: la
referencia era el commit que contestaba `/api/version` AL ARRANCAR. Cuando el
navegador vuelve a mostrar una página vieja —al restaurar la pestaña o la app,
o desde su caché, con el HTML viejo y sus chunks, que son inmutables—, ese JS
viejo arranca, pregunta, recibe el commit NUEVO y lo toma como suyo: desde ahí
toda comparación da "igual". `/api/version` ya contestaba `no-store` (y
Cloudflare `DYNAMIC`) y el service worker no intercepta pedidos: el dato era
fresco, la referencia era la equivocada. Ahora:

- la página `/` se arma en cada pedido (`force-dynamic`: Next contesta
  `Cache-Control: no-store`, así el navegador no guarda el HTML entre
  despliegues) y le pasa a la app el commit de la imagen que la sirvió
  (`src/app/page.tsx`). Se compara contra ESE: una página vieja que arranca
  con un servidor nuevo recarga en el arranque mismo. Sin commit (desarrollo),
  lo de antes;
- se vuelve a pedir `/api/version` en tres momentos de primer plano
  (`visibilitychange` → `visible`, `pageshow` —también la vuelta desde la
  caché de atrás/adelante— y `focus` de la ventana) y al abrir un chat (un
  Local o General; volver a la lista no). Nada de intervalos ni temporizadores;
- si el commit es otro, recarga, una sola vez. La recarga deja en la URL
  `#recarga=<commit>`: si después de recargar la página sigue sin ser esa
  versión, no se insiste por ese commit (sin bucle). La marca se borra al
  arrancar;
- si `/api/version` falla, tarda más de 5 s (lo corta el navegador con
  `AbortSignal.timeout`) o no trae un SHA completo, no pasa nada: ni recarga
  ni error. Se pide con `cache: "no-store"`;
- el service worker no tiene `fetch` y se actualiza solo: `skipWaiting` al
  instalarse y `clients.claim` al activarse;
- nada se guarda en el navegador. Un pedido en curso no se duplica.

**Tanda 6D: en cada respuesta.** Quedaba un hueco: quien se queda dentro de
un chat usando Ventas, Actualizar o preguntas no vuelve a primer plano ni abre
otro chat, así que no se comparaba nunca. Ahora:

- toda respuesta JSON de las rutas propias (`/api/chats*`, `/api/sesion*`,
  `/api/push*`, y también `/api/version` y `/api/salud`) trae la cabecera
  `X-Azul-Chat-Commit` con el commit de la imagen, el mismo valor que
  `/api/version`. La pone `json()` en `src/server/http/respuestas.ts`, por
  donde pasan todas; sin `APP_BUILD_ID` (desarrollo) no va;
- los tres clientes HTTP de la interfaz (`clienteChats.ts`, `PanelSesion.tsx`
  y `notificaciones.ts`) le pasan CADA respuesta a `anotarCommitDe`, buena o
  con falla. Si el commit no es el de la página, recarga con la misma marca
  anti-bucle;
- salvo que se pierda algo: con texto escrito en la caja de preguntas, o con
  una pregunta esperando su respuesta, la recarga queda retenida
  (`retenerRecarga`) y se hace apenas se libera: al vaciar la caja, o cuando
  llega la respuesta de la pregunta (que ya quedó guardada y vuelve con el
  historial). La pregunta retiene ANTES de mandarse, en el mismo toque en que
  la caja se vacía, así nunca hay un instante sin retención en el medio;
- sigue sin haber intervalos ni temporizadores: la recarga la dispara una
  respuesta o el cambio de la caja.

Está en `src/components/chats/version.ts` (sin React: recibe pedir, recargar,
el documento y la ventana), `pedirVersion` en `clienteChats.ts` y la conexión
en `AzulChat.tsx`. Los candados: `test/ui/version.test.ts` (con el caso del
11/10 y su contraprueba) y `test/frontera/recargaPorVersion.test.ts` (no-store
de `/api/version`, la página dinámica con su commit, el service worker; desde
la 6D, que cada método de cada ruta de chats, sesión y push conteste con la
cabecera, que cada `fetch` de los tres clientes pase por `anotarCommitDe` y
que la caja y la pregunta en curso retengan, cada uno con su contraprueba).

## App instalable y service worker (Tanda 5A)

Azul Chat se puede instalar en el teléfono: `/manifest.webmanifest`
(`src/app/manifest.ts`) con el nombre "Azul Chat", íconos propios
(`public/icono-*.png`, generados por `scripts/generar-iconos.mjs`) y los
colores de los tokens `--ac-color-marca` y `--ac-color-fondo`.

El service worker (`public/sw.js`) es mínimo a propósito: maneja `push`
(muestra el aviso) y `notificationclick` (abre o trae al frente Azul Chat en
ese local, y solo una URL `/?vista=local&localId=N` validada). **No tiene
`fetch`**: no intercepta ningún pedido, así que no puede servir JS viejo y la
recarga por versión sigue igual. Se registra recién al activar las
notificaciones, con `updateViaCache: "none"`.

**El orden de los avisos (Tanda 13).** Android puede entregar los push tarde y
desordenados: el 12/10 la apertura de un incidente llegó después de su
recuperación y, con la misma etiqueta, la pisó. Por eso lo ÚNICO que guarda el
service worker es, por etiqueta, la hora (`creadoEn`) del último aviso que
mostró, en una caché propia (`azul-chat-avisos-v1`) que no sirve nada. Un aviso
MÁS VIEJO que ese, con la misma etiqueta, no se muestra; uno igual o más nuevo,
sí (y reemplaza al anterior en la bandeja, como antes). Vale aunque la persona
haya borrado la notificación nueva o el service worker se haya reiniciado.
Etiquetas distintas no se tocan. Si leer la caché falla, o el aviso no trae
hora, se muestra: ante la duda, mostrar. La decisión es `decidirAviso`, pura.

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
  Transferencias o Pedidos —"Caja" (Tanda 7B), "Stock" (Tanda 8B) y
  "Pendientes" (Tanda 9B) existen, y solo en `Piezas.tsx`—; "Ventas de hoy" y "Ventas de ayer" se
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
  cliente de notificaciones con un navegador de mentira. Tanda 11: el estado
  real (servidor sí, no, sin respuesta; navegador sin suscripción) y
  "Reactivar" sin pedir permiso.
- `test/ui/configuracion.test.ts` (Tanda 11): el horario de silencio, el saldo
  de IA (normal, agotado, sin IA), los dispositivos y las dos confirmaciones,
  con "Cancelar" tocado de verdad (no cierra), y su cliente HTTP.
  `test/frontera/alcanceUi.test.ts`: "Horario de silencio" e "Inteligencia
  artificial" solo en `Configuracion.tsx`; "Privacidad del push", "Sonidos y
  vibración" y "Saldo asignado" siguen en rojo.
- `test/ui/chats.test.ts` (Tanda 5B, casos (d)): el texto del cupo en la lista,
  en un Local y en General, sin historial detrás; "Reintentar" deshabilitado
  con la espera y habilitado sin ella; la espera de 20 s solo tras un cupo;
  Ventas con el mismo texto y en espera; el cliente leyendo el 429; y el
  título con el nombre de la lista (por la URL), "Chat" sin él.
- `test/frontera/alcanceUi.test.ts` (Tanda 5A): el service worker solo escucha
  push y el toque, sin fetch, almacenamiento ni temporizadores, y desde la
  Tanda 13 con una sola caché, la de las horas de los avisos, que solo guarda
  una hora y se consulta antes de mostrar; service
  worker y Push API solo en su cliente; el manifest con los colores de los
  tokens; y los textos de la pantalla 06 que no existen siguen prohibidos.
- `test/unidad/serviceWorker.test.ts` (Tanda 13): corre el `public/sw.js` de
  verdad en `node:vm` y prueba el orden: apertura y recuperación en orden, la
  apertura vieja después de la recuperación (aunque se haya borrado o el
  service worker se haya reiniciado), la lectura que falla, etiquetas
  distintas y los avisos de eventos como antes.

- `test/ui/chats.test.ts` (Tanda 6A): sin IA no hay caja ni burbujas (con
  preguntas en curso igual); con IA, la caja debajo del chip y su texto en un
  Local y en General; la burbuja con la hora; cada respuesta (un local, todos,
  todos con uno caído y sin total, eventos con "y N más", no entendí, saldo
  agotado, las fallas con y sin espera); el cliente HTTP de la pregunta. Tanda
  6B: la plantilla del aviso (una, varias, día o período), el aviso arriba de
  la tarjeta de un local, de todos y de eventos, ninguno sin `noSeparaPor`, y
  la tarjeta de todos con "Por medio de pago" y "Por local" en su orden.

- `test/ui/chats.test.ts` (Tanda 6C): el orden del chat con empates de hora,
  la pregunta guardada dibujada en su lugar con "Respuesta del …", las fallas
  guardadas sin "Reintentar", un chat solo con preguntas no vacío, cargar
  anteriores sin repetir, y que una recién hecha no se repita.

- `test/ui/cajas.test.ts` (Tanda 7B): el chip con y sin el anuncio y su carga;
  la tarjeta sobre el fixture del ERP: turnos en orden con "Sin turno
  asignado" al final y suave, la fila plegada y desplegada, abierta, correcta,
  falta, sobra, sin retiros, retiros con y sin a quién, el fiado aparte, la
  Tesorería, y que las diferencias no se compensan; las respuestas de caja y de
  ventas por turno, el aviso de turno no encontrado, todos con un local
  faltante y la foto guardada. `test/frontera/alcanceUi.test.ts`: el chip
  "Caja" solo en `Piezas.tsx`.

- `test/ui/stock.test.ts` (Tanda 8B): la tarjeta de bajo mínimo sobre el
  fixture del ERP (con faltantes, más de 10 con "Ver todos", el tope de 50,
  sin mínimo, nada por debajo), la de productos (varios, uno, kg, bultos,
  ninguno, más coincidencias, la marca de bajo mínimo), el chip y sus estados,
  el cliente, las respuestas de un local y de todos, la foto guardada y
  "Turno Turno" con su contraprueba. `test/frontera/alcanceUi.test.ts`: el
  chip "Stock" solo en `Piezas.tsx`.
- `test/ui/pendientes.test.ts` (Tanda 9B): las plantillas (la antigüedad, la
  caja con y sin operador, "Sin turno asignado"), la tarjeta con los fixtures
  del ERP (pedidos de ccf2894, cajas de 14ae247) en el orden y con las pills,
  sin los botones del Figma, "Nada pendiente", la fuente que faltó, la de
  todos, el chip en el Local y en General (con y sin preguntas, y sin ningún
  local que lo anuncie), la falla y el cupo, el reductor, la respuesta de la
  pregunta, la foto guardada y el cliente. `test/frontera/alcanceUi.test.ts`:
  el chip "Pendientes" solo en `Piezas.tsx`, y "Ver detalle" sigue en rojo en
  la tarjeta.
- `test/ui/buscar.test.ts` (Tanda 10): leer el texto (número con y sin "#",
  entero dentro de una pregunta, sin acentos ni mayúsculas, largo y vacío), la
  pantalla en sus estados (antes de buscar, buscando, "No encontré «X».", con
  resultados y el contador del total, General con el local, "Ver más", las
  fallas), las pills, el campo que busca solo al enviar, la lupa del Local y de
  General (y sin ella, la contraprueba), la vista por la URL y "Volver al
  chat", el reductor y el cliente. `test/frontera/alcanceUi.test.ts`: el campo
  de Buscar es el segundo y último campo de los chats, uno solo en `Buscar.tsx`,
  y las pills "Transferencias" y "Pedidos" solo ahí; como chips de la barra
  siguen en rojo, igual que las pills "Caja" del diseño en Buscar.

## Fuera de alcance

No existen todavía, y la interfaz no los muestra ni los insinúa: ir desde un resultado de Buscar al punto del historial, buscar en caja o ventas, "Privacidad del push" y "Sonidos y vibración" de la configuración, el compositor y los mensajes
de personas, la IA más allá de interpretar una pregunta, las acciones sobre el ERP ("Ver diferencias", "Abrir en
ERP"), las notificaciones y cualquier actualización en vivo (WebSocket, SSE o
refresco periódico). La recarga por versión no es eso: no trae datos, solo
reemplaza el JS de un despliegue viejo, y solo en los dos momentos de arriba.

De las acciones rápidas del diseño existen "Ventas", "Caja" (Tanda 7B),
"Stock" (Tanda 8B, solo bajo mínimo) y "Pendientes" (Tanda 9B, también en
General), y solo para hoy; otros períodos (ayer, rango), los turnos, un
producto y todos los locales se piden con una pregunta (Tanda 6A), no con un
chip. No existen: los chips Transferencias y Pedidos en la barra del chat (existen
solo como pills de filtro de Buscar, Tanda 10); "Ver detalle" y
"Comparar" en la tarjeta de ventas; "Ver detalle" y "Abrir en ERP" en la de
pendientes; y los chips "Ventas", "Caja" y "Stock" en General.
