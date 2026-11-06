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

# Lit une liste de chemins séparés par un octet NUL sur l'entrée standard (aucun
# nom de fichier ne peut contenir NUL : tabulation, guillemet ou saut de ligne
# passent), écrit « base=… » puis « build=… ». Liste vide = tout tourne.
classer() {
  local base=false build=false n=0 f
  while IFS= read -r -d '' f; do
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
    obtenu="$( (if [ "$#" -gt 0 ]; then printf '%s\0' "$@"; fi) | classer | tr '\n' ' ')"
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
  # Le vrai `git diff` du script, rejoué sur un commit de fusion jetable.
  # banc <libellé> <attendu> <commande qui modifie la branche de PR>
  banc() {
    local libelle="$1" attendu="$2" geste="$3" depot sortie
    depot="$(mktemp -d "${TMPDIR:-/tmp}/ci-perimetre.XXXXXX")"
    if ! (
      cd "$depot" && git init -q -b main . && git config user.email t@t && git config user.name t &&
        mkdir -p supabase/tests supabase/migrations docs packages &&
        echo r > supabase/tests/rls.test.sql && echo m > supabase/migrations/20260101000000_x.sql &&
        echo a > packages/a.ts && git add -A && git commit -qm base &&
        git checkout -qb pr && eval "$geste" && git add -A && git commit -qm pr &&
        git checkout -q main && git merge -q --no-ff pr -m fusion
    ) > /dev/null 2>&1; then
      echo "🔴 ci-perimetre [$libelle] : dépôt jetable non construit." >&2; ko=1; rm -r "$depot"; return
    fi
    sortie="$(cd "$depot" && GITHUB_EVENT_NAME=pull_request GITHUB_OUTPUT=/dev/null bash "$ICI" 2>/dev/null | tr '\n' ' ')"
    [ "$sortie" = "$attendu " ] || { echo "🔴 ci-perimetre [git diff, $libelle] : « $sortie», attendu « $attendu »" >&2; ko=1; }
    rm -r "$depot"
  }
  banc 'chemin accentué' 'base=true build=false' "echo x > 'supabase/tests/é.test.sql'"
  banc 'test RLS sorti de supabase' 'base=true build=false' 'git mv supabase/tests/rls.test.sql docs/rls.test.sql'
  banc 'migration sortie de supabase' 'base=true build=true' 'git mv supabase/migrations/20260101000000_x.sql packages/x.sql'
  banc 'tabulation et guillemet' 'base=true build=false' "printf x > \"\$(printf 'supabase/tests/t\\tq\\\"x.sql')\""
  banc 'suppression sous supabase' 'base=true build=false' 'git rm -q supabase/tests/rls.test.sql'
  banc 'doc seule' 'base=false build=false' 'echo d > docs/x.md'
  # Le classement réel : hors PR, tout tourne.
  sortie="$(GITHUB_EVENT_NAME=push GITHUB_OUTPUT=/dev/null bash "$ICI" | tr '\n' ' ')"
  [ "$sortie" = "base=true build=true " ] || { echo "🔴 ci-perimetre [hors PR] : « $sortie»" >&2; ko=1; }
  [ "$ko" -eq 0 ] || { echo "🔴 ci-perimetre : auto-test EN ÉCHEC." >&2; exit 1; }
  echo "✅ ci-perimetre : auto-test OK (17 cas de classement ; git diff réel : accent, déplacements hors de supabase/, tabulation et guillemet, suppression, doc seule ; hors PR = tout)."
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
#   --no-renames : un fichier déplacé hors de supabase/ est listé sous son ANCIEN
#     et son nouveau chemin (avec la détection de renommage, seul le nouveau
#     sortait : un test RLS déplacé dans docs/ sautait la base) ;
#   -z + core.quotepath=false : chemins séparés par NUL, écrits tels quels (sans
#     eux, un nom accentué ou contenant une tabulation sortait entre guillemets
#     et ne correspondait plus à `supabase/*`).
# La liste passe par un fichier : une variable bash ne garde pas les octets NUL.
liste="$(mktemp "${TMPDIR:-/tmp}/ci-perimetre-liste.XXXXXX")"
trap 'rm -f "$liste"' EXIT
if ! git -c core.quotepath=false diff --no-renames --name-only -z HEAD^1 HEAD > "$liste" 2>/dev/null; then
  echo "::warning::Fichiers de la PR illisibles (fetch-depth: 2 ?) — tout tourne." >&2
  ecrire base=true; ecrire build=true
  exit 0
fi
echo "Fichiers de la PR : $(tr -cd '\0' < "$liste" | wc -c | tr -d ' ')" >&2
resultat="$(classer < "$liste")"
while IFS= read -r ligne; do ecrire "$ligne"; done <<< "$resultat"
