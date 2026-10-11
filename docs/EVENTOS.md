# Eventos del ERP en Azul Chat

Fundación de la Tanda 2. Describe lo que existe hoy en el servidor: el contrato
con el ERP, cómo se guardan los hechos, cómo se sincronizan y cómo se mide la
lectura. Las rutas que lo usan (lista de chats, Local, General y marcar
leído) están en `docs/CHATS.md`, y la interfaz que las usa en `docs/INTERFAZ.md`.

## Cuatro cosas distintas

- **Hecho operacional.** Un `Evento`: algo que pasó en el ERP. Se guarda UNA vez
  por instalación, sin dueño. Hay cuatro tipos, uno por capacidad del ERP:
  `TRANSFERENCIA_RECIBIDA` (`transferencias_eventos`, Tanda 2) y, desde la
  Tanda 4B, `PEDIDO_SOLICITADO` (`pedidos_eventos`), `TRANSFERENCIA_ENVIADA`
  (`envios_eventos`) y `TRANSFERENCIA_CANCELADA` (`cancelaciones_eventos`).
- **Visibilidad.** Quién puede ver los hechos de un local. NO se guarda: la
  decide el ERP en cada consulta, con `mi_alcance` vivo, que anuncia en cada
  local las capacidades que la persona puede usar hoy (`capacidades`, ERP
  25172fe). Tener eventos guardados de un local no autoriza a nadie a verlos.
- **Lectura.** Hasta dónde leyó cada persona, en `LecturaLocal`.
- **Conversación.** La de un local es la pareja (instalación, `erpLocalId`) y se
  deriva; General es una proyección sobre los locales autorizados en ese
  momento (`docs/CHATS.md`). Ninguna de las dos duplica eventos. No hay tabla de conversación.

## El ERP sigue siendo la autoridad

- El cliente pide cada capacidad de eventos por la misma frontera de siempre
  (`POST /api/integraciones/azul-chat/consultar`), firmada, con el token de
  delegación de la persona, con un método por capacidad
  (`transferenciasEventos`, `pedidosEventos`, `enviosEventos`,
  `cancelacionesEventos`). El ERP vuelve a autorizar cada página.
- `capacidades` de `mi_alcance` es un anuncio para armar la interfaz. No se
  guarda y no reemplaza la autorización del ERP. Una capacidad de eventos se
  ingiere en un local SOLO si `mi_alcance` la anuncia en ese local en esa
  solicitud, y de ese local la persona ve solo los tipos de las capacidades que
  tiene anunciadas: un `PEDIDO_SOLICITADO` guardado (porque otra persona lo
  trajo) no se le muestra ni se le cuenta a quien no tiene `pedidos_eventos`
  en ese local.
- **ERP no disponible: fallo cerrado (decisión P1).** Si no se puede verificar
  la autorización actual con el ERP, no se muestra historial operacional: ni
  autorización guardada, ni ventana de gracia, ni caída silenciosa a lo que
  haya en la base. La interfaz dice "ERP Azul no responde" y "Para ver el
  historial hace falta verificar tu acceso".

## Contrato con el ERP

Copiado del ERP desplegado en 25172fe. El fixture `test/fixtures/erp-25172fe.json`
lo genera `scripts/generar-fixture-erp.mjs` ejecutando `atenderSolicitud` del ERP
de punta a punta sobre los mismos bytes que manda Azul Chat; no se edita a mano.

Pedido: `capacidad`, `delegacion.token`, `alcance { grupoId, localId }` y
`parametros` con dos claves opcionales y ninguna otra: `desde` (exactamente
`{ fechaRecepcion, transferenciaId }`, tal como el ERP lo devolvió) y `limite`
(1 a 100).

