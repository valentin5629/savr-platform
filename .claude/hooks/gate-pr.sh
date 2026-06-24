#!/usr/bin/env bash
# Gate points 2 + 4 : bloque gh pr create sans tests verts + conformite-spec GO.
# Point 3 (divergences) est couvert par le reviewer conformite-spec qui doit les flaguer.
set -euo pipefail

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

if ! printf '%s' "$CMD" | grep -q "gh pr create"; then
  exit 0
fi

# Worktree-aware (cf. lib-worktree.sh) : ce hook tourne dans le clone principal
# (souvent `main`). On se place dans le worktree de la branche RÉELLEMENT PR'd
# (--head, sinon la cible d'un `cd … &&`) pour évaluer SES markers/tests/branche.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-worktree.sh"
HEAD_BRANCH="$(printf '%s' "$CMD" | sed -nE "s/.*--head[= ]+([^ \"']+).*/\1/p" | head -1)"
if [ -n "$HEAD_BRANCH" ]; then
  cd_worktree_for "$HEAD_BRANCH"
else
  CD_DIR="$(printf '%s' "$CMD" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
  cd_worktree_for "$CD_DIR"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
MARKER_CONFORMITE=".claude/conformite-ok-$(printf '%s' "$BRANCH" | tr '/' '-')"
MARKER_SECURITE=".claude/securite-ok-$(printf '%s' "$BRANCH" | tr '/' '-')"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo nohead)"

# R0d — un marker reviewer doit CONTENIR 'GO' + le SHA HEAD courant. Un fichier
# vide (touch) ou périmé (créé sur un commit antérieur) est rejeté → revue réelle,
# ré-attestée après chaque nouveau commit.
check_marker() {
  marker="$1"; label="$2"; agent="$3"
  if [ ! -f "$marker" ]; then
    echo "" >&2
    echo "❌ REVIEWER $label MANQUANT — PR bloquée." >&2
    echo "   Après Agent(subagent_type='$agent') si GO : echo \"GO $HEAD_SHA\" > '$marker'" >&2
    echo "" >&2
    exit 2
  fi
  # Ancré : 'GO ' en début de ligne — évite le faux positif de la sous-chaîne
  # « NON-GO » (un marker 'NON-GO <sha>' ne doit PAS passer).
  if ! grep -qE '^GO ' "$marker"; then
    echo "" >&2
    echo "❌ MARKER $label sans verdict 'GO' en tête (vide ou NON-GO ?) — PR bloquée." >&2
    echo "" >&2
    exit 2
  fi
  if ! grep -q "$HEAD_SHA" "$marker"; then
    echo "" >&2
    echo "❌ MARKER $label périmé (ne référence pas HEAD $HEAD_SHA) — re-revue requise après tes derniers commits." >&2
    echo "   Recrée : echo \"GO $HEAD_SHA\" > '$marker'" >&2
    echo "" >&2
    exit 2
  fi
  echo "  ✅ $label GO (marker à jour)" >&2
}

echo "" >&2
echo "🔒 GATE PR — vérification avant création PR ($BRANCH)" >&2
echo "" >&2

# 1. Tests unitaires
echo "  → pnpm -w test:unit..." >&2
if ! pnpm -w test:unit >&2 2>&1; then
  echo "" >&2
  echo "❌ test:unit échoue — PR bloquée. Corrige les tests avant de créer la PR." >&2
  exit 2
fi
echo "  ✅ tests OK" >&2

# 2. Seed check (staleness detector)
# Le check utilise DIRECT_URL (port 5432) qui peut être injoignable en environnement sandboxé.
# Si l'erreur est ENOTFOUND/ECONNREFUSED (réseau), on warn sans bloquer.
# Si c'est une vraie erreur de schéma, le process exit non-0 avec un autre message.
echo "  → pnpm seed:check..." >&2
SEED_OUTPUT=$(pnpm seed:check 2>&1 || true)
SEED_EXIT=$?
if [ $SEED_EXIT -ne 0 ]; then
  if echo "$SEED_OUTPUT" | grep -qE "ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo"; then
    echo "  ⚠️  seed:check ignoré (DIRECT_URL injoignable — réseau sandboxé, pas un écart schéma)" >&2
  else
    echo "" >&2
    echo "$SEED_OUTPUT" >&2
    echo "❌ seed:check échoue — le seed est probablement désynchronisé du schéma." >&2
    echo "   Mets à jour packages/shared/src/seed/ pour refléter les nouvelles tables/colonnes." >&2
    exit 2
  fi
else
  echo "  ✅ seed OK" >&2
fi

# 3. Outbox contracts (conformité payload V2)
echo "  → check-outbox-contracts..." >&2
if ! bash scripts/check-outbox-contracts.sh >&2 2>&1; then
  echo "" >&2
  echo "❌ check-outbox-contracts échoue — divergence détectée avec le contrat V2 §08." >&2
  exit 2
fi
echo "  ✅ outbox contracts OK" >&2

# 4. Reviewer conformite-spec — existence + 'GO' + SHA HEAD (R0d).
check_marker "$MARKER_CONFORMITE" "CONFORMITE-SPEC" "reviewer-conformite-spec"

# 5. Reviewer rls-securite — existence + 'GO' + SHA HEAD (R0d).
check_marker "$MARKER_SECURITE" "RLS-SECURITE" "reviewer-rls-securite"

echo "" >&2
echo "✅ GATE PR OK — création autorisée." >&2
exit 0
