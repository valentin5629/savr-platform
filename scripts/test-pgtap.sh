#!/usr/bin/env bash
# =============================================================================
# Test runner — Tests pgTAP RLS exhaustive (Modules 0.6+)
# =============================================================================
# Exécute tous les fichiers de tests pgTAP dans supabase/tests/M*.test.sql
# Retourne 0 si tous les tests passent, 1 sinon.
#
# Usage :
#   pnpm test:pgtap                    # run all tests
#   pnpm test:pgtap M0_6__cat_1-2      # run specific test file
#
# Prérequis : Supabase project linked (supabase link)
# =============================================================================
set -euo pipefail

# Couleurs pour output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Détecte le mode de connexion
use_linked=true
if [[ -n "${DATABASE_URL:-}" ]]; then
  use_linked=false
fi

run_sql_file() {
  local file="$1"
  if [[ "$use_linked" == "true" ]]; then
    supabase db query --linked --file "$file" 2>&1
  else
    if ! command -v psql >/dev/null 2>&1; then
      echo "✗ psql requis quand DATABASE_URL est défini" >&2
      exit 1
    fi
    psql "$DATABASE_URL" -f "$file" 2>&1
  fi
}

# Récupère le fichier spécifique ou tous les fichiers de test
TEST_PATTERN="${1:-M*}.test.sql"
TEST_FILES=$(find supabase/tests -maxdepth 1 -name "$TEST_PATTERN" | sort)

if [[ -z "$TEST_FILES" ]]; then
  echo -e "${RED}✗ Aucun fichier de test trouvé : supabase/tests/$TEST_PATTERN${NC}"
  exit 1
fi

echo -e "${YELLOW}=== pgTAP Test Runner ===${NC}"
echo "Mode : $([ "$use_linked" == "true" ] && echo "supabase db query" || echo "psql")"
echo ""

# Compte les tests
total_files=0
passed_files=0
failed_files=0

for test_file in $TEST_FILES; do
  total_files=$((total_files + 1))
  filename=$(basename "$test_file")

  echo -n "Running $filename ... "

  # Exécute le test et capture le résultat
  if output=$(run_sql_file "$test_file"); then
    # Vérifie que la sortie contient "PASS" ou le pattern pgTAP de succès
    if echo "$output" | grep -q "^ok\|PASS\|passed\|1\.\."; then
      # Cherche un "not ok" qui indiquerait un échec
      if echo "$output" | grep -q "^not ok"; then
        echo -e "${RED}FAIL${NC}"
        echo "Output:"
        echo "$output"
        failed_files=$((failed_files + 1))
      else
        echo -e "${GREEN}PASS${NC}"
        passed_files=$((passed_files + 1))
      fi
    else
      echo -e "${RED}ERROR${NC}"
      echo "Output:"
      echo "$output"
      failed_files=$((failed_files + 1))
    fi
  else
    echo -e "${RED}ERROR${NC}"
    echo "Failed to execute test"
    failed_files=$((failed_files + 1))
  fi
done

echo ""
echo -e "${YELLOW}=== Summary ===${NC}"
echo "Total: $total_files | Passed: $passed_files | Failed: $failed_files"

if [[ $failed_files -eq 0 ]]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  exit 1
fi
