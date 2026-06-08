#!/usr/bin/env bash
# Formate + corrige le fichier qui vient d'etre ecrit/edite.
set -euo pipefail
INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"
[ -z "$FILE" ] && exit 0
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.md|*.css)
    pnpm exec prettier --write "$FILE" >/dev/null 2>&1 || true
    pnpm exec eslint --fix "$FILE" >/dev/null 2>&1 || true
    ;;
esac
exit 0
