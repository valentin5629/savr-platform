#!/usr/bin/env bash
# Gate points 2 + 4 : bloque gh pr create sans tests verts + conformite-spec GO.
# Point 3 (divergences) est couvert par le reviewer conformite-spec qui doit les flaguer.
set -euo pipefail

# Chemin absolu de ce script, pris avant tout `cd` (l'auto-test le rejoue en entier).
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# ── Reconnaître la commande — isolé en fonction, pour être TESTABLE ──────────
# Le motif d'origine était la simple présence de la chaîne dans la commande : un
# `grep` sur ces mots, un message de commit qui les cite ou un script d'analyse
# qui les contient lançait la suite de tests entière puis BLOQUAIT la commande,
# faute de markers sur la branche visée (vécu deux fois le 2026-10-08 : 7 min de
# tests, puis un script de lecture refusé).
#
# Ce hook est le SEUL endroit où les markers de revue sont lus : une création de
# PR qu'il ne voit pas atteint `main` sans contrôle de revue. Le motif voit la
# commande là où le shell l'EXÉCUTE DIRECTEMENT, et écarte ce qui est
# manifestement une mention. Il ne voit PAS tout ce que voyait l'ancien motif :
# ce qu'il a perdu est décrit plus bas, mesuré, et une partie peut créer une PR.
# Deux façons d'être vu :
#
#   1. COLLÉE À UN DÉBUT DE COMMANDE — début de ligne, ou juste après un
#      séparateur (; & |), une parenthèse ou un accent grave ; ou comme texte
#      d'un `bash -c "…"` / `eval "…"` (avec ou sans options avant le `-c`).
#      Vue quoi qu'il y ait derrière — sauf la mention entre accents graves
#      décrite plus bas.
#
#   2. DERRIÈRE N'IMPORTE QUOI D'AUTRE — un mot-clé du shell (`if`, `then`,
#      `until`…), une variable d'environnement en préfixe, un lanceur (`timeout
#      120`, `nice`, `caffeinate -i`, `op run --`, `env -u X`, `sudo -u u`,
#      `xargs -I{}`), une redirection, un motif de `case` suivi d'un blanc… On
#      ne les énumère pas (on en oublierait) : la commande est vue dès qu'elle est
#      précédée d'un blanc ET suivie d'une option, d'un argument entre guillemets
#      ou en variable, d'une barre inverse de continuation (options renvoyées à
#      la ligne), d'un séparateur, d'une redirection sans descripteur ou d'un
#      commentaire (; & | < > #), ou de la fin de la ligne. C'est ce qui la
#      distingue d'une mention en pleine phrase
#      (« … via gh pr create) … », « … gh pr create est bloqué »).
#
# Dans les deux cas : binaire appelé par son chemin ou précédé d'une barre oblique
# inverse, options entre `gh`, `pr` et le verbe (`gh -R o/r pr create`), et l'alias
# `gh pr new`.
#
# LA MENTION ENTRE ACCENTS GRAVES — retirée du texte avant les deux voies : la
# commande NUE, écrite exactement `gh pr create` ou `gh pr new` (un seul espace
# entre les mots, rien d'autre entre les deux accents graves), quand ses deux
# accents graves vont ENSEMBLE. C'est l'écriture Markdown d'une mention, dans un
# message de commit ou un corps de PR ; l'accent grave ouvrant aussi une
# substitution de commande, elle déclenchait la garde par la voie 1 (rejoué le
# 2026-10-08 sur l'historique des sessions : 8 commandes sur les 654 qui
# contiennent la chaîne, toutes des notes rédigées en Markdown — ce sont les
# seules commandes de l'historique dont ce retrait change le verdict).
# « Vont ensemble » : les accents graves du texte sont appariés deux à deux
# depuis le début, comme le shell les lit. Sans cela, le texte pris entre la FIN
# d'une substitution et le DÉBUT de la suivante — du texte de commande ordinaire
# — était retiré lui aussi, et `true`gh pr create`true` --fill, qui crée une PR,
# n'était plus vu (relevé en revue sécurité ; formes épinglées en V).
# Ce que ce retrait coûte, mesuré le 2026-10-08 :
#   • si le shell exécute réellement la mention (substitution hors guillemets
#     simples), la garde ne la voit plus. C'est alors `gh` sans aucune option,
#     qui ne crée rien — gh 2.101.0, hors de tout dépôt, de cinq façons (entre
#     accents graves, alias `new`, `$( )`, entrée et sortie redirigées,
#     `GH_FORCE_TTY` posé) : code 1, « must provide `--title` and `--body` (or
#     `--fill` …) when not running interactively ». En substitution, sa sortie
#     standard est vide (mesuré pour `create` et pour `new`). Même constat que
#     la famille (a) plus bas ;
#   • l'appariement compte TOUS les accents graves, sans lire les guillemets. Un
#     accent grave que le shell ne lit pas comme tel — entre guillemets simples,
#     par exemple — le décale d'un cran, et la forme ci-dessus redevient
#     invisible : echo '`'; `true`gh pr create`true` --fill lance bien la
#     création avec `--fill`. Forme à construire, capable de créer une PR,
#     épinglée en L ;
#   • une commande qui crée une PR par une voie que ce motif ne voit pas (le
#     binaire entre guillemets, `ssh hote '…'`, `gh api`) et qui citait EN PLUS
#     la mention était vue par accident ; elle ne l'est plus.
# Dès qu'une option est écrite entre les accents graves (`gh pr create --fill`),
# la commande reste vue. Le retrait n'est pas tenté sur un texte de plus de
# 100 000 caractères (cf. le commentaire de la fonction).
#
# CE QUI DÉCLENCHE À TORT, et c'est voulu (un refus de trop vaut mieux qu'une PR
# non contrôlée) :
#   • une mention collée à un début de commande dans un texte — après un `;`, un
#     `|` ou un `&&` entre guillemets, en début de ligne d'un heredoc — ou placée
#     en fin de ligne. Vécu pendant l'écriture du premier lot : un script de
#     modification passé en heredoc, dont une ligne contenait `|` suivi de la
#     commande ;
#   • une mention en pleine phrase suivie de ce que la voie 2 attend derrière une
#     commande — une option le plus souvent (« lancer gh pr create --fill après
#     la revue ») ;
#   • une mention entre accents graves qui porte une option
#     (`gh pr create --fill`) : rien ne la distingue d'une substitution réelle.
# Un texte qui cite la commande ainsi passe par un fichier (`git commit -F`,
# `--body-file`), jamais par le texte d'une commande Bash.
#
# CE QUE L'ANCIEN MOTIF VOYAIT ET QUE CELUI-CI NE VOIT PLUS : toute commande qui
# contient la chaîne exacte sans entrer dans aucune des deux voies ci-dessus.
# Mesuré en revue sécurité sur quatre matrices de formes réelles, toutes vues par
# l'ancien motif : 35 vues sur 35 (formes courantes), 13 sur 13 (options
# renvoyées à la ligne), 7 sur 22, 3 sur 15. Familles RELEVÉES dans les deux
# dernières — l'inventaire n'est pas exhaustif, d'autres peuvent exister :
#   a. SANS aucune option — hors début de commande, refermée aussitôt par une
#      parenthèse, un accent grave ou un guillemet (`(nice gh pr create)`), ou
#      suivie d'une redirection à descripteur (`nice gh pr create 2>&1`) ; ou
#      NUE entre deux accents graves (la mention décrite plus haut, quand elle
#      est une vraie substitution : URL=`gh pr create`). Suivie de `>`, `<` ou
#      `&>`, elle est vue. Ne crée rien : hors terminal interactif, `gh` la
#      refuse (« must provide `--title` and `--body` … when not running
#      interactively », mesuré le 2026-10-08, gh 2.101.0).
#   b. AVEC options — donc capable de créer une PR — quand la commande est collée
#      à un guillemet ouvrant ailleurs que derrière `sh -c` / `eval`, ou à la
#      parenthèse d'un motif de `case`. Les 15 formes non vues de la troisième
#      matrice : `ssh hote '…'`, `su - val -c "…"`, `"$SHELL" -c "…"`,
#      `$SHELL -lc '…'`, `dash -c`, `ksh -c`, `fish -c`, `tmux send-keys "…"`,
#      `watch "…"`, `env -S "…"`, `echo "…" | bash`, `echo '…' | sh`,
#      `printf … | bash`, `bash <<< "…"`, `case $m in go)gh pr create --fill`.
#      Les voir toutes obligerait à voir aussi `grep "…"` : des mentions
#      redeviendraient des refus à tort.
#   c. AVEC options — donc capable de créer une PR — hors début de commande,
#      quand ce qui suit le verbe n'est ni une option, ni un guillemet, ni un
#      `$`, ni une barre inverse : options placées après une redirection à
#      descripteur (`nice gh pr create 2>&1 --fill`), tirées d'accents graves ou
#      d'accolades (`nice gh pr create {--fill,--draft}`). Cinq formes de la
#      quatrième matrice.
# Aucune de ces formes n'apparaît dans l'historique des sessions — aucune création
# réelle n'y est perdue, seules des mentions le sont — mais rien ne les empêche.
#
# PORTÉE — ce que ce hook ne voit pas, avant comme après ce motif :
#   • le binaire écrit entre guillemets (`"gh" pr …`) ;
#   • `gh api -X POST repos/o/r/pulls` (déjà utilisé deux fois dans l'historique) ;
#   • la commande enfouie dans un script ou derrière un alias ;
#   • une PR ouverte depuis l'interface GitHub ou un terminal humain.
# C'est un `PreToolUse(Bash)` : il ne voit que l'outil Bash de Claude Code. Pour
# les TESTS, le filet qui couvre tous ces chemins est côté GitHub (status checks
# requis sur `main`, dont `lint-typecheck-test` qui rejoue la suite complète). Pour
# la REVUE, il n'y en a pas : les markers ne sont relus nulle part ailleurs.
#
# NE JAMAIS resserrer ce motif sans relancer `--self-test`.
gate_pr_matche() {
  local binaire="\\\\?([^[:space:];&|\"']*/)?gh"
  local options='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'
  local commande="${binaire}${options}[[:space:]]+pr${options}[[:space:]]+(create|new)"
  local debut='(^|[;&|(`])[[:space:]]*'
  local enveloppe="\\b((ba|z)?sh\\b[^;&|]*[[:space:]]-[a-zA-Z]*c|eval)[[:space:]]+[\"']?[[:space:]]*"
  local suite="([[:space:]]*(\$|[;&|<>#\\\\])|[[:space:]]+[-\"'\$])"
  # La mention entre accents graves (cf. l'en-tête) est retirée avant les deux
  # voies, quand ses deux accents graves vont ensemble : le texte est découpé en
  # paires d'accents graves depuis le début, et seule une paire qui enferme
  # exactement la commande nue est retirée. Retirée, pas remplacée par un blanc :
  # c'est ce que le shell fait d'une substitution dont la sortie est vide
  # (mesuré : la commande nue ne rend rien sur sa sortie standard), le texte qui
  # l'entoure se recolle — et c'est ce texte recollé qui est jugé (forme g`…`h
  # de la matrice). Le découpage n'est fait que si le texte porte la mention, et
  # s'il tient en 100 000 caractères : son coût croît avec le carré du nombre
  # d'accents graves (mesuré sous bash 3.2 : 0,8 s pour 59 Ko et 2 000 accents
  # graves, 12 s pour 234 Ko et 8 000). Au-delà, le texte est jugé tel quel et la
  # mention redevient un refus à tort.
  local texte="$1" reste avant dedans
  case "$texte" in
    *'`gh pr create`'* | *'`gh pr new`'*)
      if [ "${#texte}" -le 100000 ]; then
        reste="$texte"
        texte=""
        while :; do
          case "$reste" in *'`'*'`'*) ;; *) break ;; esac
          avant="${reste%%\`*}"
          reste="${reste#*\`}"
          dedans="${reste%%\`*}"
          reste="${reste#*\`}"
          case "$dedans" in
            'gh pr create' | 'gh pr new') texte="${texte}${avant}" ;;
            *) texte="${texte}${avant}\`${dedans}\`" ;;
          esac
        done
        texte="${texte}${reste}"
      fi
      ;;
  esac
  # Le tube est lu dans un sous-shell SANS `pipefail` : le statut est celui de
  # grep seul. Sous `pipefail`, quand du texte suit la ligne du motif et dépasse
  # le tampon du tube, grep sort au premier résultat, printf reçoit SIGPIPE, le
  # tube sort en erreur et la commande était lue « non vue » (mesuré en revue,
  # déjà vrai avant). Pas de chaîne-ici : bash 3.2 l'écrit dans un fichier
  # temporaire, et la lecture échoue quand ce fichier ne peut pas être créé.
  # L'erreur de printf est fermée (`2>&-`), pas envoyée vers /dev/null : là où
  # /dev/null ne s'ouvre pas en écriture, la redirection échouait, printf n'était
  # pas lancé et grep ne voyait rien (mesuré par la revue du lot voisin).
  (
    set +o pipefail
    printf '%s' "$texte" 2>&- | grep -Eq "(${debut}|${enveloppe})${commande}"
  ) && return 0
  (
    set +o pipefail
    printf '%s' "$texte" 2>&- | grep -Eq "[[:space:]]${commande}${suite}"
  )
}

