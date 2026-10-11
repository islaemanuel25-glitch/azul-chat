#!/usr/bin/env bash
# Backup de la base de Azul Chat. Procedimiento y restauración: docs/DEPLOY.md.
#
# ── QUÉ HACE ────────────────────────────────────────────────────────────────
# Saca un pg_dump comprimido de la base PROPIA de Azul Chat (contenedor
# azul-chat-db), LO VERIFICA, y recién entonces rota los viejos. Si algo falla,
# borra el archivo parcial, no rota nada y sale con error: un backup roto no
# puede desplazar a uno bueno.
#
# ── QUÉ NO HACE ─────────────────────────────────────────────────────────────
# No toca nada del ERP. Escribe solo en su propio directorio, solo archivos
# `azul-chat-*.sql.gz`, y rota solo esos. Se niega a correr si el directorio es
# el de backups del ERP o el de datos de alguna base.
#
# Lo corre una vez por día el timer de systemd de usuario de
# ops/backup/systemd/ (instalado en el VPS el 10/10), o se corre a mano.
#
# ── USO ─────────────────────────────────────────────────────────────────────
#   ops/backup/backup-azul-chat.sh
# Variables opcionales (con su valor de producción por defecto):
#   AZUL_CHAT_BACKUP_DIR=/srv/produccion/backups-azul-chat
#   AZUL_CHAT_DB_CONTENEDOR=azul-chat-db
#   AZUL_CHAT_BACKUP_RETENER=30
#
# El usuario y la base se leen DENTRO del contenedor (POSTGRES_USER,
# POSTGRES_DB): el script no recibe ni imprime credenciales.

set -euo pipefail
umask 077

DIR="${AZUL_CHAT_BACKUP_DIR:-/srv/produccion/backups-azul-chat}"
CONTENEDOR="${AZUL_CHAT_DB_CONTENEDOR:-azul-chat-db}"
RETENER="${AZUL_CHAT_BACKUP_RETENER:-30}"

# Las tres tablas de la migración, más la de control de Prisma.
TABLAS_MINIMAS=4

log() { printf '%s backup-azul-chat: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }

# ── Salvaguardas ───────────────────────────────────────────────────────────
case "$RETENER" in
  '' | *[!0-9]*) log "ERROR: AZUL_CHAT_BACKUP_RETENER tiene que ser un número"; exit 2 ;;
esac
if [ "$RETENER" -lt 1 ]; then log "ERROR: hay que retener al menos 1"; exit 2; fi

DIR_REAL="$(realpath -m "$DIR")"
case "$DIR_REAL" in
  /srv/produccion/backups | /srv/produccion/backups/*)
    log "ERROR: ${DIR_REAL} es el directorio de backups del ERP. Azul Chat usa el suyo."; exit 2 ;;
  */pgdata | */pgdata/*)
    log "ERROR: ${DIR_REAL} es un directorio de datos de PostgreSQL."; exit 2 ;;
  / | /srv | /srv/produccion)
    log "ERROR: ${DIR_REAL} no es un directorio de backups."; exit 2 ;;
esac

if ! docker inspect -f '{{.State.Running}}' "$CONTENEDOR" 2>/dev/null | grep -qx true; then
  log "ERROR: el contenedor ${CONTENEDOR} no está corriendo."
  exit 1
fi

mkdir -p "$DIR_REAL"

FECHA="$(date '+%Y%m%d_%H%M%S')"
ARCHIVO="${DIR_REAL}/azul-chat-${FECHA}.sql.gz"
PARCIAL="${ARCHIVO}.parcial"

# Dos corridas en el mismo segundo darían el mismo nombre: la segunda no pisa a
# la primera, falla.
if [ -e "$ARCHIVO" ] || [ -e "$PARCIAL" ]; then
  log "ERROR: ${ARCHIVO} ya existe. No se sobrescribe un backup."
  exit 1
fi

borrar_parcial() { rm -f "$PARCIAL"; }
trap borrar_parcial EXIT

log "inicio: contenedor ${CONTENEDOR} → ${ARCHIVO}"

# --no-owner/--no-acl: el dump se restaura en cualquier instancia sin depender
# de los mismos roles. Con pipefail, una falla de pg_dump hace fallar la tubería.
if ! docker exec "$CONTENEDOR" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
     | gzip -9 > "$PARCIAL"; then
  log "ERROR: pg_dump falló. No se rota nada."
  exit 1
fi

# ── Verificación, antes de rotar nada ──────────────────────────────────────
if ! gzip -t "$PARCIAL" 2>/dev/null; then
  log "ERROR: el gzip está corrupto o truncado. No se rota."
  exit 1
fi
# pg_dump 16 cierra con la marca y después un \unrestrict: se busca en el final.
if ! gzip -dc "$PARCIAL" | tail -20 | grep -q "PostgreSQL database dump complete"; then
  log "ERROR: falta la marca de cierre: el dump quedó incompleto. No se rota."
  exit 1
fi
TABLAS="$(gzip -dc "$PARCIAL" | grep -c '^CREATE TABLE' || true)"
if [ "$TABLAS" -lt "$TABLAS_MINIMAS" ]; then
  log "ERROR: ${TABLAS} tablas en el dump, se esperaban ${TABLAS_MINIMAS} o más. No se rota."
  exit 1
fi

mv "$PARCIAL" "$ARCHIVO"
trap - EXIT
log "dump OK: $(stat -c %s "$ARCHIVO") bytes, ${TABLAS} tablas"

# ── Rotación: solo archivos de Azul Chat, del más nuevo al más viejo ───────
# El nombre lleva la fecha en formato ordenable, así que el orden alfabético
# inverso es el cronológico inverso.
mapfile -t VIEJOS < <(find "$DIR_REAL" -maxdepth 1 -type f -name 'azul-chat-*.sql.gz' -printf '%f\n' | sort -r | tail -n +"$((RETENER + 1))")
for f in "${VIEJOS[@]}"; do
  rm -f -- "${DIR_REAL}/${f}"
  log "rotado: ${f}"
done

log "fin: $(find "$DIR_REAL" -maxdepth 1 -type f -name 'azul-chat-*.sql.gz' | wc -l) backups en ${DIR_REAL}"
printf '%s\n' "$ARCHIVO"
