#!/usr/bin/env bash
# Vérifie que specs/ a été synchronisé depuis le Vault dans les 8 dernières heures.
# Bloquant seulement si des fichiers specs/cdc/** sont stagés dans le commit courant.
# NE s'applique PAS si aucun fichier specs/ n'est modifié dans le commit.
set -euo pipefail

SYNC_FILE="specs/SYNC.md"
MAX_AGE_SECONDS=$((8 * 60 * 60))

# Bloquant seulement si des fichiers specs/cdc/** ou specs/tests/** sont stagés.
# specs/manifests/ (suivi interne) est exclu : les manifests ne dépendent pas du sync Vault.
STAGED_SPECS=$(git diff --cached --name-only | grep -E '^specs/(cdc|tests|ddl-cible|fixtures)/' || true)
if [[ -z "$STAGED_SPECS" ]]; then
  exit 0
fi

if [[ ! -f "$SYNC_FILE" ]]; then
  echo "⚠️  pre-commit : specs/SYNC.md absent — lancer 'bash scripts/sync-specs.sh'" >&2
  exit 2
fi

# Âge du fichier SYNC.md en secondes
if stat -f "%m" "$SYNC_FILE" &>/dev/null; then
  # macOS
  mtime=$(stat -f "%m" "$SYNC_FILE")
else
  # Linux
  mtime=$(stat -c "%Y" "$SYNC_FILE")
fi
now=$(date +%s)
age=$(( now - mtime ))

if (( age > MAX_AGE_SECONDS )); then
  hours=$(( age / 3600 ))
  echo "❌  pre-commit : specs/ vieux de ${hours}h (max 8h) — lancer 'bash scripts/sync-specs.sh'" >&2
  exit 2
fi

exit 0
