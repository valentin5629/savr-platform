#!/usr/bin/env bash
# Bloque les commandes destructives.
set -euo pipefail
INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"
PATTERNS='rm[[:space:]]+-rf[[:space:]]+/|git[[:space:]]+push[[:space:]]+.*--force|drop[[:space:]]+(table|schema|database).*cascade|supabase[[:space:]]+db[[:space:]]+reset|truncate[[:space:]]'
if printf '%s' "$CMD" | grep -Eiq "$PATTERNS"; then
  echo "Commande destructive bloquee par le harnais : revue humaine obligatoire." >&2
  exit 2
fi
exit 0
