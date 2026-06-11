#!/usr/bin/env bash
# =============================================================================
# Module 0.2 — Smoke test DB : connexion + présence schémas V1
# =============================================================================
# Vérifie que :
#   1. La connexion PostgreSQL fonctionne
#   2. Les schémas 'plateforme' et 'shared' existent
#   3. Le schéma 'tms' est ABSENT (garde-fou 1 TMS-Ready)
#
# Usage :
#   bash scripts/smoke-test-db.sh              # projet lié (supabase link)
#   DATABASE_URL=<url> bash scripts/smoke-test-db.sh  # connexion directe (port 5432)
#
# Prérequis : supabase CLI avec `supabase link` effectué, ou psql + DATABASE_URL.
# Note : utiliser le port 5432 (direct), pas 6543 (pooler — PgBouncer incompatible
# avec les prepared statements utilisés en interne par le CLI).
# =============================================================================
set -euo pipefail

# Détecte le mode de connexion
use_linked=true
if [[ -n "${DATABASE_URL:-}" ]]; then
  use_linked=false
fi

run_sql() {
  local query="$1"
  if [[ "$use_linked" == "true" ]]; then
    echo "$query" | supabase db query --linked --output json 2>/dev/null
  else
    # psql obligatoire pour une connexion directe (le pooler n'est pas compatible)
    if ! command -v psql >/dev/null 2>&1; then
      echo "✗ psql requis quand DATABASE_URL est défini (brew install postgresql@17)" >&2
      exit 1
    fi
    psql "$DATABASE_URL" -tAc "$query" 2>/dev/null
  fi
}

check_schema() {
  local schema="$1"
  local result
  result="$(run_sql "SELECT schema_name FROM information_schema.schemata WHERE schema_name = '$schema';")"
  echo "$result" | grep -q "$schema"
}

echo "Smoke test DB — Savr Platform module 0.2"
if [[ "$use_linked" == "true" ]]; then
  echo "Mode : supabase db query --linked (projet lié)"
else
  echo "Mode : psql via DATABASE_URL"
fi
echo ""

# Test connexion
if ! run_sql "SELECT 1;" >/dev/null 2>&1; then
  echo "✗ ÉCHEC : impossible de se connecter à la base de données."
  echo "  → Vérifier que le projet est lié ('supabase link') ou que DATABASE_URL est correct."
  exit 1
fi
echo "✓ Connexion OK"

for schema in plateforme shared; do
  if check_schema "$schema"; then
    echo "✓ Schéma '$schema' présent"
  else
    echo "✗ ÉCHEC : schéma '$schema' absent — relancer 'pnpm db:push' ou 'pnpm db:reset'"
    exit 1
  fi
done

if check_schema "tms"; then
  echo "✗ VIOLATION garde-fou 1 TMS-Ready : schéma 'tms' détecté en base !"
  echo "  → Supprimer la migration qui crée tms.* — interdit en V1."
  exit 1
else
  echo "✓ Schéma 'tms' absent (garde-fou 1 TMS-Ready OK)"
fi

echo ""
echo "Smoke test DB : OK — schémas plateforme + shared présents, tms absent."
exit 0
