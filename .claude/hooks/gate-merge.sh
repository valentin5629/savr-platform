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

INPUT="$(cat 2>/dev/null || true)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || exit 0

# Motif ANCRÉ en tête de segment (début de ligne, ou après ; & | &&). Un merge réel
# est toujours en tête de segment, `cd <worktree> && gh pr merge …` compris. Sans
# cet ancrage, toute commande qui MENTIONNE la chaîne déclenche le contrôle :
# mesuré en revue, `git commit -m "doc: … finir par gh pr merge <n>"` sortait en 2.
# `gate-pr.sh` matche sans ancre, mais son critère porte sur la commande elle-même
# (markers, tests) ; ici le refus porte sur un ÉTAT DU DÉPÔT sans rapport avec la
# commande interceptée — un faux positif y est bien plus coûteux.
printf '%s' "$CMD" | grep -Eq '(^|[;&|])[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge' || exit 0

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-worktree.sh"

# `gh pr merge [<numéro> | <url> | <branche>]`. Sans argument, gh vise la PR de la
# branche courante. On résout d'abord l'argument éventuel en NOM DE BRANCHE : c'est
# lui qui désigne le worktree à évaluer, pas le cwd du hook (clone principal).
# Premier token NON-FLAG après `merge` — `gh pr merge --squash 42` est légal, donc
# on ne peut pas se contenter du token suivant immédiatement.
ARG="$(printf '%s' "$CMD" \
  | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+merge[[:space:]]+//p' \
  | head -1 | tr ' ' '\n' | grep -vE '^-' | grep -vE '^$' | head -1)"

BRANCHE=""
if [ -n "$ARG" ]; then
  if printf '%s' "$ARG" | grep -Eq '^[0-9]+$|^https?://'; then
    BRANCHE="$(gh pr view "$ARG" --json headRefName -q .headRefName 2>/dev/null || true)"
    # ⚠ `gh` en échec (non authentifié, hors ligne, rate limit) → on NE SAIT PAS
    # quelle branche est visée. Se rabattre sur le cwd ferait juger le clone
    # principal en affichant le nom d'une autre branche : un refus faux, avec un
    # motif trompeur. Mesuré en revue sécurité. Fail-safe : on laisse passer.
    [ -n "$BRANCHE" ] || exit 0
  else
    BRANCHE="$ARG"
  fi
  cd_worktree_for "$BRANCHE"
  # cd_worktree_for est un no-op quand aucun worktree ne porte la branche : on
  # jugerait alors l'arbre du cwd en prétendant juger la branche demandée. On
  # vérifie qu'on est BIEN dessus, sinon on s'abstient.
  [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)" = "$BRANCHE" ] || exit 0
else
  # Sans argument, `gh` vise la PR de la branche du répertoire d'où part la
  # commande. `.cwd` du payload est cette information — le cwd du hook, lui, est
  # celui du clone principal. db-guard.sh lit déjà ce champ.
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
  CD_DIR="$(printf '%s' "$CMD" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
  cd_worktree_for "${CD_DIR:-$CWD}"
  BRANCHE="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [ -n "$BRANCHE" ] && [ "$BRANCHE" != "HEAD" ] || exit 0
fi

CHECK="scripts/check-migration-timestamp.sh"
[ -f "$CHECK" ] || exit 0

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
