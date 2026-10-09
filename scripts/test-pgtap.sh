#!/usr/bin/env bash
# =============================================================================
# test-pgtap.sh — lanceur LOCAL des tests pgTAP (`pnpm test:pgtap`)
# =============================================================================
# Joue par psql les fichiers supabase/tests/<motif>.test.sql et rend un verdict
# par fichier. Ce n'est PAS le lanceur de la CI : le job `pgtap-rls-outbox` passe
# par `supabase test db` (pg_prove), sur tout le dossier.
#
# Usage :
#   DATABASE_URL=postgresql://… pnpm test:pgtap                  # motif par défaut : M*
#   DATABASE_URL=postgresql://… pnpm test:pgtap M0_6__cat_1-2    # un seul fichier
#   bash scripts/test-pgtap.sh --self-test                       # auto-test, sans base
#
# Le motif par défaut est `M*` : un fichier dont le nom ne commence pas par un M
# majuscule n'est pas joué.
#
# Sortie : 0 = chaque fichier joué est vert ; 1 = au moins un fichier rouge, ou
# aucun fichier pour ce motif ; 2 = DATABASE_URL absent (rien n'est joué), ou
# auto-test en échec.
#
# UN FICHIER EST VERT quand les trois sont vrais, ROUGE sinon :
#   1. psql sort en 0 ;
#   2. aucune ligne `not ok N` ;
#   3. il y a autant de lignes `ok N` et `not ok N` que le plan `1..N` en annonce.
#
# Avant le 2026-10-09 ce lanceur ne voyait aucun des trois. Mesuré ce jour-là sur
# les 8 fichiers M* et la base locale (psql 16.14, serveur PostgreSQL 17.6) : il
# affichait « Total: 8 | Passed: 8 | Failed: 0 » et sortait en 0, alors qu'un
# fichier portait une assertion en échec et que quatre autres portaient des
# erreurs SQL, 0 à 3 assertions jouées sur 9 à 22 prévues.
#
# Ce que porte chaque option de psql (mêmes mesures) :
#   • `-A` : sans elle psql aligne ses colonnes et chaque ligne pgTAP sort
#     précédée d'un espace (` 1..11`, ` ok 1 - …`, ` not ok 5 - …`). Aucune ne
#     commence alors la ligne, et ce lanceur ne lit que les débuts de ligne.
#   • `-X` : avec un fichier de démarrage de psql (désigné par PSQLRC) qui demande
#     `\pset format aligned` et `\pset tuples_only off`, les lignes sortent de
#     nouveau précédées d'un espace malgré `-A -t`. `-X` empêche de le lire.
#   • `-v ON_ERROR_STOP=1` : sans elle psql sortait en 0 sur les quatre fichiers
#     en erreur. Avec elle il s'arrête à la première erreur SQL et sort en 3.
#     Connexion refusée : psql sort en 2.
#   • `-t` : retire les en-têtes de colonne et les « (1 ligne) » de la sortie
#     affichée quand un fichier est rouge. Le verdict n'en dépend pas (mêmes
#     comptes avec et sans, sur quatre fichiers).
#
# Lecture de la sortie : `sed -n` et `grep -c` lisent le texte jusqu'au bout. La
# forme d'avant, `echo "$sortie" | grep -q …` sous `pipefail`, laissait le STATUT
# du tube décider : grep sort au premier résultat alors qu'echo n'a pas fini
# d'écrire, et le tube sort en erreur (statuts relevés : 141 pour echo, 0 pour
# grep ; 1 et 0 quand SIGPIPE est ignoré). Le motif est alors dit absent. Mesuré
# le 2026-10-09 sur une sortie de 329 623 caractères dont la première ligne est
# `not ok 1`, 200 essais, sous macOS 26.5.1 (/bin/bash 3.2.57, grep BSD 2.6.0) et
# sous Ubuntu 22.04 en conteneur Docker (bash 5.1.16, grep GNU 3.7) : la forme
# d'avant n'a vu cette ligne dans aucun essai, `grep -c` l'a comptée dans tous.
#
# PAS DE MODE « PROJET LIÉ ». Sans DATABASE_URL, ce lanceur passait par
# `supabase db query --linked --file`. Mesuré le 2026-10-09 (CLI 2.105.0, projet
# de développement, fichiers de requêtes constantes en lecture seule) :
#   • le CLI ne rend qu'UN jeu de résultats par fichier, le dernier qui porte des
#     lignes : de deux `SELECT` constants, seul le second revient ;
#   • il le rend dans un tableau à bordures avec `--agent no`, dans une enveloppe
#     JSON sans cette option depuis une session Claude Code ;
#   • une erreur SQL le fait sortir en 1.
# Les lignes `ok` et `not ok` d'un fichier ne peuvent donc pas y être comptées :
# aucun verdict n'est possible, et ce lanceur ne lance plus rien dans ce mode.
# Non mesuré : un vrai fichier pgTAP dans ce mode (il écrit ses données d'essai).
# Avec `--local`, la même commande refuse tout fichier à plusieurs instructions
# (« cannot insert multiple commands into a prepared statement », sortie 1).
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Auto-test (`--self-test`) — joué en CI (job `migration-timestamp`), sans base.
#
# Un faux `psql`, placé en tête du PATH, écrit le contenu du fichier reçu par
# `-f` comme le vrai psql écrit la sortie d'un test (mesures de l'en-tête) :
#   • sans `-A`, chaque ligne sort précédée d'un espace ;
#   • sans `-X` aussi : il joue un poste dont le fichier de démarrage de psql
#     demande le format aligné ;
#   • une ligne `ERROR:` ne l'arrête, sortie 3, qu'avec ON_ERROR_STOP=1 ; sans
#     cette option il écrit tout et sort en 0.
# Chaque fichier d'essai porte donc la sortie qu'il est censé produire.
# ---------------------------------------------------------------------------
self_test() (
  local script_abs bac remplissage grosse_rouge echec=false
  script_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  bac=$(mktemp -d) || { echo "🔴 AUTO-TEST : mktemp -d impossible." >&2; return 2; }
  [ -n "$bac" ] && [ -d "$bac" ] || { echo "🔴 AUTO-TEST : répertoire jetable invalide." >&2; return 2; }
  trap 'rm -rf "$bac"' EXIT
  mkdir -p "$bac/bin" "$bac/depot/supabase/tests"
  cd "$bac/depot" || { echo "🔴 AUTO-TEST : accès au dépôt jetable impossible." >&2; return 2; }

  cat > "$bac/bin/psql" <<'FAUX'
#!/usr/bin/env bash
vu_A=non vu_X=non arret=non fichier=""
while [ $# -gt 0 ]; do
  case "$1" in
    -A) vu_A=oui ;;
    -X) vu_X=oui ;;
    ON_ERROR_STOP=1) arret=oui ;;
    -f) fichier="$2"; shift ;;
  esac
  shift