# ── Auto-test, 2e partie : le flux du hook, de bout en bout ─────────────────
# La matrice plus bas ne juge que le motif. Ici c'est le script ENTIER qui est
# rejoué dans un dépôt jetable, avec un faux `pnpm` et un faux contrôle outbox :
# un `exit 2` retiré, un marker qui ne serait plus lu, une suite rouge qui
# laisserait passer — rien d'autre ne les ferait rougir (relevé en revue sécurité
# de la PR #530 : le flux n'avait aucun auto-test). Les scripts voisins
# (`lib-worktree.sh`, `suite-verte.sh`) sont les vrais, pris à côté de celui-ci.
bout_en_bout() (
  set +e
  set -uo pipefail
  ko=false
  bac="$(mktemp -d)" || { echo "🔴 gate-pr : mktemp impossible." >&2; exit 1; }
  trap 'rm -rf "$bac"' EXIT
  bac="$(cd "$bac" && pwd -P)"
  depot="$bac/depot"; autre="$bac/autre"; journal="$bac/journal"; sortie="$bac/sortie"
  mkdir -p "$bac/bin"
  cat > "$bac/bin/pnpm" <<'FAUX'
#!/bin/sh
echo "$*" >> "$FAUX_JOURNAL"
case "$*" in
  *seed:check*)
    [ -n "${FAUX_SEED_SORTIE:-}" ] && echo "$FAUX_SEED_SORTIE"
    exit "${FAUX_SEED_CODE:-0}"
    ;;
  *) exit "${FAUX_TESTS_CODE:-0}" ;;
