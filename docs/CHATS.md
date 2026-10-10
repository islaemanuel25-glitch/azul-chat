# La API de chats

Tanda 2B. Describe las rutas que usa la interfaz de Chats y lo que garantizan:
las cuatro de la Tanda 2B y, desde la Tanda 3A, `GET /api/chats/ventas`. La interfaz que las usa (Tanda 2C) está en `docs/INTERFAZ.md`. Lo que hay
debajo —eventos, ingesta, lectura— está en `docs/EVENTOS.md`.

El camino de cada solicitud es siempre el mismo:

sesión → `mi_alcance` vivo → capacidades de hoy → locales autorizados →
sincronización → eventos guardados → lectura → respuesta.

El código vive en `src/server/chats/` y los tipos públicos en
`src/shared/chats/api.ts`. Los candados están en `test/db/chats.test.ts`, que
ejerce las rutas con una sesión real contra PostgreSQL y el ERP de mentira con
estado, y en `test/unidad/cursorChats.test.ts`.

## Autorización viva

Cada solicitud de chats —las tres de lectura y la de marcar leído— pide
`mi_alcance` al ERP con el token de la persona, UNA vez, y se queda con los
locales cuyo `capacidades` incluye `transferencias_eventos`
(`localesAutorizadosAhora`, en `autorizacion.ts`). Todo lo demás se restringe a
ese conjunto.

- No hay caché de autorización. Ni `Evento`, ni `CursorIngesta`, ni
  `LecturaLocal`, ni `Vinculo`, ni `Sesion` prueban que alguien pueda ver un
  local. Tener eventos guardados de un local no autoriza a nadie a verlo.
- No se infiere nada de roles ni de territorio: un local que aparece en
  `mi_alcance` sin la capacidad no forma parte de los chats y no se sincroniza
  nunca.
- Una capacidad desconocida se ignora. Un `mi_alcance` sin `capacidades` (un
  ERP anterior a 25172fe) no autoriza ningún local.
- Quitar la capacidad saca el local en la solicitud siguiente; devolverla lo
  restaura sin revincular, con la lectura que la persona tenía.
- Si al sincronizar el ERP niega `transferencias_eventos` a un local que
  `mi_alcance` anunció (algo cambió entre las dos llamadas), ese local sale de
  la respuesta: fallo cerrado para él.

## Fallo cerrado (P1)

Si `mi_alcance` no se puede comprobar —ERP caído, lento, cupo, respuesta que
no cumple el contrato— la solicitud falla entera con `ERP_NO_DISPONIBLE` y no
lleva un solo evento: ni autorización guardada, ni ventana de gracia, ni caída
silenciosa a lo que haya en la base. Tampoco se marca leído.

`VINCULO_NO_VALIDO` conserva su significado de siempre, venga de `mi_alcance` o
de `transferencias_eventos`: el vínculo se invalida, sus sesiones se revocan, la
cookie se borra y la respuesta es `SIN_SESION` con motivo `VINCULO_INVALIDO`.

## Frecuencia de ingesta, que no es autorización

Son dos cosas distintas y conviene no confundirlas:

- **Autorización:** se pide en cada solicitud, siempre.
- **Ingesta:** si un local se sincronizó bien hace menos de 30 s
  (`FRECUENCIA_MINIMA_INGESTA_MS`, contra `CursorIngesta.ultimaSincronizacionEn`),
  no se vuelve a pedir `transferencias_eventos`: se usa lo guardado. Es seguro
  porque solo decide qué tan fresco está lo guardado, nunca quién lo ve.

El cursor de ingesta es de la instalación, no de la persona: si una persona
acaba de sincronizar Casiano, la siguiente que lo mire dentro de los 30 s no lo
vuelve a pedir, pero sí pide su propio `mi_alcance`.

