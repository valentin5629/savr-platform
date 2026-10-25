#!/usr/bin/env bash
# =============================================================================
# ci-perimetre.sh — ce qu'une PR doit faire tourner en CI, d'après ses fichiers.
# =============================================================================
# Décision Val 2026-10-25 (CI à trois niveaux). Les jobs requis tournent TOUJOURS ;
# seules des étapes lourdes sont sautées quand la PR ne peut pas changer leur
# résultat. Écrit deux sorties dans $GITHUB_OUTPUT (et sur la sortie standard) :
#
#   base=true   la base Supabase démarre (migrations + pgTAP). Seuls les fichiers
#               de supabase/ changent le résultat des tests pgTAP ; .github/ et
#               scripts/ portent le démarrage de la base et les scripts qui la lisent.
#   build=true  build Next.js + e2e. Sautés quand la PR ne touche QUE specs/,
#               docs/, fixtures/, supabase/, .claude/ ou des .md : rien de ce que
#               le build compile ou que l'e2e sert.
#
# Les tests unitaires ne sont JAMAIS sautés : ils lisent specs/, docs/,
# supabase/, scripts/, .github/ et fixtures/ (relevé le 2026-10-25).
#
# Sens sûr : hors pull_request, ou si la liste des fichiers ne peut pas être
# établie, les deux sorties valent true. Un plantage du script fait échouer
# l'étape, donc le job.
#
# Usage CI : bash scripts/ci-perimetre.sh   (checkout de la PR, fetch-depth: 2)
# Auto-test : bash scripts/ci-perimetre.sh --self-test
# =============================================================================
set -euo pipefail

# Chemin absolu de ce script, pris avant tout `cd` (l'auto-test le rejoue).
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# Lit une liste de chemins (un par ligne) sur l'entrée standard, écrit
# « base=… » puis « build=… ». Liste vide = rien à juger = tout tourne.
classer() {
  local base=false build=false n=0 f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    n=$((n + 1))
    case "$f" in
      supabase/* | .github/* | scripts/*) base=true ;;
    esac
    case "$f" in
      specs/* | docs/* | fixtures/* | supabase/* | .claude/* | *.md) ;;
      *) build=true ;;
    esac
  done
  if [ "$n" -eq 0 ]; then base=true; build=true; fi
  echo "base=$base"
  echo "build=$build"
}

if [ "${1:-}" = "--self-test" ]; then
  ko=0
  cas() { # cas <libellé> <attendu> <chemins…>
    local libelle="$1" attendu="$2" obtenu
    shift 2
    obtenu="$(printf '%s\n' "$@" | classer | tr '\n' ' ')"
    if [ "$obtenu" != "$attendu " ]; then
      echo "🔴 ci-perimetre [$libelle] : obtenu « $obtenu», attendu « $attendu »" >&2
      ko=1
    fi
  }
  cas 'doc seule' 'base=false build=false' 'docs/claude/x.md' 'README.md'
  cas 'specs seules' 'base=false build=false' 'specs/cdc/a.md' 'specs/manifests/M0.3.json'
  cas 'hooks seuls' 'base=false build=false' '.claude/hooks/gate-pr.sh'
  cas 'fixtures seules' 'base=false build=false' 'fixtures/api/x.json'
  cas 'migration seule' 'base=true build=false' 'supabase/migrations/20261025000000_plateforme_x.sql'
  cas 'test pgTAP seul' 'base=true build=false' 'supabase/tests/x.test.sql'
  cas 'code seul' 'base=false build=true' 'packages/plateforme/src/a.ts'
  cas 'renderer seul' 'base=false build=true' 'apps/pdf-renderer/src/a.ts'
  cas 'md dans packages' 'base=false build=false' 'packages/plateforme/src/lib/CLAUDE.md'
  cas 'code + migration' 'base=true build=true' 'packages/shared/src/a.ts' 'supabase/migrations/x.sql'
  cas 'workflow' 'base=true build=true' '.github/workflows/quality.yml'
  cas 'script' 'base=true build=true' 'scripts/check-coupling.sh'
  cas 'dépendances' 'base=false build=true' 'pnpm-lock.yaml'
  cas 'config racine' 'base=false build=true' 'vitest.config.ts'
  cas 'liste vide' 'base=true build=true'
  cas 'chemin accentué sous supabase' 'base=true build=false' 'supabase/tests/données_é.test.sql'
  cas 'synchro des specs accentuée' 'base=false build=false' 'specs/cdc/01 - Cahier des charges App/05 - Règles métier.md'
  # Le vrai `git diff` du script, sur un commit de fusion qui ajoute un fichier
  # accentué sous supabase/ : il doit voir la base.
  depot="$(mktemp -d "${TMPDIR:-/tmp}/ci-perimetre.XXXXXX")"
  (
    cd "$depot" && git init -q -b main . && git config user.email t@t && git config user.name t &&
      echo a > a.ts && git add -A && git commit -qm base &&
      git checkout -qb pr && mkdir -p supabase/tests && echo x > 'supabase/tests/é.test.sql' &&
      git add -A && git commit -qm pr && git checkout -q main && git merge -q --no-ff pr -m fusion
  ) > /dev/null 2>&1 || { echo "🔴 ci-perimetre : dépôt jetable non construit." >&2; ko=1; }
  sortie="$(cd "$depot" && GITHUB_EVENT_NAME=pull_request GITHUB_OUTPUT=/dev/null bash "$ICI" 2>/dev/null | tr '\n' ' ')"
  [ "$sortie" = "base=true build=false " ] || { echo "🔴 ci-perimetre [git diff, chemin accentué] : « $sortie»" >&2; ko=1; }
  rm -r "$depot"
  # Le classement réel : hors PR, tout tourne.
  sortie="$(GITHUB_EVENT_NAME=push GITHUB_OUTPUT=/dev/null bash "$ICI" | tr '\n' ' ')"
  [ "$sortie" = "base=true build=true " ] || { echo "🔴 ci-perimetre [hors PR] : « $sortie»" >&2; ko=1; }
  [ "$ko" -eq 0 ] || { echo "🔴 ci-perimetre : auto-test EN ÉCHEC." >&2; exit 1; }
  echo "✅ ci-perimetre : auto-test OK (17 cas de classement, git diff réel sur un chemin accentué, hors PR = tout)."
  exit 0
fi

ecrire() {
  printf '%s\n' "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then printf '%s\n' "$1" >> "$GITHUB_OUTPUT"; fi
}

if [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]; then
  echo "Hors pull_request : tout tourne." >&2
  ecrire base=true; ecrire build=true
  exit 0
fi

# Checkout d'une PR = commit de fusion : son 1er parent est la base de la PR.
# `core.quotepath=false` : sans lui, git écrit un chemin non ASCII entre guillemets
# et en octal (« "supabase/tests/\303\251.sql" »), qui ne correspondrait plus à
# `supabase/*` — la base serait sautée à tort.
if ! fichiers="$(git -c core.quotepath=false diff --name-only HEAD^1 HEAD 2>/dev/null)"; then
  echo "::warning::Fichiers de la PR illisibles (fetch-depth: 2 ?) — tout tourne." >&2
  ecrire base=true; ecrire build=true
  exit 0
fi
echo "Fichiers de la PR : $(printf '%s\n' "$fichiers" | grep -c . || true)" >&2
resultat="$(printf '%s\n' "$fichiers" | classer)"
while IFS= read -r ligne; do ecrire "$ligne"; done <<< "$resultat"
