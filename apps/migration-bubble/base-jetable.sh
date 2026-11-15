#!/usr/bin/env bash
# =============================================================================
# base-jetable.sh — la base locale jetable des répétitions de la migration Bubble.
# =============================================================================
# Monte une pile Postgres Supabase À PART (identifiant de projet et ports
# propres) : ni la pile locale habituelle du dépôt (`savr-platform`, port
# 54322), ni savr-dev, ni la prod ne sont touchées. Les migrations du dépôt y
# sont appliquées sur base neuve, puis le marqueur `migration.base_jetable` est
# posé : sans lui, l'import refuse de tourner.
#
#   bash apps/migration-bubble/base-jetable.sh demarrer   # crée la base si besoin
#   bash apps/migration-bubble/base-jetable.sh arreter    # l'arrête ET efface ses données
#   bash apps/migration-bubble/base-jetable.sh adresse    # affiche l'adresse de connexion
#
# Tout vit hors du dépôt, sous $MIGRATION_BUBBLE_DOSSIER (défaut
# ~/Documents/savr-migration-bubble).
# =============================================================================
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOSSIER="${MIGRATION_BUBBLE_DOSSIER:-$HOME/Documents/savr-migration-bubble}/base-jetable"
PROJET="savr-migration-bubble"
PORT=56322
ADRESSE="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"

case "${1:-}" in
  demarrer)
    mkdir -p "$DOSSIER/supabase"
    # Même configuration que le dépôt, sous un autre nom de projet et d'autres ports (54xxx → 56xxx).
    sed -E -e "s/^project_id = .*/project_id = \"${PROJET}\"/" \
        -e 's/^(port|shadow_port) = 54([0-9]{3})$/\1 = 56\2/' \
        "$RACINE/supabase/config.toml" > "$DOSSIER/supabase/config.toml"
    grep -q "^project_id = \"${PROJET}\"$" "$DOSSIER/supabase/config.toml" \
      || { echo "🔴 identifiant de projet non posé : arrêt." >&2; exit 1; }
    grep -Eq "^port = ${PORT}$" "$DOSSIER/supabase/config.toml" \
      || { echo "🔴 port ${PORT} non posé : arrêt (la pile du dépôt serait visée)." >&2; exit 1; }
    for d in migrations templates; do
      [ -d "$DOSSIER/supabase/$d" ] && mv "$DOSSIER/supabase/$d" "$DOSSIER/supabase/$d.ancien.$$"
      cp -R "$RACINE/supabase/$d" "$DOSSIER/supabase/$d"
    done
    find "$DOSSIER/supabase" -maxdepth 1 -name '*.ancien.*' -exec rm -r {} +
    supabase db start --workdir "$DOSSIER"
    psql "$ADRESSE" -v ON_ERROR_STOP=1 -q -c "CREATE SCHEMA IF NOT EXISTS migration" \
      -c "CREATE TABLE IF NOT EXISTS migration.base_jetable (posee_le timestamptz NOT NULL DEFAULT now())"
    echo "Base jetable prête : $ADRESSE"
    ;;
  arreter)
    supabase stop --no-backup --workdir "$DOSSIER"
    ;;
  adresse)
    echo "$ADRESSE"
    ;;
  *)
    echo "Usage : $0 demarrer | arreter | adresse" >&2
    exit 2
    ;;
esac
