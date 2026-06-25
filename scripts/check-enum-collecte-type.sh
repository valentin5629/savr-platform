#!/usr/bin/env bash
# check-enum-collecte-type.sh — Garde anti-récidive cluster C3 (BL-P0-05).
#
# L'enum réel est `plateforme.collecte_type_enum('zero_dechet','anti_gaspi')`.
# Filtrer `collectes.type` avec les littéraux métier 'zd'/'ag' → erreur enum
# Postgres (avalée → KPI à 0). Ce gate flagge tout `.eq('type', 'zd'|'ag')` /
# `.in('type', [… 'zd'|'ag' …])` qui réintroduirait le bug.
#
# MODE RAPPORT (exit 0 toujours) — flippable bloquant par cliquet ultérieur.
# SCOPE volontairement RESTREINT aux requêtes Supabase `.eq/.in('type', …)` :
#   - n'attrape PAS les interfaces de formulaire `type: 'zd' | 'ag'` (codes form
#     mappés vers l'enum par fn_creer_collecte) ;
#   - n'attrape PAS les comparaisons d'affichage `row.type === 'zd'`.
# Émet RATCHET_COUNT=<n> pour intégration cliquet future.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Littéraux 'zd'/'ag' à l'intérieur d'un argument .eq('type', …) / .in('type', […]).
PATTERN="\.(eq|in)\('type', *\[?'(zd|ag)'"

HITS=$(grep -rnE "$PATTERN" packages \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
  --exclude="*.test.ts" --exclude="*.test.tsx" 2>/dev/null || true)

COUNT=$(printf '%s' "$HITS" | grep -c . || true)

if [ "$COUNT" -gt 0 ]; then
  echo "🟡 [report] check-enum-collecte-type : $COUNT littéral(aux) 'zd'/'ag' sur .eq/.in('type') collectes :" >&2
  printf '%s\n' "$HITS" >&2
  echo "   → utiliser l'enum réel 'zero_dechet'/'anti_gaspi' (cf. BL-P0-05 / cluster C3)." >&2
else
  echo "✅ check-enum-collecte-type : 0 littéral 'zd'/'ag' sur .eq/.in('type') collectes."
fi

echo "RATCHET_COUNT=$COUNT"
exit 0
