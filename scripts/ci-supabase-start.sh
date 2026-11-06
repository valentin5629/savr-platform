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
# publiée sur public.ecr.aws et sur Docker Hub (docker.io). Le premier repli
# (public.ecr.aws seul, PR #614) a sauvé 3 jobs sur 6 ; les 3 autres ont été
# refusés aussi par public.ecr.aws (« toomanyrequests: Data limit exceeded » ou
# délai dépassé) : un seul registre de repli ne suffit pas.
#
# CE QUE FAIT LE SCRIPT : `supabase start` sur le registre de l'action, puis, en
# cas d'échec, arrêt de la pile et nouvel essai sur public.ecr.aws, puis sur
# docker.io ; le tout deux fois au plus, avec une pause entre les deux tours.
# Les images déjà téléchargées restent dans le cache Docker du runner : un
# second tour ne télécharge que ce qui manque. Après six échecs, le job reste
# rouge.
#
# Le registre qui a répondu est écrit dans $GITHUB_ENV : les étapes suivantes du
# job y téléchargent aussi leurs images. Sans cela, `supabase test db` tirait
# supabase/pg_prove sur ghcr.io même après un repli, et le job pgtap-rls-outbox
# échouait là (PR #613, 2026-10-22 : démarrage sur docker.io après les refus de
# ghcr.io et de public.ecr.aws, puis pg_prove refusé par ghcr.io).
#
#   bash scripts/ci-supabase-start.sh              # en CI, à la place de `supabase start`
#   bash scripts/ci-supabase-start.sh --self-test  # faux CLI Supabase en tête du PATH, pas de Docker
# =============================================================================
set -uo pipefail

TOURS=2
PAUSE="${CI_SUPABASE_PAUSE:-30}" # secondes entre deux tours (0 dans l'auto-test)

registres() { # registre de l'action (défaut du CLI : public.ecr.aws), puis les replis, sans doublon
  local vus="" r
  for r in "${SUPABASE_INTERNAL_IMAGE_REGISTRY:-public.ecr.aws}" public.ecr.aws docker.io; do
    case " $vus " in *" $r "*) continue ;; esac
    vus="$vus $r"
    echo "$r"
  done
}

retenir() { # registre qui a répondu → étapes suivantes du job (hors GitHub Actions : rien)
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "SUPABASE_INTERNAL_IMAGE_REGISTRY=$1" >> "$GITHUB_ENV" \
      || echo "::warning::registre ${1} non retenu pour les étapes suivantes du job."
  fi
}

demarrer() {
  local tour registre liste
  liste=$(registres)
  for tour in $(seq 1 "$TOURS"); do
    for registre in $liste; do
      if SUPABASE_INTERNAL_IMAGE_REGISTRY="$registre" supabase start; then
        retenir "$registre"
        return 0
      fi
      echo "::warning::supabase start a échoué (registre ${registre}, tour ${tour}/${TOURS})."
      supabase stop --no-backup || true
    done
    if [ "$tour" -lt "$TOURS" ]; then
      sleep "$PAUSE"
    fi
  done
  echo "::error::supabase start a échoué sur tous les registres ($(echo $liste)), ${TOURS} tours."
  return 1
}

