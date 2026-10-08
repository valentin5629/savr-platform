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
# sessions et de leurs sous-agents (1 954 commandes distinctes ou `git` et
# `commit` partagent une ligne) : 1 426 vues par l'ancien motif, et 122 de la
# forme `git <options> commit` jamais vues (112 en septembre, 10 en octobre).
# Sur ces 122, 108 executent le commit — sans anti-couplage, ni typecheck, ni
# lint, ni tests lies ; les 14 autres ne portent la forme que dans le corps d'un
# heredoc (un script ecrit ou edite par la commande). Les 122, par premiere
# forme :
#   git -c core.hooksPath=… commit …               70
#   git -c commit.gpgsign=… commit …               26
#   git -C <dossier> [autres options] commit …     13
#   git -c user.name=… -c user.email=… commit …    12 (depots jetables de sondes)
#   /usr/bin/git -c core.hooksPath=… commit …       1
#
# Ce que le motif voit desormais, entre `git` et `commit` — liste FERMEE : les
# options de la page de manuel de git 2.50.1, plus deux que git accepte sans
# les y decrire (`--no-literal-pathspecs`, `--shallow-file`), toutes essayees
# une par une :
#   • les options a valeur separee, valeur OBLIGATOIRE : `-c cle=valeur`,
#     `-C <dossier>`, `--git-dir`, `--work-tree`, `--namespace`, `--config-env`,
#     `--attr-source`, `--shallow-file`. La valeur peut porter des guillemets
#     (`-c user.name="A B"`, `-C "/un dossier"`) ;
#   • les drapeaux sans valeur : `-p`, `-P`, `--paginate`, `--no-pager`, `--bare`,
#     `--no-replace-objects`, `--no-lazy-fetch`, `--no-optional-locks`,
#     `--no-advice`, les quatre `--…-pathspecs` et `--no-literal-pathspecs` ;
#   • toute option longue a valeur collee (`--git-dir=…`, `--exec-path=…`) ;
#   • le binaire appele par son chemin ou precede d'une barre oblique inverse.
# La liste est fermee pour une raison mesuree en revue : avec « un mot en tiret,
# suivi ou non d'une valeur », `-c` sans valeur laissait lire `commit` au debut
# de `commit.gpgsign=false`, et un drapeau avalait la sous-commande. La garde
# tournait — et bloquait, arbre rouge — sur `git -c commit.gpgsign=false rebase
# --continue` et `… stash push` (les 2 commandes de l'historique dans ce cas),
# comme sur `git --no-pager log --grep commit`.
# Ce qui precede la commande ne change pas : un debut de ligne, un blanc ou un
# separateur (; & |). Tout ce que l'ancien motif voyait reste vu — rejoue sur le
# meme historique : aucune commande perdue, 122 gagnees.
#
# CE QUI DECLENCHE A TORT — releve, d'autres cas peuvent exister : une mention
# precedee d'un blanc (`echo "avant git commit"`), desormais aussi quand elle
# porte des options (`echo "relancer avec git -c a=b commit"`) ; la forme ecrite
# dans le corps d'un heredoc, que la commande n'execute pas (14 des 122
# commandes gagnees) ; et les sous-commandes dont le nom commence par `commit`
# (`git commit-graph`). La garde tourne alors pour rien — elle ne bloque que si
# un arbre vise est rouge.
#
# CE QUE LE MOTIF NE VOIT PAS — inventaire ouvert, d'autres formes peuvent
# exister :
#   • une option globale absente de la liste ci-dessus : le manuel n'est pas
#     exhaustif (les deux ajoutees ont ete relevees en revue), et git en ajoute ;
#   • une valeur d'option faite d'une substitution SANS guillemets qui contient
#     un blanc (`-C $(git rev-parse --show-toplevel)`), ou d'un blanc echappe
#     (`-C /un\ dossier`) ;
#   • la commande collee a une parenthese, a un accent grave ou a un guillemet :
#     `(git commit …)`, `$(git commit …)`, `bash -c "git commit …"`,
#     `ssh hote 'git commit …'`, `echo "git commit …" | bash`. L'ancien motif ne
#     les voyait pas non plus. Voir la parenthese et l'accent grave ferait
#     tourner la garde sur les mentions ecrites en Markdown : rejoue sur
#     l'historique, 10 commandes de plus l'auraient declenchee — 8 qui ne font
#     que citer la commande, 2 `git commit-tree`, aucun commit. Voir en plus le
#     texte d'un `sh -c` / `eval` n'en ajoutait aucune ;
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
  local avec_valeur="(-c|-C|--git-dir|--work-tree|--namespace|--config-env|--attr-source|--shallow-file)[[:space:]]+${morceau}+"
  local drapeau='-p|-P|--paginate|--no-pager|--bare|--no-replace-objects|--no-lazy-fetch|--no-optional-locks|--no-advice|--(literal|glob|noglob|icase|no-literal)-pathspecs'
  local collee="--[a-z-]+=${morceau}*"
  local options="([[:space:]]+(${avec_valeur}|${drapeau}|${collee}))*"
  local binaire="\\\\?([^[:space:];&|\"']*/)?git"
  printf '%s' "(^|[;&|[:space:]])${binaire}${options}[[:space:]]+commit"
}
# Le tube est lu dans un sous-shell SANS `pipefail` : le statut est celui de grep
# seul. Sous `pipefail`, quand du texte suit la ligne du motif et depasse le
# tampon du tube, grep sort au premier resultat, printf recoit SIGPIPE, le tube
# sort en erreur et la commande etait lue « non vue » (mesure en revue, deja
# vrai de l'ancien motif). Pas de chaine-ici : bash 3.2 l'ecrit dans un fichier
# temporaire, et la lecture echoue quand ce fichier ne peut pas etre cree.
commit_matche() {
  (
    set +o pipefail
    printf '%s' "$1" 2> /dev/null | grep -Eq "$(commit_motif)"
  )
}