esac
FAUX
  chmod +x "$bac/bin/pnpm"
  : > "$journal"
  # Deux worktrees : `lot` (dossier `depot`) et `chore/autre-lot` (dossier
  # `autre`). La barre oblique est voulue : le nom du marker la remplace par un
  # tiret, comme pour toutes les branches du projet.
  # `.claude/` est ignoré, comme dans le vrai dépôt : un marker ne salit pas l'arbre.
  (
    mkdir "$depot" && cd "$depot" && git init -q -b main . && git config user.email t@t && git config user.name t
    mkdir scripts && printf '#!/bin/sh\nexit "${FAUX_OUTBOX_CODE:-0}"\n' > scripts/check-outbox-contracts.sh
    echo '.claude/' > .gitignore && echo a > f.ts
    git add -A && git commit -qm base
    git checkout -q -b lot && echo b > f.ts && git commit -qam lot
    git worktree add -q -b chore/autre-lot "$autre" main
  ) >/dev/null 2>&1 || { echo "🔴 gate-pr : dépôt jetable non construit." >&2; exit 1; }

  # joue <dossier> <commande> [VAR=valeur …] : passe la commande au hook, depuis ce dossier.
  joue() {
    local dossier="$1" commande="$2"
    shift 2
    (cd "$dossier" && jq -n --arg c "$commande" '{tool_input: {command: $c}}' \
      | env PATH="$bac/bin:$PATH" FAUX_JOURNAL="$journal" "$@" "$BASH" "$ICI" > "$sortie" 2>&1)
  }
  attendu() {  # attendu <libellé> <obtenu> <voulu>
    [ "$2" = "$3" ] || { echo "🔴 flux [$1] : obtenu [$2], attendu [$3]" >&2; ko=true; }
  }
  code() {  # code <libellé> <voulu> <dossier> <commande> [VAR=valeur …]
    local libelle="$1" voulu="$2" rc=0
    shift 2
    joue "$@" || rc=$?
    attendu "$libelle" "$rc" "$voulu"
  }
  dit() {  # dit <libellé> <texte> : la sortie du dernier passage contient ce texte
    grep -qF -- "$2" "$sortie" || { echo "🔴 flux [$1] : la sortie ne dit pas « $2 »" >&2; ko=true; }
  }
  tait() {  # tait <libellé> <texte> : la sortie du dernier passage ne le contient pas
    if grep -qF -- "$2" "$sortie"; then echo "🔴 flux [$1] : la sortie dit « $2 »" >&2; ko=true; fi
  }
  appels() { grep -c -- "$1" "$journal" || true; }
  tete() { git -C "$1" rev-parse HEAD; }
  go() {  # go <dossier> <branche> : pose les deux markers GO sur le HEAD de ce dossier
    mkdir -p "$1/.claude"
    echo "GO $(tete "$1")" > "$1/.claude/conformite-ok-$2"
    echo "GO $(tete "$1")" > "$1/.claude/securite-ok-$2"
  }
  local creer='gh pr create --fill'
  local faux_sha='0000000000000000000000000000000000000000'

  # 1. Une commande qui ne crée pas de PR : laissée passer, rien n'est lancé.
  code 'commande sans création de PR' 0 "$depot" 'git status --short'
  attendu 'commande sans création de PR → rien de lancé' "$(wc -l < "$journal" | tr -d ' ')" 0

  # 2. Tout est en règle.
  go "$depot" lot
  code 'tout en règle' 0 "$depot" "$creer"
  dit 'tout en règle' 'GATE PR OK'
  dit 'tout en règle' 'seed OK'
  attendu 'tout en règle → suite complète jouée' "$(appels 'test:unit')" 1
  attendu 'tout en règle → seed interrogé' "$(appels 'seed:check')" 1

  # 3. Deuxième tentative sur le même contenu : la suite n'est pas rejouée.
  code '2e tentative, même contenu' 0 "$depot" "$creer"
  attendu '2e tentative → suite non rejouée' "$(appels 'test:unit')" 1

  # 4. Suite rouge sur un contenu nouveau, puis contrat outbox en échec.
  (cd "$depot" && echo c > f.ts && git commit -qam c) >/dev/null 2>&1
  go "$depot" lot
  code 'suite rouge' 2 "$depot" "$creer" FAUX_TESTS_CODE=1
  dit 'suite rouge' 'test:unit échoue'
  tait 'suite rouge' 'GATE PR OK'
  code 'contrat outbox en échec' 2 "$depot" "$creer" FAUX_OUTBOX_CODE=1
  dit 'contrat outbox en échec' 'check-outbox-contracts échoue'

  # 5. Markers de revue : absent, vide, NON-GO, périmé — pour chacun des deux.
  local m
  for m in conformite securite; do
    go "$depot" lot
    rm "$depot/.claude/$m-ok-lot"
    code "marker $m absent" 2 "$depot" "$creer"
    dit "marker $m absent" 'MANQUANT'
    : > "$depot/.claude/$m-ok-lot"
    code "marker $m vide" 2 "$depot" "$creer"
    echo "NON-GO $(tete "$depot")" > "$depot/.claude/$m-ok-lot"
    code "marker $m NON-GO" 2 "$depot" "$creer"
    dit "marker $m NON-GO" "sans verdict 'GO'"
    echo "GO $faux_sha" > "$depot/.claude/$m-ok-lot"
    code "marker $m sur un autre commit" 2 "$depot" "$creer"
    dit "marker $m sur un autre commit" 'périmé'
  done
  go "$depot" lot
  code 'markers rétablis' 0 "$depot" "$creer"

  # 6. Vérification du seed : dit ce qu'elle constate, ne bloque pas, et ne dit
  # jamais « OK » sans l'avoir constaté (le défaut d'origine : `|| true` puis `$?`).
  code 'seed en écart' 0 "$depot" "$creer" FAUX_SEED_CODE=1 'FAUX_SEED_SORTIE=  ❌ 0 téléphone hors range'
  tait 'seed en écart' 'seed OK'
  dit 'seed en écart' 'signale un écart'
  dit 'seed en écart' '0 téléphone hors range'
  code 'seed non joué' 0 "$depot" "$creer" FAUX_SEED_CODE=1 \
    "FAUX_SEED_SORTIE=[seed:check] erreur : ENOENT: no such file or directory, open '/x/.env.local'"
  tait 'seed non joué' 'seed OK'
  dit 'seed non joué' 'NON JOUÉ'
  # Un script qui plante n'a rien constaté : ni « OK », ni « écart ».
  code 'seed en erreur sur un autre fichier' 0 "$depot" "$creer" FAUX_SEED_CODE=1 \
    "FAUX_SEED_SORTIE=[seed:check] erreur : ENOENT: no such file or directory, open '/x/matrix.csv'"
  tait 'seed en erreur sur un autre fichier' 'seed OK'
  tait 'seed en erreur sur un autre fichier' 'signale un écart'
  dit 'seed en erreur sur un autre fichier' 'sans rendre de verdict'
  dit 'seed en erreur sur un autre fichier' 'matrix.csv'
  code 'seed : commande introuvable' 0 "$depot" "$creer" FAUX_SEED_CODE=127 'FAUX_SEED_SORTIE=sh: tsx: command not found'
  tait 'seed : commande introuvable' 'seed OK'
  dit 'seed : commande introuvable' 'sans rendre de verdict'
  # Chaque signe d'une base injoignable, seul sur sa ligne de sortie.
  code 'seed : nom introuvable' 0 "$depot" "$creer" FAUX_SEED_CODE=1 'FAUX_SEED_SORTIE=Error: ENOTFOUND db.exemple.supabase.co'
  tait 'seed : nom introuvable' 'seed OK'
  dit 'seed : nom introuvable' 'NON JOUÉ'
  code 'seed : résolution de nom en échec' 0 "$depot" "$creer" FAUX_SEED_CODE=1 'FAUX_SEED_SORTIE=Error: getaddrinfo EAI_AGAIN db.exemple.supabase.co'
  dit 'seed : résolution de nom en échec' 'NON JOUÉ'
  code 'seed : connexion refusée' 0 "$depot" "$creer" FAUX_SEED_CODE=1 \
    'FAUX_SEED_SORTIE=[seed:check] erreur : connect ECONNREFUSED 127.0.0.1:5432'
  dit 'seed : connexion refusée' 'NON JOUÉ'
  code 'seed : délai dépassé' 0 "$depot" "$creer" FAUX_SEED_CODE=1 \
    'FAUX_SEED_SORTIE=[seed:check] erreur : connect ETIMEDOUT 10.0.0.1:5432'
  dit 'seed : délai dépassé' 'NON JOUÉ'

  # 7. Ce sont les markers et le contenu de la branche VISÉE qui sont jugés —
  # `--head <branche>`, sinon la cible d'un `cd … &&` — pas ceux du dossier où
  # le hook tourne.
  code '--head vers une branche sans markers' 2 "$depot" "$creer --head chore/autre-lot"
  go "$autre" chore-autre-lot
  rm "$depot/.claude/conformite-ok-lot" "$depot/.claude/securite-ok-lot"
  code '--head vers une branche en règle, depuis un dossier sans markers' 0 "$depot" "$creer --head chore/autre-lot"
  code 'cd vers un worktree en règle, depuis un dossier sans markers' 0 "$depot" "cd $autre && $creer"
  code 'cd vers un worktree sans markers, depuis un dossier en règle' 2 "$autre" "cd $depot && $creer"
  code 'sans cible : le dossier courant, sans markers' 2 "$depot" "$creer"

  [ "$ko" = false ]
)

