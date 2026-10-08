#!/usr/bin/env bash
# Bloque tout `git commit` si anti-couplage / typecheck / lint / tests LIÉS echouent.
#
# Les tests joues ici sont ceux que la branche a pu casser (graphe d'imports) plus
# les cliquets de securite, pas la suite entiere : cf. l'en-tete de tests-lies.sh
# pour la mesure et pour ce qui reste joue en entier (gate-pr avant la PR, job CI
# requis `lint-typecheck-test`).
set -euo pipefail

# Chemin absolu de ce script, pris avant tout `cd` (l'auto-test le rejoue en entier).
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# ── Reconnaitre la commande — isole en fonction, pour etre TESTABLE ──────────
# Le motif d'origine etait `git`, des blancs, `commit`, precede d'un debut de
# ligne, d'un blanc ou d'un separateur. Il ne voyait pas les options globales que
# git accepte ENTRE les deux mots. Rejoue le 2026-10-08 sur l'historique des
# sessions et de leurs sous-agents : 1 575 commandes vues, et 124 de la forme
# `git <options> commit` jamais vues (114 en septembre, 10 en octobre) — ni
# anti-couplage, ni typecheck, ni lint, ni tests lies. Par premiere forme :
#   git -c core.hooksPath=… commit …               70
#   git -c commit.gpgsign=… commit …               26
#   git -C <dossier> [autres options] commit …     13
#   git -c user.name=… -c user.email=… commit …    12 (depots jetables de sondes)
#   autres (`-c commit.…`, `/usr/bin/git -c …`)     3
#
# Ce que le motif voit desormais :
#   • les options globales entre `git` et `commit` : `-c cle=valeur`,
#     `-C <dossier>`, `--no-pager`, `--git-dir=…`… Une option est un mot qui
#     commence par un tiret, suivi ou non d'une valeur ; une valeur peut porter
#     des guillemets (`-c user.name="A B"`, `-C "/un dossier"`) ;
#   • le binaire appele par son chemin ou precede d'une barre oblique inverse.
# Ce qui precede la commande ne change pas : un debut de ligne, un blanc ou un
# separateur (; & |). Tout ce que l'ancien motif voyait reste vu — rejoue sur le
# meme historique : aucune commande perdue, 124 gagnees.
#
# CE QUI DECLENCHE A TORT, comme avant : une mention precedee d'un blanc
# (`echo "avant git commit"`), et les sous-commandes dont le nom commence par
# `commit` (`git commit-graph`). La garde tourne alors pour rien — elle ne bloque
# que si l'arbre vise est rouge.
#
# CE QUE LE MOTIF NE VOIT PAS — inventaire ouvert, d'autres formes peuvent
# exister :
#   • la commande collee a une parenthese, a un accent grave ou a un guillemet :
#     `(git commit …)`, `$(git commit …)`, `bash -c "git commit …"`,
#     `ssh hote 'git commit …'`, `echo "git commit …" | bash`. L'ancien motif ne
#     les voyait pas non plus. Voir la parenthese et l'accent grave ferait
#     tourner la garde sur les mentions ecrites en Markdown : rejoue sur
#     l'historique, 10 commandes de plus l'auraient declenchee, pour 9 mentions
#     et 2 `git commit-tree`, aucun commit. Voir en plus le texte d'un
#     `sh -c` / `eval` n'en ajoutait aucune ;
#   • le binaire ecrit entre guillemets (`"git" commit`) ;
#   • une valeur d'option dont les guillemets imbriques laissent un blanc a
#     decouvert (`-C "$(echo "/un dossier")"`) ;
#   • `commit` renvoye a la ligne suivante par une barre oblique inverse ;
#   • la commande enfouie dans un script ou derriere un alias ;
#   • un commit fait hors de l'outil Bash de Claude Code (terminal, editeur).
# Le filet qui couvre tous ces chemins est cote GitHub : les status checks requis
# sur `main` rejouent anti-couplage, typecheck, lint et la suite complete.
#
# NE JAMAIS resserrer ce motif sans relancer `--self-test`.
commit_motif() {
  local morceau="([^[:space:]\"']|\"[^\"]*\"|'[^']*')"
  local options="([[:space:]]+-${morceau}+([[:space:]]+${morceau}+)?)*"
  local binaire="\\\\?([^[:space:];&|\"']*/)?git"
  printf '%s' "(^|[;&|[:space:]])${binaire}${options}[[:space:]]+commit"
}
commit_matche() {
  printf '%s' "$1" | grep -Eq "$(commit_motif)"
}

