#!/usr/bin/env bash
# =============================================================================
# Garde-fou 3 TMS-Ready : interdiction du couplage direct a MTS-1 / Everest
# =============================================================================
# La Plateforme ne parle JAMAIS directement a MTS-1 / Everest depuis le code
# metier : tout passe par l'interface logistique_provider (impl. adapter_mts1 /
# adapter_everest), confinee a packages/adapters/. Un swap d'adapter (V2 = TMS
# natif) doit etre trivial → 0 reference directe hors de cette zone.
#
# Regles :
#   - Motifs "mts1" / "everest" : scannes dans le code TS/JS + SQL, HORS
#     packages/adapters/, HORS chemins listes dans scripts/coupling-allowlist.txt
#     (exceptions legitimes rares — ex. valeur d'enum transporteurs.type_tms —
#      visibles et revues en PR, jamais silencieuses).
#   - Motif "customerOrders" (ressource API MTS-1 V3) : INTERDIT PARTOUT hors
#     adapters, AUCUNE exception (l'allowlist est ignoree pour ce motif).
#
# Sortie : exit 1 (build rouge) + chaque fichier:ligne fautif si violation,
#          exit 0 sinon. Compatible bash 3.2 (macOS) et GNU bash (CI Linux).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ALLOWLIST="scripts/coupling-allowlist.txt"
EXTS_REGEX='\.(ts|tsx|js|jsx|mjs|cjs|sql)$'

# Bornes "mot" portables (GNU + BSD grep), sans \b (non portable).
WB='(^|[^A-Za-z0-9_])'
WE='([^A-Za-z0-9_]|$)'
PAT_PROVIDER="${WB}(mts1|everest)${WE}"
PAT_CUSTORDERS="${WB}customerOrders${WE}"

# Fichiers suivis hors zone autorisee, filtres sur les extensions scannees.
# Un seul `git grep` par motif au lieu de deux `grep` par fichier : 20 s → ~1 s
# (mesure 2026-10-25). Hors d'un depot git, repli sur `grep -r`.
EXCLUS=(':(exclude)packages/adapters/*' ':(exclude)scripts/check-coupling.sh' ":(exclude)$ALLOWLIST")

# Sortie « fichier:ligne:texte » pour le motif $1, fichiers des extensions scannees.
chercher() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git grep -nIiE "$1" -- "${EXCLUS[@]}" 2>/dev/null || true
  else
    grep -rnIiE "$1" . 2>/dev/null | sed 's#^\./##' \
      | grep -vE '^(packages/adapters/|scripts/check-coupling\.sh:|scripts/coupling-allowlist\.txt:)' || true
  fi | while IFS= read -r hit; do
    f="${hit%%:*}"
    [[ "$f" =~ $EXTS_REGEX ]] && printf '%s\n' "$hit"
  done
}

# Vrai si le chemin $1 correspond a un glob de l'allowlist (# = commentaire).
ALLOW_PATS=()
if [ -f "$ALLOWLIST" ]; then
  while IFS= read -r pat; do
    case "$pat" in ''|\#*) continue ;; esac
    ALLOW_PATS+=("$pat")
  done < "$ALLOWLIST"
fi
allowed() {
  local f="$1" pat
  [ "${#ALLOW_PATS[@]}" -gt 0 ] || return 1
  for pat in "${ALLOW_PATS[@]}"; do
    # shellcheck disable=SC2254
    case "$f" in $pat) return 0 ;; esac
  done
  return 1
}

violations=0

# customerOrders : interdit partout, zero exception.
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  echo "COUPLAGE [customerOrders] ${hit%%:*}:${hit#*:}"
  violations=1
done < <(chercher "$PAT_CUSTORDERS")

# mts1 / everest : exception possible via allowlist (jugee une fois par fichier).
dernier=""; exempt=1
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  f="${hit%%:*}"
  if [ "$f" != "$dernier" ]; then
    dernier="$f"
    if allowed "$f"; then exempt=0; else exempt=1; fi
  fi
  [ "$exempt" -eq 0 ] && continue
  echo "COUPLAGE [mts1|everest] $f:${hit#*:}"
  violations=1
done < <(chercher "$PAT_PROVIDER")

if [ "$violations" -ne 0 ]; then
  {
    echo ""
    echo "Garde-fou 3 (anti-couplage TMS) : reference directe a MTS-1/Everest hors packages/adapters/."
    echo "→ Router l'appel via l'interface logistique_provider (adapter_mts1 / adapter_everest)."
    echo "→ Exception legitime ? Ajouter le chemin a $ALLOWLIST (revu en PR)."
    echo "  customerOrders n'admet JAMAIS d'exception."
  } >&2
  exit 1
fi

echo "Garde-fou 3 anti-couplage : OK (0 reference directe hors packages/adapters/)."
exit 0
