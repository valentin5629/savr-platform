#!/usr/bin/env bash
# =============================================================================
# tests-lies.sh — au commit, joue les tests que la BRANCHE a pu casser, pas les
# 3 700 de la suite.
#
# POURQUOI
# --------
# `pre-commit-gate` rejouait `pnpm -w test:unit` en entier à chaque commit. Mesuré
# le 2026-10-08 sur 233 commits d'octobre : 307 s de médiane par commit (20 s en
# juin), 4 à 5 commits par session, soit une vingtaine de minutes par session
# passées à rejouer des tests sans rapport avec le changement. La suite complète
# fait 412 s à elle seule ; typecheck (37 s) et lint (20 s) n'y sont pour rien.
#
# CE QUE ÇA NE RETIRE PAS
# -----------------------
# La suite complète reste jouée, sur le contenu exact qui part en revue :
#   • avant la PR, par `gate-pr` (via `suite-verte.sh`) ;
#   • en CI, par le job `lint-typecheck-test` — status check REQUIS sur `main`.
# Une casse hors du graphe d'imports (un test qui LIT les fichiers du dépôt au
# lieu de les importer, p. ex. `tests/securite/api-routes-gardees`) est donc vue
# à la PR au lieu du commit. Plus tard dans la même session, jamais après le merge.
#
# COMMENT
# -------
# « Lié » = le graphe d'imports de Vitest (`vitest related`) : un test est joué
# s'il importe, directement ou non, un fichier modifié — ou s'il est lui-même
# modifié. Le périmètre est TOUT ce que la branche change par rapport à
# `origin/main` (commits, index, arbre de travail, fichiers non suivis), pas
# seulement l'index : le hook se déclenche AVANT la commande, donc avant le
# `git add` d'un `git add … && git commit …`.
#
# REPLI SUR LA SUITE COMPLÈTE — chaque fois que « lié » ne veut plus rien dire :
#   • un fichier de configuration ou de dépendances change (peut casser n'importe
#     quel test sans qu'aucun import ne le relie) ;
#   • la base de comparaison est introuvable (pas d'`origin/main`).
#
#   bash .claude/hooks/tests-lies.sh              # joue les tests liés
#   bash .claude/hooks/tests-lies.sh --self-test  # non-vacuité du calcul de périmètre
# =============================================================================
set -uo pipefail

BASE_REF="${TESTS_LIES_BASE_REF:-origin/main}"

# Fichiers dont le changement peut casser un test qu'aucun import ne relie à eux.
# stdin = une liste de chemins ; 0 si l'un d'eux impose la suite complète.
exige_suite_complete() {
  grep -Eq '(^|/)package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$|^\.npmrc$|(^|/)tsconfig[^/]*\.json$|^vitest\.(config|setup)\.[cm]?[jt]s$'
}

# Fichiers que le graphe d'imports sait relier à un test. Le reste (SQL, Markdown,
# YAML, scripts shell) n'est importé par aucun test : le passer à Vitest ne
# sélectionnerait rien, et une synchro de specs en ferait des milliers d'arguments.
garde_le_code() {
  grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|css)$' || true
}

# Tout ce que la branche change par rapport à la base. Trois sources, parce
# qu'aucune ne suffit seule : les commits déjà faits, l'index + l'arbre de travail,
# et les fichiers pas encore suivis. Sort en 1 si la base est introuvable.
fichiers_de_la_branche() {
  local base
  base="$(git merge-base HEAD "$BASE_REF" 2>/dev/null)" || return 1
  [ -n "$base" ] || return 1
  {
    git diff --name-only --diff-filter=ACMR "$base" HEAD
    git diff --name-only --diff-filter=ACMR HEAD
    git ls-files --others --exclude-standard
  } | sort -u
}

