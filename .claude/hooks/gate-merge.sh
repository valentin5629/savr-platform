#!/usr/bin/env bash
# =============================================================================
# gate-merge.sh — hook PreToolUse(Bash). Bloque `gh pr merge` quand la branche
# porte une migration que `main` a doublée PENDANT la revue.
#
# LE TROU QU'IL FERME
# -------------------
# `check-migration-timestamp.sh` se joue au commit (pré-commit, contrôles A+B) et
# en CI (`--branch`). Les deux comparent à `origin/main` TEL QU'IL ÉTAIT À CE
# MOMENT-LÀ. Entre la CI verte et le merge, `main` avance : sur la PR #373
# (2026-09-21), 8 commits ont atterri pendant une seule revue, dont 3 migrations
# postérieures à celle du lot. Aucun contrôle ne regardait plus rien à cet
# instant — et c'est le seul qui compte, puisque c'est lui qui fige l'ordre.
#
# CE QUE COÛTE L'OUBLI — mesuré le 2026-09-22, pas supposé (CLI v2.105.0).
# C'est le cas de ce hook, la migration n'étant appliquée NULLE PART encore :
# `supabase db push` REFUSE, sort en 1, et nomme le fichier :
#   Found local migration files to be inserted before the last migration on
#   remote database. Rerun the command with --include-all flag …
# Le dommage n'est donc pas le silence, il est collectif :
#   • plus aucun déploiement ne passe tant que le désordre n'est pas résolu ;
#   • le seul remède du CLI, `--include-all`, applique TOUTES les migrations
#     manquantes — donc les lots des autres. Le 2026-09-21, fermer `lieux` en
#     prod a exigé d'en appliquer 8, dont 7 d'autres lots, deux en attente
#     depuis 4 jours.
# ⚠ Il existe en revanche un cas RÉELLEMENT silencieux, voisin mais distinct :
# quand la version est DÉJÀ dans `schema_migrations` sous un AUTRE nom de
# fichier, `db push` sort en 0 sans jamais lister le fichier, et son SQL ne
# tourne pas. Cf. `scripts/check-migration-timestamp.sh`, en-tête.
# Ce hook garde le déploiement sur un `db push` simple, lot par lot.
#
# PORTÉE, ET CE QU'IL NE COUVRE PAS
# ---------------------------------
# C'est un `PreToolUse(Bash)` : il ne voit QUE l'outil Bash de Claude Code. Lui
# échappent, tous vérifiés en revue :
#   • un `gh pr merge` tapé par un humain dans son propre terminal ;
#   • un merge depuis l'interface GitHub ;
#   • `gh pr merge --auto` — le contrôle se joue à l'ACTIVATION, GitHub merge
#     plus tard côté serveur : périmé par construction, c'est le trou même que
#     ce hook ferme, rouvert par un flag ;
#   • `gh api -X PUT repos/o/r/pulls/N/merge` ;
#   • un `gh pr merge` enfoui dans un script (`bash scripts/fin-de-lot.sh`) ou
#     derrière un alias : la chaîne n'apparaît pas dans la commande interceptée.
# Le filet qui couvre TOUS ces chemins est côté GitHub : le job
# `migration-timestamp` doit devenir un status check REQUIS
# (`required_status_checks.contexts`). Le réglage « Require branches to be up to
# date before merging » (`strict`) est déjà actif et force la re-exécution de la
# CI — mais un rouge de `migration-timestamp` ne bloque rien tant qu'il n'est pas
# requis. Cf. BRANCH_PROTECTION.md.
#
# FAIL-SAFE : tout ce qui n'est pas un refus AVÉRÉ laisse passer (exit 0) —
# commande non concernée, branche non résolue, dépôt sans migrations, hors ligne.
# =============================================================================
set -uo pipefail

# ── Analyse de la commande — isolée en fonctions, pour être TESTABLE ────────
# C'est ici que vit la subtilité du hook, et c'est ici qu'un resserrement du motif
# a déjà creusé un trou. D'où `--self-test` plus bas : le gate ne peut plus devenir
# muet sans que quelqu'un le sache.