# ── Auto-test : la matrice des formes de commande ──────────────────────────
# Une forme par ligne, préfixée de son type :
#   V = création RÉELLE, doit être vue ;
#   N = simple mention, ne doit pas déclencher ;
#   F = mention prise pour une commande — refus à tort ASSUMÉ (sens sûr) ;
#   L = limite connue — forme réelle NON vue par ce motif (cf. l'en-tête : ce que
#       l'ancien motif voyait et que celui-ci ne voit plus, et PORTÉE).
# F et L sont dans la matrice pour qu'un changement de comportement sur ces cas
# se voie, dans un sens comme dans l'autre.
if [ "${1:-}" = "--self-test" ]; then
  # Avant tout `git init` : un auto-test lancé depuis un hook git, un `rebase
  # --exec` ou un alias hérite de GIT_DIR, et ses dépôts « jetables » seraient
  # alors le VRAI dépôt (mesuré par la revue du lot voisin sur un autre hook :
  # `bare = true` écrit dans la configuration du clone). Ligne non épinglée par
  # un test ici.
  unset ${!GIT_*}
  echec=false
  nv=0; nn=0; nf=0; nl=0
  juge() {  # juge <type> <forme>
    local r voulu
    if gate_pr_matche "$2"; then r=VU; else r="NON VU"; fi
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
V:gh pr create --title "x" --body "y"
V:cd /tmp/wt && git push -u origin HEAD && gh pr create --fill
V:gh pr create --title "t" --body "$(cat <<'EOT'
V:BODY="$(cat /tmp/b.md)" && gh pr create --body "$BODY"
V:git push 2>&1 | tail -3; gh pr create --fill
V:(cd /tmp/wt; gh pr create --fill)
V:{ gh pr create --fill; }
V:[ -n "$x" ] && gh pr create --fill
V:URL=`gh pr create --fill`
V:URL="$(gh pr create --fill)"
V:if gh pr create --fill; then echo ok; fi
V:if git push -u origin b; then gh pr create --fill; fi
V:until gh pr create --fill; do sleep 5; done
V:test -f ok && gh pr create --fill || echo ko
V:GH_REPO=valentin5629/savr-platform gh pr create --fill
V:GH_TOKEN=abc GH_PAGER= gh pr create --fill
V:GH_TOKEN="$(cat tok)" gh pr create --fill
V:TITRE="a b" gh pr create --title "$TITRE"
V:/opt/homebrew/bin/gh pr create --fill
V:\gh pr create --fill
V:timeout 120 gh pr create --fill
V:gtimeout 120 gh pr create --fill
V:caffeinate -i gh pr create --fill
V:op run -- gh pr create --fill
V:retry 3 gh pr create --fill
V:nice gh pr create --fill
V:noglob gh pr create --fill
V:pnpm exec gh pr create --fill
V:env -u GH_HOST gh pr create --fill
V:env GH_TOKEN=abc gh pr create --fill
V:command -p gh pr create --fill
V:command gh pr create --fill
V:sudo -u val gh pr create --fill
V:echo x | xargs -I{} gh pr create --title {}
V:bash -lc "gh pr create --fill"
V:bash -e -c "gh pr create --fill"
V:bash -euo pipefail -c "gh pr create --fill"
V:/bin/bash -c "gh pr create --fill"
V:eval "gh pr create --fill"
V:case "$m" in go) gh pr create --fill;; esac
V:2>/dev/null gh pr create --fill
V:cd /tmp/wt &&gh pr create --fill
V:ok=1;gh pr create --fill
V:yes |gh pr create --fill
V:nice gh pr create # puis attendre la CI
V:GH_TOKEN=abc gh pr create \
V:if gh pr create \
V:if git push -u origin b; then gh pr create \
V:timeout 120 gh pr create \
V:{ gh pr create \
V:timeout 120 gh pr create
V:nice gh pr create && echo ok
V:nice gh pr create "$@"
V:nice gh pr create $ARGS
V:nice gh pr create > /tmp/sortie.txt
V:nice gh pr create < /tmp/corps.md
V:nice gh pr create &> /tmp/sortie.txt
V:echo `gh pr create` && gh pr create --fill
V:g`gh pr create`h pr create --fill
V:nice g`gh pr new`h pr create --fill
V:URL=`gh -R o/r pr create --fill`
V:`true`gh pr create`true` --fill
V:`true`gh pr new`true` --fill
V:`true `gh pr create` true` --fill
V:`:`gh pr create`:` --title t --body b
V:`true`gh pr create`echo " --fill"`
V:nice `true`gh pr create`true` --fill
V:bash -c '`true`gh pr create`true` --fill'
V:if `true`gh pr create`true` --fill; then echo ok; fi
V:D=`pwd`; `true`gh pr create`true` --fill --head b
V:gh pr new --fill
V:gh  pr   create --fill
V:gh pr -R o/r create --fill
V:gh -R o/r pr create --fill
V:gh --repo=o/r pr create --fill
N:git commit -m "doc: la garde de gh pr create ne rejoue plus rien"
N:git log --grep "gh pr create" --oneline
N:echo "ne pas lancer gh pr create ici"
N:rg -n "gh pr create" .claude
N:grep -c "gh pr create" DEFINITION_OF_DONE.md
N:# gh pr create est bloque sans markers
N:sed -n '/gh pr create/p' gate-pr.sh
N:jq -r '.x | select(test("gh pr create"))' f.json
N:printf '%s\n' 'gh pr create --fill' > /tmp/cmd.txt
N:python3 -c "if 'gh pr create' in c: k = 'gh pr create'"
N:echo "=== push + gate-pr (via gh pr create) ==="
N:gh pr view 42 --json title
N:gh pr merge 42 --squash
N:git commit -m "doc : `gh pr create` reste garde"
N:echo 'juste avant `gh pr create`, verifier mergeable'
N:- l'alias `gh pr new` est vu comme `gh pr create` (ligne de note Markdown)
F:echo "etape 1 ; gh pr create ; etape 3"
F:echo "a && gh pr create --fill"
F:gh pr create est la commande surveillee (ligne de corps de heredoc)
F:gh pr merge 42 --squash  # puis gh pr create
F:git commit -m "doc : lancer gh pr create --fill apres la revue"
F:echo 'la forme `gh pr create --fill` est gardee'
F:echo 'ecrit `gh  pr create` avec deux espaces'
F:echo 'voir `gh pr create`, ou bien `gh pr create --fill`'
L:"gh" pr create --fill
L:ssh hote 'gh pr create --fill'
L:su - val -c "gh pr create --fill"
L:"$SHELL" -c "gh pr create --fill"
L:$SHELL -lc 'gh pr create --fill'
L:dash -c "gh pr create --fill"
L:ksh -c "gh pr create --fill"
L:fish -c "gh pr create --fill"
L:tmux send-keys "gh pr create --fill" Enter
L:watch -n 60 "gh pr create --fill"
L:env -S "gh pr create --fill"
L:echo "gh pr create --fill" | bash
L:echo 'gh pr create --fill' | sh
L:printf '%s\n' "gh pr create --fill" | bash
L:bash <<< "gh pr create --fill"
L:case $m in go)gh pr create --fill;; esac
L:nice gh pr create 2>&1
L:(nice gh pr create)
L:URL=`gh pr create`
L:nice gh pr create 2>&1 --fill
L:nice gh pr create {--fill,--draft}
L:echo '`'; `true`gh pr create`true` --fill
L:"gh" pr create --fill # la mention `gh pr create` ne suffit plus a la faire voir
L:ssh hote 'gh pr create --fill' # idem, avec la mention `gh pr new`
FORMES
  # Une commande sur plusieurs lignes : chaque début de ligne est une position de commande.
  juge V "$(printf 'git push -u origin b\n  gh pr create --fill')"
  # Options renvoyées à la ligne : la ligne qui porte la commande finit par une barre inverse.
  juge V "$(printf 'cd /tmp/wt && GH_TOKEN=abc gh pr create \\\n  --title "t" \\\n  --body "b"')"
  # Une très grosse commande où du texte SUIT la ligne de la création : le tube
  # lu sous `pipefail` la rendait « non vue » (cf. gate_pr_matche).
  remplissage="$(head -c 300000 /dev/zero | tr '\0' 'x')"
  juge V "$(printf 'gh pr create --fill\n%s' "$remplissage")"
  juge V "$(printf 'nice gh pr create --fill\n%s' "$remplissage")"
  # Au-delà de 100 000 caractères, la mention entre accents graves n'est plus
  # retirée : refus à tort assumé (cf. gate_pr_matche).
  juge F "$(printf 'echo "voir `gh pr create` avant la revue"\n%s' "$remplissage")"
  juge N "$(printf 'echo "voir `gh pr create` avant la revue"\n%s' "${remplissage:0:90000}")"
  juge N "$(printf 'git status --short\n%s' "$remplissage")"

  # Ni heredoc ni chaîne-ici dans ce qui s'exécute hors auto-test (la fonction de
  # reconnaissance et le flux) : bash 3.2 les écrit dans un fichier temporaire, et
  # quand ce fichier ne peut pas être créé, ce qu'ils alimentent est sauté sans
  # erreur. Contrôle sur le texte de ce script, commentaires écartés.
  # Compte (`grep -c`), pas « au premier trouvé » (`grep -q`) : sous `pipefail`,
  # un grep qui sort tôt fait échouer le tube et le contrôle lisait « rien trouvé »
  # dans quelques passes sur cent sous Linux (mesuré en revue sécurité).
  heredocs="$(sed -n '/^gate_pr_matche() {$/,/^# ── Auto-test, 2e partie/p; /^INPUT="\$(cat)"$/,$p' "$ICI" \
    | grep -vE '^[[:space:]]*#' | grep -c '<<' || true)"
  if [ "$heredocs" != 0 ]; then
    echo "🔴 un heredoc ou une chaîne-ici est revenu dans le chemin exécuté du hook (${heredocs} ligne(s))." >&2
    echec=true
  fi
  [ "$(sed -n '/^gate_pr_matche() {$/,/^# ── Auto-test, 2e partie/p; /^INPUT="\$(cat)"$/,$p' "$ICI" | wc -l | tr -d ' ')" -gt 150 ] \
    || { echo "🔴 le contrôle « sans heredoc » ne lit plus le chemin exécuté du hook." >&2; echec=true; }

  bout_en_bout || echec=true

  if [ "$echec" = true ]; then
    echo "🔴 gate-pr : auto-test EN ÉCHEC — le hook peut être muet ou bloquer à tort." >&2
    exit 2
  fi
  echo "✅ gate-pr : auto-test OK ($nv créations de PR vues, $nn mentions ignorées, $nf refus à tort assumés, $nl limites connues ; flux de bout en bout : commande ignorée, suite rouge, contrat outbox, markers absent / vide / NON-GO / périmé pour chaque relecteur, seed qui ne dit plus OK à tort, branche visée par --head ou par cd)."
  exit 0
