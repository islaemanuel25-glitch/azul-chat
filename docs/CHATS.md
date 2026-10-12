# La API de chats

Tanda 2B. Describe las rutas que usa la interfaz de Chats y lo que garantizan:
las cuatro de la Tanda 2B y, desde la Tanda 3A, `GET /api/chats/ventas`. La interfaz que las usa (Tanda 2C) está en `docs/INTERFAZ.md`. Lo que hay
debajo —eventos, ingesta, lectura— está en `docs/EVENTOS.md`.

El camino de cada solicitud es siempre el mismo:

sesión → `mi_alcance` vivo → capacidades de hoy → locales autorizados →
eventos guardados → lectura → respuesta.

Desde la Tanda 5B no hay sincronización en ese camino: lo nuevo del ERP lo
trae solo la corrida de fondo, y el pedido lee lo que ella guardó.

El código vive en `src/server/chats/` y los tipos públicos en
`src/shared/chats/api.ts`. Los candados están en `test/db/chats.test.ts`, que
ejerce las rutas con una sesión real contra PostgreSQL y el ERP de mentira con
estado (y corre la sincronización de fondo donde antes la disparaba el
pedido), en `test/db/cupo.test.ts` (el cupo del ERP, Tanda 5B) y en
`test/unidad/cursorChats.test.ts`.

## Autorización viva

Cada solicitud de chats —las tres de lectura y la de marcar leído— pide
`mi_alcance` al ERP con el token de la persona, UNA vez, y se queda con los
locales cuyo `capacidades` incluye al menos una capacidad de eventos:
`transferencias_eventos` y, desde la Tanda 4B, `pedidos_eventos`,
`envios_eventos` o `cancelaciones_eventos` (`localesAutorizadosAhora`, en
`autorizacion.ts`). De cada local se queda también CUÁLES anuncia: de ese
local, la persona ve solo los tipos de evento de esas capacidades
(`TRANSFERENCIA_RECIBIDA`, `PEDIDO_SOLICITADO`, `TRANSFERENCIA_ENVIADA`,
`TRANSFERENCIA_CANCELADA`), y solo esas se ingieren. Todo lo demás —historial,
último evento, no leídos, General— se restringe a ese conjunto, por local Y
por tipo.

- No hay caché de autorización. Ni `Evento`, ni `CursorIngesta`, ni
  `LecturaLocal`, ni `Vinculo`, ni `Sesion` prueban que alguien pueda ver un
  local. Tener eventos guardados de un local no autoriza a nadie a verlo.
- No se infiere nada de roles ni de territorio: un local que aparece en
  `mi_alcance` sin ninguna capacidad de eventos no forma parte de los chats y
  no se sincroniza nunca. Una capacidad no anunciada en un local no se pide al
  ERP en ese local, y lo que otra persona haya traído de ella no se muestra ni
  se cuenta.
- Una capacidad desconocida se ignora. Un `mi_alcance` sin `capacidades` (un
  ERP anterior a 25172fe) no autoriza ningún local.
- Quitar las capacidades saca el local en la solicitud siguiente; devolverlas
  lo restaura sin revincular, con la lectura que la persona tenía.
- Qué tipos ve la persona de cada local lo dice SOLO `mi_alcance` vivo (sus
  `capacidades`). Desde la Tanda 5B el pedido del navegador no ingiere, así
  que no se entera si el ERP le niega a la corrida de fondo una capacidad
  anunciada: esa capacidad no avanza, su cursor queda con `NO_AUTORIZADO` y el
  local se ve "Actualización demorada", con lo ya guardado. Quitar la
  capacidad en `mi_alcance` sí saca sus tipos en la solicitud siguiente.

## Fallo cerrado (P1)

Si `mi_alcance` no se puede comprobar —ERP caído, lento, cupo, respuesta que
no cumple el contrato— la solicitud falla entera y no lleva un solo evento: ni
autorización guardada, ni ventana de gracia, ni caída silenciosa a lo que haya
en la base. Tampoco se marca leído. La falla es `ERP_NO_DISPONIBLE`, salvo
cuando el ERP contestó LIMITE_EXCEDIDO: ahí es `ERP_CUPO_EXCEDIDO` (429), para
que la interfaz no diga "ERP Azul no responde" cuando sí respondió (Tanda 5B).

`VINCULO_NO_VALIDO` conserva su significado de siempre, venga de `mi_alcance` o
de cualquier capacidad de eventos: el vínculo se invalida, sus sesiones se revocan, la
cookie se borra y la respuesta es `SIN_SESION` con motivo `VINCULO_INVALIDO`.