done
echo psql >> "$(dirname "$0")/appels"
code=0
if [ "$arret" = oui ] && grep -q 'ERROR:' "$fichier"; then
  texte=$(sed '/ERROR:/q' "$fichier")
  code=3
else
  texte=$(cat "$fichier")
fi
if [ "$vu_A$vu_X" = ouioui ]; then
  printf '%s\n' "$texte"
else
  printf '%s\n' "$texte" | sed 's/^/ /'
fi
exit "$code"
FAUX
  # Faux `supabase` : il ne fait que laisser une trace. Ce lanceur ne doit plus
  # l'appeler (cf. « PAS DE MODE PROJET LIÉ »).
  cat > "$bac/bin/supabase" <<'FAUX'
#!/usr/bin/env bash
echo supabase >> "$(dirname "$0")/appels"
FAUX
  chmod +x "$bac/bin/psql" "$bac/bin/supabase"

  # essai <nom> <sortie que psql est censé écrire pour ce fichier>
  essai() { printf '%s\n' "$2" > "supabase/tests/$1.test.sql"; }

  essai M_verte "1..3
ok 1 - a
ok 2 - b
ok 3 - c"
  essai M_rouge_debut "1..3
not ok 1 - a
# Failed test 1: \"a\"
ok 2 - b
ok 3 - c
# Looks like you failed 1 test of 3"
  essai M_rouge_milieu "1..3
ok 1 - a
not ok 2 - b
# Failed test 2: \"b\"
ok 3 - c
# Looks like you failed 1 test of 3"
  essai M_rouge_fin "1..3