Respuesta: `capacidad`, `version: 1`, `local`, `grupoId`, `hasta`, `eventos`,
`siguiente`, `hayMas`. Cada evento: `tipo`, `eventoId`, `transferenciaId`,
`fechaRecepcion`, `origen { id, nombre, esDeposito }`, `destino { id, nombre }`,
`tieneDiferencias`, `lineasConDiferencia`.

### Las tres capacidades de la Tanda 4B

Copiadas del ERP en producción en 76b9a71 (erpmanual PR #167,
`lib/integraciones/azul-chat/pedidosEventos.js`, `enviosEventos.js`,
`cancelacionesEventos.js` y el cursor común `cursorDeEventos.js`). El fixture
`test/fixtures/erp-76b9a71.json` es una copia sin tocar de
`docs/integraciones/azul-chat/erp-eventos-tanda-4a.json` de ese commit,
generado por el ERP ejecutando su puerta contra una base descartable.

Mismo pedido, misma respuesta y mismo cursor que `transferencias_eventos`
(`desde` con exactamente dos claves, `limite` 1 a 100, por defecto 50,
`siguiente` = el último devuelto o el mismo `desde`, `hayMas` por una fila de
más, nada más nuevo que `hasta` = ahora − 60 s, `version: 1`). Cambian los
nombres de las claves del cursor y la forma del evento:

- `pedidos_eventos` → `PEDIDO_SOLICITADO`: `pedidoId`, `fechaSolicitud`,
  `origen { id, nombre }`, `lineas`. Cursor `{ fechaSolicitud, pedidoId }`.
  Permiso `pedidos.ver`. Es del local que PIDIÓ. `lineas` es la cantidad de
  líneas AL LEER: dos lecturas pueden traer distinto número con la misma
  clave. Un pedido cancelado se BORRA en el ERP: no hay evento de cancelación
  de pedido; si Azul Chat ya lo guardó, lo conserva como historia.
- `envios_eventos` → `TRANSFERENCIA_ENVIADA`: `transferenciaId`, `fechaEnvio`,
  `origen { id, nombre }`, `lineas`, `pedidoId` (o null). Cursor
  `{ fechaEnvio, transferenciaId }`. Permiso `transferencias.ver`. Es del local
  DESTINO.
- `cancelaciones_eventos` → `TRANSFERENCIA_CANCELADA`: `transferenciaId`,
  `fechaCancelacion`, `origen { id, nombre }`, `pedidoId` (o null). Cursor
  `{ fechaCancelacion, transferenciaId }`. Permiso `transferencias.ver`. Es del
  local DESTINO. Las cancelaciones anteriores al 2026-08-20 no tienen fecha y
  no salen.

Ninguno de los tres trae `destino`: el local del evento es el de la respuesta,
que se comprueba igual al pedido.

## Validación antes de guardar

Una página se valida ENTERA antes de tocar la base. Si falla una sola cosa, es
`RESPUESTA_INVALIDA`: no se guarda nada de ella y el cursor no se mueve.

- Forma (`src/shared/erp/contrato.ts`, `esDatosEventosDe`, uno para las cuatro
  capacidades con el contrato de cada una): capacidad y versión; cada evento
  bien formado; `eventoId` igual a `<TIPO>:<id>:<fecha>`; orden estricto por
  (fecha, id); ningún evento más nuevo que `hasta`; `siguiente` igual al último
  evento; `hayMas` solo con eventos.
- Contra el pedido (`src/server/eventos/pagina.ts`, `validarPaginaDe`): el
  local es el pedido; en `TRANSFERENCIA_RECIBIDA`, el destino de TODOS los
  eventos es ese local; el primero viene después del `desde`; una página vacía
  repite el `desde`; no más eventos que el `limite`, y `hayMas` solo con la
  página llena.

## Evento

Columnas para indexar, payload para mostrar:

- `tipo`; `claveExterna` = `eventoId` del ERP; `erpLocalId` = destino;
  `erpReferenciaId` = transferencia; `fechaOperacion` = fecha de recepción.