## Quién trae lo nuevo: solo la sincronización de fondo (Tanda 5B)

Son dos cosas distintas y conviene no confundirlas:

- **Autorización:** se pide en cada solicitud del navegador, siempre: UNA
  `mi_alcance`, sin caché.
- **Ingesta:** la hace SOLO la sincronización de fondo
  (`POST /api/interno/sincronizar`, un timer cada 2 minutos; `docs/EVENTOS.md`).
  Ningún pedido del navegador —la lista, un local, General, marcar leído,
  "Actualizar"— llama al ERP para traer eventos: leen la base propia.

Por qué (11/10, visto en los logs de Chat y del ERP): abrir la app costaba 22 a
27 consultas (una `mi_alcance` y la ingesta de cada local y capacidad), la
corrida de fondo 21, y el cupo del ERP es de 30 por persona en una ventana fija
de 60 s. Las dos en el mismo minuto: 13 rechazos de la corrida, 10 de la app
(la persona tocó Reintentar 10 veces) y la pantalla "ERP Azul no responde".

Lo que cuesta ahora cada pedido del navegador, medido contra el ERP de
mentira (`test/db/chats.test.ts`, caso (a)): la lista, un local, una página
anterior, General, marcar leído y "Actualizar", 1 consulta cada uno
(`mi_alcance`); Ventas, 2 (`mi_alcance` y `ventas_resumen`); Caja (Tanda 7B),
2 (`mi_alcance` y `cajas_resumen`). La corrida de
fondo gasta como mucho 18 por persona y le deja 12 a la app: el cupo y el
presupuesto, con números, están en `docs/DEPLOY.md`.

## "Actualización demorada", desde los cursores

El estado de cada local (`sincronizacion`) sale de los cursores que dejó la
corrida de fondo, sin llamar al ERP (`estadoDeLocales`,
`src/server/chats/sincronizacion.ts`). Un local es `DEMORADA` si alguna de las
capacidades que `mi_alcance` le anuncia HOY:

- no tiene cursor todavía, o nunca se sincronizó bien (una capacidad recién
  anunciada lo está hasta la próxima corrida);
- quedó con un error en su última vez (`ultimoErrorCodigo`: ERP caído, cupo,
  contrato, contradicción, base, `NO_AUTORIZADO`); o
- se sincronizó bien por última vez hace más de
  `ANTIGUEDAD_MAXIMA_SINCRONIZACION_MS`: 3 corridas del timer
  (`CORRIDAS_TOLERADAS` × `PERIODO_SINCRONIZACION_MS`, 3 × 2 min = 6 min).
  Una corrida que se saltea no alcanza para avisar; tres seguidas, sí.

Si no, `AL_DIA`. El pedido no reintenta nada: lo que falló lo vuelve a
intentar la corrida siguiente. `PERIODO_SINCRONIZACION_MS` es el
`OnUnitActiveSec` del timer, y `test/frontera/produccion.test.ts` exige que
coincidan.

## La línea de base de lectura

La primera vez que una persona ve un local (la lista, General o el local), su
lectura se fija en el mayor `Evento.id` de ese local QUE YA ESTÁ en la base:
desde la Tanda 5B el pedido no trae nada antes. Lo que la corrida de fondo
trajo antes de esa primera vista es historia para la persona; lo que trae
después, si no es `historico`, cuenta como nuevo. Si la persona mira antes de
que el fondo haya traído nada, la base es 0 y el backfill que llega después no
cuenta, porque es `historico`. Lo fija `test/db/cupo.test.ts`, caso (f).

## Las rutas

Todas contestan JSON con `Cache-Control: no-store`. Los ids de evento salen
SIEMPRE como texto, porque son BIGINT y pueden pasar `Number.MAX_SAFE_INTEGER`.

### GET /api/chats

Sin parámetros. Devuelve `{ estado: "OK", usuario: { nombre }, general:
{ noLeidos, ultimoEvento }, locales }`.

Cada local trae `localId`, `nombre`, `esDeposito`, `ultimoEvento`, `noLeidos` y
`sincronizacion`. El orden es por el último evento, del más reciente al más
antiguo (por fecha y, a igual fecha, por id); los locales sin eventos van al
final, por nombre y después por id. **No** se ordena por no leídos.

`general` se deriva: sus no leídos son la suma de los locales y su último
evento es el más reciente entre ellos, con su local.

