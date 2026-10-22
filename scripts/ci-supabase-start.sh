#!/usr/bin/env bash
# =============================================================================
# ci-supabase-start.sh — démarre la pile Supabase locale de la CI, avec un repli
# de registre d'images.
# =============================================================================
# POURQUOI (2026-10-22) : l'action supabase/setup-cli fait télécharger les images
# sur ghcr.io (variable SUPABASE_INTERNAL_IMAGE_REGISTRY qu'elle exporte). Après un
# incident GitHub (composant « Packages » dégradé à partir de 16:28 UTC), ghcr.io
# a refusé une partie des téléchargements de l'image supabase/postgres (429
# « toomanyrequests … allowed: 44000/minute »), anonymes comme authentifiés
# (mesuré depuis un poste hors CI) : chaque job qui démarre la pile a échoué
# pendant des heures, main compris. La même image, à la même empreinte, est
# publiée sur public.ecr.aws, qui la servait sans refus.
#
# CE QUE FAIT LE SCRIPT : `supabase start` tel quel ; s'il échoue, arrêt de la
# pile puis nouvel essai avec SUPABASE_INTERNAL_IMAGE_REGISTRY=public.ecr.aws.
# Une autre cause d'échec échoue aussi au second essai : le job reste rouge.
#
#   bash scripts/ci-supabase-start.sh              # en CI, à la place de `supabase start`
#   bash scripts/ci-supabase-start.sh --self-test  # faux CLI Supabase en tête du PATH, pas de Docker
# =============================================================================
set -uo pipefail

REPLI=public.ecr.aws

demarrer() {
  if supabase start; then
    return 0
  fi
  echo "::warning::supabase start a échoué (registre ${SUPABASE_INTERNAL_IMAGE_REGISTRY:-par défaut}) — nouvel essai sur ${REPLI}."
  supabase stop --no-backup || true
  SUPABASE_INTERNAL_IMAGE_REGISTRY="$REPLI" supabase start
}

auto_test() {
  local bac echec=0
  bac=$(mktemp -d) || { echo "🔴 mktemp a échoué" >&2; return 1; }
  [ -d "$bac" ] || { echo "🔴 dossier jetable absent" >&2; return 1; }
  # Faux CLI : note chaque appel avec le registre vu, et rend le code demandé
  # selon le registre (CODE_PREMIER sur ghcr.io, CODE_REPLI sur public.ecr.aws).
  cat > "$bac/supabase" <<'FAUX'
#!/usr/bin/env bash
echo "$* registre=${SUPABASE_INTERNAL_IMAGE_REGISTRY:-}" >> "$JOURNAL"
case "$1" in
  start)
    if [ "${SUPABASE_INTERNAL_IMAGE_REGISTRY:-}" = public.ecr.aws ]; then
      exit "${CODE_REPLI:-0}"
    fi
    exit "${CODE_PREMIER:-0}" ;;
  *) exit 0 ;;
esac
FAUX
  chmod +x "$bac/supabase"

  cas() { # libellé, code au premier essai, code au repli, code attendu, appels attendus
    : > "$bac/journal"
    JOURNAL="$bac/journal" CODE_PREMIER="$2" CODE_REPLI="$3" \
      SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io PATH="$bac:$PATH" \
      bash "$SCRIPT" >/dev/null 2>&1
    local code=$?
    local appels
    appels=$(tr '\n' ';' < "$bac/journal")
    if [ "$code" != "$4" ] || [ "$appels" != "$5" ]; then
      echo "🔴 $1 : code $code (attendu $4), appels « $appels » (attendus « $5 »)" >&2
      echec=1
    else
      echo "✅ $1"
    fi
  }

  cas "ghcr.io répond : un seul démarrage, sans repli" 0 0 0 \
    "start registre=ghcr.io;"
  cas "ghcr.io refuse : arrêt de la pile, puis démarrage sur public.ecr.aws" 1 0 0 \
    "start registre=ghcr.io;stop --no-backup registre=ghcr.io;start registre=public.ecr.aws;"
  cas "les deux refusent : le job reste rouge" 1 1 1 \
    "start registre=ghcr.io;stop --no-backup registre=ghcr.io;start registre=public.ecr.aws;"

  rm -rf "$bac"
  return "$echec"
}

SCRIPT="${BASH_SOURCE[0]}"
if [ "${1:-}" = "--self-test" ]; then
  auto_test
  exit $?
fi
demarrer
