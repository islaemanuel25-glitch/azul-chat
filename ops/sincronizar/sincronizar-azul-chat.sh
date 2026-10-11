#!/usr/bin/env bash
# ops/sincronizar/sincronizar-azul-chat.sh — dispara la sincronización en
# segundo plano de Azul Chat (Tanda 5A). Lo corre el timer de USUARIO
# azul-chat-sincronizar.timer cada 2 minutos; instalación en docs/DEPLOY.md,
# sección "Sincronización en segundo plano".
#
# Hace UN POST a http://127.0.0.1:3100/api/interno/sincronizar con el secreto
# de la tarea en la cabecera x-azul-chat-tarea, y nada más. Sin reintentos: la
# próxima corrida es en 2 minutos.
#
# El secreto:
#   · se lee de un archivo FUERA del repo (por defecto
#     ~/.config/azul-chat/tarea.secreto) que tiene que tener permisos 600;
#   · se le pasa a curl por la ENTRADA ESTÁNDAR como configuración (-K -), no
#     como argumento: no aparece en `ps` ni en /proc/<pid>/cmdline;
#   · no se imprime nunca. Lo que sale al journal es el código HTTP y el resumen
#     de la corrida, que son solo cuentas.

set -euo pipefail

ARCHIVO="${AZUL_CHAT_TAREA_SECRETO_ARCHIVO:-$HOME/.config/azul-chat/tarea.secreto}"
URL="http://127.0.0.1:3100/api/interno/sincronizar"

fallar() {
  echo "sincronizar-azul-chat: $1" >&2
  exit 1
}

[ -f "$ARCHIVO" ] || fallar "no existe el archivo del secreto ($ARCHIVO)."
[ "$(stat -c '%a' "$ARCHIVO")" = "600" ] || fallar "el archivo del secreto tiene que tener permisos 600 ($ARCHIVO)."
SECRETO="$(tr -d '\r\n' < "$ARCHIVO")"
[ "${#SECRETO}" -ge 32 ] || fallar "el secreto del archivo tiene menos de 32 caracteres."
case "$SECRETO" in *'"'* | *'\'*) fallar "el secreto no puede tener comillas ni barras invertidas." ;; esac

RESPUESTA="$(mktemp)"
trap 'rm -f "$RESPUESTA"' EXIT

# printf es interno de bash: el secreto no pasa por la línea de comandos de ningún proceso.
CODIGO="$(printf 'header = "x-azul-chat-tarea: %s"\n' "$SECRETO" |
  curl --silent --show-error --max-time 110 --request POST --config - \
    --output "$RESPUESTA" --write-out '%{http_code}' "$URL")" || fallar "no se pudo llegar a Azul Chat en 127.0.0.1:3100."
unset SECRETO

echo "sincronizar-azul-chat: HTTP $CODIGO $(head -c 1000 "$RESPUESTA")"
[ "$CODIGO" = "200" ] || exit 1