ok 1 - a
ok 2 - b
not ok 3 - c
# Failed test 3: \"c\"
# Looks like you failed 1 test of 3"
  # Erreur SQL APRÈS la dernière assertion : le plan est tenu, rien n'est
  # `not ok`. Seul le code de sortie de psql peut la rendre rouge.
  essai M_erreur_sql "1..3
ok 1 - a
ok 2 - b
ok 3 - c
psql:M_erreur_sql.test.sql:9: ERROR:  relation \"inconnue\" does not exist"
  essai M_plan_incomplet "1..3
ok 1 - a
ok 2 - b"
  : > supabase/tests/M_muette.test.sql

  # Très grosses sorties : plus de 300 000 caractères de diagnostics pgTAP.
  remplissage=$(head -c 320000 /dev/zero | tr '\0' 'x' | fold -w 100 | sed 's/^/# /')
  essai M_grosse_verte "1..1
ok 1 - a
$remplissage"
  grosse_rouge="not ok 1 - a
$remplissage
1..1"
  essai M_grosse_rouge "$grosse_rouge"

  # Gardes anti-essai-vacant. Les deux grosses sorties ne prouvent quelque chose
  # que si elles sont VRAIMENT grosses, et si la lecture d'avant manque VRAIMENT
  # le `not ok` de la grosse rouge sur la machine qui joue ce test. Tube nu sous
  # `pipefail` VOULU, donc : c'est la lecture d'avant, rejouée pour constater
  # qu'elle se trompe ici. `2>/dev/null` : le message d'echo quand SIGPIPE est
  # ignoré.
  if [ "${#remplissage}" -le 300000 ]; then
    echo "🔴 AUTO-TEST : grosses sorties VACANTES — ${#remplissage} caractères de remplissage, plus de 300 000 attendus." >&2
    echec=true
  elif ( set -o pipefail; echo "$grosse_rouge" 2>/dev/null | grep -q "^not ok" ); then
    echo "🔴 AUTO-TEST : M_grosse_rouge VACANTE — la lecture d'avant voit son « not ok » ici (${#grosse_rouge} caractères) : grossir le remplissage." >&2
    echec=true
  fi

  # cas <motif de fichiers> <sortie attendue> <texte attendu> <ce que l'échec veut dire>
  # Le texte attendu est cherché par `case`, sans tube : la sortie du lanceur
  # contient celle d'un fichier rouge, jusqu'à plus de 300 000 caractères.
  cas() {
    local rc=0 sortie
    sortie=$(PATH="$bac/bin:$PATH" DATABASE_URL="faux://base" bash "$script_abs" "$1" 2>&1) || rc=$?
    case "$sortie" in
      *"$3"*) [ "$rc" -eq "$2" ] && return 0 ;;
    esac
    echo "🔴 AUTO-TEST : $1 — attendu « $3 » et sortie $2, obtenu sortie $rc. $4" >&2
    echec=true
  }

  cas M_verte 0 "Running M_verte.test.sql ... PASS" \
    "Une sortie verte n'est plus dite verte."
  cas M_rouge_debut 1 "Running M_rouge_debut.test.sql ... FAIL" \
    "Une assertion en échec en tête de fichier passe pour verte."
  cas M_rouge_milieu 1 "Running M_rouge_milieu.test.sql ... FAIL" \
    "Une assertion en échec en milieu de fichier passe pour verte."
  cas M_rouge_fin 1 "Running M_rouge_fin.test.sql ... FAIL" \
    "Une assertion en échec en fin de fichier passe pour verte."
  cas M_erreur_sql 1 "Running M_erreur_sql.test.sql ... FAIL" \
    "Une erreur SQL passe pour verte."
  cas M_plan_incomplet 1 "Running M_plan_incomplet.test.sql ... FAIL" \
    "Un plan incomplet passe pour vert."
  cas M_muette 1 "Running M_muette.test.sql ... FAIL" \
    "Un fichier qui n'écrit rien passe pour vert."
  cas M_grosse_verte 0 "Running M_grosse_verte.test.sql ... PASS" \
    "Une très grosse sortie verte n'est plus dite verte."
  cas M_grosse_rouge 1 "Running M_grosse_rouge.test.sql ... FAIL" \
    "Une assertion en échec suivie d'une très grosse sortie passe pour verte."
  # Tous les fichiers ensemble : un rouge parmi des verts reste compté.
  cas "M_*" 1 "Total: 9 | Passed: 2 | Failed: 7" \
    "Le décompte des fichiers est faux."
  # Aucun fichier pour le motif : rien n'est joué, ce n'est pas un vert.
  cas M_absente 1 "Aucun fichier de test trouvé : supabase/tests/M_absente.test.sql" \
    "Un motif qui ne désigne aucun fichier passe pour vert."

  # Sans DATABASE_URL : sortie 2, et ni psql ni le CLI Supabase ne sont lancés.
  : > "$bac/bin/appels"
  local rc=0
  PATH="$bac/bin:$PATH" env -u DATABASE_URL bash "$script_abs" M_verte >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ] || [ -s "$bac/bin/appels" ]; then
    echo "🔴 AUTO-TEST : sans DATABASE_URL — sortie $rc (2 attendu), commandes lancées : $(tr '\n' ' ' < "$bac/bin/appels")." >&2
    echec=true
  fi

  [ "$echec" = true ] && return 1
  echo "✅ test-pgtap : auto-test OK (sortie verte, assertion en échec au début, au milieu, à la fin, erreur SQL, plan incomplet, fichier muet, très grosses sorties verte et rouge, décompte, motif sans fichier, refus sans DATABASE_URL)."
  return 0
)