### GET /api/chats/local?localId=N[&cursor=C]

El historial de un local, 30 eventos por página, del más reciente al más
antiguo. Devuelve `{ estado: "OK", local: { localId, nombre, esDeposito, ventas, caja },
sincronizacion, noLeidos, leidoHasta, eventos, guardadas, siguiente, preguntas }`. `siguiente` es el
cursor de la página siguiente, o `null`.

`local.ventas` (Tanda 3A) es `true` si el `mi_alcance` de ESA solicitud anuncia
`ventas_resumen` en el local. Es un anuncio para mostrar el botón "Ventas", no
una autorización: `GET /api/chats/ventas` lo vuelve a decidir. Abrir el chat no
consulta ventas.

`local.caja` (Tanda 7B) es lo mismo para `cajas_resumen` y el botón "Caja":
un anuncio, que `GET /api/chats/caja` vuelve a decidir.

`preguntas` (Tanda 6A, también en General) es `true` si el servidor tiene la
IA configurada: es el anuncio de la caja de preguntas, no una autorización.

Un local que no está en los autorizados de ahora —por no tener la capacidad o
por no existir en el alcance— es `NO_AUTORIZADO` (403), sin distinguir cuál.

El local va por query y no como segmento de ruta (`/api/chats/locales/[localId]`)
porque la frontera de rutas no admite segmentos dinámicos en `src/app`
(`test/frontera/rutas.test.ts`). Cambiarlo es decidir aflojar ese candado.

### GET /api/chats/general[?cursor=C]

General es una **proyección**: la misma tabla de eventos, filtrada por los
locales autorizados de ahora. No hay un "local General" ni se copia nada. Un
evento de General es el mismo `Evento.id` que en su Local, con el mismo
contenido, más `local: { localId, nombre }`. Devuelve `{ estado: "OK",
noLeidos, eventos, guardadas, siguiente, localesDemorados, preguntas }`; `noLeidos` es la suma de los
locales.

### POST /api/chats/leido

Marcar leído es SIEMPRE explícito. Ningún GET marca nada.

Cuerpo exacto: `{ "marcas": [{ "localId": 3, "hastaEventoId": "123" }] }`, de 1
a 50 marcas, sin locales repetidos, con el id como texto. Controla el Origin,
como vincular y cerrar.

- Si UN local del pedido no está autorizado ahora, se rechaza el pedido entero
  (`NO_AUTORIZADO`) y no se marca ninguno.
- Se recorta al mayor `Evento.id` de ESE local: un id de otro local, o uno
  inventado, no adelanta lo que todavía no llegó.
- Nunca retrocede.
- Todas las marcas van en una transacción.

Devuelve `{ estado: "OK", lecturas: [{ localId, leidoHasta, noLeidos }] }`.
Marcar General leído es mandar una marca por cada local.

### GET /api/chats/ventas?localId=N

Tanda 3A. Las ventas de HOY de un local, como las calcula el ERP en esta
solicitud. Período fijo: `localId` es el único parámetro, y cualquier otro
(`periodo`, `grupoId`, uno repetido) es `SOLICITUD_INVALIDA` (400) antes de leer
la sesión.

1. Sesión obligatoria y `mi_alcance` vivo, como las demás. El local tiene que
   estar en el alcance de ahora y anunciar `ventas_resumen` (`conVentas`, en
   `autorizacion.ts`); si no, `NO_AUTORIZADO` (403), igual que `chats/local`, y
   el ERP no recibe la consulta de ventas. No hace falta `transferencias_eventos`.
2. `ventasResumenDeSesion` (`src/server/ventas/`) con `{ alcance: { grupoId,
   localId }, periodo: { tipo: "hoy" } }`. El `grupoId` es el que `mi_alcance`
   dio para ese local, nunca uno del navegador. El ERP vuelve a decidir.

Sin reintentos. Los errores del ERP se leen por código: `VINCULO_NO_VALIDO`
revoca como en el resto (401 con motivo, cookie borrada); caído, lento,
`NO_AUTORIZADO` o una respuesta fuera del contrato son `ERP_NO_DISPONIBLE`
(503) y la sesión queda como está. Una respuesta que no es del local, el grupo
o el período pedidos tampoco se muestra.

Devuelve `{ estado: "OK", local: { id, nombre }, periodo: { desde, hasta },
cantidadVentas, totalVendido, mediosDePago: [{ medio, etiqueta, total,
cantidadPagos }], advertencias: [{ codigo, mensaje }] }`. El nombre es el de
hoy, de `mi_alcance`; los números son los del ERP copiados campo por campo, y los
montos, su decimal en texto tal cual. No salen el token, el grupo, la zona
horaria ni la versión del contrato.

