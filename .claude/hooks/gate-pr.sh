#!/usr/bin/env bash
# Gate points 2 + 4 : bloque gh pr create sans tests verts + conformite-spec GO.
# Point 3 (divergences) est couvert par le reviewer conformite-spec qui doit les flaguer.
set -euo pipefail

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

if ! printf '%s' "$CMD" | grep -q "gh pr create"; then
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
MARKER_CONFORMITE=".claude/conformite-ok-$(printf '%s' "$BRANCH" | tr '/' '-')"
MARKER_SECURITE=".claude/securite-ok-$(printf '%s' "$BRANCH" | tr '/' '-')"

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

# 4. Reviewer conformite-spec
if [ ! -f "$MARKER_CONFORMITE" ]; then
  echo "" >&2
  echo "❌ REVIEWER CONFORMITE-SPEC MANQUANT — PR bloquée." >&2
  echo "" >&2
  echo "  1. Lance le reviewer : Agent(subagent_type='reviewer-conformite-spec')" >&2
  echo "  2. Si GO : crée le fichier '$MARKER_CONFORMITE'" >&2
  echo "  3. Si NON-GO : corrige les écarts, re-lance le reviewer, puis crée le fichier" >&2
  echo "" >&2
  exit 2
fi
echo "  ✅ conformite-spec GO" >&2

# 5. Reviewer rls-securite
if [ ! -f "$MARKER_SECURITE" ]; then
  echo "" >&2
  echo "❌ REVIEWER RLS-SECURITE MANQUANT — PR bloquée." >&2
  echo "" >&2
  echo "  1. Lance le reviewer : Agent(subagent_type='reviewer-rls-securite')" >&2
  echo "  2. Si GO : crée le fichier '$MARKER_SECURITE'" >&2
  echo "  3. Si NON-GO : corrige les écarts, re-lance le reviewer, puis crée le fichier" >&2
  echo "" >&2
  exit 2
fi
echo "  ✅ rls-securite GO" >&2

echo "" >&2
echo "✅ GATE PR OK — création autorisée." >&2
exit 0