- `payload` v1: `{ origen, destino, tieneDiferencias, lineasConDiferencia }`,
  con su guardián (`src/server/eventos/transferenciaRecibida.ts`). Se arma de
  cero: un campo de más del ERP no se guarda. Nada de permisos, roles, alcance,
  capacidades, token, sesión ni filas del ERP.
- Unique `(instalacionId, claveExterna)`. La base además exige que la clave de
  una `TRANSFERENCIA_RECIBIDA` coincida con su id y su fecha.

Los tres tipos de la Tanda 4B (`src/server/eventos/pedidosEnviosCancelaciones.ts`),
con el local de la respuesta como `erpLocalId`:

- `PEDIDO_SOLICITADO`: referencia = `pedidoId`, fecha = `fechaSolicitud`,
  payload v1 `{ origen { id, nombre }, lineas }`.
- `TRANSFERENCIA_ENVIADA`: referencia = `transferenciaId`, fecha =
  `fechaEnvio`, payload v1 `{ origen { id, nombre }, lineas, pedidoId }`.
- `TRANSFERENCIA_CANCELADA`: referencia = `transferenciaId`, fecha =
  `fechaCancelacion`, payload v1 `{ origen { id, nombre }, pedidoId }`.

La migración `20261011120000_eventos_pedidos_envios_cancelaciones` agrega los
tres valores al enum `TipoEvento`, amplía el CHECK de `CursorIngesta.capacidad`
a las cuatro capacidades y exige, como para las recepciones, que la clave de
cada tipo nuevo sea exactamente `<TIPO>:<id>:<fecha ISO>`. No toca filas
existentes.

**Identidad y foto.** La `claveExterna` identifica el hecho. Lo que está
guardado de un evento son dos cosas distintas:

- su IDENTIDAD: tipo, `erpLocalId`, `erpReferenciaId` y `fechaOperacion`. No
  puede contradecirse nunca;
- su FOTO (`payloadVersion` y `payload`): lo que se vio en la PRIMERA ingesta.
  Un cambio posterior de contenido no reescribe la historia: renombrar un local
  o que el ERP recalcule un conteo no toca los eventos ya guardados.

**Cuando una clave vuelve** (páginas solapadas, la misma página dos veces, un
cursor que retrocede), se compara con lo guardado, campo por campo y no por el
texto del JSON (`src/server/eventos/repetido.ts`):

- **Duplicado idéntico**: no pasa nada. Ni fila nueva, ni cambio, ni error.
- **Identidad contradictoria** (la misma clave con otro tipo, otro local, otra
  referencia u otra fecha): `EVENTO_CONTRADICTORIO`. La página ENTERA se
  deshace —tampoco entran los eventos nuevos que traía—, la fila guardada no
  se toca ni se mueve de local, el cursor no avanza y el código queda en
  `ultimoErrorCodigo`. Otra referencia u otra fecha bajo la misma clave ni
  siquiera llegan acá: el contrato exige que la clave sea `TIPO:id:fecha` y la
  base lo exige con un CHECK. El caso que sí puede llegar es el mismo evento
  en una página de OTRO local, porque el local no forma parte de la clave.
- **Misma identidad, otra foto**: no bloquea. Se conserva la primera foto, los
  eventos nuevos de la página entran, el cursor avanza y la diferencia queda en
  `ultimaDiferenciaContenidoClave` / `ultimaDiferenciaContenidoEn` del cursor.
  Ese diagnóstico no es un error —la sincronización salió bien— y por eso no va
  en `ultimoErrorCodigo`, que dice que la última sincronización falló y se
  limpia con un éxito; el diagnóstico de contenido no se limpia.
- **`PEDIDO_SOLICITADO` con otra cantidad de líneas**: es lo ESPERADO (el ERP
  cuenta las líneas al leer y el depósito puede ajustar un pedido Solicitado).
  Cuenta como duplicado idéntico: se conserva la foto de la primera vez y NO se
  anota como diferencia. El origen sí cuenta. Para los otros tipos, cualquier
  campo del payload cuenta, como siempre.

