#!/usr/bin/env bash
# =============================================================================
# run-report-pgtap.sh — exécute un fichier de test pgTAP en MODE RAPPORT (T0).
# =============================================================================
# Lance `psql -f <fichier>` (le fichier porte son propre BEGIN/plan/ROLLBACK +
# CREATE EXTENSION pgtap), parse la sortie TAP, écrit un résumé dans
# $GITHUB_STEP_SUMMARY + un compteur de burn-down, et SORT TOUJOURS 0.
#
# Utilisé par les jobs mode-rapport `semantic-oracle` (G9) et
# `integration-contracts` (L4) — ces tests vivent HORS supabase/tests/ pour ne
# PAS être ramassés par le job bloquant `pgtap-rls-outbox`.
#
# Usage : bash scripts/run-report-pgtap.sh <fichier.test.sql> "<Titre du gate>"
# Pré-requis : $DATABASE_URL + psql sur le PATH.
# =============================================================================
set -uo pipefail

FILE="${1:?usage: run-report-pgtap.sh <fichier.test.sql> <titre>}"
TITLE="${2:-Rapport pgTAP}"
DB="${DATABASE_URL:-postgresql://postgres:postgres@localhost:54322/postgres}"

summary() { # $1 = markdown
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; fi
  printf '%s\n' "$1"
}

if ! command -v psql >/dev/null 2>&1; then
  summary "## ${TITLE} (mode rapport)
⚠️ psql introuvable — test non exécuté (non bloquant)."
  exit 0
fi
if [ ! -f "$FILE" ]; then
  summary "## ${TITLE} (mode rapport)
⚠️ Fichier de test absent : \`${FILE}\` (non bloquant)."
  exit 0
fi

# -A -t : sortie tuples-only non alignée → les lignes TAP « ok N »/« not ok N »
# sortent en début de ligne (sinon psql les indente en colonne formatée).
OUT="$(psql "$DB" -X -A -t -v ON_ERROR_STOP=0 -f "$FILE" 2>&1)"

NB_OK=$(printf '%s\n' "$OUT" | grep -cE '^ok [0-9]+' || true)
NB_KO=$(printf '%s\n' "$OUT" | grep -cE '^not ok [0-9]+' || true)
# Vraies erreurs SQL seulement (les NOTICE/WARNING — ex. « extension pgtap already
# exists » — sont préfixés psql: mais ne contiennent pas ERROR:).
NB_ERR=$(printf '%s\n' "$OUT" | grep -cE 'ERROR:' || true)

{
  echo "## ${TITLE} (mode rapport)"
  echo ""
  echo "**Burn-down : ${NB_KO} assertion(s) en échec · ${NB_OK} ok · ${NB_ERR} erreur(s) SQL.**"
  echo ""
  if [ "$NB_KO" -gt 0 ] || [ "$NB_ERR" -gt 0 ]; then
    echo "### Échecs / erreurs"
    echo '```'
    printf '%s\n' "$OUT" | grep -E '^not ok [0-9]+|ERROR:' | head -60
    echo '```'
  else
    echo "_Toutes les assertions passent._"
  fi
  echo ""
  echo "> Mode RAPPORT — informatif, non bloquant (exit 0). Flip bloquant (T1) = déplacer le test dans \`supabase/tests/\`."
} > /tmp/report.md
summary "$(cat /tmp/report.md)"

echo "[run-report-pgtap] ${FILE} : ${NB_KO} not ok · ${NB_OK} ok · ${NB_ERR} erreur(s) — MODE RAPPORT (exit 0)."
exit 0
