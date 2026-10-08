#!/usr/bin/env bash
# Gate points 2 + 4 : bloque gh pr create sans tests verts + conformite-spec GO.
# Point 3 (divergences) est couvert par le reviewer conformite-spec qui doit les flaguer.
set -euo pipefail

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
#      Vue quoi qu'il y ait derrière.
#
#   2. DERRIÈRE N'IMPORTE QUOI D'AUTRE — un mot-clé du shell (`if`, `then`,
#      `until`…), une variable d'environnement en préfixe, un lanceur (`timeout
#      120`, `nice`, `caffeinate -i`, `op run --`, `env -u X`, `sudo -u u`,
#      `xargs -I{}`), une redirection, un motif de `case` suivi d'un blanc… On ne les énumère pas
#      (on en oublierait) : la commande est vue dès qu'elle est précédée d'un
#      blanc ET suivie d'une option, d'un argument entre guillemets ou en
#      variable, d'une fin de commande, ou d'une barre inverse de continuation
#      (options renvoyées à la ligne). C'est ce qui la distingue d'une mention
#      en pleine phrase (« … via gh pr create) … », « … gh pr create est bloqué »).
#
# Dans les deux cas : binaire appelé par son chemin ou précédé d'une barre oblique
# inverse, options entre `gh`, `pr` et le verbe (`gh -R o/r pr create`), et l'alias
# `gh pr new`.
#
# CE QUI DÉCLENCHE À TORT, et c'est voulu (un refus de trop vaut mieux qu'une PR
# non contrôlée) : une mention collée à un début de commande dans un texte — après
# un `;`, un `|` ou un `&&` entre guillemets, en début de ligne d'un heredoc — ou
# placée en fin de ligne. Vécu pendant l'écriture de ce lot : un script de
# modification passé en heredoc, dont une ligne contenait `|` suivi de la commande.
#
# CE QUE L'ANCIEN MOTIF VOYAIT ET QUE CELUI-CI NE VOIT PLUS — mesuré en revue
# sécurité sur trois matrices de formes réelles, toutes vues par l'ancien motif :
# 48 vues sur 48 pour les deux premières (35 formes courantes, 13 avec les options
# renvoyées à la ligne), 7 sur 22 pour la troisième. Deux familles :
#   a. SANS aucune option, hors début de commande — refermée aussitôt (`(nice gh
#      pr create)`) ou suivie d'une redirection (`nice gh pr create 2>&1`). Ne
#      crée rien : hors terminal interactif, `gh` la refuse (« must provide
#      `--title` and `--body` … when not running interactively »).
#   b. AVEC options — donc capable de créer une PR — quand la commande est collée
#      à un guillemet ouvrant ailleurs que derrière `sh -c` / `eval`, ou à la
#      parenthèse d'un motif de `case`. Les 15 formes non vues de la troisième
#      matrice : `ssh hote '…'`, `su - val -c "…"`, `"$SHELL" -c "…"`,
#      `$SHELL -lc '…'`, `dash -c`, `ksh -c`, `fish -c`, `tmux send-keys "…"`,
#      `watch "…"`, `env -S "…"`, `echo "…" | bash`, `echo '…' | sh`,
#      `printf … | bash`, `bash <<< "…"`, `case $m in go)gh pr create --fill`.
#      Les voir toutes obligerait à voir aussi `grep "…"` : des mentions
#      redeviendraient des refus à tort. Aucune n'apparaît dans l'historique des
#      sessions — aucune création réelle n'y est perdue, seules des mentions le
#      sont — mais rien ne les empêche.
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
  printf '%s' "$1" | grep -Eq "(${debut}|${enveloppe})${commande}" && return 0
  printf '%s' "$1" | grep -Eq "[[:space:]]${commande}${suite}"
}

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
    [ "$r" = "$voulu" ] || { echo "🔴 motif [$1] : [$2] → $r (attendu $voulu)" >&2; echec=true; }
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
F:echo "etape 1 ; gh pr create ; etape 3"
F:echo "a && gh pr create --fill"
F:gh pr create est la commande surveillee (ligne de corps de heredoc)
F:gh pr merge 42 --squash  # puis gh pr create
L:"gh" pr create --fill
L:ssh hote 'gh pr create --fill'
L:su - val -c "gh pr create --fill"
L:echo "gh pr create --fill" | bash
L:case $m in go)gh pr create --fill;; esac
L:nice gh pr create 2>&1
L:(nice gh pr create)
FORMES
  # Une commande sur plusieurs lignes : chaque début de ligne est une position de commande.
  juge V "$(printf 'git push -u origin b\n  gh pr create --fill')"
  # Options renvoyées à la ligne : la ligne qui porte la commande finit par une barre inverse.
  juge V "$(printf 'cd /tmp/wt && GH_TOKEN=abc gh pr create \\\n  --title "t" \\\n  --body "b"')"

  if [ "$echec" = true ]; then
    echo "🔴 gate-pr : auto-test EN ÉCHEC — le hook peut être muet ou bloquer à tort." >&2
    exit 2
  fi
  echo "✅ gate-pr : auto-test OK ($nv créations de PR vues, $nn mentions ignorées, $nf refus à tort assumés, $nl limites connues)."
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

# 2. Seed check (staleness detector)
# Le check utilise DIRECT_URL (port 5432) qui peut être injoignable en environnement sandboxé.
# Si l'erreur est ENOTFOUND/ECONNREFUSED (réseau), on warn sans bloquer.
# Si c'est une vraie erreur de schéma, le process exit non-0 avec un autre message.
echo "  → pnpm seed:check..." >&2
SEED_OUTPUT=$(pnpm seed:check 2>&1 || true)
SEED_EXIT=$?
if [ $SEED_EXIT -ne 0 ]; then
  if echo "$SEED_OUTPUT" | grep -qE "ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo"; then
    echo "  ⚠️  seed:check ignoré (DIRECT_URL injoignable — réseau sandboxé, pas un écart schéma)" >&2
  else
    echo "" >&2
    echo "$SEED_OUTPUT" >&2
    echo "❌ seed:check échoue — le seed est probablement désynchronisé du schéma." >&2
    echo "   Mets à jour packages/shared/src/seed/ pour refléter les nouvelles tables/colonnes." >&2
    exit 2
  fi
else
  echo "  ✅ seed OK" >&2
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