Nada se guarda: no toca `Evento`, `CursorIngesta` ni `LecturaLocal`, no
sincroniza y no marca leído. Por solicitud: una `mi_alcance` y una
`ventas_resumen`. Los candados están en `test/db/ventas.test.ts` y
`test/unidad/ventasChats.test.ts`.

### GET /api/chats/caja?localId=N

Tanda 7B. Las cajas de HOY de un local, agrupadas por turno operativo, como las
da `cajas_resumen` del ERP (14ae247). Mismo camino que ventas, con el mismo
código (`consultarLocalHoy` en `manejadores.ts`): `localId` es el único
parámetro; sesión y `mi_alcance` vivo; el local tiene que anunciar
`cajas_resumen` (`conCaja`) o es `NO_AUTORIZADO` (403) sin consultar cajas; el
`grupoId` sale de `mi_alcance`; `{ periodo: { tipo: "hoy" } }`, sin
`turnoOperativo`. Sin reintentos, errores por código como en ventas
(`LIMITE_EXCEDIDO` es `ERP_CUPO_EXCEDIDO`, 429); una respuesta de otro local,
grupo o período no se muestra.

Devuelve `{ estado: "OK", local: { id, nombre }, fecha, turnos, advertencias }`.
Cada turno: `{ turno: { id, nombre }, sinTurnoAsignado, totales, cajas }`, con
"Sin turno asignado" al final (`id` null), como lo ordena el ERP. Los totales
del turno son los del ERP (suma de sus cajas). Cada caja trae operador,
apertura, cierre o null, estado (`ABIERTA`, `CORRECTA`, `CON_DIFERENCIA`, y
`SIN_CONTEO` / `ANULADA`, que el contrato del ERP también define), ventas por
medio con el fiado aparte (`cobrado: false`, nunca dentro del total cobrado),
cantidad de ventas, retiros `{ monto, motivo, aQuien, hora, registradoPor }`,
ingresos, monto inicial, efectivo esperado y contado, diferencia
`{ monto, tipo: FALTA | SOBRA | NINGUNA }`, retirado y fondo al cierre, y
`verificacionTesoreria`. Todo copiado campo por campo; los montos, su decimal en
texto tal cual.

Las reglas del dueño que la forma sostiene: **la diferencia es de cada caja y
no se compensa entre operadores** (no hay diferencia por turno ni por local, y
el código no la suma nunca); digital no es efectivo; fiado no es cobrado; la
verificación de Tesorería es un dato aparte y no se mezcla con la diferencia
de caja.

Nada se guarda. Candados: `test/db/caja.test.ts`,
`test/unidad/cajasChats.test.ts` y `test/erp/cajasResumen.test.ts` (forma,
contra el fixture del ERP `test/fixtures/erp-14ae247.json`).

### POST /api/chats/preguntar

Tanda 6A. Una pregunta en lenguaje natural, desde un Local o desde General.
Cuerpo `{ pregunta, localId? }`: `pregunta` de 1 a 300 caracteres (sin contar
los espacios de los bordes), `localId` solo si se pregunta desde un Local; otra
clave es `SOLICITUD_INVALIDA` (400). Exige sesión y el Origin exacto de
`AZUL_CHAT_ORIGEN_PUBLICO` (`ORIGEN_NO_PERMITIDO`, 403), como marcar leído.

**La IA solo interpreta.** Recibe la pregunta, la fecha de hoy en Argentina, el
nombre del local desde el que se pregunta y los NOMBRES de los locales
autorizados hoy. Nada más: ni ventas, ni eventos, ni ids. Devuelve UNA
intención por salida estructurada, contra un esquema cerrado:
`ventas` (un local o "todos"; hoy, ayer o rango), `caja` (Tanda 7B: un local
o "todos"; un solo día: hoy, ayer o una fecha), `eventos` (recibidas,
recibidas con diferencias, enviadas, pedidos o cancelaciones; un local o
"todos"; hoy, ayer o rango) o `no_entiendo`. Elige el local por su nombre, de
una lista cerrada que el esquema le da (`enum`); el id lo pone el código. Todo
lo que se muestra lo arma el código: ningún texto ni número de la respuesta sale
del modelo.