**Idempotencia y carreras.** Dentro de la transacción de la página: se insertan
las claves que faltan con `INSERT … ON CONFLICT DO NOTHING` y después se relee
y se compara CADA clave de la página. Si otra transacción está insertando la
misma clave, PostgreSQL espera a que termine; el índice único es la defensa
final y no hay ventana entre "consulto" y "guardo". Ignorar el duplicado no
decide nada: decide la comparación. La misma página dos veces, o páginas
solapadas, dejan una fila por evento.

**Reset-operativo.** El ERP borra transferencias y reinicia sus ids, así que un
`transferenciaId` puede volver con otra recepción. No se deduplica por id: la
clave lleva la fecha y las dos vidas son dos eventos. Un evento guardado no
desaparece porque el ERP borre la transferencia; queda como historia.

## Orden de operación y orden de ingesta

- `fechaOperacion` es cuándo pasó en el ERP. Sirve para mostrar.
- `Evento.id` es la secuencia de INGESTA: cuándo se enteró Azul Chat. La lectura
  se mide con esto. Dos eventos del mismo milisegundo se distinguen sin
  ambigüedad, y uno con fecha vieja que se conoce tarde cuenta como nuevo.

## CursorIngesta: un cursor por local y capacidad, compartido

Uno por (instalación, local, capacidad), para todas las personas: el mismo
evento no se baja una vez por persona. Guarda el `siguiente` del ERP **tal cual**;
nunca se arma un cursor ni se usa el reloj de Azul Chat para fabricarlo.

La maquinaria es UNA para las cuatro capacidades: `sincronizarEventosLocal`
(`src/server/eventos/ingesta.ts`), con la definición de cada capacidad en
`src/server/eventos/capacidades.ts` (contrato, tipo, cómo se pasa un evento a
fila). `sincronizarTransferenciasLocal` es la de siempre con la definición de
`transferencias_eventos`; `test/db/huellaTransferencias.test.ts` fija con un
sha256, tomado antes de generalizar, que las recepciones se ingieren
exactamente igual que antes. Cada capacidad tiene su fila de cursor: avanza,
falla y completa su backfill por separado.

La ingesta NO autoriza: recibe un local ya autorizado y una función que llama
al ERP con la delegación de quien pregunta. `sincronizarTransferenciasDeLaSesion`
la une con la sesión, para que un `VINCULO_NO_VALIDO` siga el flujo de siempre
(invalida el vínculo y revoca sus sesiones) y nada más lo haga.

Cada página es un ciclo:

1. **Arriendo**: un UPDATE atómico toma la fila solo si está libre o vencida
   (`arrendadoHasta` = ahora + 30 s, `arrendadoPor` = id de la ejecución). Si
   no se toma, no se llama al ERP. Sin Redis y sin transacción abierta durante
   la llamada.
2. Se llama al ERP con el cursor guardado.
3. Se valida la página entera.
4. Una transacción bloquea la fila y comprueba que el arriendo SIGA siendo
   propio; si otro lo tomó, se deshace todo y el cursor no avanza. Si es propio:
   guarda los eventos (con la comparación de claves repetidas de arriba),
   guarda el cursor, marca el backfill si corresponde, limpia el error anterior
   y suelta el arriendo.

Un fallo suelta el arriendo, deja el cursor quieto y anota el **código** en
`ultimoErrorCodigo` (nunca un mensaje). No hay reintentos automáticos:
`LIMITE_EXCEDIDO`, `ERP_INALCANZABLE` y `TIEMPO_AGOTADO` se informan y reintentar
lo decide la persona (o, desde la Tanda 5B, la corrida de fondo siguiente).
`NO_AUTORIZADO` no invalida el vínculo. Hasta 3 páginas por sincronización
—menos si al fondo le queda menos presupuesto—: una historia larga se completa
en varias corridas.