if [ "${1:-}" = "--self-test" ]; then
  self_test || exit 2
  exit 0
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL absent : aucun test n'a été joué." >&2
  echo "  Ce lanceur ne passe plus par le projet lié (cf. l'en-tête de $0)." >&2
  echo "  Base Supabase locale : DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:pgtap" >&2
  exit 2
fi

# Couleurs seulement vers un terminal : une sortie capturée reste du texte nu.
if [ -t 1 ]; then
  RED=$'\033[0;31m' GREEN=$'\033[0;32m' YELLOW=$'\033[1;33m' NC=$'\033[0m'
else
  RED="" GREEN="" YELLOW="" NC=""
fi

# Récupère le fichier spécifique ou tous les fichiers de test
TEST_PATTERN="${1:-M*}.test.sql"
TEST_FILES=$(find supabase/tests -maxdepth 1 -name "$TEST_PATTERN" | sort)

if [[ -z "$TEST_FILES" ]]; then
  echo "${RED}✗ Aucun fichier de test trouvé : supabase/tests/$TEST_PATTERN${NC}"
  exit 1
fi

echo "${YELLOW}=== pgTAP Test Runner ===${NC}"
echo "Mode : psql"
echo ""

total_files=0
passed_files=0
failed_files=0

for test_file in $TEST_FILES; do
  total_files=$((total_files + 1))
  echo -n "Running $(basename "$test_file") ... "

  code=0
  sortie=$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -f "$test_file" 2>&1) || code=$?

  # `|| true` : grep -c sort en 1 quand il compte zéro ligne.
  prevu=$(printf '%s\n' "$sortie" | sed -n 's/^1\.\.\([0-9][0-9]*\)$/\1/p')
  joue=$(printf '%s\n' "$sortie" | grep -cE '^(not )?ok [0-9]+') || true
  en_echec=$(printf '%s\n' "$sortie" | grep -cE '^not ok [0-9]+') || true

  motif=""
  [ "$code" = 0 ] || motif="psql est sorti en $code"
  [ "$en_echec" = 0 ] || motif="${motif:+$motif ; }$en_echec assertion(s) en échec"
  [ "$joue" = "$prevu" ] || motif="${motif:+$motif ; }$joue assertion(s) jouée(s), plan : ${prevu:-absent}"

  if [ -z "$motif" ]; then
    echo "${GREEN}PASS${NC}"
    passed_files=$((passed_files + 1))
  else
    echo "${RED}FAIL${NC}"
    echo "  → $motif"
    echo "Sortie de psql :"
    echo "$sortie"
    failed_files=$((failed_files + 1))
  fi
done

echo ""
echo "${YELLOW}=== Summary ===${NC}"
echo "Total: $total_files | Passed: $passed_files | Failed: $failed_files"

if [[ $failed_files -eq 0 ]]; then
  echo "${GREEN}✓ All tests passed!${NC}"
  exit 0
else
  echo "${RED}✗ Some tests failed${NC}"
  exit 1
fi