**Lo que no se puede separar se dice (Tanda 6B).** `ventas_resumen` del ERP no
filtra por turno, ni por hora, ni por vendedor: "¿cuánto vendió el sábado el
turno tarde?" contestaba el día completo sin decirlo, que es un dato engañoso.
Ahora el esquema trae además `restriccionesNoSoportadas`, una lista cerrada
(`turno`, `hora`, `vendedor`, `producto`, `categoria`, `medio_de_pago`,
`cliente`; vacía si no pide nada de eso) que la IA completa con lo que la
pregunta pide separar. No cambia la intención: se contesta igual con el período
completo, y la respuesta de `VENTAS` o `EVENTOS` lleva `noSeparaPor`, la lista
de lo pedido que esa respuesta no separa, en el orden del catálogo. En ventas,
`medio_de_pago` no entra: el desglose por medio ya lo muestra. En eventos entra
todo. La interfaz convierte `noSeparaPor` en un aviso fijo; viajan códigos, no
textos. Un valor fuera del catálogo, o que no sea una lista, es `NO_ENTIENDO`.

**Turnos (Tanda 7B).** El esquema trae `turno`: texto libre corto (hasta 40
caracteres) o null. La IA lo copia de la pregunta ("tarde"); no conoce los
nombres de los turnos del local, ni ningún monto. El código pide
`cajas_resumen` del día entero y elige el turno contra los nombres que devolvió
el ERP: sin acentos ni mayúsculas, el nombre exacto gana y si no "contiene" en
los dos sentidos; "Sin turno asignado" no se elige por texto. Si no coincide
ninguno, o más de uno, se muestran todos los turnos del día con el aviso fijo
"No encontré el turno «{texto}». Estos son los turnos del día." (plantilla de la
interfaz). Azul Chat no le manda `turnoOperativo` al ERP, así que
`TURNO_OPERATIVO_INVALIDO` no llega por este camino; si llegara, es
`ERP_NO_DISPONIBLE`.

- `caja` con turno: la misma tarjeta de cajas del día, con solo ese turno.
  "¿Hubo retiros hoy?" o "¿cómo cerró la caja?" son `caja`.
- `ventas` con turno, de UN día y en locales con `cajas_resumen`: se contesta
  con `cajas_resumen` (`VENTAS_TURNO`): el total del turno por medio y sus
  cajas, y `turno` sale de `noSeparaPor` (o se separó, o el aviso de turno no
  encontrado lo dice; en ese caso se muestran todos los turnos y no hay total). En "todos", una
  consulta por local y la suma por código en centavos; si falta un local, se
  dice cuál y no hay total. Con un rango de días, o un local sin
  `cajas_resumen`, es ventas como antes con el aviso de que no separa por turno.

En orden:

1. Forma, Origin y cuerpo. Sin la clave de la IA (o mal configurada):
   `IA_NO_DISPONIBLE` (503) sin gastar nada; la interfaz ni muestra la caja,
   porque `chats/local` y `chats/general` traen `preguntas: false`.
2. `mi_alcance` vivo. El `localId`, si viene, tiene que estar en el alcance de
   hoy (`NO_AUTORIZADO`, 403).
3. El tope del mes (abajo): si no entra la reserva, `SALDO_AGOTADO` y no se
   llama a la IA.
4. La IA (`src/server/ia/gemini.ts`), una sola llamada, sin reintentos. Si no
   contesta: `IA_NO_DISPONIBLE` (503).
5. El código valida la intención (`src/server/preguntas/intencion.ts`): exactamente
   las ocho claves del esquema; el local, uno de los de hoy CON la capacidad que la
   intención necesita (`ventas_resumen`, `cajas_resumen` o la del tipo de evento);
   `caja` de un solo día; fechas reales,
   `desde` ≤ `hasta` y un rango de 31 días como mucho. Lo que no cierra es
   `NO_ENTIENDO`, con ejemplos fijos de lo que sí se puede preguntar.
6. La respuesta:
   - **Ventas de un local**: una `ventas_resumen` (`ventasResumenDeSesion`, la
     misma que `chats/ventas`), copiada campo por campo. Las fechas futuras las
     decide el ERP: si rechaza el período, es `NO_ENTIENDO`.
   - **Ventas de todos**: una `ventas_resumen` por cada local con la capacidad
     hoy, y el código suma total, cantidad y cada medio de pago en centavos
     enteros (sin coma flotante). Si alguno falla, la respuesta dice cuáles
     (`fallidos`) y NO trae total (`total: null`): un total parcial no se
     muestra como si fuera completo. Un rechazo por cupo corta las consultas que
     faltan.
   - **Eventos**: de la base propia, sin consultar al ERP. Solo de locales
     autorizados hoy con la capacidad del tipo, histórico incluido, por día de
     Argentina (`fechaOperacion`). La cantidad, los 10 más recientes y cuántos
     más hay (`restantes`, "y N más").
   - **Caja** y **ventas por turno**: arriba, "Turnos".