## Histórico y backfill

Sin cursor, el ERP devuelve la historia desde el evento más viejo. Mientras
`backfillCompletoEn` es null, todo lo que se ingiere es `historico = true`,
aunque lleve varias visitas. La primera página con `hayMas: false` completa el
backfill. Lo que entra después es `historico = false`, y lo histórico no cambia.

El backfill es POR CAPACIDAD: cuando un local empieza a anunciar una capacidad
nueva (o en el primer despliegue de la Tanda 4B), toda su historia entra como
`historico = true`, aunque se ingiera mucho después que lo nuevo de otra
capacidad del mismo local. Por eso puede haber eventos históricos con ids
mayores que eventos no leídos: un id alto no dice que un evento sea nuevo para
la persona, y la regla de no leído mira `historico` siempre.

## Lectura

`LecturaLocal (vinculoId, erpLocalId, leidoHastaEventoId)`, del Vinculo y no de
la sesión: dos dispositivos de la misma persona leen lo mismo.

- **No leído** = `historico = false` y `Evento.id > leidoHastaEventoId`, de los
  tipos que la persona puede ver hoy en ese local.
- **Línea de base**: la primera vez que una persona ve un local, su lectura se
  fija en el mayor `Evento.id` actual del local (0 si no hay). Todo lo anterior
  a su primera visita es historia para ella. Desde la Tanda 5B el pedido no
  ingiere, así que "actual" es lo que la corrida de fondo ya guardó; lo que
  traiga después cuenta como nuevo si no es histórico (`test/db/cupo.test.ts`).
- Avanzar la lectura nunca retrocede (GREATEST) y se recorta al mayor
  `Evento.id` que existe en el local.
- La instalación sale del vínculo: no se lee ni se marca sobre otra.

Marcar leído es `POST /api/chats/leido`, explícito, y antes de leer o marcar un
local la capa de chats lo verifica con `mi_alcance` vivo (`docs/CHATS.md`).

## Sincronización en segundo plano (Tanda 5A, única desde la 5B)

Hasta la Tanda 4B la ingesta corría solo cuando alguien abría la app. En la
5A se sumó un timer del VPS que llama cada 2 minutos a
`POST /api/interno/sincronizar` (`src/server/interno/`; instalación y por qué
cada 2 minutos, en `docs/DEPLOY.md`). **Desde la Tanda 5B es lo ÚNICO que
ingiere**: abrir la app compartía con esta corrida el cupo del ERP (30 por
persona en 60 s) y el 11/10 lo agotó (`docs/CHATS.md`). Ahora cada pedido del
navegador solo pide `mi_alcance` y lee la base.

No es una ingesta nueva: es un **disparador** de la que ya existe. Por cada
persona con el vínculo vigente y una sesión que valga (la más reciente; quien
cerró en todos lados no se sincroniza):

1. con su token, descifrado en el servidor como siempre, `mi_alcance` VIVO
   (`autorizacionViva`, la misma de las rutas de chats);
2. `sincronizarAutorizados`: frecuencia mínima por (local, capacidad) —lo que
   otra persona trajo en esta corrida no se vuelve a pedir—, arriendo, hasta 3
   páginas, backfill y las mismas reglas por código. `VINCULO_NO_VALIDO`
   invalida el vínculo y revoca sus sesiones (`delegarConContexto`, el mismo
   camino que una solicitud con cookie); caído, lento, cupo o `NO_AUTORIZADO`
   no;
3. los avisos push (abajo).

