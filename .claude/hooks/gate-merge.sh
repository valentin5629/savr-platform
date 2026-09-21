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
# CE QUE COÛTE L'OUBLI — mesuré le 2026-09-22, pas supposé.
# Contrairement à ce qu'annonçaient les commentaires du repo, `supabase db push`
# ne saute RIEN en silence : il refuse, sort en 1, et nomme le fichier fautif.
# Le dommage est ailleurs, et il est collectif :
#   • plus aucun déploiement ne passe tant que le désordre n'est pas résolu ;
#   • le seul remède du CLI, `--include-all`, applique TOUTES les migrations
#     manquantes — donc les lots des autres. Le 2026-09-21, fermer `lieux` en
#     prod a exigé d'en appliquer 8, dont 7 d'autres lots, deux en attente
#     depuis 4 jours.
# Ce hook garde le déploiement sur un `db push` simple, lot par lot.
#
# PORTÉE, ET CE QU'IL NE COUVRE PAS
# ---------------------------------
# Il ne voit que les merges lancés depuis Claude Code / le terminal. Un merge
# fait depuis l'interface GitHub lui échappe. Le filet mécanique équivalent
# côté GitHub est le réglage de branch protection « Require branches to be up to
# date before merging », qui force la mise à jour de la branche (donc la
# re-exécution de la CI) avant tout merge — à appliquer par Val, cf.
# BRANCH_PROTECTION.md.
#
# FAIL-SAFE : tout ce qui n'est pas un refus AVÉRÉ laisse passer (exit 0) —
# commande non concernée, branche non résolue, dépôt sans migrations, hors ligne.
# =============================================================================
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || exit 0

printf '%s' "$CMD" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+merge' || exit 0

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-worktree.sh"

# `gh pr merge [<numéro> | <url> | <branche>]`. Sans argument, gh vise la PR de la
# branche courante. On résout d'abord l'argument éventuel en NOM DE BRANCHE : c'est
# lui qui désigne le worktree à évaluer, pas le cwd du hook (clone principal).
ARG="$(printf '%s' "$CMD" \
  | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+merge[[:space:]]+([^-][^[:space:]]*).*/\1/p' | head -1)"

BRANCHE=""
if [ -n "$ARG" ]; then
  # Un numéro ou une URL doit être traduit ; un nom de branche se suffit à lui-même.
  if printf '%s' "$ARG" | grep -Eq '^[0-9]+$|^https?://'; then
    BRANCHE="$(gh pr view "$ARG" --json headRefName -q .headRefName 2>/dev/null || true)"
  else
    BRANCHE="$ARG"
  fi
fi
if [ -z "$BRANCHE" ]; then
  CD_DIR="$(printf '%s' "$CMD" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
  cd_worktree_for "$CD_DIR"
  BRANCHE="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
else
  cd_worktree_for "$BRANCHE"
fi

# Branche non résolue → on ne sait pas quoi contrôler : laisser passer plutôt que
# de bloquer un merge légitime sur une incertitude d'analyse de la commande.
[ -n "$BRANCHE" ] && [ "$BRANCHE" != "HEAD" ] || exit 0

CHECK="scripts/check-migration-timestamp.sh"
[ -f "$CHECK" ] || exit 0

SORTIE="$(bash "$CHECK" --merge 2>&1)"
RC=$?
[ "$RC" -eq 0 ] && exit 0

{
  echo ""
  echo "🔴 MERGE BLOQUÉ — ordre des migrations (branche '$BRANCHE')."
  echo "$SORTIE"
  echo "   Après correction : re-pousser, attendre la CI, et les markers reviewers"
  echo "   devront être ré-ancrés au nouveau SHA (tout amend les périme)."
  echo ""
} >&2
exit 2
