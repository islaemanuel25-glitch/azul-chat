# Eventos del ERP en Azul Chat

Fundación de la Tanda 2. Describe lo que existe hoy en el servidor: el contrato
con el ERP, cómo se guardan los hechos, cómo se sincronizan y cómo se mide la
lectura. La interfaz de Chats, la conversación y General todavía no existen.

## Cuatro cosas distintas

- **Hecho operacional.** Un `Evento`: algo que pasó en el ERP. Se guarda UNA vez
  por instalación, sin dueño. Hoy hay un solo tipo, `TRANSFERENCIA_RECIBIDA`.
- **Visibilidad.** Quién puede ver los hechos de un local. NO se guarda: la
  decide el ERP en cada consulta, con `mi_alcance` vivo, que anuncia en cada
  local las capacidades que la persona puede usar hoy (`capacidades`, ERP
  25172fe). Tener eventos guardados de un local no autoriza a nadie a verlos.
- **Lectura.** Hasta dónde leyó cada persona, en `LecturaLocal`.
- **Conversación.** La de un local es la pareja (instalación, `erpLocalId`) y se
  deriva; General será una proyección sobre los locales autorizados en ese
  momento. Ninguna de las dos duplica eventos. No hay tabla de conversación.

## El ERP sigue siendo la autoridad

- El cliente pide `transferencias_eventos` por la misma frontera de siempre
  (`POST /api/integraciones/azul-chat/consultar`), firmada, con el token de
  delegación de la persona. El ERP vuelve a autorizar cada página.
- `capacidades` de `mi_alcance` es un anuncio para armar la interfaz. No se
  guarda y no reemplaza la autorización del ERP.
- **ERP no disponible: fallo cerrado (decisión P1).** Si no se puede verificar
  la autorización actual con el ERP, no se muestra historial operacional: ni
  autorización guardada, ni ventana de gracia, ni caída silenciosa a lo que
  haya en la base. La interfaz dirá "ERP Azul no responde" y algo equivalente a
  "Para ver el historial hace falta verificar tu acceso".

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

## Validación antes de guardar

Una página se valida ENTERA antes de tocar la base. Si falla una sola cosa, es
`RESPUESTA_INVALIDA`: no se guarda nada de ella y el cursor no se mueve.

- Forma (`src/shared/erp/contrato.ts`): capacidad y versión; cada evento bien
  formado; `eventoId` igual a `TRANSFERENCIA_RECIBIDA:<transferenciaId>:<fechaRecepcion>`;
  orden estricto por (fecha, id); ningún evento más nuevo que `hasta`;
  `siguiente` igual al último evento; `hayMas` solo con eventos.
- Contra el pedido (`src/server/eventos/pagina.ts`): el local es el pedido; el
  destino de TODOS los eventos es ese local; el primero viene después del
  `desde`; una página vacía repite el `desde`; no más eventos que el `limite`, y
  `hayMas` solo con la página llena.

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

**Idempotencia.** Ingerir la misma página dos veces, o páginas solapadas, deja
una fila por evento: el insert ignora las claves que ya existen.

**Reset-operativo.** El ERP borra transferencias y reinicia sus ids, así que un
`transferenciaId` puede volver con otra recepción. No se deduplica por id: la
clave lleva la fecha y las dos vidas son dos eventos. Un evento guardado no
desaparece porque el ERP borre la transferencia; queda como historia.

## Orden de operación y orden de ingesta

- `fechaOperacion` es cuándo pasó en el ERP. Sirve para mostrar.
- `Evento.id` es la secuencia de INGESTA: cuándo se enteró Azul Chat. La lectura
  se mide con esto. Dos eventos del mismo milisegundo se distinguen sin
  ambigüedad, y uno con fecha vieja que se conoce tarde cuenta como nuevo.

## CursorIngesta: un cursor por local, compartido

Uno por (instalación, local, capacidad), para todas las personas: el mismo
evento no se baja una vez por persona. Guarda el `siguiente` del ERP **tal cual**;
nunca se arma un cursor ni se usa el reloj de Azul Chat para fabricarlo.

`sincronizarTransferenciasLocal` (`src/server/eventos/ingesta.ts`) NO autoriza:
recibe un local ya autorizado y una función que llama al ERP con la delegación
de quien pregunta. `sincronizarTransferenciasDeLaSesion` lo une con la sesión,
para que un `VINCULO_NO_VALIDO` siga el flujo de siempre (invalida el vínculo y
revoca sus sesiones) y nada más lo haga.

Cada página es un ciclo:

1. **Arriendo**: un UPDATE atómico toma la fila solo si está libre o vencida
   (`arrendadoHasta` = ahora + 30 s, `arrendadoPor` = id de la ejecución). Si
   no se toma, no se llama al ERP. Sin Redis y sin transacción abierta durante
   la llamada.
2. Se llama al ERP con el cursor guardado.
3. Se valida la página entera.
4. Una transacción bloquea la fila y comprueba que el arriendo SIGA siendo
   propio; si otro lo tomó, se deshace todo y el cursor no avanza. Si es propio:
   inserta los eventos, guarda el cursor, marca el backfill si corresponde,
   limpia el error anterior y suelta el arriendo.

Un fallo suelta el arriendo, deja el cursor quieto y anota el **código** en
`ultimoErrorCodigo` (nunca un mensaje). No hay reintentos automáticos:
`LIMITE_EXCEDIDO`, `ERP_INALCANZABLE` y `TIEMPO_AGOTADO` se informan y reintentar
lo decide la persona. `NO_AUTORIZADO` no invalida el vínculo. Hasta 3 páginas
por sincronización: una historia larga se completa en varias visitas.

## Histórico y backfill

Sin cursor, el ERP devuelve la historia desde el evento más viejo. Mientras
`backfillCompletoEn` es null, todo lo que se ingiere es `historico = true`,
aunque lleve varias visitas. La primera página con `hayMas: false` completa el
backfill. Lo que entra después es `historico = false`, y lo histórico no cambia.

## Lectura

`LecturaLocal (vinculoId, erpLocalId, leidoHastaEventoId)`, del Vinculo y no de
la sesión: dos dispositivos de la misma persona leen lo mismo.

- **No leído** = `historico = false` y `Evento.id > leidoHastaEventoId`.
- **Línea de base**: la primera vez que una persona ve un local, su lectura se
  fija en el mayor `Evento.id` actual del local (0 si no hay). Todo lo anterior
  a su primera visita es historia para ella.
- Avanzar la lectura nunca retrocede (GREATEST) y se recorta al mayor
  `Evento.id` que existe en el local.
- La instalación sale del vínculo: no se lee ni se marca sobre otra.

Todavía no hay una ruta para marcar leído: llega con la capa de chats, que
antes de leer o marcar un local tiene que verificarlo con `mi_alcance` vivo.
