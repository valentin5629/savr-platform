#!/usr/bin/env bash
# Gate point 1 : avant tout edit sur packages/.
# R0d (durcissement harnais) : auparavant ce gate s'auto-exitait sur toute
# branche qui n'était pas ^feat/m[0-9] → les lots de remédiation feat/r*,
# fix/r*, chore/r* contournaient brief-ack ET le blocage des divergences spec.
# Désormais :
#   - les DIVERGENCES spec en attente bloquent TOUTE branche éditant packages/
#     (un patch spec non syncé doit l'être avant tout code, quel que soit le lot) ;
#   - le BRIEF-ACK est exigé pour tout lot de dev structuré : module (feat/m*) ET
#     remédiation ((feat|fix|chore)/r*) ;
#   - la COHÉRENCE inter-CDC reste exigée pour les modules NEUFS (feat/m) seulement
#     (les R-lots remédient des modules déjà construits).
set -euo pipefail

INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"

# Seulement pour les fichiers dans packages/
if ! printf '%s' "$FILE" | grep -q "/packages/"; then
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# ── Divergences spec en attente — bloquent TOUTE branche éditant packages/ ──
# (placé AVANT le filtre de branche : R0d ferme le contournement feat/r*).
if [ -f ".claude/divergences-ambigu" ]; then
  echo "" >&2
  echo "🔴 DIVERGENCES AMBIGUËS NON RÉSOLUES — édition bloquée" >&2
  echo "" >&2
  echo "  Des décisions métier sont en attente avant de toucher du code." >&2
  echo "  1. Réponds aux questions ambiguës dans _Divergences/" >&2
  echo "  2. Lance cdc-patch-divergences + cdc-devfacing-export dans Cowork" >&2
  echo "  3. Dis 'specs sync' → sync-specs.sh se lance et débloque" >&2
  echo "" >&2
  exit 2
fi

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

# ── Worktree-aware (cf. lib-worktree.sh) ─────────────────────────────────────
# Les divergences ci-dessus sont des flags REPO-GLOBAUX (créés dans le clone
# principal par le sync) → évaluées dans le cwd courant, AVANT le cd (correct).
# Le brief-ack / la cohérence ci-dessous sont SPÉCIFIQUES À LA BRANCHE → on se
# place dans le worktree du fichier édité pour lire SA branche + SES markers
# (sinon, dans le clone principal sur `main`, ce gate s'auto-exitait → brief-ack
# jamais exigé pour un lot worktree).
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-worktree.sh"
cd_worktree_for "$FILE"
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# ── Lots de dev structurés (module neuf OU remédiation) ──
IS_MODULE=0
IS_REMED=0
printf '%s' "$BRANCH" | grep -qE '^feat/m[0-9]' && IS_MODULE=1
printf '%s' "$BRANCH" | grep -qE '^(feat|fix|chore)/r[0-9]' && IS_REMED=1

# Branche hors cycle de dev structuré (ex. chore/ci, fix/typo) : pas de brief exigé.
if [ "$IS_MODULE" -eq 0 ] && [ "$IS_REMED" -eq 0 ]; then
  exit 0
fi

# Cohérence inter-CDC — modules NEUFS uniquement (feat/m). Une fois par verticale.
if [ "$IS_MODULE" -eq 1 ]; then
  VERTICALE=$(printf '%s' "$BRANCH" | sed -nE 's#^feat/m([0-9]+)\..*#\1#p')
  COHERENCE_MARKER=".claude/coherence-ok-v${VERTICALE:-x}"
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
fi

# Brief-ack — obligatoire pour tout lot de dev structuré (module ou remédiation).
MARKER=".claude/brief-ack-$(printf '%s' "$BRANCH" | tr '/' '-')"
if [ ! -f "$MARKER" ]; then
  echo "" >&2
  echo "🔒 BRIEF NON LU — édition bloquée sur $BRANCH" >&2
  echo "" >&2
  echo "  1. Lance le brief : module-briefer (module neuf) ou lis le(s) ticket(s)" >&2
  echo "     backlog BL-* + le CDC pointé (lot de remédiation)." >&2
  echo "  2. Crée le fichier '$MARKER' pour débloquer." >&2
  echo "" >&2
  exit 2
fi