auto_test() {
  local bac echec=0
  bac=$(mktemp -d) || { echo "🔴 mktemp a échoué" >&2; return 1; }
  [ -d "$bac" ] || { echo "🔴 dossier jetable absent" >&2; return 1; }
  # Faux CLI : note chaque appel avec le registre vu ; le n-ième `start` rend le
  # n-ième code de CODES (0 au-delà de la liste).
  cat > "$bac/supabase" <<'FAUX'
#!/usr/bin/env bash
echo "$* registre=${SUPABASE_INTERNAL_IMAGE_REGISTRY:-}" >> "$JOURNAL"
case "$1" in
  start)
    n=$(( $(cat "$COMPTEUR" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$COMPTEUR"
    set -- $CODES
    code=0
    [ "$n" -le "$#" ] && eval "code=\${$n}"
    exit "$code" ;;
  *) exit 0 ;;
esac
FAUX
  chmod +x "$bac/supabase"

  cas() { # libellé, registre de l'action, codes des `start` successifs, code attendu, appels attendus,
    #     registre retenu attendu dans GITHUB_ENV (vide : rien d'écrit) ; la ligne déjà
    #     présente dans GITHUB_ENV doit rester (ajout, jamais écrasement)
    : > "$bac/journal"
    echo "DEJA_LA=1" > "$bac/github_env"
    rm -f "$bac/compteur"
    JOURNAL="$bac/journal" COMPTEUR="$bac/compteur" CODES="$3" CI_SUPABASE_PAUSE=0 \
      GITHUB_ENV="$bac/github_env" SUPABASE_INTERNAL_IMAGE_REGISTRY="$2" PATH="$bac:$PATH" \
      bash "$SCRIPT" >/dev/null 2>&1
    local code=$?
    local appels retenu attendu="DEJA_LA=1;"
    appels=$(tr '\n' ';' < "$bac/journal")
    retenu=$(tr '\n' ';' < "$bac/github_env")
    [ -n "$6" ] && attendu="${attendu}SUPABASE_INTERNAL_IMAGE_REGISTRY=$6;"
    if [ "$code" != "$4" ] || [ "$appels" != "$5" ] || [ "$retenu" != "$attendu" ]; then
      echo "🔴 $1 : code $code (attendu $4), appels « $appels » (attendus « $5 »), GITHUB_ENV « $retenu » (attendu « $attendu »)" >&2
      echec=1
    else
      echo "✅ $1"
    fi
  }

  local G="start registre=ghcr.io;" E="start registre=public.ecr.aws;" D="start registre=docker.io;"
  local SG="stop --no-backup registre=ghcr.io;"
  cas "ghcr.io répond : un seul démarrage, sans repli" ghcr.io "0" 0 "$G" ghcr.io
  cas "ghcr.io refuse : arrêt de la pile, puis public.ecr.aws" ghcr.io "1 0" 0 "$G$SG$E" public.ecr.aws
  cas "ghcr.io et public.ecr.aws refusent : docker.io" ghcr.io "1 1 0" 0 "$G$SG$E$SG$D" docker.io
  cas "le premier tour échoue en entier : second tour, ghcr.io répond" ghcr.io "1 1 1 0" 0 \
    "$G$SG$E$SG$D$SG$G" ghcr.io
  cas "tout refuse deux fois : six essais, le job reste rouge" ghcr.io "1 1 1 1 1 1" 1 \
    "$G$SG$E$SG$D$SG$G$SG$E$SG$D$SG" ""
  cas "registre de l'action = public.ecr.aws : pas d'essai en double" public.ecr.aws "1 0" 0 \
    "$E""stop --no-backup registre=public.ecr.aws;$D" docker.io
  cas "aucun registre exporté : défaut du CLI, puis docker.io" "" "1 0" 0 \
    "start registre=public.ecr.aws;stop --no-backup registre=;start registre=docker.io;" docker.io

  # Hors GitHub Actions (GITHUB_ENV absent) : démarrage normal, aucun fichier écrit.
  : > "$bac/journal"
  rm -f "$bac/compteur" "$bac/github_env"
  env -u GITHUB_ENV JOURNAL="$bac/journal" COMPTEUR="$bac/compteur" CODES="1 0" CI_SUPABASE_PAUSE=0 \
    SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io PATH="$bac:$PATH" bash "$SCRIPT" >/dev/null 2>&1
  local code_hors=$? appels_hors fichiers
  appels_hors=$(tr '\n' ';' < "$bac/journal")
  fichiers=$(ls -A "$bac" | tr '\n' ' ')
  if [ "$code_hors" = 0 ] && [ "$appels_hors" = "$G$SG$E" ] && [ "$fichiers" = "compteur journal supabase " ]; then
    echo "✅ hors GitHub Actions : démarrage sans fichier d'environnement"
  else
    echo "🔴 hors GitHub Actions : code $code_hors, appels « $appels_hors », fichiers « $fichiers »" >&2
    echec=1
  fi

  rm -rf "$bac"
  return "$echec"
}

SCRIPT="${BASH_SOURCE[0]}"
if [ "${1:-}" = "--self-test" ]; then
  auto_test
  exit $?
fi
demarrer