Estados: `VENTAS` (`alcance` `LOCAL` o `TODOS`) y `EVENTOS`, los dos con
`noSeparaPor`; `CAJA` y `VENTAS_TURNO` (Tanda 7B, `LOCAL` o `TODOS`, con
`turnoPedido`, `turnoNoEncontrado`, las cajas de cada local y, en `TODOS`,
`fallidos`; `VENTAS_TURNO` además `noSeparaPor` y, en `TODOS`, `total` o null);
`NO_ENTIENDO`,
`SALDO_AGOTADO` (200), `IA_NO_DISPONIBLE` (503), y las fallas de siempre:
`ERP_NO_DISPONIBLE` (503), `ERP_CUPO_EXCEDIDO` (429), `SIN_SESION`,
`NO_AUTORIZADO`, `SOLICITUD_INVALIDA`, `ORIGEN_NO_PERMITIDO`,
`SERVICIO_NO_DISPONIBLE`.

**Cupo del ERP por pregunta: 1 + N.** Una `mi_alcance` siempre; más una
`ventas_resumen` (o `cajas_resumen` en caja y ventas por turno) si es de un
local, o N si es de todos (N = locales con esa capacidad hoy). Eventos y `NO_ENTIENDO` gastan solo la `mi_alcance`. Con 5 locales, una
pregunta de "todos" gasta 6 del cupo de 120 por persona por minuto.

**El tope de gasto** (`src/server/ia/consumo.ts`, tabla `ConsumoIa`, una fila
por mes de Argentina). Antes de llamar se reserva el peor caso de una pregunta
(4000 tokens de entrada y 2048 de salida a la tarifa vigente: 10.680
millonésimas de dólar con la de hoy) con UN `INSERT … ON CONFLICT DO UPDATE`
condicionado a no pasar `AZUL_CHAT_IA_TOPE_USD`: dos preguntas a la vez no
pasan el tope entre las dos. Después se ajusta al uso real que informa Google.
Si Google no contestó, la reserva queda entera (no se sabe qué cobró). El tope
vuelve a cero el día 1, a las 00:00 de Argentina.

**La tarifa** (`src/server/ia/tarifa.ts`): modelo `gemini-3.6-flash`, el mismo
del ERP. Según https://ai.google.dev/gemini-api/docs/pricing ("Last updated
2026-10-09 UTC", leída el 2026-10-11): US$ 0,75 por millón de tokens de entrada
y US$ 3,75 por millón de salida (el razonamiento cuenta como salida) hasta el
2026-12-31; desde el 2027-01-01, US$ 1,50 y US$ 7,50. Los dos tramos están en el
código con su fecha. Una pregunta típica (unos 800 tokens de entrada y 200 de
salida) cuesta del orden de US$ 0,001 a 0,002; con el tope de US$ 5, unas
3.000 a 4.000 preguntas por mes. No está medido contra Google: es la cuenta con
la tarifa.

