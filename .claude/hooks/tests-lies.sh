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
# CE QUI EST JOUÉ
# ---------------
#   1. Les tests LIÉS au changement = le graphe d'imports de Vitest (`vitest
#      related`) : un test est joué s'il importe, directement ou non, un fichier
#      modifié — ou s'il est lui-même modifié. Le périmètre est TOUT ce que la
#      branche change par rapport à `origin/main` (commits, index, arbre de
#      travail, fichiers non suivis), pas seulement l'index : le hook se déclenche
#      AVANT la commande, donc avant le `git add` d'un `git add … && git commit …`.
#   2. Les cliquets de SÉCURITÉ (`packages/plateforme/tests/securite/`), à chaque
#      commit dès que la branche change quoi que ce soit. Quatre des six LISENT le
#      dépôt au lieu de l'importer (routes gardées, middleware, crons) : le graphe
#      d'imports ne les relie à rien, et une route d'API ajoutée sans garde
#      passait le commit (mesuré en revue). Une dizaine de secondes.
#
# CE QUE ÇA NE RETIRE PAS
# -----------------------
# La suite complète reste jouée, sur le contenu exact qui part en revue :
#   • avant la PR, par `gate-pr` (via `suite-verte.sh`) ;
#   • en CI, par le job `lint-typecheck-test` — status check REQUIS sur `main`.
# Ce qui échappe encore au commit est donc vu à la PR — plus tard dans la même
# session, jamais après le merge : les autres tests qui lisent le dépôt sans
# l'importer (26 fichiers de test au 2026-10-08, dont 19 lisent du SQL), et tout
# ce qu'un changement SQL, HTML ou Markdown peut casser.
#
# REPLI SUR LA SUITE COMPLÈTE — chaque fois que « lié » ne veut plus rien dire :
#   • un fichier de configuration ou de dépendances change (peut casser n'importe
#     quel test sans qu'aucun import ne le relie) ;
#   • la base de comparaison est introuvable (pas d'`origin/main`).
#
#   bash .claude/hooks/tests-lies.sh              # joue les tests liés
#   bash .claude/hooks/tests-lies.sh --self-test  # non-vacuité
# =============================================================================
set -uo pipefail

# Chemin absolu de ce script, pris avant tout `cd` (l'auto-test le rejoue en entier).
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

BASE_REF="${TESTS_LIES_BASE_REF:-origin/main}"
SECURITE='packages/plateforme/tests/securite'

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

# Tout ce que la branche TOUCHE par rapport à la base, suppressions comprises.
# Trois sources, parce qu'aucune ne suffit seule : les commits déjà faits, l'index
# + l'arbre de travail, et les fichiers pas encore suivis. Sort en 1 si la base
# est introuvable.
# Les suppressions comptent : supprimer un fichier peut casser un cliquet (retirer
# `middleware.ts` rougit `middleware-actif`, mesuré en revue) ou la configuration.
# Un fichier supprimé ne part évidemment pas vers Vitest — le flux principal ne
# garde que ce qui existe encore.
# `core.quotePath=false` : sans lui, git rend un chemin accentué entre guillemets
# et en octal — un nom qui ne désigne plus aucun fichier, écarté en silence.
fichiers_de_la_branche() {
  local base
  base="$(git merge-base HEAD "$BASE_REF" 2>/dev/null)" || return 1
  [ -n "$base" ] || return 1
  {
    git -c core.quotePath=false diff --name-only --diff-filter=ACDMR "$base" HEAD
    git -c core.quotePath=false diff --name-only --diff-filter=ACDMR HEAD
    git -c core.quotePath=false ls-files --others --exclude-standard
  } | LC_ALL=C sort -u
}

