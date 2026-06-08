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

list_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files
  else
    find . -type f | sed 's#^\./##'
  fi
}

# Vrai si le chemin $1 correspond a un glob de l'allowlist (# = commentaire).
allowed() {
  local f="$1" pat
  [ -f "$ALLOWLIST" ] || return 1
  while IFS= read -r pat; do
    case "$pat" in ''|\#*) continue ;; esac
    # shellcheck disable=SC2254
    case "$f" in $pat) return 0 ;; esac
  done < "$ALLOWLIST"
  return 1
}

violations=0

while IFS= read -r f; do
  [[ "$f" =~ $EXTS_REGEX ]] || continue
  case "$f" in
    packages/adapters/*) continue ;;        # zone autorisee (les adapters)
    scripts/check-coupling.sh) continue ;;  # le garde-fou lui-meme
    "$ALLOWLIST") continue ;;
  esac

  # customerOrders : interdit partout, zero exception.
  if hits="$(grep -nEi "$PAT_CUSTORDERS" "$f" 2>/dev/null)"; then
    while IFS= read -r line; do
      echo "COUPLAGE [customerOrders] $f:$line"
    done <<< "$hits"
    violations=1
  fi

  # mts1 / everest : exception possible via allowlist.
  if allowed "$f"; then continue; fi
  if hits="$(grep -nEi "$PAT_PROVIDER" "$f" 2>/dev/null)"; then
    while IFS= read -r line; do
      echo "COUPLAGE [mts1|everest] $f:$line"
    done <<< "$hits"
    violations=1
  fi
done < <(list_files)

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