Un local vencido se sincroniza con la ingesta de la fundación tal cual:
arriendo, hasta 3 páginas de 100, cursor y backfill. No hay worker, cron,
polling ni Redis: solo se sincroniza cuando una persona pide los chats, y solo
los locales que esa solicitud necesita (la lista y General, todos; un local,
ese). Marcar leído no sincroniza.

Por solicitud, entonces: una `mi_alcance` y, como mucho, una sincronización por
local autorizado y vencido.

## Si falla la ingesta de un local

Cuando la autorización de ahora ya se comprobó, que falle la ingesta de un local
—ERP caído para esa llamada, cupo, contrato, contradicción, base— no le quita
nada a los demás ni al historial ya guardado de ese local. El local queda con
`sincronizacion: "DEMORADA"` y muestra lo que había; los demás siguen
`AL_DIA`. Una falla no deja al local fresco: la solicitud siguiente lo vuelve a
intentar. No hay reintentos automáticos.

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
antiguo. Devuelve `{ estado: "OK", local: { localId, nombre, esDeposito, ventas },
sincronizacion, noLeidos, leidoHasta, eventos, siguiente }`. `siguiente` es el
cursor de la página siguiente, o `null`.

`local.ventas` (Tanda 3A) es `true` si el `mi_alcance` de ESA solicitud anuncia
`ventas_resumen` en el local. Es un anuncio para mostrar el botón "Ventas", no
una autorización: `GET /api/chats/ventas` lo vuelve a decidir. Abrir el chat no
consulta ventas.

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
noLeidos, eventos, siguiente, localesDemorados }`; `noLeidos` es la suma de los
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

## El evento público

`{ id, tipo, fecha, transferenciaId, origen: { id, nombre, esDeposito },
destino: { id, nombre }, tieneDiferencias, lineasConDiferencia }`.

`id` es el `Evento.id` en texto y `fecha` es la `fechaOperacion` (cuándo se
recibió en el ERP). No salen la instalación, la clave externa, la versión, la
marca de histórico, la fecha de ingesta ni el payload crudo. Un evento guardado
que no se puede leer como `TRANSFERENCIA_RECIBIDA` v1 no se muestra a medias: la
solicitud falla con `SERVICIO_NO_DISPONIBLE`.

## No leídos

Por vínculo y por local, como en la fundación: `historico = false` y
`Evento.id > leidoHastaEventoId`. General es la suma.

- La primera vez que una persona ve un local, su lectura se fija en el mayor
  `Evento.id` del local DESPUÉS de sincronizar. Lo que esa primera vista trae
  del ERP es historia para ella, no novedad.
- Lo que trae el backfill es histórico y no cuenta nunca.
- Dos sesiones de la misma persona comparten la lectura; otra persona no.
- La lectura se ordena por `Evento.id` (orden de ingesta) y el historial por
  fecha. Un evento con fecha vieja que se conoció tarde aparece en su lugar por
  fecha y cuenta como nuevo por id.

## Paginación

El historial se ordena por `(fechaOperacion desc, Evento.id desc)`, que es un
orden total aunque dos eventos compartan la fecha. El cursor es la posición del
último evento de la página, `{ f: fecha ISO, i: id }` en JSON y base64url.

Se valida estricto: exactamente esas dos claves, instante ISO válido, id entero
positivo que entra en un BIGINT, hasta 200 caracteres. Uno con otra forma es
`SOLICITUD_INVALIDA`, no se arregla. No lleva local ni instalación: no sirve
para salir de los locales autorizados, porque la consulta los filtra siempre
desde el servidor. No es el cursor del ERP, que nunca sale del servidor.

Los parámetros de la URL también son estrictos: uno de más o repetido es
`SOLICITUD_INVALIDA`, y lo mal formado se rechaza antes de llamar al ERP.

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
- `SERVICIO_NO_DISPONIBLE` (503): configuración o base.

La ingesta demorada de un local no es un error: es `sincronizacion: "DEMORADA"`
dentro de una respuesta buena.