# Reconnaître `gh pr merge` en POSITION DE COMMANDE, et lui seul. Position de
# commande = début de ligne, après un séparateur (; & | &&), après une parenthèse,
# ou après un mot-clé / préfixe shell.
#
# ⚠ `if` N'EST PAS UNE OPTION. `if gh pr merge … ; then <cleanup> ; else NE RIEN
# SUPPRIMER ; fi` est la forme IMPOSÉE par le projet, après un incident où un
# cleanup non gardé a supprimé la branche distante d'une PR non mergée. Une
# première version ancrait sur `(^|[;&|])` seul : le gate était donc muet sur la
# commande même que le harnais oblige à écrire. Relevé en revue, mesuré.
# NE JAMAIS resserrer ce motif sans relancer `--self-test`.
gate_merge_matche() {
  printf '%s' "$1" | grep -Eq '(^|[;&|(]|\b(if|then|else|elif|do|while|until|time|env|command|exec|nohup)[[:space:]]+)[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge'
}

# L'argument est le premier token NON-FLAG après `merge` (`gh pr merge --squash 42`
# est légal). On COUPE d'abord la queue au premier séparateur shell : sans ça,
# `… --delete-branch && git worktree remove …` donnait ARG='&&' et `… ; echo fini`
# donnait ARG='echo' — de faux noms de branche, donc une abstention silencieuse sur
# des merges bien réels.
gate_merge_arg() {
  printf '%s' "$1" \
    | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+merge[[:space:]]+//p' \
    | head -1 | sed -E 's/[;&|].*//' \
    | tr ' ' '\n' | grep -vE '^-' | grep -vE '^$' | head -1
}

# ── Auto-test : la matrice des formes de commande ──────────────────────────
if [ "${1:-}" = "--self-test" ]; then
  echec=false
  att() {  # att <commande> <VU|NON VU>
    if gate_merge_matche "$1"; then r=VU; else r="NON VU"; fi
    [ "$r" = "$2" ] || { echo "🔴 motif : [$1] → $r (attendu $2)" >&2; echec=true; }
  }
  arg() {  # arg <commande> <ARG attendu>
    a="$(gate_merge_arg "$1")"
    [ "$a" = "$2" ] || { echo "🔴 arg : [$1] → [$a] (attendu [$2])" >&2; echec=true; }
  }

  # — formes de merge RÉELLES : toutes doivent être vues —
  att 'gh pr merge 42 --squash --delete-branch'                    'VU'
  att 'if gh pr merge 42 --squash; then echo ok; fi'               'VU'
  att 'cd /tmp/wt && gh pr merge --squash'                         'VU'
  att 'time gh pr merge 42'                                        'VU'
  att 'gh pr merge --squash; echo fini'                            'VU'
  att '(gh pr merge 42 --squash)'                                  'VU'
  # — simples MENTIONS : aucune ne doit déclencher —
  att 'git commit -m "doc: finir par gh pr merge 42"'              'NON VU'
  att 'grep -rn "gh pr merge" DEFINITION_OF_DONE.md'               'NON VU'
  att 'gh pr create --title "remplace gh pr merge"'                     'NON VU'
  # — extraction de l'argument : la queue shell n'est jamais un nom de branche —
  arg 'gh pr merge 42 --squash'                                    '42'
  arg 'gh pr merge --squash 42'                                    '42'
  arg 'gh pr merge --squash --delete-branch && git worktree remove ../x' ''
  arg 'gh pr merge --squash; echo fini'                            ''
  arg 'gh pr merge ma/branche --squash'                            'ma/branche'
  arg 'if gh pr merge 42 --squash; then echo ok; fi'               '42'

  if [ "$echec" = true ]; then
    echo "🔴 gate-merge : auto-test EN ÉCHEC — le hook peut être muet ou bloquer à tort." >&2
    exit 2
  fi
  echo "✅ gate-merge : auto-test OK (6 formes de merge vues, 3 mentions ignorées, queue shell jamais prise pour une branche)."
  exit 0
fi

INPUT="$(cat 2>/dev/null || true)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || exit 0

gate_merge_matche "$CMD" || exit 0