fi

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

gate_pr_matche "$CMD" || exit 0

# Résolu AVANT tout `cd` : le dossier du hook RÉELLEMENT exécuté. Les commandes de
# settings.json sont relatives — c'est donc le clone principal pour une session
# qui y est enracinée, et le worktree de la session sinon. C'est la version de
# suite-verte.sh de CE dossier qui doit servir, pas celle de la branche visée par
# la commande : une branche ouverte avant ce lot ne porte pas le script.
HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Worktree-aware (cf. lib-worktree.sh) : ce hook tourne dans le dossier où la
# session est enracinée — le clone principal (souvent `main`) ou un autre
# worktree. On se place dans le worktree de la branche RÉELLEMENT PR'd (--head,
# sinon la cible d'un `cd … &&`) pour évaluer SES markers/tests/branche.
. "$HOOKS/lib-worktree.sh"
HEAD_BRANCH="$(printf '%s' "$CMD" | sed -nE "s/.*--head[= ]+([^ \"']+).*/\1/p" | head -1)"
if [ -n "$HEAD_BRANCH" ]; then
  cd_worktree_for "$HEAD_BRANCH"
else
  CD_DIR="$(printf '%s' "$CMD" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
  cd_worktree_for "$CD_DIR"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
MARKER_CONFORMITE=".claude/conformite-ok-$(printf '%s' "$BRANCH" | tr '/' '-')"
MARKER_SECURITE=".claude/securite-ok-$(printf '%s' "$BRANCH" | tr '/' '-')"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo nohead)"

