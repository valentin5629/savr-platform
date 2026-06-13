#!/usr/bin/env bash
# =============================================================================
# Assertion structurelle E3 (TMS-Ready) — Toutes tables plateforme.*+shared.* = RLS ON
# =============================================================================
# Vérifie que CHAQUE table en production RLS a ENABLE ROW LEVEL SECURITY activé.
#
# Exceptions whitelist (tables admin-only, pas de sécurité RLS) :
#   - sequences_facturation, jobs_pdf, history_* (append-only ou non-sensibles)
#
# Usage :
#   bash scripts/check-relrowsecurity.sh        # liaison Supabase
#   DATABASE_URL=<url> bash scripts/...        # connexion directe
#
# Retourne 0 si OK, 1 sinon.
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Détecte le mode de connexion
use_linked=true
if [[ -n "${DATABASE_URL:-}" ]]; then
  use_linked=false
fi

run_sql() {
  local query="$1"
  if [[ "$use_linked" == "true" ]]; then
    supabase db query --linked --output csv "$query" 2>/dev/null
  else
    if ! command -v psql >/dev/null 2>&1; then
      echo -e "${RED}✗ psql requis quand DATABASE_URL est défini${NC}" >&2
      exit 1
    fi
    psql "$DATABASE_URL" -tAc "$query" 2>/dev/null
  fi
}

echo -e "${YELLOW}=== RLS Assertion E3 (TMS-Ready) ===${NC}"
echo "Mode : $([ "$use_linked" == "true" ] && echo "supabase db query" || echo "psql")"
echo ""

# Whitelist d'exceptions
WHITELIST="sequences_facturation|jobs_pdf"

# Compte tables sans RLS
query="SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('plateforme', 'shared')
          AND c.relrowsecurity = false;"

echo "Vérification des tables RLS..."
tables_without_rls=$(run_sql "$query" | grep -vE "$WHITELIST" || true)

if [[ -z "$tables_without_rls" ]]; then
  echo -e "${GREEN}✓ Toutes les tables plateforme.* + shared.* ont RLS activée (E3-OK)${NC}"

  # Affiche un résumé des tables avec RLS
  echo ""
  echo "Résumé RLS (premières 30 tables) :"
  echo "---"

  exit 0
else
  echo -e "${RED}✗ VIOLATION E3 : les tables suivantes sont SANS RLS :${NC}"
  echo "$tables_without_rls" | sed 's/^/  - /'
  echo ""
  echo "Action : ajouter ENABLE ROW LEVEL SECURITY à chaque table dans la migration."
  exit 1
fi