Desde la Tanda 6C la pregunta y su respuesta se guardan (abajo, "Preguntas
guardadas"); sigue sin marcar leído y sin crear chips. El registro (`ia.pregunta`) lleva resultado, duración, tokens y costo;
nunca la pregunta. Candados: `test/db/preguntas.test.ts` (Tanda 6B: ninguna
respuesta de ventas o eventos sale sin `noSeparaPor` cuando la intención trae
una restricción que no separa, recorriendo el catálogo entero).

## El evento público

Común a los cuatro tipos: `{ id, tipo, fecha, historico }`. Además, según `tipo`:

- `TRANSFERENCIA_RECIBIDA`: `transferenciaId, origen: { id, nombre, esDeposito },
  destino: { id, nombre }, tieneDiferencias, lineasConDiferencia`.
- `PEDIDO_SOLICITADO` (Tanda 4B): `pedidoId, origen: { id, nombre }, lineas`.
- `TRANSFERENCIA_ENVIADA` (Tanda 4B): `transferenciaId, origen: { id, nombre }, lineas`.
- `TRANSFERENCIA_CANCELADA` (Tanda 4B): `transferenciaId, origen: { id, nombre }`.

`id` es el `Evento.id` en texto y `fecha` es la `fechaOperacion` (cuándo pasó
en el ERP: recepción, solicitud, envío o cancelación). `historico` (Tanda 4B)
dice si el evento entró con el backfill de su capacidad: es un booleano y nada
más, y existe para que la interfaz cuente los no leídos con la misma regla que
el servidor (`docs/INTERFAZ.md`). No salen la instalación, la clave externa, la
versión, la fecha de ingesta, el `pedidoId` de un envío o una cancelación ni el
payload crudo. Un evento guardado que no se puede leer como la v1 de su tipo
no se muestra a medias: la solicitud falla con `SERVICIO_NO_DISPONIBLE`.

## No leídos

Por vínculo y por local, como en la fundación: `historico = false` y
`Evento.id > leidoHastaEventoId`, de los tipos que la persona puede ver hoy en
ese local. General es la suma.

- La primera vez que una persona ve un local, su lectura se fija en el mayor
  `Evento.id` que el local ya tiene en la base (ver "La línea de base de
  lectura"): lo que el fondo trajo antes de esa primera vista es historia para
  ella, no novedad.
- Lo que trae el backfill es histórico y no cuenta nunca. El backfill es por
  capacidad: la historia de una capacidad recién anunciada entra después que lo
  nuevo de otra, con ids MAYORES que no leídos reales, y tampoco cuenta.
- Dos sesiones de la misma persona comparten la lectura; otra persona no.
- La lectura se ordena por `Evento.id` (orden de ingesta) y el historial por
  fecha. Un evento con fecha vieja que se conoció tarde aparece en su lugar por
  fecha y cuenta como nuevo por id.

## Paginación

El historial se ordena por `(fechaOperacion desc, Evento.id desc)`, que es un
orden total aunque dos eventos compartan la fecha. El cursor es la posición del
último evento de la página, `{ f: fecha ISO, i: id }` en JSON y base64url.

**Tanda 6C: las preguntas guardadas van en la misma página.** Un Local y General
traen, además de `eventos`, `guardadas`: las preguntas guardadas de la persona
en ese chat. Se pagina UNA sola secuencia, eventos por `fechaOperacion` y
preguntas por `creadaEn`, del más reciente al más antiguo; a igual instante
va primero la pregunta y, entre dos del mismo tipo, el de id mayor. Es un orden
total, así que el cursor sigue siendo la posición del último elemento de la
página:

- si el último es un evento, el cursor es exactamente el de antes, `{ f, i }`:
  uno emitido antes del despliegue sigue valiendo igual;
- si es una pregunta, `{ f, i, t: "p" }`.

Cada página pide 31 de cada lado después del cursor, junta las dos listas en
ese orden y se queda con las primeras 30: lo que sobra vuelve en la página
siguiente, así que nada se repite ni se pierde (`paginaDeHistorial`, en
`src/server/chats/historial.ts`; lo recorre `test/db/preguntas.test.ts` de a 1,
2 y 3 por página, con empates de hora). Una página puede tener menos de 30
eventos porque lugares los ocupan preguntas; la lectura no cambia, porque
`noLeidos` y `leidoHasta` son solo de eventos.

Se valida estricto: exactamente esas dos claves (o las tres, con `t: "p"`), instante ISO válido, id entero
positivo que entra en un BIGINT, hasta 200 caracteres. Uno con otra forma es
`SOLICITUD_INVALIDA`, no se arregla. No lleva local ni instalación: no sirve
para salir de los locales autorizados, porque la consulta los filtra siempre
desde el servidor. No es el cursor del ERP, que nunca sale del servidor.

Los parámetros de la URL también son estrictos: uno de más o repetido es
`SOLICITUD_INVALIDA`, y lo mal formado se rechaza antes de llamar al ERP.

## Preguntas guardadas (Tanda 6C)

Pedido del dueño: "una vez que salgo y vuelvo a entrar no queda guardado".
Cada pregunta contestada se guarda en la tabla `Pregunta`
(`src/server/preguntas/guardadas.ts`) con exactamente la respuesta que vio la
pantalla, en JSON versionado (`resultadoVersion` 2 desde la Tanda 7B, que agrega `CAJA`
y `VENTAS_TURNO`; las de versión 1 se siguen leyendo, solo con sus estados). POST preguntar contesta,
además, `guardadaId`, para que la pantalla no la muestre dos veces cuando el
historial ya la trae.

- **Por persona y por chat.** Es del vínculo que preguntó, y del Local donde se
  preguntó (`erpLocalId`) o de General (null). Otra persona no la ve; en
  General no aparecen las de un Local ni al revés.
- **Qué se guarda.** Las respuestas que se dan una vez autorizada la persona:
  ventas, caja, ventas por turno, eventos, no entendí, saldo agotado, la IA caída, el ERP caído o sin
  cupo. Lo de antes de saber quién es (sin sesión, solicitud inválida, local
  ajeno) no se guarda. Si guardar falla, se contesta igual.
- **Una foto.** Al volver a verla no se recalcula nada; la pantalla dice cuándo
  fue la respuesta.
- **Fallo cerrado al mostrar.** Cada pregunta guarda sus `requisitos`: de qué
  locales trae datos y con qué capacidad (`ventas_resumen`, `cajas_resumen`
  para caja y ventas por turno, o la del tipo de evento). Para mostrarla, todos tienen que seguir anunciados hoy por
  `mi_alcance`; si uno no, se oculta (no se borra: si mañana vuelve, se ve).
  Un requisito ilegible también la oculta. Las que no traen datos de locales
  (no entendí, saldo, IA caída) se ven en su chat mientras la persona lo pueda
  abrir.
- **No son eventos.** No cuentan como no leídos, no disparan push y no marcan
  leído: nada de eso mira esta tabla.
- **Retención: 90 días.** La lectura ya no muestra las más viejas, y la
  corrida de fondo (`POST /api/interno/sincronizar`) las borra al empezar, sin
  tocar otra tabla (`preguntasBorradas` en su resumen).

## Errores públicos

Solo un estado, sin mensaje, stack, URL interna, respuesta del ERP ni token:

- `SIN_SESION` (401), con `motivo: "VINCULO_INVALIDO"` si el ERP revocó el
  vínculo. Si había cookie, se borra.
- `NO_AUTORIZADO` (403): el local no está autorizado ahora, o el ERP negó
  `mi_alcance`. (En ventas, un `NO_AUTORIZADO` del ERP a la consulta de ventas
  es `ERP_NO_DISPONIBLE`.)
- `ORIGEN_NO_PERMITIDO` (403): marcar leído desde otro origen.
- `SOLICITUD_INVALIDA` (400).
- `ERP_NO_DISPONIBLE` (503): no se pudo comprobar la autorización. Sin
  historial. En ventas, además, el ERP no dio unas ventas que se puedan mostrar.
- `ERP_CUPO_EXCEDIDO` (429, Tanda 5B): el ERP contestó LIMITE_EXCEDIDO, en
  `mi_alcance` o, en ventas y caja, en `ventas_resumen` / `cajas_resumen`. Sin historial, igual que el
  anterior; la interfaz lo dice con su propio texto.
- `SERVICIO_NO_DISPONIBLE` (503): configuración o base.
- En preguntas (Tanda 6A), además: `NO_ENTIENDO` y `SALDO_AGOTADO` (200) y
  `IA_NO_DISPONIBLE` (503). No son fallas del ERP: el resto sigue andando.

Un local demorado no es un error: es `sincronizacion: "DEMORADA"` dentro de una
respuesta buena.

## Notificaciones push (Tanda 5A)

Tres rutas más, ninguna llama al ERP:

- `GET /api/push/clave`: `{ estado: "OK", clave }`, la clave pública VAPID
  (no es secreta; no va por `NEXT_PUBLIC_`). Sin claves configuradas, 503
  `NO_DISPONIBLE`.
- `POST /api/push/suscribir`: el cuerpo es `PushSubscription.toJSON()`
  (`endpoint`, `expirationTime`, `keys { p256dh, auth }`), exacto. Sesión y
  Origin, como vincular. El endpoint tiene que ser https, sin usuario ni
  puerto, de un servicio de push conocido; si no, `SOLICITUD_INVALIDA`. Queda
  colgada de la sesión de la solicitud; el mismo endpoint otra vez la actualiza.
- `DELETE /api/push/suscribir`: `{ endpoint }`. Borra solo una suscripción de
  la persona de la sesión.

Qué se avisa y cuándo lo decide la sincronización de fondo, con `mi_alcance`
vivo en cada corrida (`docs/EVENTOS.md`): guardar una suscripción no autoriza
nada.

`POST /api/interno/sincronizar` no es del navegador ni de esta API: es del timer
del VPS, por 127.0.0.1 y con su secreto; a todo lo demás le contesta 404
(`docs/DEPLOY.md`).