# R0d — un marker reviewer doit CONTENIR 'GO' + le SHA HEAD courant. Un fichier
# vide (touch) ou périmé (créé sur un commit antérieur) est rejeté → revue réelle,
# ré-attestée après chaque nouveau commit.
check_marker() {
  marker="$1"; label="$2"; agent="$3"
  if [ ! -f "$marker" ]; then
    echo "" >&2
    echo "❌ REVIEWER $label MANQUANT — PR bloquée." >&2
    echo "   Après Agent(subagent_type='$agent') si GO : echo \"GO $HEAD_SHA\" > '$marker'" >&2
    echo "" >&2
    exit 2
  fi
  # Ancré : 'GO ' en début de ligne — évite le faux positif de la sous-chaîne
  # « NON-GO » (un marker 'NON-GO <sha>' ne doit PAS passer).
  if ! grep -qE '^GO ' "$marker"; then
    echo "" >&2
    echo "❌ MARKER $label sans verdict 'GO' en tête (vide ou NON-GO ?) — PR bloquée." >&2
    echo "" >&2
    exit 2
  fi
  if ! grep -q "$HEAD_SHA" "$marker"; then
    echo "" >&2
    echo "❌ MARKER $label périmé (ne référence pas HEAD $HEAD_SHA) — re-revue requise après tes derniers commits." >&2
    echo "   Recrée : echo \"GO $HEAD_SHA\" > '$marker'" >&2
    echo "" >&2
    exit 2
  fi
  echo "  ✅ $label GO (marker à jour)" >&2
}