# ── Auto-test : un périmètre qui oublie une source rend le commit vert à tort ──
self_test() (
  set -uo pipefail
  echec=false
  tmp="$(mktemp -d)" || { echo "🔴 tests-lies : mktemp impossible." >&2; exit 2; }
  trap 'rm -rf "$tmp"' EXIT
  attendu() {  # attendu <libellé> <obtenu> <voulu>
    [ "$2" = "$3" ] || { echo "🔴 $1 : obtenu [$2], attendu [$3]" >&2; echec=true; }
  }

  # — périmètre : dépôt jetable, une source de changement par fichier —
  (
    cd "$tmp" && git init -q -b main . && git config user.email t@t && git config user.name t
    mkdir -p src && echo a > src/intact.ts && echo a > src/supprime.ts && echo a > src/modifie.ts
    git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD
    git checkout -q -b lot
    echo b > src/commite.ts && git add src/commite.ts && git commit -qm lot
    echo b > src/indexe.ts && git add src/indexe.ts
    echo b >> src/modifie.ts
    echo b > src/non-suivi.ts
    git rm -q src/supprime.ts
  ) >/dev/null 2>&1 || { echo "🔴 tests-lies : dépôt jetable non construit." >&2; exit 2; }
  vus="$(cd "$tmp" && fichiers_de_la_branche | tr '\n' ' ')"
  attendu 'périmètre (commit + index + arbre + non suivi, sans le supprimé ni l’intact)' \
    "$vus" 'src/commite.ts src/indexe.ts src/modifie.ts src/non-suivi.ts '

  # — base introuvable : jamais « aucun fichier modifié » —
  rc=0
  (cd "$tmp" && git update-ref -d refs/remotes/origin/main && fichiers_de_la_branche >/dev/null 2>&1) || rc=$?
  attendu 'base introuvable → échec explicite (repli suite complète)' "$rc" '1'

  # — repli sur la suite complète —
  complet() { if printf '%s\n' "$1" | exige_suite_complete; then echo OUI; else echo NON; fi; }
  attendu 'package.json racine'        "$(complet 'package.json')"                       'OUI'
  attendu 'package.json de paquet'     "$(complet 'packages/shared/package.json')"       'OUI'
  attendu 'lockfile'                   "$(complet 'pnpm-lock.yaml')"                     'OUI'
  attendu 'tsconfig de paquet'         "$(complet 'packages/plateforme/tsconfig.json')"  'OUI'
  attendu 'config Vitest'              "$(complet 'vitest.config.ts')"                   'OUI'
  attendu 'setup Vitest'               "$(complet 'vitest.setup.ts')"                    'OUI'
  attendu 'composant ordinaire'        "$(complet 'packages/plateforme/src/components/ui/badge.tsx')" 'NON'
  attendu 'fichier nommé comme une config, ailleurs' "$(complet 'specs/cdc/vitest.config.ts.md')"     'NON'

  # — filtre : seul le code part vers Vitest —
  gardes="$(printf '%s\n' 'a/b.tsx' 'supabase/migrations/1_x.sql' 'specs/cdc/x.md' 'a/[id]/c.ts' 'x.json' | garde_le_code | tr '\n' ' ')"
  attendu 'filtre code' "$gardes" 'a/b.tsx a/[id]/c.ts x.json '

  if [ "$echec" = true ]; then
    echo "🔴 tests-lies : auto-test EN ÉCHEC — le périmètre des tests liés n'est plus fiable." >&2
    exit 2
  fi
  echo "✅ tests-lies : auto-test OK (périmètre sur 4 sources, base introuvable signalée, 6 replis sur la suite complète, filtre code)."
)

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

racine="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "tests-lies : pas dans un dépôt git." >&2; exit 2; }
cd "$racine" || exit 2

if ! modifies="$(fichiers_de_la_branche)"; then
  echo "tests liés : base '$BASE_REF' introuvable — suite complète." >&2
  exec pnpm -w test:unit
fi

if printf '%s\n' "$modifies" | exige_suite_complete; then
  echo "tests liés : la branche touche la configuration ou les dépendances — suite complète." >&2
  exec pnpm -w test:unit
fi

FICHIERS=()
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && FICHIERS+=("$f")
done <<EOF
$(printf '%s\n' "$modifies" | garde_le_code)
EOF

if [ "${#FICHIERS[@]}" -eq 0 ]; then
  echo "tests liés : aucun fichier de code modifié par la branche — aucun test à jouer." >&2
  exit 0
fi

echo "tests liés : ${#FICHIERS[@]} fichier(s) de code modifié(s) par la branche → tests qui en dépendent." >&2
exec pnpm -w exec vitest related --run --passWithNoTests "${FICHIERS[@]}"
