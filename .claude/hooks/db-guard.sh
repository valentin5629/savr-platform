#!/usr/bin/env bash
# =============================================================================
# db-guard.sh — hook PreToolUse(Bash). Sérialise les ÉCRITURES dans la DB
# PARTAGÉE savr-dev entre sessions parallèles.
#
# Bloque (exit 2) une commande qui MUTE savr-dev (seed / supabase db push /
# migration up / db reset) SI une AUTRE session tient déjà un « lease savr-dev »
# frais. Sinon : acquiert/rafraîchit le lease et laisse passer (exit 0).
#
# FAIL-SAFE : tout ce qui n'est pas un conflit AVÉRÉ → exit 0 (jamais de blocage
# d'un travail légitime). Commande non-DB, session hors savr-dev (local/jetable),
# lease libre/périmé/à soi, hors git, jq absent → passent instantanément.
#
# Le lease vit dans le `.git` COMMUN → partagé par tous les worktrees du clone.
# Libérer le lease d'une session morte :  pnpm session:db-unlock
# =============================================================================
set -uo pipefail

SAVR_DEV_REF="nvbyuajdvtuezcvyxtkd" # ref projet Supabase savr-dev (partagé)
LEASE_STALE=1800                    # 30 min : au-delà, lease considéré périmé

INPUT="$(cat 2>/dev/null || true)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || exit 0

# --- (1) commande qui MUTE une DB ? sinon on passe (cas courant, instantané). ---
# seed:check est READ-ONLY → volontairement exclu (pas dans la liste des mutations).
MUTATE_RE='seed:(minimal|demo|auth|jwt)|src/seed/(index|auth|jwt)\.ts|supabase[[:space:]]+db[[:space:]]+(push|reset)|supabase[[:space:]]+migration[[:space:]]+up|(^|[^a-z])db:(push|reset)([^a-z]|$)'
printf '%s' "$CMD" | grep -Eiq "$MUTATE_RE" || exit 0
# --dry-run ne mute rien (preview) → on ne garde pas.
printf '%s' "$CMD" | grep -Eiq -- '--dry-run' && exit 0

# --- (2) la session cible-t-elle savr-dev ? (local/jetable/aucune = pas de risque partagé) ---
root="$CWD"
{ [ -n "$root" ] && [ -d "$root" ]; } || root="$PWD"
top="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$top" ] || exit 0
envf="$top/.env.local"
[ -f "$envf" ] || exit 0
grep -q "$SAVR_DEV_REF" "$envf" 2>/dev/null || exit 0

# --- (3) lease savr-dev (dans le .git commun, visible de tous les worktrees) ---
common="$(git -C "$root" rev-parse --git-common-dir 2>/dev/null || true)"
[ -n "$common" ] || exit 0
case "$common" in
  /*) : ;;
  *) common="$(cd "$top" 2>/dev/null && cd "$common" 2>/dev/null && pwd)" || exit 0 ;;
esac
lease="$common/.savr-dev.lease"
branch="$(git -C "$top" branch --show-current 2>/dev/null || echo '?')"
now="$(date +%s 2>/dev/null || echo 0)"

# --- MUTEX ATOMIQUE autour de la section critique lecture-décision-écriture.
# `mkdir` est atomique en POSIX (échoue si le dossier existe déjà) → un seul hook
# entre ici à la fois. Sans lui, deux hooks simultanés pourraient tous deux lire
# « pas de lease frais » et acquérir en même temps (TOCTOU). La section critique
# ne dure que quelques ms.
lockdir="$lease.lock"
held=0
i=0
while [ "$held" -eq 0 ]; do
  if mkdir "$lockdir" 2>/dev/null; then
    held=1
    break
  fi
  i=$((i + 1))
  if [ "$i" -ge 40 ]; then
    # ~2s d'attente : la section critique durant des ms, un verrou encore tenu
    # ici est quasi certainement ORPHELIN (hook tué avant libération). On le
    # force pour ne JAMAIS deadlocker, puis dernière tentative d'acquisition.
    rmdir "$lockdir" 2>/dev/null || true
    mkdir "$lockdir" 2>/dev/null && held=1
    break
  fi
  sleep 0.05
done
cleanup() {
  [ "$held" -eq 1 ] && rmdir "$lockdir" 2>/dev/null
  return 0
}
trap cleanup EXIT

if [ -f "$lease" ]; then
  IFS='|' read -r l_wt l_branch l_epoch <"$lease" 2>/dev/null || true
  l_epoch="${l_epoch:-0}"
  age=$((now - l_epoch))
  if [ "${l_wt:-}" != "$top" ] && [ "$age" -ge 0 ] && [ "$age" -lt "$LEASE_STALE" ]; then
    {
      echo "🔴 CONFLIT savr-dev : la DB partagée est déjà utilisée par une AUTRE session."
      echo "   Détenteur : branche '$l_branch'  ($l_wt)  — lease posé il y a ${age}s."
      echo "   Ta session ('$branch') s'apprête à ÉCRIRE dans savr-dev (seed/migration) → risque de clobber."
      echo "   Options :"
      echo "     • attends que l'autre session finisse, puis relance ;"
      echo "     • si cette autre session est MORTE : 'pnpm session:db-unlock' puis relance ;"
      echo "     • ou isole cette session sur une base jetable / Supabase local (aucun lease requis)."
      echo "   Diagnostic complet : 'pnpm session:doctor'."
    } >&2
    exit 2
  fi
fi

# Libre / périmé / à moi → acquiert (ou rafraîchit) le lease, puis laisse passer.
printf '%s|%s|%s\n' "$top" "$branch" "$now" >"$lease" 2>/dev/null || true
exit 0