echo "" >&2
echo "🔒 GATE PR — vérification avant création PR ($BRANCH)" >&2
echo "" >&2

# 1. Tests unitaires — la suite COMPLÈTE, une fois par contenu. Le commit n'en
# joue plus que la part liée au changement (tests-lies.sh) : c'est ici que tout
# le reste est joué avant la PR. Une suite déjà verte sur le contenu exact de HEAD
# n'est pas rejouée (cf. suite-verte.sh) — typiquement la 2e tentative, après un
# premier refus sur un marker de revue.
echo "  → suite de tests complète (une fois par contenu)..." >&2
if ! bash "$HOOKS/suite-verte.sh" >&2 2>&1; then
  echo "" >&2
  echo "❌ test:unit échoue — PR bloquée. Corrige les tests avant de créer la PR." >&2
  exit 2
fi
echo "  ✅ tests OK" >&2

# 2. Vérification du seed — INFORMATIVE : elle dit ce qu'elle constate, elle ne
# bloque pas.
# `pnpm seed:check` interroge la base de DEV (volumétrie, objets clés, emails et
# téléphones fictifs, séquences de facturation). Il juge l'état de cette base,
# pas le contenu de la branche.
# Histoire de ce bloc, relevée par `git log -G'seed:check'` : du 2026-06-14 (#17)
# au 2026-06-17, il bloquait pour de bon (`if ! pnpm seed:check; then … exit 2`).
# Du 2026-06-17 (#48) au 2026-10-08, il lisait `$?` après un `|| true` : le code
# lu était toujours nul, « seed OK » s'affichait quoi qu'il arrive, et son
# `exit 2` ne pouvait plus être atteint. Mesuré le 2026-10-08, avant de corriger
# la lecture :
#   • dans un worktree sans `.env.local` (33 des 34 de `.claude/worktrees/` ce
#     jour-là), le script sort en 1 sans avoir rien contrôlé (ENOENT sur
#     `.env.local`) ;
#   • dans le clone principal, il sort en 1 sur 3 écarts réels de la base de dev
#     (un transporteur, une séquence de facturation, un téléphone).
# Bloquer sur ce code arrêterait donc toute création de PR, pour un état qui ne
# dépend pas de la PR. Le bloc reste non bloquant, comme il l'est en fait depuis
# le 2026-06-17 ; ce qui change, c'est qu'il n'affiche plus « OK » sans l'avoir
# constaté. Le rendre bloquant, ou le retirer d'ici, est une décision de Val.
sortie_contient() {  # <texte> <motif> — lu sans pipefail, comme dans gate_pr_matche
  (
    set +o pipefail
    printf '%s' "$1" 2>&- | grep -qE "$2"
  )
}
echo "  → pnpm seed:check (informatif)..." >&2
SEED_EXIT=0
SEED_OUTPUT="$(pnpm seed:check 2>&1)" || SEED_EXIT=$?
if [ "$SEED_EXIT" -eq 0 ]; then
  echo "  ✅ seed OK" >&2
