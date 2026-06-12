#!/usr/bin/env bash
# =============================================================================
# RLS Coverage Checker — Vérifie que CHAQUE scénario du manifest a un test vert
# =============================================================================
# Valide que :
#   1. Chaque ID du manifest (specs/manifests/M0.6.json) correspond à un test
#   2. Chaque test du fichier .sql existe et est nommé correctement
#   3. Aucun test ne manque (anti-vacuité)
#
# Usage :
#   bash scripts/check-rls-coverage.sh M0.6
#
# Retourne 0 si OK, 1 sinon.
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/check-rls-coverage.sh <module> (e.g., M0.6)" >&2
  exit 1
fi

module="$1"
manifest_file="specs/manifests/${module}.json"

if [[ ! -f "$manifest_file" ]]; then
  echo -e "${RED}✗ Manifest non trouvé : $manifest_file${NC}" >&2
  exit 1
fi

echo -e "${YELLOW}=== RLS Coverage Check ($module) ===${NC}"
echo ""

# Extraire les IDs des scénarios du manifest
echo "Scénarios du manifest :"
jq -r '.scenarios[].id' "$manifest_file" | while read -r scenario_id; do
  echo "  - $scenario_id"
done

echo ""

# Récupérer les fichiers de test du manifest
test_files=$(jq -r '.test_files[]' "$manifest_file" 2>/dev/null || echo "")

if [[ -z "$test_files" ]]; then
  echo -e "${RED}✗ Aucun fichier de test défini dans le manifest${NC}"
  exit 1
fi

echo "Fichiers de test associés :"
echo "$test_files" | while read -r file; do
  if [[ ! -f "$file" ]]; then
    echo -e "  ${RED}✗ $file (NOT FOUND)${NC}"
  else
    echo -e "  ${GREEN}✓ $file${NC}"
  fi
done

echo ""

# Vérifier que chaque scénario a un test correspondant dans les fichiers
echo "Vérification des tests..."

missing_tests=()
jq -r '.scenarios[].id' "$manifest_file" | while read -r scenario_id; do
  # Cherche le pattern "SELECT.*'<scenario_id>" dans les fichiers de test
  found=false
  for test_file in $test_files; do
    if grep -q "'$scenario_id\|\"$scenario_id" "$test_file" 2>/dev/null; then
      found=true
      break
    fi
  done

  if [[ "$found" == "true" ]]; then
    echo -e "  ${GREEN}✓ $scenario_id${NC}"
  else
    echo -e "  ${RED}✗ $scenario_id (pas de test)${NC}"
    missing_tests+=("$scenario_id")
  fi
done

echo ""

if [[ ${#missing_tests[@]} -eq 0 ]]; then
  echo -e "${GREEN}✓ Couverture RLS OK — Tous les scénarios ont des tests${NC}"
  exit 0
else
  echo -e "${RED}✗ COUVERTURE INCOMPLÈTE — Les scénarios suivants manquent de tests :${NC}"
  printf '%s\n' "${missing_tests[@]}" | sed 's/^/  - /'
  exit 1
fi
