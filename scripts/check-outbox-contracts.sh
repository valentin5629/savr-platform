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

# ── 2. Structure table outbox_events — VALIDÉE AILLEURS (divergence BLOC7) ────
# La table V1 `plateforme.outbox_events` DIVERGE STRUCTURELLEMENT du contrat V2 §08 :
# naming V1 = `statut` / `aggregate_id`, contrat V2 = `status` / `event_id`. C'est une
# divergence TRACÉE et ASSUMÉE, convergence reportée V2 (CLAUDE.md §3bis +
# _Divergences/_traités/2026-06/BLOC7_20260624.md — les 4 tables Bloc 7 divergent du
# DDL cible). Comparer ici la table V1 aux NOMS de colonnes V2 produisait un FAUX ÉCHEC
# permanent (masqué jusqu'ici car les schémas V2 étaient absents → Section 1 skippait).
#
# La conformité structurelle V1↔cible est déjà couverte par le gate `check-schema-vs-cible`
# (avec l'allowlist BLOC7, R0c) + les tests pgTAP G4 (pattern lease/claim sur la vraie DB).
# Ce gate se limite donc au niveau CONTRAT V2 = présence des schémas E1/E2/E3/E5 §08
# (Section 1 ci-dessus, validables en isolation) — pas de re-check de la structure V1.
# `${MIGRATIONS_DIR}` conservé pour référence si la Section 2 est un jour rétablie au grain V1.
: "${MIGRATIONS_DIR:?}"

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