elif sortie_contient "$SEED_OUTPUT" "ENOENT.*\.env\.local|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo"; then
  echo "  ⚠️  seed:check NON JOUÉ — pas de .env.local dans ce dossier, ou base de dev injoignable. Rien n'a été contrôlé." >&2
elif sortie_contient "$SEED_OUTPUT" '❌'; then
  printf '%s\n' "$SEED_OUTPUT" | grep -E '❌' >&2 || true
  echo "  ⚠️  seed:check signale un écart sur la base de dev (code ${SEED_EXIT}) — non bloquant." >&2
else
  printf '%s\n' "$SEED_OUTPUT" | tail -3 >&2 || true
  echo "  ⚠️  seed:check a échoué (code ${SEED_EXIT}) sans rendre de verdict — rien n'est établi sur la base de dev. Non bloquant." >&2
fi

# 3. Outbox contracts (conformité payload V2)
echo "  → check-outbox-contracts..." >&2
if ! bash scripts/check-outbox-contracts.sh >&2 2>&1; then
  echo "" >&2
  echo "❌ check-outbox-contracts échoue — divergence détectée avec le contrat V2 §08." >&2
  exit 2
fi
echo "  ✅ outbox contracts OK" >&2

# 4. Reviewer conformite-spec — existence + 'GO' + SHA HEAD (R0d).
check_marker "$MARKER_CONFORMITE" "CONFORMITE-SPEC" "reviewer-conformite-spec"

# 5. Reviewer rls-securite — existence + 'GO' + SHA HEAD (R0d).
check_marker "$MARKER_SECURITE" "RLS-SECURITE" "reviewer-rls-securite"

echo "" >&2
echo "✅ GATE PR OK — création autorisée." >&2
exit 0
