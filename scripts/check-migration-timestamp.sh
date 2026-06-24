#!/usr/bin/env bash
# R0d — anti-collision de timestamp de migration (pré-commit).
# Bug déjà vécu : une nouvelle migration avec un timestamp <= au max du DOSSIER
# passe `psql -f` en local mais provoque un duplicate key schema_migrations en CI
# (invisible localement). Règle : toute migration AJOUTÉE doit avoir le timestamp
# le PLUS GRAND du dossier supabase/migrations/.
set -euo pipefail

MIG_DIR="supabase/migrations"
[ -d "$MIG_DIR" ] || exit 0

# Migrations nouvellement ajoutées et stagées dans ce commit.
STAGED=$(git diff --cached --name-only --diff-filter=A \
  | grep -E "^${MIG_DIR}/[0-9]{14}_.*\.sql$" || true)
[ -z "$STAGED" ] && exit 0

# Timestamps des nouvelles migrations stagées.
NEW_TS=$(for f in $STAGED; do basename "$f" | grep -oE '^[0-9]{14}'; done | sort -u)

# Max timestamp parmi les migrations EXISTANTES (hors les nouvelles).
MAX_OTHER=$(
  ls "${MIG_DIR}"/*.sql 2>/dev/null \
    | xargs -n1 basename 2>/dev/null \
    | grep -oE '^[0-9]{14}' \
    | grep -vxF "$(printf '%s\n' "$NEW_TS")" \
    | sort | tail -1
)

FAIL=false
for ts in $NEW_TS; do
  # Comparaison lexicographique = numérique (timestamps 14 chiffres, même longueur).
  if [ -n "$MAX_OTHER" ] && ! [[ "$ts" > "$MAX_OTHER" ]]; then
    echo "" >&2
    echo "❌  Migration $ts <= max du dossier ($MAX_OTHER) — collision schema_migrations en CI." >&2
    echo "    Renomme la migration avec un timestamp > $MAX_OTHER (ex: $(date -u +%Y%m%d%H%M%S 2>/dev/null || echo '<maintenant>'))." >&2
    echo "    (Le max LOCAL appliqué peut être périmé : c'est le max du DOSSIER qui compte.)" >&2
    echo "" >&2
    FAIL=true
  fi
done

[ "$FAIL" = true ] && exit 2
exit 0
