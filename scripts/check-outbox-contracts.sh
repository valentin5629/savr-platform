#!/usr/bin/env bash
# scripts/check-outbox-contracts.sh — Vérifie la conformité des payloads outbox avec le contrat V2.
# Deux niveaux :
#   1. Structure table outbox_events (colonnes requises par le pattern lease/claim)
#   2. Présence des schémas JSON E1/E2/E3/E5 (cible V2, garde-fou G2)
# Ne valide PAS les payloads individuels (couvert par pgTAP G4).
# Exit 0 = OK · Exit 1 = violation bloquante
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMAS_DIR="${REPO_ROOT}/specs/cdc/02 - Cahier des charges TMS/08 - savr-api-contracts/schemas/entrants"
MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"

echo "🔍 check-outbox-contracts : vérification contrat V2..." >&2

# ── 1. Schémas E1/E2/E3/E5 présents ──────────────────────────────────────────
if [[ ! -d "$SCHEMAS_DIR" ]]; then
  echo "⚠️  Schemas entrants absents ($SCHEMAS_DIR) — skip." >&2
  exit 0
fi

SCHEMAS_MANQUANTS=()
for event in E1 E2 E3 E5; do
  if ! ls "${SCHEMAS_DIR}/${event}."*.json &>/dev/null 2>&1; then
    SCHEMAS_MANQUANTS+=("$event")
  fi
done

if [[ ${#SCHEMAS_MANQUANTS[@]} -gt 0 ]]; then
  echo "❌ Schémas JSON manquants : ${SCHEMAS_MANQUANTS[*]}" >&2
  echo "   Attendus dans : ${SCHEMAS_DIR}" >&2
  exit 1
fi
echo "  ✅ Schémas E1/E2/E3/E5 présents" >&2

# ── 2. Structure table outbox_events (colonnes lease/claim V2) ───────────────
# Colonnes non-négociables (ajoutées revue adversariale 2026-06-11) :
REQUIRED_COLS=(event_type event_id payload status seq txid claimed_until requires_reconciliation)

if ! compgen -G "${MIGRATIONS_DIR}/*.sql" > /dev/null 2>&1; then
  echo "⚠️  Aucune migration — skip structure outbox." >&2
  exit 0
fi

MIGRATION_CONTENT=$(cat "${MIGRATIONS_DIR}"/*.sql 2>/dev/null || echo "")

COLS_MANQUANTES=()
for col in "${REQUIRED_COLS[@]}"; do
  # Cherche la colonne dans un contexte outbox_events
  if ! echo "$MIGRATION_CONTENT" | grep -A 30 'outbox_events' | grep -qw "$col"; then
    COLS_MANQUANTES+=("$col")
  fi
done

if [[ ${#COLS_MANQUANTES[@]} -gt 0 ]]; then
  echo "❌ Colonnes outbox_events manquantes vs contrat V2 : ${COLS_MANQUANTES[*]}" >&2
  echo "   Ces colonnes sont requises pour le pattern lease/claim et la compatibilité V2." >&2
  exit 1
fi
echo "  ✅ Structure outbox_events conforme (${#REQUIRED_COLS[@]} colonnes)" >&2

# ── 3. Champ event_type valide (E1/E2/E3/E5 uniquement) ──────────────────────
# Cherche des event_type codés en dur hors du périmètre contractuel
if grep -r "event_type" "${REPO_ROOT}/packages/" --include="*.ts" 2>/dev/null \
    | grep -v "//\|test\|spec\|mock" \
    | grep -v "E1\|E2\|E3\|E5\|collecte\.creee\|collecte\.modifiee\|collecte\.annulee\|lieu\.champ_critique"; then
  echo "⚠️  event_type non standard détecté ci-dessus — vérifier la conformité §08." >&2
fi

echo "" >&2
echo "✅ check-outbox-contracts OK" >&2
exit 0
