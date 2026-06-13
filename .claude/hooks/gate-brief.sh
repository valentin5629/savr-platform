#!/usr/bin/env bash
# Gate point 1 : brief du module lu avant tout edit sur packages/
# Bloque Write/Edit sur packages/* si le brief n'a pas été acquitté pour la branche courante.
set -euo pipefail

INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"

# Seulement pour les fichiers dans packages/
if ! printf '%s' "$FILE" | grep -q "/packages/"; then
  exit 0
fi

# Seulement sur les branches de module feat/m*
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if ! printf '%s' "$BRANCH" | grep -qE "^feat/m[0-9]"; then
  exit 0
fi

MARKER=".claude/brief-ack-$(printf '%s' "$BRANCH" | tr '/' '-')"

# Cohérence inter-CDC : marker PAR VERTICALE (pas par module).
# La verticale = le numéro après 'm' dans feat/mN.x (M1.x=V1 ZD, M2.x=V2 AG…).
# Vérifier la cohérence une fois par verticale suffit ; entre sous-lots d'une
# même verticale le contexte est partagé (décision Val 2026-06-13).
VERTICALE=$(printf '%s' "$BRANCH" | sed -nE 's#^feat/m([0-9]+)\..*#\1#p')
COHERENCE_MARKER=".claude/coherence-ok-v${VERTICALE:-x}"

# Vérifier les divergences ambiguës non résolues du module précédent
if [ -f ".claude/divergences-ambigu" ]; then
  echo "" >&2
  echo "🔴 DIVERGENCES AMBIGUËS NON RÉSOLUES — édition bloquée" >&2
  echo "" >&2
  echo "  Des décisions métier sont en attente avant de démarrer un nouveau module." >&2
  echo "  1. Réponds aux questions ambiguës dans _Divergences/" >&2
  echo "  2. Lance cdc-patch-divergences + cdc-devfacing-export dans Cowork" >&2
  echo "  3. Dis 'specs sync' → sync-specs.sh se lance et débloque" >&2
  echo "" >&2
  exit 2
fi

# Vérifier les divergences claires en attente de sync Cowork
if [ -f ".claude/divergences-clair" ]; then
  echo "" >&2
  echo "🟡 SPECS SYNC REQUIS — édition bloquée" >&2
  echo "" >&2
  echo "  Des patches clairs attendent d'être appliqués dans le Vault." >&2
  echo "  1. Lance cdc-patch-divergences + cdc-devfacing-export dans Cowork" >&2
  echo "  2. Dis 'specs sync' → sync-specs.sh se lance et débloque" >&2
  echo "" >&2
  exit 2
fi

# Vérifier la cohérence inter-CDC — une fois par verticale (V${VERTICALE:-x})
if [ ! -f "$COHERENCE_MARKER" ]; then
  echo "" >&2
  echo "🔍 COHÉRENCE INTER-CDC NON VÉRIFIÉE — verticale V${VERTICALE:-?} (branche $BRANCH)" >&2
  echo "" >&2
  echo "  Première fois sur cette verticale → vérifier la cohérence cross-CDC." >&2
  echo "  1. Lance le skill coherence-inter-cdc" >&2
  echo "  2. Crée le fichier '$COHERENCE_MARKER' pour débloquer toute la verticale" >&2
  echo "" >&2
  exit 2
fi

if [ ! -f "$MARKER" ]; then
  echo "" >&2
  echo "🔒 BRIEF NON LU — édition bloquée sur $BRANCH" >&2
  echo "" >&2
  echo "  1. Lance le skill module-briefer (Skill tool, args = numéro de module)" >&2
  echo "  2. Crée le fichier '$MARKER' pour débloquer" >&2
  echo "" >&2
  exit 2
fi