# Toute abstention laisse une trace. Un merge qui passe SANS contrôle et SANS un
# mot est le défaut que ce lot corrige par ailleurs (cf. le message « NON JOUÉ »
# plus bas) : il n'y a pas de raison de l'admettre ici. Relevé en revue.
abstention() {
  {
    echo ""
    echo "⚠️  gate-merge : contrôle d'ordre NON JOUÉ — $1."
    echo "    Le merge n'est PAS bloqué, mais l'ordre des migrations n'a pas été vérifié."
    echo ""
  } >&2
  exit 0
}
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-worktree.sh"

ARG="$(gate_merge_arg "$CMD")"

BRANCHE=""
if [ -n "$ARG" ]; then
  if printf '%s' "$ARG" | grep -Eq '^[0-9]+$|^https?://'; then
    BRANCHE="$(gh pr view "$ARG" --json headRefName -q .headRefName 2>/dev/null || true)"
    # ⚠ `gh` en échec (non authentifié, hors ligne, rate limit) → on NE SAIT PAS
    # quelle branche est visée. Se rabattre sur le cwd ferait juger le clone
    # principal en affichant le nom d'une autre branche : un refus faux, avec un
    # motif trompeur. Mesuré en revue sécurité. Fail-safe : on laisse passer.
    [ -n "$BRANCHE" ] || abstention "'gh pr view $ARG' n'a pas résolu la branche (hors ligne ? non authentifié ?)"
  else
    BRANCHE="$ARG"
  fi
  cd_worktree_for "$BRANCHE"
  # cd_worktree_for est un no-op quand aucun worktree ne porte la branche : on
  # jugerait alors l'arbre du cwd en prétendant juger la branche demandée. On
  # vérifie qu'on est BIEN dessus, sinon on s'abstient.
  [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)" = "$BRANCHE" ] || abstention "aucun worktree ne porte la branche '$BRANCHE'"
else
  # Sans argument, `gh` vise la PR de la branche du répertoire d'où part la
  # commande. `.cwd` du payload est cette information — le cwd du hook, lui, est
  # celui du clone principal. db-guard.sh lit déjà ce champ.
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
  CD_DIR="$(printf '%s' "$CMD" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
  cd_worktree_for "${CD_DIR:-$CWD}"
  BRANCHE="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [ -n "$BRANCHE" ] && [ "$BRANCHE" != "HEAD" ] || abstention "branche courante non résolue (HEAD détachée ?)"
fi

CHECK="scripts/check-migration-timestamp.sh"
[ -f "$CHECK" ] || abstention "$CHECK absent de la branche '$BRANCHE'"

SORTIE="$(bash "$CHECK" --merge 2>&1)"
RC=$?

# ⚠ SEUL un refus AVÉRÉ bloque. Le contrat du script est : 2 = refus, 0 = OK,
# tout le reste = contrôle NON JOUÉ (64 = argument inconnu, 127 = script absent,
# 1 = git/mktemp qui casse). Traiter « non joué » comme un refus gèle les merges
# légitimes : ce hook exécute le script DE LA BRANCHE CIBLE, et toute branche
# ouverte avant ce lot porte un script qui ne connaît pas `--merge` → exit 64.
# Mesuré le 2026-09-22 : 66 des 67 worktrees, et les 3 PR ouvertes, auraient été
# bloqués avec un motif faux et un remède inopérant. Relevé en revue sécurité.
if [ "$RC" -ne 2 ]; then
  if [ "$RC" -ne 0 ]; then
    {
      echo ""
      echo "⚠️  gate-merge : contrôle d'ordre NON JOUÉ sur '$BRANCHE' (exit $RC)."
      echo "    Cause probable : branche ouverte avant l'ajout du mode --merge."
      echo "    Le merge n'est PAS bloqué — mais l'ordre des migrations n'a pas été vérifié."
      echo ""
    } >&2
  fi
  exit 0
fi

{
  echo ""
  echo "🔴 MERGE BLOQUÉ — ordre des migrations (branche '$BRANCHE')."
  echo "$SORTIE"
  echo "   Après correction : re-pousser, attendre la CI, et les markers reviewers"
  echo "   devront être ré-ancrés au nouveau SHA (tout amend les périme)."
  echo ""
} >&2
exit 2