# ── Le dossier ou le commit aura lieu ───────────────────────────────────────
# Le hook tourne dans le dossier ou la session est enracinee, avant que la
# commande n'ait fait son `cd`. Il doit juger le worktree VISE, pas le sien :
#   • `git -C <dossier> … commit` : ce dossier (le dernier `-C` ecrit avant
#     `commit` ; un `-C` relatif est rapporte a la cible du `cd` de tete, sinon
#     au dossier courant). Seul le premier commit de la commande est lu.
#   • sinon la cible du `cd … &&` de tete, comme avant.
# Un `-C` ecrit APRES `commit` est une autre option (reprendre le message d'un
# commit) : il n'est pas lu.
# Limite : un dossier donne par une variable ou une substitution n'est pas
# resolu — le hook juge alors le dossier de la session.
cible_du_commit() {
  local cd_dir premier c_dir
  cd_dir="$(printf '%s' "$1" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
  premier="$(printf '%s' "$1" | grep -oE "$(commit_motif)" | head -1 || true)"
  c_dir="$(printf '%s' "$premier" | sed -nE "s/.*[[:space:]]-C[[:space:]]+(\"([^\"]*)\"|'([^']*)'|([^[:space:]]+)).*/\\2\\3\\4/p" | head -1 || true)"
  case "$c_dir" in
    '') printf '%s' "$cd_dir" ;;
    /*) printf '%s' "$c_dir" ;;
    *)
      case "$cd_dir" in
        /*) printf '%s/%s' "$cd_dir" "$c_dir" ;;
        *) printf '%s/%s' "$PWD" "$c_dir" ;;
      esac
      ;;
  esac
}

# ── Auto-test, 2e partie : le flux du hook, de bout en bout ─────────────────
# Le script ENTIER est rejoue dans un depot jetable a deux worktrees, avec un faux
# `pnpm` et un faux controle anti-couplage qui notent OU ils tournent : un `exit 2`
# retire, un controle qui ne serait plus lance, un commit vise par `-C` juge dans
# le mauvais dossier — rien d'autre ne les ferait rougir. Les scripts voisins
# (`lib-worktree.sh`, `tests-lies.sh`) sont les vrais, pris a cote de celui-ci.
bout_en_bout() (
  set +e
  set -uo pipefail
  ko=false
  bac="$(mktemp -d)" || { echo "🔴 pre-commit-gate : mktemp impossible." >&2; exit 1; }
  trap 'rm -rf "$bac"' EXIT
  bac="$(cd "$bac" && pwd -P)"
  depot="$bac/depot"; autre="$bac/autre"; journal="$bac/journal"; sortie="$bac/sortie"
  mkdir -p "$bac/bin"
  cat > "$bac/bin/pnpm" <<'FAUX'
#!/bin/sh
echo "pnpm $* @ $(pwd -P)" >> "$FAUX_JOURNAL"
case "$*" in
  *typecheck*) exit "${FAUX_TYPECHECK_CODE:-0}" ;;
  *lint*) exit "${FAUX_LINT_CODE:-0}" ;;
  *) exit "${FAUX_TESTS_CODE:-0}" ;;
esac
FAUX
  chmod +x "$bac/bin/pnpm"
  (
    mkdir "$depot" && cd "$depot" && git init -q -b main . && git config user.email t@t && git config user.name t
    mkdir scripts src
    printf '#!/bin/sh\necho "couplage @ $(pwd -P)" >> "$FAUX_JOURNAL"\nexit "${FAUX_COUPLAGE_CODE:-0}"\n' > scripts/check-coupling.sh
    echo a > src/a.ts
    git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD
    git checkout -q -b lot
    git worktree add -q -b autre-lot "$autre" main
  ) >/dev/null 2>&1 || { echo "🔴 pre-commit-gate : depot jetable non construit." >&2; exit 1; }

  # joue <dossier> <commande> [VAR=valeur …] : passe la commande au hook, depuis ce dossier.
  joue() {
    local dossier="$1" commande="$2"
    shift 2
    : > "$journal"
    (cd "$dossier" && jq -n --arg c "$commande" '{tool_input: {command: $c}}' \
      | env PATH="$bac/bin:$PATH" FAUX_JOURNAL="$journal" "$@" "$BASH" "$ICI" > "$sortie" 2>&1)
  }
  attendu() {  # attendu <libelle> <obtenu> <voulu>
    [ "$2" = "$3" ] || { echo "🔴 flux [$1] : obtenu [$2], attendu [$3]" >&2; ko=true; }
  }
  code() {  # code <libelle> <voulu> <dossier> <commande> [VAR=valeur …]
    local libelle="$1" voulu="$2" rc=0
    shift 2
    joue "$@" || rc=$?
    attendu "$libelle" "$rc" "$voulu"
  }
  # Ce que le dernier passage a lance, dans l'ordre, et ou.
  lances() { sed -E 's/^pnpm -w (exec vitest related).*( @ .*)$/\1\2/; s/^pnpm -w //' "$journal" | tr '\n' '|'; }
  local tout_dans_depot="couplage @ ${depot}|typecheck @ ${depot}|lint @ ${depot}|"
  local tout_dans_autre="couplage @ ${autre}|typecheck @ ${autre}|lint @ ${autre}|"

  # 1. Une commande qui ne commite pas : laissee passer, rien n'est lance.
  code 'commande sans commit' 0 "$depot" 'git status --short'
  attendu 'commande sans commit → rien de lance' "$(lances)" ''

  # 2. Un commit ordinaire : les trois controles, dans le dossier de la session.
  # La branche ne change rien : tests-lies n'a aucun test a jouer.
  code 'commit ordinaire' 0 "$depot" 'git commit -m x'
  attendu 'commit ordinaire → controles lances' "$(lances)" "$tout_dans_depot"

  # 3. Les formes que l'ancien motif ne voyait pas : la garde tourne.
  code 'option globale -c' 0 "$depot" 'git -c core.hooksPath=.husky commit -q -m x'
  attendu 'option globale -c → controles lances' "$(lances)" "$tout_dans_depot"
  code 'deux options globales' 0 "$depot" 'git -c user.name="A B" -c user.email=a@b commit -qm x'
  attendu 'deux options globales → controles lances' "$(lances)" "$tout_dans_depot"

  # 4. Chaque controle rouge bloque, et les suivants ne sont pas joues.
  code 'anti-couplage rouge' 2 "$depot" 'git commit -m x' FAUX_COUPLAGE_CODE=1
  attendu 'anti-couplage rouge → arret' "$(lances)" "couplage @ ${depot}|"
  code 'typecheck rouge' 2 "$depot" 'git commit -m x' FAUX_TYPECHECK_CODE=1
  attendu 'typecheck rouge → arret' "$(lances)" "couplage @ ${depot}|typecheck @ ${depot}|"
  code 'lint rouge' 2 "$depot" 'git commit -m x' FAUX_LINT_CODE=1
  attendu 'lint rouge → arret' "$(lances)" "$tout_dans_depot"
  echo b > "$depot/src/a.ts"
  code 'tests lies verts' 0 "$depot" 'git commit -m x'
  attendu 'tests lies verts → Vitest lance' "$(lances)" "${tout_dans_depot}exec vitest related @ ${depot}|"
  code 'tests lies rouges' 2 "$depot" 'git commit -m x' FAUX_TESTS_CODE=1
  code 'tests lies rouges, forme -c' 2 "$depot" 'git -c commit.gpgsign=false commit -q -F -' FAUX_TESTS_CODE=1

  # 5. Le commit vise un autre worktree : c'est LUI qui est juge. `autre` ne porte
  # aucun changement, `depot` en porte un — Vitest ne doit pas etre lance.
  code '-C absolu' 0 "$depot" "git -C $autre commit -m x"
  attendu '-C absolu → juge dans le dossier vise' "$(lances)" "$tout_dans_autre"
  code '-C entre guillemets, suivi de -c' 0 "$depot" "git -C \"$autre\" -c commit.gpgsign=false commit -m x"
  attendu '-C entre guillemets → juge dans le dossier vise' "$(lances)" "$tout_dans_autre"
  code 'cd de tete' 0 "$depot" "cd $autre && git commit -m x"
  attendu 'cd de tete → juge dans le dossier vise' "$(lances)" "$tout_dans_autre"
  code '-C relatif apres un cd' 0 "$depot" "cd $bac && git -C autre commit -m x"
  attendu '-C relatif apres un cd → juge dans le dossier vise' "$(lances)" "$tout_dans_autre"
  code '-C relatif sans cd' 0 "$bac" 'git -C autre commit -m x'
  attendu '-C relatif sans cd → juge dans le dossier vise' "$(lances)" "$tout_dans_autre"
  code '-C l emporte sur le cd' 0 "$autre" "cd $autre && git -C $depot commit -m x"
  attendu '-C l emporte sur le cd → juge dans le dossier vise' "$(lances)" "${tout_dans_depot}exec vitest related @ ${depot}|"
  code '-C apres commit (reprise de message) : pas un dossier' 0 "$autre" 'git commit -C HEAD --no-edit'
  attendu '-C apres commit → juge dans le dossier courant' "$(lances)" "$tout_dans_autre"

  [ "$ko" = false ]
)

# ── Auto-test : la matrice des formes de commande, puis le flux ─────────────
# Une forme par ligne, prefixee de son type :
#   V = commit REEL, doit etre vu ;
#   N = autre commande ou simple mention, ne doit pas declencher ;
#   F = mention prise pour un commit — la garde tourne pour rien, ASSUME ;
#   L = limite connue — commit reel NON vu par ce motif (cf. l'en-tete).
# F et L sont dans la matrice pour qu'un changement de comportement sur ces cas
# se voie, dans un sens comme dans l'autre.
if [ "${1:-}" = "--self-test" ]; then
  echec=false
  nv=0; nn=0; nf=0; nl=0; nc=0
  juge() {  # juge <type> <forme>
    local r voulu
    if commit_matche "$2"; then r=VU; else r="NON VU"; fi
    case "$1" in
      V) voulu=VU; nv=$((nv + 1)) ;;
      F) voulu=VU; nf=$((nf + 1)) ;;
      N) voulu="NON VU"; nn=$((nn + 1)) ;;
      L) voulu="NON VU"; nl=$((nl + 1)) ;;
      *) echo "🔴 type de forme inconnu : [$1]" >&2; echec=true; return 0 ;;
    esac
    [ "$r" = "$voulu" ] || { echo "🔴 motif [$1] : [$2] → $r (attendu $voulu)" >&2; echec=true; }
  }
  while IFS= read -r ligne; do
    [ -n "$ligne" ] || continue
    juge "${ligne%%:*}" "${ligne#*:}"
  done <<'FORMES'
V:git commit -m "x"
V:git add -A && git commit -q -F /tmp/msg.txt
V:cd /tmp/wt && git commit -m x
V:git add f;git commit -m x
V:git add f &&git commit -m x
V:git diff --cached --quiet || git commit -m x
V:GIT_AUTHOR_DATE="2026-01-01T00:00:00" git commit -m x
V:env GIT_COMMITTER_NAME=x git commit -m x
V:if git commit -m x; then echo ok; fi
V:git commit --amend --no-edit
V:git commit --allow-empty -m "ci : relance"
V:git commit -C HEAD~1 --no-edit
V:git -c core.hooksPath=.husky commit -q -F - <<'EOF'
V:git -c commit.gpgsign=false commit -q -F - <<'MSG'
V:git -c user.name=sonde -c user.email=sonde@invalid commit -qm base
V:git -c user.name="Val L" -c user.email=v@x commit -m x
V:git -c user.name='Val L' commit -m x
V:git -C wt-lot commit --quiet -m "remede"
V:git -C /tmp/wt commit -m x
V:git -C "/tmp/un dossier" commit -m x
V:git -C "$(git rev-parse --show-toplevel)" commit -m x
V:git -C "$(dirname "$f")" commit -m x
V:git -C "$C" -c core.hooksPath=/dev/null commit --quiet --no-verify -m x
V:git -C $SP/temoin -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
V:git --no-pager commit -m x
V:git -p commit -m x
V:git --git-dir=/tmp/wt/.git --work-tree=/tmp/wt commit -m x
V:git --git-dir /tmp/wt/.git commit -m x
V:git  commit -m x
V:/usr/bin/git commit -m x
V:\git commit -m x
V:/usr/bin/git -c core.hooksPath=.husky commit -q -F /tmp/m.txt
V:command git commit -m x
V:(cd /tmp/wt && git commit -m x)
V:bash -c "cd /tmp/wt && git commit -m x"
N:git status --short
N:git log --oneline -5
N:git log --grep commit --oneline
N:git log -1 --format=%H # dernier commit
N:git show --stat HEAD
N:git -C /tmp/wt log --format=%s -1
N:git -c core.quotePath=false diff --name-only HEAD
N:git rev-list --count origin/main..HEAD # nombre de commits
N:gh pr view 42 --json commits
N:git diff --stat commit1 commit2
N:echo "git commit est garde"
N:grep -n "git commit" .claude/hooks/pre-commit-gate.sh
N:rg -n 'git -c core.hooksPath=.husky commit' .
N:# mesure en revue, `git commit -m "doc"` sortait en 2 (note Markdown)
N:echo "--- hooks (git commit matcher) ---"
N:NEW=$(git commit-tree "$(git rev-parse origin/main^{tree})" -p origin/main -m x)
F:echo "avant git commit"
F:echo "relancer avec git -c core.hooksPath=.husky commit ensuite"
F:git commit-graph write
L:(git commit -m x)
L:SHA=$(git commit -q -m x && git rev-parse HEAD)
L:SHA=`git commit -q -m x`
L:bash -c "git commit -m x"
L:eval "git -c a=b commit -m x"
L:"git" commit -m x
L:ssh hote 'git commit -m x'
L:echo "git commit -m x" | bash
L:git -C "$(echo "/tmp/un dossier")" commit -m x
L:git -c core.hooksPath=.husky \
FORMES

  # Le dossier vise : ce que `cible_du_commit` rend pour une commande donnee.
  cible() {  # cible <libelle> <commande> <voulu>
    local r
    r="$(cd / && cible_du_commit "$2")"
    nc=$((nc + 1))
    [ "$r" = "$3" ] || { echo "🔴 cible [$1] : [$2] → [$r] (attendu [$3])" >&2; echec=true; }
  }
  cible 'sans cd ni -C' 'git commit -m x' ''
  cible 'cd de tete' 'cd /tmp/wt && git commit -m x' '/tmp/wt'
  cible '-C absolu' 'git -C /tmp/wt commit -m x' '/tmp/wt'
  cible '-C entre guillemets doubles' 'git -C "/tmp/un dossier" commit -m x' '/tmp/un dossier'
  cible '-C entre guillemets simples' "git -C '/tmp/un dossier' commit -m x" '/tmp/un dossier'
  cible '-C suivi de -c' 'git -C /tmp/wt -c a=b commit -m x' '/tmp/wt'
  cible '-C precede de -c' 'git -c a=b -C /tmp/wt commit -m x' '/tmp/wt'
  cible '-C absolu l emporte sur le cd' 'cd /tmp/a && git -C /tmp/b commit -m x' '/tmp/b'
  cible '-C relatif apres un cd absolu' 'cd /tmp/a && git -C sous commit -m x' '/tmp/a/sous'
  cible '-C relatif sans cd' 'git -C sous commit -m x' '//sous'
  cible '-C apres commit : reprise de message, pas un dossier' 'git commit -C HEAD~1 --no-edit' ''
  cible '-C apres commit, avec un cd' 'cd /tmp/wt && git commit -C HEAD~1' '/tmp/wt'
  cible '-C d un autre git, avant le commit' 'git -C /tmp/a status && git commit -m x' ''
  cible 'premier commit seul' 'git -C /tmp/a commit -m x && git -C /tmp/b commit -m y' '/tmp/a'

  bout_en_bout || echec=true

  if [ "$echec" = true ]; then
    echo "🔴 pre-commit-gate : auto-test EN ECHEC — la garde peut etre muette ou juger le mauvais dossier." >&2
    exit 2
  fi
  echo "✅ pre-commit-gate : auto-test OK ($nv commits vus, $nn autres commandes ignorees, $nf declenchements a tort assumes, $nl limites connues ; $nc cibles ; flux de bout en bout : commande ignoree, options globales, chaque controle rouge bloque, worktree vise par -C ou par cd)."
  exit 0
fi

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

commit_matche "$CMD" || exit 0

# Resolu AVANT tout `cd` : le dossier du hook REELLEMENT execute. Les commandes de
# settings.json sont relatives — c'est donc le clone principal pour une session
# qui y est enracinee, et le worktree de la session sinon. C'est la version de
# tests-lies.sh de CE dossier qui doit servir, pas celle de la branche visee par
# la commande : une branche ouverte avant ce lot ne porte pas le script.
HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Worktree-aware (cf. lib-worktree.sh) : ce hook tourne dans le dossier ou la
# session est enracinee (clone principal ou autre worktree). On se place dans le
# worktree VISE par le commit (cf. cible_du_commit) pour que typecheck/lint/tests
# valident SON diff, pas celui du dossier de la session.
. "$HOOKS/lib-worktree.sh"
cd_worktree_for "$(cible_du_commit "$CMD")"

echo "Gate pre-commit : anti-couplage + typecheck + lint + tests lies..." >&2
# Garde-fou 3 TMS-Ready (anti-couplage MTS-1/Everest) — deterministe, sans dependance npm.
if ! bash scripts/check-coupling.sh >&2; then echo "KO anti-couplage -- commit bloque." >&2; exit 2; fi
if ! pnpm -w typecheck >&2; then echo "KO typecheck -- commit bloque." >&2; exit 2; fi
if ! pnpm -w lint >&2;      then echo "KO lint -- commit bloque." >&2;      exit 2; fi
if ! bash "$HOOKS/tests-lies.sh" >&2; then echo "KO tests lies -- commit bloque." >&2; exit 2; fi
echo "OK Gate pre-commit." >&2
exit 0
