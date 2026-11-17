#!/usr/bin/env bash
# Relève, pendant un run de charge, ce que k6 ne voit pas : connexions à la
# base et files d'attente (critères des scénarios 1 et 4 du CDC
# `08 - Performance/04`). Une ligne CSV par relevé sur la sortie standard.
#
#   DATABASE_URL=… bash tests/load/echantillonner-base.sh [intervalle_s] > resultats/base.csv
#
# Lecture seule (transaction READ ONLY, annulée), base savr-dev uniquement.
# Arrêt : Ctrl-C.
set -euo pipefail

SAVR_DEV_REF="nvbyuajdvtuezcvyxtkd" # = DEV_PROJECT_REF, packages/shared/src/seed/constants.ts
INTERVALLE="${1:-60}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL manquante (celle de savr-dev, .env.local du clone principal)." >&2
  exit 2
fi
case "$DATABASE_URL" in
  *"$SAVR_DEV_REF"*) ;;
  *)
    echo "Refusé : DATABASE_URL ne désigne pas le projet savr-dev." >&2
    exit 2
    ;;
esac
if ! [[ "$INTERVALLE" =~ ^[0-9]+$ ]] || (( INTERVALLE < 5 )); then
  echo "Intervalle invalide : $INTERVALLE (entier, 5 s au moins)." >&2
  exit 2
fi

# Le pooler ignore PGOPTIONS (default_transaction_read_only reste off, mesuré) :
# la lecture seule est posée dans la transaction elle-même.
REQUETE="BEGIN TRANSACTION READ ONLY;
SELECT to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI:SS'),
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
  (SELECT setting FROM pg_settings WHERE name = 'max_connections'),
  (SELECT count(*) FROM plateforme.jobs_pdf WHERE statut IN ('pending', 'failed', 'processing')),
  (SELECT count(*) FROM plateforme.outbox_events WHERE statut IN ('pending', 'processing'));
ROLLBACK;"

echo "horodatage,connexions,max_connexions,jobs_pdf_en_attente,ordres_en_file"
while true; do
  psql "$DATABASE_URL" -X -q -A -t -F ',' -v ON_ERROR_STOP=1 -c "$REQUETE" \
    | grep -E '^[0-9]{4}-' || echo "$(date '+%Y-%m-%d %H:%M:%S'),erreur,,,"
  sleep "$INTERVALLE"
done