# Les cliquets de sécurité présents dans l'arbre de travail.
tests_de_securite() {
  local t
  for t in "$SECURITE"/*.test.ts*; do
    [ -f "$t" ] && printf '%s\n' "$t"
  done
  return 0
}

# ── Auto-test : un périmètre qui oublie une source rend le commit vert à tort ──
self_test() (
  set -uo pipefail
  echec=false
  tmp="$(mktemp -d)" || { echo "🔴 tests-lies : mktemp impossible." >&2; exit 2; }
  faux="$(mktemp -d)" || { echo "🔴 tests-lies : mktemp impossible." >&2; exit 2; }
  trap 'rm -rf "$tmp" "$faux"' EXIT
  attendu() {  # attendu <libellé> <obtenu> <voulu>
    [ "$2" = "$3" ] || { echo "🔴 $1 : obtenu [$2], attendu [$3]" >&2; echec=true; }
  }

  # — périmètre : dépôt jetable, une source de changement par fichier —
  (
    cd "$tmp" && git init -q -b main . && git config user.email t@t && git config user.name t
    mkdir -p src && echo a > src/intact.ts && echo a > src/supprime.ts && echo a > src/modifie.ts
    echo a > src/modifié.ts && echo a > src/supprime-commit.ts
    git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD
    git checkout -q -b lot
    echo b > src/commite.ts && echo b > src/commité.ts && git add src/commite.ts src/commité.ts
    git rm -q src/supprime-commit.ts && git commit -qm lot
    echo b > src/indexe.ts && git add src/indexe.ts
    echo b >> src/modifie.ts
    echo b >> src/modifié.ts
    echo b > src/non-suivi.ts
    echo b > src/sondé.ts
    git rm -q src/supprime.ts
  ) >/dev/null 2>&1 || { echo "🔴 tests-lies : dépôt jetable non construit." >&2; exit 2; }
  vus="$(cd "$tmp" && fichiers_de_la_branche | tr '\n' ' ')"
  attendu 'périmètre (commit + index + arbre + non suivi ; supprimé dans un commit et dans l’index ; noms accentués des trois sources ; sans l’intact)' \
    "$vus" 'src/commite.ts src/commité.ts src/indexe.ts src/modifie.ts src/modifié.ts src/non-suivi.ts src/sondé.ts src/supprime-commit.ts src/supprime.ts '

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

  # — De bout en bout, avec un faux `pnpm` : c'est le flux principal qui lance
  # Vitest et qui rend son verdict. Un script qui ne lancerait plus rien, ou qui
  # avalerait un échec, laisserait passer tous les commits. —
  printf '#!/bin/sh\necho "$*" >> "%s/journal"\nexit "${FAUX_PNPM_CODE:-0}"\n' "$faux" > "$faux/pnpm"
  chmod +x "$faux/pnpm"
  : > "$faux/journal"
  joue() { (cd "$faux/depot" && PATH="$faux:$PATH" FAUX_PNPM_CODE="$1" bash "$ICI" >/dev/null 2>&1); }
  dernier() { tail -1 "$faux/journal"; }
  appels() { wc -l < "$faux/journal" | tr -d ' '; }
  garde="./$SECURITE/garde.test.ts"
  lies='-w exec vitest related --run --passWithNoTests'
  (
    mkdir "$faux/depot" && cd "$faux/depot" && git init -q -b main . && git config user.email t@t && git config user.name t
    mkdir -p src "$SECURITE" && echo a > src/a.ts && echo a > README.md && echo '{}' > package.json
    echo a > "$SECURITE/garde.test.ts"
    git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD
    git checkout -q -b lot
  ) >/dev/null 2>&1 || { echo "🔴 tests-lies : dépôt jetable (bout en bout) non construit." >&2; exit 2; }

  joue 0 || { echo "🔴 branche sans changement : le script sort en erreur." >&2; echec=true; }
  attendu 'branche sans changement → Vitest pas lancé' "$(appels)" '0'
  # Une suppression seule est un changement : les cliquets sont joués, le fichier
  # supprimé ne part pas vers Vitest.
  (cd "$faux/depot" && git rm -q src/a.ts) >/dev/null 2>&1
  joue 0 || { echo "🔴 lot de suppression seule : le script sort en erreur." >&2; echec=true; }
  attendu 'suppression seule → cliquets de sécurité joués' "$(appels)" '1'
  attendu 'suppression seule → le fichier supprimé ne part pas vers Vitest' "$(dernier)" "$lies $garde"
  (cd "$faux/depot" && git reset -q HEAD -- src/a.ts && git checkout -q -- src/a.ts && echo b > README.md) >/dev/null 2>&1
  joue 0 || { echo "🔴 lot sans code : le script sort en erreur." >&2; echec=true; }
  attendu 'lot sans fichier de code → cliquets de sécurité joués' "$(appels)" '2'
  attendu 'lot sans fichier de code → cliquets de sécurité seuls' "$(dernier)" "$lies $garde"
  (cd "$faux/depot" && echo b > src/a.ts)
  joue 0 || { echo "🔴 tests liés verts : le script sort en erreur." >&2; echec=true; }
  attendu 'code modifié → tests liés + cliquets de sécurité' "$(dernier)" "$lies ./src/a.ts $garde"
  if joue 1; then echo "🔴 tests liés rouges : le script sort en 0." >&2; echec=true; fi
  # Un fichier dont le nom commence par un tiret ne doit jamais devenir une option de Vitest.
  (cd "$faux/depot" && echo b > ./--testNamePattern=zzz.ts)
  joue 0
  attendu 'nom de fichier en forme d’option → passé comme chemin' "$(dernier)" "$lies ./--testNamePattern=zzz.ts ./src/a.ts $garde"
  (cd "$faux/depot" && rm ./--testNamePattern=zzz.ts && echo '{"a":1}' > package.json)
  joue 0 || { echo "🔴 suite complète verte : le script sort en erreur." >&2; echec=true; }
  attendu 'dépendances modifiées → suite complète' "$(dernier)" '-w test:unit'
  if joue 1; then echo "🔴 suite complète rouge : le script sort en 0." >&2; echec=true; fi
  (cd "$faux/depot" && git checkout -q -- package.json && git update-ref -d refs/remotes/origin/main)
  # Compté, pas seulement lu : la ligne précédente du journal est déjà « test:unit ».
  avant="$(appels)"
  joue 0
  attendu 'base introuvable → suite complète' "$(dernier)" '-w test:unit'
  attendu 'base introuvable → suite complète réellement lancée' "$(appels)" "$((avant + 1))"

  if [ "$echec" = true ]; then
    echo "🔴 tests-lies : auto-test EN ÉCHEC — le périmètre des tests liés n'est plus fiable." >&2
    exit 2
  fi
  echo "✅ tests-lies : auto-test OK (périmètre sur 4 sources, suppressions et noms accentués compris ; base introuvable signalée ; 6 replis sur la suite complète ; filtre code ; de bout en bout : code modifié et cliquets de sécurité passés à Vitest comme chemins, cliquets joués sur suppression seule, échec propagé, suite complète sur dépendances modifiées ou base introuvable)."
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

if [ -z "$modifies" ]; then
  echo "tests liés : la branche ne change aucun fichier — aucun test à jouer." >&2
  exit 0
fi

# Chaque chemin est préfixé par `./` : un fichier nommé `--quelque-chose` serait
# sinon lu par Vitest comme une option (mesuré en revue : 12 tests passés en
# « skipped », commit vert sur un module cassé).
ARGS=()
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && ARGS+=("./$f")
done <<EOF
$(printf '%s\n' "$modifies" | garde_le_code)
EOF
nb_code="${#ARGS[@]}"
while IFS= read -r t; do
  [ -n "$t" ] && ARGS+=("./$t")
done <<EOF
$(tests_de_securite)
EOF
nb_securite=$((${#ARGS[@]} - nb_code))

if [ "${#ARGS[@]}" -eq 0 ]; then
  echo "tests liés : aucun fichier de code modifié par la branche, aucun cliquet de sécurité dans l'arbre — aucun test à jouer." >&2
  exit 0
fi

echo "tests liés : $nb_code fichier(s) de code modifié(s) par la branche → tests qui en dépendent, plus $nb_securite cliquet(s) de sécurité." >&2
exec pnpm -w exec vitest related --run --passWithNoTests "${ARGS[@]}"