**El cupo (Tanda 5B).** Por persona, la corrida gasta como mucho
`PRESUPUESTO_FONDO_POR_PERSONA` = 18 consultas (`mi_alcance` + páginas): el
cupo del ERP es 30 y se le dejan 12 a la app abierta. Lo que no entra queda
para la corrida siguiente, sin anotar error. Si el ERP contesta
`LIMITE_EXCEDIDO` en cualquier consulta, la corrida se CORTA: no se le pide
nada más a nadie, las capacidades que esa persona tenía por delante quedan con
`ultimoErrorCodigo = LIMITE_EXCEDIDO` y la respuesta es 200 con
`cortadaPorCupo: true`. El orden de una corrida empieza por lo pendiente
(capacidades sin cursor, sin sincronizar o con `LIMITE_EXCEDIDO`) y después
por la sincronización buena más vieja; a igual, el de `mi_alcance`. Si en la
anterior entró todo, el orden se repite; si algo quedó afuera, va primero.

La respuesta y el renglón `tarea.sincronizar` dicen, además de lo de la 5A,
`cortadaPorCupo`, `personasConPendientes` y `consultasErp`.

Sin reintentos: lo que falla lo intenta la corrida siguiente. Dos corridas
seguidas no repiten nada: la segunda encuentra todo fresco.

**Qué ve el navegador.** "Actualización demorada" sale de los cursores que deja
esta corrida: un local está demorado si alguna capacidad anunciada no tiene
cursor, quedó con error o lleva más de 3 corridas (6 min) sin sincronizar
(`estadoDeLocales`, `docs/CHATS.md`).

## Avisos push (Tanda 5A)

Se avisa SOLO lo que una persona no vio y puede ver hoy. Por local, los eventos:

- con `historico = false`: nunca backfill, tampoco el de una capacidad recién
  anunciada;
- de un tipo que `mi_alcance` le anuncia HOY en ese local;
- con `Evento.id` por encima de su marca de avisos (`AvisoLocal`), sea la
  corrida de quien sea la que los ingirió;
- con `Evento.id` por encima de lo que ya LEYÓ: lo leído en la app no se avisa.

**Una sola vez.** `AvisoLocal (vinculoId, erpLocalId, avisadoHastaEventoId)` es
una marca de agua, como `LecturaLocal`: nace en el mayor `Evento.id` del local
(lo que ya había no es novedad) y en cada corrida pasa al tope con un UPDATE
condicionado a que siga donde se leyó; si otra corrida la movió primero, esta
no avisa nada de ese local. El aviso se manda después de mover la marca: si el
envío falla, no se reintenta. La marca avanza aunque no haya suscripción, así
activar las notificaciones no trae una avalancha de lo anterior.

**El texto**, agrupado por local y por corrida, con los mismos títulos de la
interfaz (`src/shared/chats/textos.ts`): un evento, "Casiano: Transferencia
#404 recibida con diferencias"; dos o más, "Casiano: 3 novedades". Título
"Azul Chat". Tocarlo abre `/?vista=local&localId=N`. Sin montos, productos ni
ids técnicos fuera del número del título.

**El envío** (`src/server/push/`): Web Push estándar. El cifrado (RFC 8291,
aes128gcm) y la firma VAPID (RFC 8292) los arma la librería `web-push`; el POST
lo hace Azul Chat con `fetch`, sin reintentos, sin redirecciones, con corte a
los 10 s y vencimiento de 12 horas en el servicio de push. Solo a endpoints de
los servicios de push de los navegadores (FCM, Mozilla, Apple, Windows): el
servidor le pega a esa URL, y una lista cerrada impide usarlo para llegar a
otro lado. Si el servicio contesta 404 o 410, la suscripción se borra; otro
error se anota (`ultimoErrorCodigo`) y la suscripción queda.

`PushSuscripcion` es de la SESIÓN del dispositivo (y por ella del vínculo):
cerrar sesión, que venza o que el vínculo se invalide corta sus avisos, y la
corrida siguiente la borra.

La migración es `20261011180000_push_suscripcion_y_avisos`: crea las dos tablas,
con CHECKs de forma (endpoint https, claves con la forma del navegador, error
con fecha y código juntos, marca no negativa). No toca datos.