# ── Les dossiers ou la commande commite ─────────────────────────────────────
# Le hook tourne dans le dossier ou la session est enracinee, avant que la
# commande n'ait fait son `cd`. Il doit juger chaque worktree VISE, pas le sien.
# TOUTES les occurrences du motif sont lues, pas seulement la premiere, et
# chacune donne un dossier a juger :
#   • sans `-C` : la cible du `cd … &&` de tete, sinon le dossier du hook — ce
#     que jugeait deja l'ancien hook. Ce dossier est en outre rendu d'office, et
#     en premier, pour toute commande que l'ancien motif voit : la garde ne juge
#     jamais moins que lui ;
#   • avec `-C <dossier>` ecrit en clair et qui existe : ce dossier. Plusieurs
#     `-C` s'enchainent comme pour git (un `-C` relatif part du precedent, sinon
#     de la cible du `cd` de tete, sinon du dossier du hook) ;
#   • avec `-C "$VAR"` (ou `$VAR/sous-dossier`) : le dossier que donne le texte
#     `VAR=valeur` quand la commande le porte UNE seule fois, valeur en clair,
#     suivi de `;`, de `&&` ou d'une fin de ligne (`WT=/chemin; git -C "$WT"
#     commit`). Ce dossier S'AJOUTE au cas « sans `-C` », il ne le remplace pas :
#     le hook lit un texte, il ne sait pas si ce texte est une affectation que le
#     shell execute. Releve en revue securite — `echo WT=/vert; …`, une ligne de
#     commentaire, `[ -d /absent ] && WT=/vert; …` : la variable reste vide et le
#     commit part du dossier courant ;
#   • dans tous les autres cas — variable inconnue, substitution, tilde,
#     caractere generique, dossier inexistant, `-C` relatif derriere un `cd`
#     relatif : retour au cas « sans `-C` ». Jamais un dossier parent.
# Un `-C` ecrit APRES `commit` est une autre option (reprendre le message d'un
# commit) et un `-C` ecrit dans la valeur d'une autre option n'en est pas un :
# ni l'un ni l'autre n'est lu.
#
# CE QUE CETTE LECTURE NE SAIT PAS — releve, d'autres cas peuvent exister. Le
# hook juge alors un dossier qui n'est pas celui du commit :
#   • un dossier donne par `--git-dir` / `--work-tree`, ou par les variables
#     d'environnement `GIT_DIR` / `GIT_WORK_TREE` ;
#   • un `cd` qui n'est pas en tete de commande (`cd a && …; cd b && git commit`
#     est juge dans `a`, deja vrai de l'ancien hook) ;
#   • une variable posee autrement que par ce texte (`read`, `for`,
#     environnement) : son dossier n'est pas juge, seul celui du cas « sans
#     `-C` » l'est ;
#   • un `-C` relatif quand le dossier courant du shell n'est pas celui du hook.
# Rejoue sur l'historique : des 13 commandes gagnees qui portent un `-C`, 8 le
# donnent par une variable et 5 par un chemin relatif.
#
# AUCUN heredoc ni chaine-ici dans ces fonctions ni dans le flux du hook : bash
# 3.2 les ecrit dans un fichier temporaire, et quand ce fichier ne peut pas etre
# cree la boucle qu'ils alimentent est sautee sans erreur. Mesure en revue
# securite : la garde ne jugeait alors aucun dossier et affichait « OK ».
# L'auto-test le controle sur le texte de ce script.
#
# Rend le chemin precede d'une lettre — `L` s'il est ecrit en clair, `V` s'il
# vient d'une variable — ou sort en 1.
chemin_en_clair() {  # <mot> <commande>
  local v="$1" simple=false origine=L nom suffixe
  local re_var='^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(/[A-Za-z0-9._/-]*)?$'
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}"; simple=true ;;
  esac
  if [ "$simple" = false ] && [[ "$v" =~ $re_var ]]; then
    nom="${BASH_REMATCH[1]}"
    suffixe="${BASH_REMATCH[2]}"
    v="$(valeur_de_variable "$nom" "$2")" || return 1
    v="${v}${suffixe}"
    origine=V
  fi
  case "$v" in
    '' | *[\"\'\$\`\\~*?\[\{]*) return 1 ;;
  esac
  printf '%s%s' "$origine" "$v"
}
# Le texte `NOM=valeur` doit etre suivi de `;`, de `&&` ou d'une fin de ligne :
# dans `WT=/chemin git -C "$WT" commit`, le shell developpe `$WT` AVANT de poser
# l'affectation, qui ne vaut donc pas pour ce `-C`.
valeur_de_variable() {  # <nom> <commande> : la valeur ecrite une fois, en clair
  local nom="$1" nombre valeur
  local clair="(\"[^\"\$\`\\\\]*\"|'[^']*'|[^[:space:];&|\"'\$\`\\\\(){}<>*?~]+)"
  nombre="$(printf '%s\n' "$2" | grep -oE "(^|[;&|[:space:]])${nom}=" | wc -l | tr -d ' ' || true)"
  [ "$nombre" = 1 ] || return 1
  valeur="$(printf '%s\n' "$2" | grep -oE "(^|[;&|[:space:]])${nom}=${clair}[[:space:]]*(;|&&|\$)" | head -1 \
    | sed -E "s/^[;&|[:space:]]*${nom}=//; s/[[:space:]]*(;|&&)?\$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" || true)"
  [ -n "$valeur" ] || return 1
  printf '%s' "$valeur"
}
# Une ligne par dossier vise, sans doublon : `=` suivi de l'indice a passer a
# `cd_worktree_for` (vide = le dossier du hook). Le `=` garde les lignes vides.
cibles_du_commit() {
  local cmd="$1" cd_dir base occurrence mot dossier a_c resolu attend saute par_variable v
  local morceau="([^[:space:]\"']|\"[^\"]*\"|'[^']*')"
  cd_dir="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
  case "$cd_dir" in
    /*) base="$cd_dir" ;;
    '') base="$PWD" ;;
    *) base="" ;;
  esac
  {
    # Quand l'ANCIEN motif voit la commande, le dossier que jugeait l'ancien hook
    # est rendu d'office, et en premier : la garde ne juge jamais MOINS que lui,
    # meme si l'occurrence qu'il voyait est prise dans la valeur entre guillemets
    # d'une option.
    if (
      set +o pipefail
      printf '%s' "$cmd" 2> /dev/null | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit'
    ); then
      printf '=%s\n' "$cd_dir"
    fi
    printf '%s\n' "$cmd" | { grep -oE "$(commit_motif)" || true; } | while IFS= read -r occurrence; do
      [ -n "$occurrence" ] || continue
      printf '%s\n' "$occurrence" | { grep -oE "${morceau}+" || true; } | {
        dossier="$base"; a_c=false; resolu=true; attend=false; saute=false; par_variable=false
        while IFS= read -r mot; do
          if [ "$saute" = true ]; then
            saute=false
          elif [ "$attend" = true ]; then
            attend=false
            a_c=true
            if v="$(chemin_en_clair "$mot" "$cmd")"; then
              case "$v" in V*) par_variable=true ;; esac
              v="${v#?}"
              case "$v" in
                /*) dossier="$v" ;;
                *) if [ -n "$dossier" ]; then dossier="${dossier}/${v}"; else resolu=false; fi ;;
              esac
            else
              resolu=false
            fi
          else
            case "$mot" in
              -C) attend=true ;;
              -c | --git-dir | --work-tree | --namespace | --config-env | --attr-source | --shallow-file) saute=true ;;
            esac
          fi
        done
        if [ "$a_c" = true ] && [ "$resolu" = true ] && [ -d "$dossier" ]; then
          # Un dossier tire d'une variable s'ajoute au cas « sans -C » (cf. plus haut).
          if [ "$par_variable" = true ]; then printf '=%s\n' "$cd_dir"; fi
          printf '=%s\n' "$dossier"
        else
          printf '=%s\n' "$cd_dir"
        fi
      }
    done
  } | awk '!deja[$0]++'
}

# ── Auto-test, 2e partie : le flux du hook, de bout en bout ─────────────────
# Le script ENTIER est rejoue dans un depot jetable a deux worktrees, avec un faux
# `pnpm` et un faux controle anti-couplage qui notent OU ils tournent : un `exit 2`
# retire, un controle qui ne serait plus lance, un commit vise par `-C` juge dans
# le mauvais dossier — rien d'autre ne les ferait rougir. Les scripts voisins
# (`lib-worktree.sh`, `tests-lies.sh`) sont les vrais, pris a cote de celui-ci.
# Un worktree est « rouge » quand il contient un fichier `ROUGE` : le faux
# anti-couplage y echoue, et la garde doit bloquer des qu'un dossier juge l'est.
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
    printf '#!/bin/sh\necho "couplage @ $(pwd -P)" >> "$FAUX_JOURNAL"\n[ ! -f ROUGE ] || exit 1\nexit "${FAUX_COUPLAGE_CODE:-0}"\n' > scripts/check-coupling.sh
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
  code '-C enchaines' 0 "$depot" "git -C $bac -C autre commit -m x"
  attendu '-C enchaines → juge dans le dossier vise' "$(lances)" "$tout_dans_autre"
  # Un dossier tire d'une variable S'AJOUTE a celui du hook, juge en premier.
  local hook_dans_depot="${tout_dans_depot}exec vitest related @ ${depot}|"
  code '-C par une variable affectee en clair' 0 "$depot" "WT=\"$autre\"; git -C \"\$WT\" commit -m x"
  attendu '-C par une variable → dossier du hook, puis dossier vise' "$(lances)" "${hook_dans_depot}${tout_dans_autre}"
  code '-C par une variable et un sous-dossier' 0 "$depot" "B=$bac && git -C \$B/autre commit -m x"
  attendu '-C par une variable et un sous-dossier → dossier du hook, puis dossier vise' "$(lances)" "${hook_dans_depot}${tout_dans_autre}"
  # Ce qui ne se resout pas retombe sur le dossier du hook — jamais sur un parent
  # (`autre/absent` n'existe pas : juger `autre` a sa place serait juger a cote).
  code '-C par une variable inconnue' 0 "$depot" 'git -C "$INCONNUE" commit -m x'
  attendu '-C par une variable inconnue → dossier du hook' "$(lances)" "$hook_dans_depot"
  code '-C vers un dossier absent' 0 "$depot" "git -C $autre/absent commit -m x"
  attendu '-C vers un dossier absent → dossier du hook, pas son parent' "$(lances)" "$hook_dans_depot"
  code 'affectation en prefixe de commande' 0 "$depot" "WT=$autre git -C \"\$WT\" commit -m x"
  attendu 'affectation en prefixe de commande → ne vaut pas, dossier du hook' "$(lances)" "$hook_dans_depot"

  # 6. Plusieurs occurrences : CHAQUE dossier vise est juge, un seul rouge bloque.
  # `depot` devient rouge, `autre` reste vert. Sans cela, citer un dossier vert
  # devant un commit ordinaire faisait juger le vert pendant que le commit partait
  # du rouge (releve en revue securite).
  : > "$depot/ROUGE"
  code 'session rouge, commit ordinaire' 2 "$depot" 'git commit -m x'
  code 'session rouge, un seul commit et il vise le vert' 0 "$depot" "git -C $autre commit -m x"
  attendu 'session rouge, commit vers le vert → seul le vert est juge' "$(lances)" "$tout_dans_autre"
  code '-C vert --dry-run, puis commit ordinaire' 2 "$depot" "git -C $autre commit --dry-run; git commit -m x"
  attendu '-C vert puis commit ordinaire → le dossier du hook d abord, et il bloque' "$(lances)" "couplage @ ${depot}|"
  # Un texte `VAR=valeur` que le shell n'execute pas comme une affectation : la
  # variable reste vide, `git -C ""` commite dans le dossier courant (le rouge).
  code 'variable posee par un echo, pas par le shell' 2 "$depot" "echo WT=$autre; git -C \"\$WT\" commit -m x"
  attendu 'variable posee par un echo → le dossier du hook est juge, et il bloque' "$(lances)" "couplage @ ${depot}|"
  code 'variable dans un commentaire' 2 "$depot" "$(printf '# WT=%s\ngit -C "$WT" commit -m x' "$autre")"
  code 'variable affectee sous condition' 2 "$depot" "[ -d /dossier/absent ] && WT=$autre; git -C \"\$WT\" commit -m x"
  code 'variable dans un corps de heredoc' 2 "$depot" "$(printf "cat > n.txt <<'EOF'\nWT=%s\nEOF\ngit -C \"\$WT\" commit -m x" "$autre")"
  code 'mention de -C vert, puis commit ordinaire' 2 "$depot" "echo \"voir git -C $autre commit\" && git commit -m x"
  code 'commentaire citant -C vert, puis commit ordinaire' 2 "$depot" "$(printf '# equivalent de git -C %s commit\ngit commit -m x' "$autre")"
  code 'heredoc citant -C vert, puis commit -F' 2 "$depot" "$(printf "cat > m.txt <<'EOF'\nnote : git -C %s commit est vu\nEOF\ngit commit -F m.txt" "$autre")"
  code '-C vert commit-graph, puis commit ordinaire' 2 "$depot" "git -C $autre commit-graph write; git commit -m x"
  code '-C vert, puis commit ordinaire' 2 "$depot" "git -C $autre commit -m a && git commit -m b"
  code 'commit ordinaire, puis -C vert' 2 "$depot" "git commit -m b && git -C $autre commit -m a"
  attendu 'commit ordinaire puis -C vert → arret des le dossier rouge' "$(lances)" "couplage @ ${depot}|"
  code 'session verte, -C rouge' 2 "$autre" "git -C $depot commit -m x"
  code 'session verte, commit ordinaire puis -C rouge' 2 "$autre" "git commit -m a; git -C $depot commit -m b"
  attendu 'commit ordinaire puis -C rouge → les deux dossiers, dans l ordre' "$(lances)" "${tout_dans_autre}couplage @ ${depot}|"
  code 'session verte, -C rouge puis commit ordinaire' 2 "$autre" "git -C $depot commit -m a; git commit -m b"
  attendu '-C rouge puis commit ordinaire → les deux dossiers, celui du hook d abord' "$(lances)" "${tout_dans_autre}couplage @ ${depot}|"
  code 'session verte, deux -C dont un rouge' 2 "$bac" "git -C $autre commit -m a && git -C $depot commit -m b"
  attendu 'deux -C dont un rouge → les deux dossiers, dans l ordre' "$(lances)" "${tout_dans_autre}couplage @ ${depot}|"
  rm "$depot/ROUGE"
  code 'deux commits dans le meme dossier' 0 "$autre" "git commit -m a && git -C $autre commit -m b"
  attendu 'deux commits dans le meme dossier → juge une seule fois' "$(lances)" "$tout_dans_autre"

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
    [ "$r" = "$voulu" ] || { echo "🔴 motif [$1] : [${2:0:160}] → $r (attendu $voulu)" >&2; echec=true; }
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
V:git --work-tree /tmp/wt --namespace n commit -m x
V:git --config-env user.name=NOM --attr-source HEAD commit -m x
V:git -P --paginate --bare --no-replace-objects --no-lazy-fetch commit -m x
V:git --no-optional-locks --no-advice --literal-pathspecs commit -m x
V:git --glob-pathspecs --noglob-pathspecs --icase-pathspecs commit -m x
V:git --no-literal-pathspecs --shallow-file /dev/null commit -m x
V:git --exec-path=/usr/libexec/git-core -c a=b commit -m x
V:git -c commit.gpgsign=false -c core.hooksPath=.husky commit -m x
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
N:git -c commit.gpgsign=false rebase --continue
N:git -c commit.gpgsign=false stash push -u -m sauvegarde
N:git -c commit.gpgsign=false merge origin/main
N:git -c commit.gpgsign=false cherry-pick abc123
N:git -c commit.gpgsign=false -c x=y log -1
N:git --no-pager log --grep commit
N:git -p log --grep commit
N:git --no-pager show --stat commit1
N:git -C commit status
N:git --git-dir commit status
N:git --shallow-file commit status
N:# mesure en revue, `git commit -m "doc"` sortait en 2 (note Markdown)
N:echo "--- hooks (git commit matcher) ---"
N:NEW=$(git commit-tree "$(git rev-parse origin/main^{tree})" -p origin/main -m x)
F:echo "avant git commit"
F:echo "relancer avec git -c core.hooksPath=.husky commit ensuite"
F:git commit-graph write
F:git -c a=b commit-graph write
F:  git -c core.hooksPath=/dev/null commit --quiet -m "ligne d'un corps de heredoc, non executee"
L:git -C $(git rev-parse --show-toplevel) commit -m x
L:git -C /tmp/un\ dossier commit -m x
L:git --option-inconnue commit -m x
L:git -c a=b --option-inconnue valeur commit -m x
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
  # Une tres grosse commande ou du texte SUIT la ligne du commit : le tube lu sous
  # `pipefail` la rendait « non vue » (cf. commit_matche).
  remplissage="$(head -c 300000 /dev/zero | tr '\0' 'x')"
  juge V "$(printf 'git commit -m x\n%s' "$remplissage")"
  juge V "$(printf '%s\ngit -c core.hooksPath=.husky commit -m x\n%s' "$remplissage" "$remplissage")"
  juge N "$(printf 'git status --short\n%s' "$remplissage")"

  # Les dossiers vises : ce que `cibles_du_commit` rend pour une commande donnee
  # — une entree `=<indice>` par occurrence du motif, jointes ici par `|`. Les
  # dossiers existent pour de bon : un `-C` vers un dossier absent retombe sur le
  # cas sans `-C`. Le dossier courant est `$essai`.
  essai="$(mktemp -d)" || { echo "🔴 pre-commit-gate : mktemp impossible." >&2; exit 2; }
  essai="$(cd "$essai" && pwd -P)"
  # `sous`, `~x` et `commit` sont des leurres : des dossiers qui existent la ou
  # une lecture fautive irait les chercher.
  mkdir -p "$essai/a/sous" "$essai/b" "$essai/un dossier" "$essai/sous" "$essai/~x" "$essai/commit"
  A="$essai/a"
  B="$essai/b"
  cibles() {  # cibles <libelle> <commande> <voulu>
    local r
    r="$(cd "$essai" && cibles_du_commit "$2" | tr '\n' '|')"
    nc=$((nc + 1))
    [ "$r" = "$3" ] || { echo "🔴 cibles [$1] : [$2] → [$r] (attendu [$3])" >&2; echec=true; }
  }
  cibles 'sans cd ni -C' 'git commit -m x' '=|'
  cibles 'cd de tete' "cd $A && git commit -m x" "=$A|"
  cibles '-C absolu' "git -C $A commit -m x" "=$A|"
  cibles '-C entre guillemets doubles' "git -C \"$essai/un dossier\" commit -m x" "=$essai/un dossier|"
  cibles '-C entre guillemets simples' "git -C '$essai/un dossier' commit -m x" "=$essai/un dossier|"
  cibles '-C suivi de -c' "git -C $A -c a=b commit -m x" "=$A|"
  cibles '-C precede de -c' "git -c a=b -C $A commit -m x" "=$A|"
  cibles '-C precede de --git-dir et de sa valeur' "git --git-dir $A/.git -C $B commit -m x" "=$B|"
  cibles '-C absolu l emporte sur le cd' "cd $A && git -C $B commit -m x" "=$B|"
  cibles '-C relatif apres un cd absolu' "cd $A && git -C sous commit -m x" "=$A/sous|"
  cibles '-C relatif sans cd : part du dossier du hook' 'git -C a commit -m x' "=$essai/a|"
  cibles '-C relatif derriere un cd relatif : non resolu' 'cd a && git -C sous commit -m x' '=a|'
  cibles '-C enchaines, le second relatif' "git -C $A -C sous commit -m x" "=$A/sous|"
  cibles '-C enchaines, le second absolu' "git -C $A -C $B commit -m x" "=$B|"
  cibles '-C enchaines, deux relatifs' 'git -C a -C sous commit -m x' "=$essai/a/sous|"
  cibles '-C enchaines, retour sur place' "git -C $B -C . commit -m x" "=$B/.|"
  cibles '-C apres commit : reprise de message, pas un dossier' 'git commit -C HEAD~1 --no-edit' '=|'
  cibles '-C apres commit, avec un cd' "cd $A && git commit -C HEAD~1" "=$A|"
  cibles '-C d un autre git, avant le commit' "git -C $A status && git commit -m x" '=|'
  cibles '-C dans la valeur d une autre option' "git -c x=\" -C $A \" commit -m x" '=|'
  cibles '-C vers un dossier absent' "git -C $A/absent commit -m x" '=|'
  cibles '-C vers un dossier absent, avec un cd' "cd $B && git -C $A/absent commit -m x" "=$B|"
  cibles '-C au tilde' 'git -C ~/x commit -m x' '=|'
  cibles '-C au tilde, meme si un dossier porte ce nom' 'git -C ~x commit -m x' '=|'
  cibles '-C au caractere generique' "git -C $essai/* commit -m x" '=|'
  cibles 'la valeur d une autre option vaut -C : ce n est pas un -C' 'git -c -C commit -m x' '=|'
  # Chaque occurrence compte, et le dossier que jugeait l'ancien hook vient en
  # premier des que l'ancien motif voit la commande : c'est ce qui le garde parmi
  # les dossiers juges quand la commande cite aussi un autre dossier.
  cibles 'deux commits, deux dossiers' "git -C $A commit -m x && git -C $B commit -m y" "=$A|=$B|"
  cibles '-C puis commit ordinaire' "git -C $A commit --dry-run; git commit -m x" "=|=$A|"
  cibles 'commit ordinaire puis -C' "git commit -m b && git -C $A commit -m a" "=|=$A|"
  cibles 'mention de -C puis commit ordinaire' "echo \"voir git -C $A commit\" && git commit -m x" "=|=$A|"
  cibles '-C puis commit ordinaire, derriere un cd' "cd $B && git -C $A commit -m a && git commit -m b" "=$B|=$A|"
  cibles 'sur deux lignes' "$(printf 'git -C %s commit -m a\ngit commit -m b' "$A")" "=|=$A|"
  cibles 'deux commits ordinaires : un seul dossier' 'git commit -m a && git commit -m b' '=|'
  cibles 'occurrence de l ancien motif prise dans une valeur entre guillemets' "git -C $A -c \"x=y git commit\" commit -m z" "=|=$A|"
  # Une variable : lue si la commande porte `VAR=valeur` une fois, en clair, suivi
  # de `;`, `&&` ou d'une fin de ligne. Son dossier s'AJOUTE au cas « sans -C »,
  # rendu en premier — le texte lu peut ne pas etre une affectation executee.
  cibles 'variable inconnue' 'git -C "$X" commit -m x' '=|'
  cibles 'variable inconnue, avec un cd' "cd $A && git -C \"\$X\" commit -m x" "=$A|"
  cibles 'variable au milieu d un chemin' "git -C $A/\$X commit -m x" '=|'
  cibles 'variable affectee, point-virgule' "WT=$A; git -C \"\$WT\" commit -m x" "=|=$A|"
  cibles 'variable affectee entre guillemets, &&' "WT=\"$A\" && git -C \$WT commit -m x" "=|=$A|"
  cibles 'variable affectee entre guillemets simples, accolades' "WT='$A'; git -C \"\${WT}\" commit -m x" "=|=$A|"
  cibles 'variable affectee sur sa ligne' "$(printf 'WT=%s\ngit -C "$WT" commit -m x' "$A")" "=|=$A|"
  cibles 'variable exportee' "export WT=$A; git -C \$WT commit -m x" "=|=$A|"
  cibles 'variable et sous-dossier' "S=$essai; git -C \"\$S/a\" commit -m x" "=|=$essai/a|"
  cibles 'variable relative, apres un cd' "cd $essai && D=a; git -C \$D commit -m x" "=$essai|=$essai/a|"
  cibles 'variable puis chemin en clair : le clair ne s ajoute a rien' "WT=$A; git -C $B commit -m x" "=$B|"
  cibles 'variable posee par un echo : le dossier du hook reste rendu' "echo WT=$A; git -C \"\$WT\" commit -m x" "=|=$A|"
  cibles 'variable affectee deux fois' "WT=$A; WT=$B; git -C \"\$WT\" commit -m x" '=|'
  cibles 'variable affectee par une substitution' 'WT="$(pwd)"; git -C "$WT" commit -m x' '=|'
  cibles 'variable en prefixe de commande' "WT=$A git -C \"\$WT\" commit -m x" '=|'
  cibles 'variable affectee dans un tube' "WT=$A | git -C \"\$WT\" commit -m x" '=|'
  cibles 'variable entre guillemets simples : texte, pas variable' "WT=$A; git -C '\$WT' commit -m x" '=|'
  rm -rf "$essai"

  # Ni heredoc ni chaine-ici dans ce qui s'execute hors auto-test : les fonctions
  # de lecture (du motif jusqu'a l'auto-test) et le flux (apres la lecture de
  # l'entree). Controle sur le texte de ce script, commentaires ecartes.
  if sed -n '/^commit_motif() {$/,/^# ── Auto-test, 2e partie/p; /^INPUT="\$(cat)"$/,$p' "$ICI" \
    | grep -vE '^[[:space:]]*#' | grep -q '<<'; then
    echo "🔴 un heredoc ou une chaine-ici est revenu dans le chemin execute du hook." >&2
    echec=true
  fi
  [ "$(sed -n '/^commit_motif() {$/,/^# ── Auto-test, 2e partie/p; /^INPUT="\$(cat)"$/,$p' "$ICI" | wc -l | tr -d ' ')" -gt 150 ] \
    || { echo "🔴 le controle « sans heredoc » ne lit plus le chemin execute du hook." >&2; echec=true; }

  bout_en_bout || echec=true

  if [ "$echec" = true ]; then
    echo "🔴 pre-commit-gate : auto-test EN ECHEC — la garde peut etre muette ou juger le mauvais dossier." >&2
    exit 2
  fi
  echo "✅ pre-commit-gate : auto-test OK ($nv commits vus, $nn autres commandes ignorees, $nf declenchements a tort assumes, $nl limites connues ; $nc cas de dossiers vises ; flux de bout en bout : commande ignoree, options globales, chaque controle rouge bloque, worktree vise par -C ou par cd, chaque dossier vise juge)."
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
# session est enracinee (clone principal ou autre worktree). Chaque dossier vise
# par la commande (cf. cibles_du_commit) est ramene a la racine de son worktree ;
# une racine citee plusieurs fois n'est jugee qu'une fois.
. "$HOOKS/lib-worktree.sh"
RACINES="$(cibles_du_commit "$CMD" | while IFS= read -r cible; do (
  cd_worktree_for "${cible#=}" > /dev/null 2>&1
  pwd -P
); done | awk '!deja[$0]++')" || RACINES=""
# Le motif vient d'etre vu : il y a toujours au moins une racine. Si la lecture
# echouait malgre tout, on juge le dossier du hook plutot que rien.
[ -n "$RACINES" ] || RACINES="$(pwd -P)"

# Les controles, dans le dossier courant. Garde-fou 3 TMS-Ready (anti-couplage
# MTS-1/Everest) d'abord : deterministe, sans dependance npm.
controles() {
  if ! bash scripts/check-coupling.sh >&2; then echo "KO anti-couplage -- commit bloque." >&2; return 2; fi
  if ! pnpm -w typecheck >&2; then echo "KO typecheck -- commit bloque." >&2; return 2; fi
  if ! pnpm -w lint >&2;      then echo "KO lint -- commit bloque." >&2;      return 2; fi
  if ! bash "$HOOKS/tests-lies.sh" >&2; then echo "KO tests lies -- commit bloque." >&2; return 2; fi
}

echo "Gate pre-commit : anti-couplage + typecheck + lint + tests lies..." >&2
# Une racine par ligne. La boucle ne lit pas l'entree standard, et celle des
# controles est fermee : ils n'ont rien a y lire. Jamais « OK » sans qu'un
# dossier au moins ait ete juge — le dernier test ne devrait pas pouvoir
# echouer (il y a toujours une racine), il est la pour le dire si cela arrivait.
JUGES=0
ANCIEN_IFS="$IFS"
IFS='
'
set -f
for racine in $RACINES; do
  IFS="$ANCIEN_IFS"
  set +f
  echo "  dossier juge : ${racine}" >&2
  (cd "$racine" && controles) < /dev/null || exit 2
  JUGES=$((JUGES + 1))
done
IFS="$ANCIEN_IFS"
set +f
[ "$JUGES" -gt 0 ] || { echo "KO aucun dossier juge -- commit bloque." >&2; exit 2; }
echo "OK Gate pre-commit." >&2
exit 0
