#!/usr/bin/env bash
# R0d — anti-collision de timestamp de migration.
#
# Supabase dérive la `version` (PK de supabase_migrations.schema_migrations) du
# préfixe 14 chiffres du nom de fichier. Deux migrations qui partagent ce préfixe
# ne peuvent pas coexister : selon le chemin, soit `supabase db reset` meurt sur
# un duplicate key (CI rouge), soit — bien pire — `db push` voit la version déjà
# présente et SAUTE la seconde migration EN SILENCE (jamais appliquée, ni en dev
# ni en prod).
#
# DEUX contrôles, de portées différentes :
#
#   (A) LOCAL — la migration ajoutée doit porter le timestamp le plus grand du
#       dossier de la BRANCHE COURANTE, et aucun préfixe du dossier ne doit être
#       dupliqué. Nécessaire, PAS suffisant : aveugle à tout ce qui n'est pas sur
#       la branche.
#
#   (B) INTER-BRANCHES — aucun autre ref distant ne doit porter le même préfixe
#       sous un autre nom de fichier. SEUL contrôle complet : c'est le seul qui
#       voie une branche EN VOL, ni mergée ni sur `main` (5e occurrence de la
#       famille, PR #322 : la collision était avec `fix/filtre-provider-find-
#       tournees`, et (A) ne pouvait structurellement pas la voir — il compare au
#       max du dossier de sa propre branche).
#
# Usage :
#   check-migration-timestamp.sh              # pré-commit : migrations STAGÉES (A + B)
#   check-migration-timestamp.sh --branch     # CI / pré-push : migrations de HEAD absentes d'origin/main (A + B)
#   check-migration-timestamp.sh --no-remote  # (A) seul — sans réseau
#   check-migration-timestamp.sh --self-test  # prouve que (A) ET (B) rougissent vraiment (non-vacuité)
set -euo pipefail

MIG_DIR="supabase/migrations"
BASE_REF="${MIGRATION_BASE_REF:-origin/main}"
MODE="staged"
WITH_REMOTE=true
SELF_TEST=false

for arg in "$@"; do
  case "$arg" in
    --branch)    MODE="branch" ;;
    --no-remote) WITH_REMOTE=false ;;
    --self-test) SELF_TEST=true ;;
    *) echo "Argument inconnu : $arg" >&2; exit 64 ;;
  esac
done

prefixe() { basename "$1" | cut -c1-14; }

# ---------------------------------------------------------------------------
# Rappels affichés sur collision : les deux pièges qui restent APRÈS la détection.
# ---------------------------------------------------------------------------
rappels_apres_collision() {
  cat >&2 <<'TXT'

    ⚠  Renommer ne suffit PAS si le numéro a déjà été appliqué quelque part.
       Si l'ancien préfixe a été écrit dans un schema_migrations (dev OU prod),
       il reste BRÛLÉ : au merge de l'autre lot, `db push` verra la version déjà
       présente et sautera SA migration en silence. Correctif complet =
       DELETE de l'ancienne version + INSERT de la nouvelle, dans chaque base
       où l'ancienne a été appliquée.

    ⚠  Qui bouge ? Celui qui a déjà écrit le numéro dans un schema_migrations
       (c'est lui qui a armé l'ambiguïté), et à défaut celui dont la PR n'est
       pas encore ouverte. Ne pas laisser « le second au merge » trancher :
       à ce moment-là l'échec est silencieux, pas bloquant.

    ⚠  Viser un timestamp POSTÉRIEUR au max de la cible, pas simplement « libre » :
       s'insérer dans un trou change l'ordre d'application sur base vierge.
TXT
}

# ---------------------------------------------------------------------------
# Périmètre : les migrations « à moi », celles dont je choisis le timestamp.
# ---------------------------------------------------------------------------
mes_migrations() {
  if [ "$MODE" = "staged" ]; then
    # `R` autant que `A` : renommer une migration est précisément le remède que ce
    # script conseille en cas de collision, et un `git mv` pur est classé R100 —
    # sans lui, le commit de correction ne serait re-contrôlé par personne en local.
    # (--name-only rend le nom de DESTINATION pour un R, donc le nouveau préfixe.)
    git diff --cached --name-only --diff-filter=AR \
      | grep -E "^${MIG_DIR}/[0-9]{14}_.*\.sql$" || true
  else
    # Migrations portées par HEAD dont le nom de fichier est absent de la cible.
    local base_names
    base_names=$(git ls-tree -r --name-only "$BASE_REF" -- "$MIG_DIR" 2>/dev/null | sed 's#.*/##' || true)
    git ls-tree -r --name-only HEAD -- "$MIG_DIR" 2>/dev/null \
      | grep -E "^${MIG_DIR}/[0-9]{14}_.*\.sql$" \
      | while read -r f; do
          printf '%s\n' "$base_names" | grep -qxF "$(basename "$f")" || echo "$f"
        done
  fi
}

# ---------------------------------------------------------------------------
# (A) Contrôle LOCAL — max du dossier + aucun préfixe dupliqué sur la branche.
# ---------------------------------------------------------------------------
controle_local() {
  local mes="$1" fail=false
  local new_ts max_other

  # Préfixes DÉJÀ acceptés dans la référence (HEAD en pré-commit, la cible en CI).
  # Un renommage cosmétique — corriger le slug sans toucher au préfixe — ne doit
  # pas être traité comme une migration nouvelle : son timestamp a déjà été admis,
  # et lui conseiller « prends un timestamp > max » le décalerait à tort. Il reste
  # soumis au contrôle de doublon ci-dessous, et au contrôle inter-branches.
  local ref_prefixes
  if [ "$MODE" = "staged" ]; then
    ref_prefixes=$(git ls-tree -r --name-only HEAD -- "$MIG_DIR" 2>/dev/null | sed 's#.*/##; s#_.*##' || true)
  else
    ref_prefixes=$(git ls-tree -r --name-only "$BASE_REF" -- "$MIG_DIR" 2>/dev/null | sed 's#.*/##; s#_.*##' || true)
  fi

  new_ts=$(for f in $mes; do prefixe "$f"; done | sort -u)

  max_other=$(
    ls "${MIG_DIR}"/*.sql 2>/dev/null \
      | xargs -n1 basename 2>/dev/null \
      | grep -oE '^[0-9]{14}' \
      | grep -vxF "$(printf '%s\n' "$new_ts")" \
      | sort | tail -1
  )

  local ts
  for ts in $new_ts; do
    # Préfixe déjà présent dans la référence => renommage, pas une migration neuve.
    if printf '%s\n' "$ref_prefixes" | grep -qxF "$ts"; then continue; fi
    # Comparaison lexicographique = numérique (14 chiffres, même longueur).
    if [ -n "$max_other" ] && ! [[ "$ts" > "$max_other" ]]; then
      echo "" >&2
      echo "❌  Migration $ts <= max du dossier ($max_other) — collision ou ré-ordonnancement." >&2
      echo "    Renomme avec un timestamp > $max_other (ex: $(date -u +%Y%m%d%H%M%S 2>/dev/null || echo '<maintenant>'))." >&2
      echo "    (Le max LOCAL appliqué peut être périmé : c'est le max du DOSSIER qui compte.)" >&2
      fail=true
    fi
  done

  # Doublon déjà présent dans le dossier (typiquement révélé par un merge de main).
  local dups d
  dups=$(ls "${MIG_DIR}"/*.sql 2>/dev/null | sed 's#.*/##; s#_.*##' | sort | uniq -d || true)
  if [ -n "$dups" ]; then
    echo "" >&2
    echo "❌  Préfixe(s) dupliqué(s) DANS ${MIG_DIR}/ sur cette branche :" >&2
    for d in $dups; do
      echo "      $d :" >&2
      ls "${MIG_DIR}"/"${d}"_*.sql 2>/dev/null | sed 's#.*/#        #' >&2
    done
    fail=true
  fi

  [ "$fail" = true ] && return 1
  return 0
}

# ---------------------------------------------------------------------------
# (B) Contrôle INTER-BRANCHES — le seul complet.
#
# Un ref distant est CANDIDAT s'il n'est pas déjà contenu dans la cible (une
# branche dont le HEAD est ancêtre de origin/main n'apporte rien). Attention :
# le repo squash-merge, donc ce filtre ne purge presque rien — c'est la
# comparaison par NOM DE FICHIER qui évite le bruit : deux refs portant le
# MÊME fichier portent la même migration, pas une collision.
# ---------------------------------------------------------------------------
refs_candidats() {
  git for-each-ref --format='%(refname:short)' "${MIGRATION_SCAN_REFS:-refs/remotes}" \
    | grep -v '/HEAD$' \
    | grep '/' \
    | while read -r ref; do
        git rev-parse --verify -q "${ref}^{commit}" >/dev/null 2>&1 || continue
        if [ "$ref" != "$BASE_REF" ] \
           && git merge-base --is-ancestor "$ref" "$BASE_REF" 2>/dev/null; then
          continue
        fi
        echo "$ref"
      done
}

controle_inter_branches() {
  local mes="$1" fail=false

  [ "$WITH_REMOTE" = true ] || return 0

  if [ -z "${MIGRATION_SCAN_REFS:-}" ]; then
    if ! git fetch --quiet --prune origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null; then
      echo "" >&2
      echo "⚠️  git fetch impossible (hors ligne ?) — contrôle INTER-BRANCHES non joué." >&2
      echo "    Le contrôle local ne voit PAS les branches en vol : rejouer avant de pousser." >&2
      return 0
    fi
  fi

  local catalogue
  catalogue=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$catalogue'" RETURN

  local ref
  for ref in $(refs_candidats); do
    git ls-tree -r --name-only "$ref" -- "$MIG_DIR" 2>/dev/null \
      | grep -E "^${MIG_DIR}/[0-9]{14}_.*\.sql$" \
      | sed "s#^#${ref} #" >> "$catalogue"
  done

  local f ts mien conflits
  for f in $mes; do
    ts=$(prefixe "$f")
    mien=$(basename "$f")
    # Collision = même préfixe SOUS UN AUTRE NOM DE FICHIER. Le même nom sur un
    # autre ref (ma branche déjà poussée, une branche squash-mergée) désigne LA
    # MÊME migration : une seule `version`, donc rien à signaler — même si son
    # contenu diffère, ce qui relève du merge, pas de schema_migrations.
    conflits=$(awk -v ts="$ts" -v mien="$mien" \
      '{n=split($2,a,"/"); b=a[n];
        if (substr(b,1,14)==ts && b!=mien) print "      " $1 "  →  " b}' \
      "$catalogue" | sort -u)
    if [ -n "$conflits" ]; then
      echo "" >&2
      echo "❌  Collision de timestamp $ts avec une branche NON MERGÉE :" >&2
      echo "      (à moi)  $mien" >&2
      echo "$conflits" >&2
      echo "" >&2
      echo "    Ce cas est INVISIBLE au contrôle local et au merge d'essai avec ${BASE_REF} :" >&2
      echo "    la branche concurrente n'est ni sur ${BASE_REF}, ni sur la mienne." >&2
      rappels_apres_collision
      fail=true
    fi
  done

  [ "$fail" = true ] && return 1
  return 0
}

# ---------------------------------------------------------------------------
# Auto-test : prouve que (B) rougit sur une vraie collision, reste vert sinon,
# et ne se signale pas lui-même une fois la branche poussée. Sans ça le gate
# pourrait être inerte et personne ne le saurait.
# ---------------------------------------------------------------------------
self_test() {
  local script_abs tmp origine clone rc echec=false
  script_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  origine="$tmp/origine.git"
  clone="$tmp/clone"

  git init --quiet --bare --initial-branch=main "$origine"
  git init --quiet --initial-branch=main "$tmp/amorce"
  (
    cd "$tmp/amorce"
    git config user.email t@t.t && git config user.name t && git config commit.gpgsign false
    mkdir -p "$MIG_DIR"
    echo "-- socle" > "$MIG_DIR/20260101100000_plateforme_socle.sql"
    git add -A && git -c core.hooksPath=/dev/null commit --quiet --no-verify -m socle
    git remote add origin "$origine" && git push --quiet origin main
    # Branche concurrente EN VOL : jamais mergée dans main.
    git checkout --quiet -b concurrente
    echo "-- concurrente" > "$MIG_DIR/20260101130000_plateforme_concurrente.sql"
    git add -A && git -c core.hooksPath=/dev/null commit --quiet --no-verify -m concurrente
    git push --quiet origin concurrente
  ) >/dev/null 2>&1

  git clone --quiet "$origine" "$clone"
  cd "$clone"
  git config user.email t@t.t && git config user.name t && git config commit.gpgsign false
  git checkout --quiet -b mon-lot

  # Cas 1 — ROUGE attendu : même préfixe que la branche en vol.
  echo "-- mien" > "$MIG_DIR/20260101130000_plateforme_mon_lot.sql"
  git add -A
  rc=0; bash "$script_abs" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "🔴 AUTO-TEST : collision inter-branches NON détectée (exit $rc, attendu 2)." >&2
    echo "   Le gate ne prouve plus rien." >&2
    echec=true
  fi

  # Cas 1bis — le contrôle LOCAL seul doit rester VERT sur ce même cas :
  # c'est exactement ce qui rendait la 5e occurrence invisible.
  rc=0; bash "$script_abs" --no-remote >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "🔴 AUTO-TEST : le contrôle local rougit sur le cas inter-branches (exit $rc)." >&2
    echo "   Prémisse cassée : le cas de test ne démontre plus le trou qu'il documente." >&2
    echec=true
  fi

  # Cas 2 — VERT attendu : préfixe libre et postérieur au max.
  git rm --quiet -f "$MIG_DIR/20260101130000_plateforme_mon_lot.sql"
  echo "-- mien" > "$MIG_DIR/20260101140000_plateforme_mon_lot.sql"
  git add -A
  rc=0; bash "$script_abs" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "🔴 AUTO-TEST : faux positif sur un timestamp libre (exit $rc, attendu 0)." >&2
    echec=true
  fi

  # Cas 3 — VERT attendu : ma branche poussée ne doit pas se dénoncer elle-même,
  # y compris après avoir RETOUCHÉ ma migration (le contenu diffère alors de
  # celui du ref distant, seul le filtre « branche courante » évite le faux positif).
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "mon lot" >/dev/null 2>&1
  git push --quiet origin mon-lot >/dev/null 2>&1
  echo "-- mien, corrigé après le premier push" > "$MIG_DIR/20260101140000_plateforme_mon_lot.sql"
  git add -A
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "mon lot, suite" >/dev/null 2>&1
  rc=0; bash "$script_abs" --branch >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "🔴 AUTO-TEST : faux positif — la branche se signale contre son propre ref distant (exit $rc)." >&2
    echec=true
  fi

  # Cas 4 — ROUGE attendu SANS RÉSEAU : deux préfixes identiques dans le dossier
  # (ce qu'un merge de la cible fait apparaître). Couvre le contrôle (A), que les
  # cas 1 à 3 laissaient hors de portée de toute mutation.
  echo "-- jumeau" > "$MIG_DIR/20260101140000_plateforme_jumeau.sql"
  git add -A
  rc=0; bash "$script_abs" --no-remote >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "🔴 AUTO-TEST : préfixe dupliqué DANS le dossier non détecté (exit $rc, attendu 2)." >&2
    echec=true
  fi
  git rm --quiet -f "$MIG_DIR/20260101140000_plateforme_jumeau.sql"

  # Cas 5 — ROUGE attendu : la migration RENOMMÉE doit rester contrôlée. Un `git mv`
  # pur est classé R100, pas A : filtré, il sortirait du périmètre et le commit de
  # correction ne serait vérifié par personne en local. On renomme vers un préfixe
  # antérieur au socle restant (20260101100000) : le contrôle (A) doit le refuser.
  git mv "$MIG_DIR/20260101140000_plateforme_mon_lot.sql" "$MIG_DIR/20260101090000_plateforme_mon_lot.sql"
  rc=0; bash "$script_abs" --no-remote >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "🔴 AUTO-TEST : migration RENOMMÉE hors périmètre (exit $rc, attendu 2) — un git mv échappe au contrôle." >&2
    echec=true
  fi

  # Cas 6 — VERT attendu : renommage COSMÉTIQUE (slug corrigé, préfixe inchangé)
  # d'une migration qui n'est pas la plus récente. Le timestamp a déjà été admis :
  # le refuser afficherait « prends un timestamp > max », conseil qui décalerait
  # à tort une migration déjà ordonnée.
  git reset --quiet --hard HEAD >/dev/null 2>&1
  git mv "$MIG_DIR/20260101100000_plateforme_socle.sql" "$MIG_DIR/20260101100000_plateforme_socle_corrige.sql"
  # Garde anti-fixture-vacante : sans renommage dans le périmètre, ce cas passerait
  # au vert quoi que fasse le script — il ne prouverait plus rien.
  if ! git diff --cached --name-only --diff-filter=AR | grep -q 'socle_corrige'; then
    echo "🔴 AUTO-TEST : cas 6 VACANT — le renommage n'est pas dans le périmètre, l'assertion ne prouve rien." >&2
    echec=true
  fi
  rc=0; bash "$script_abs" --no-remote >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "🔴 AUTO-TEST : faux positif sur un renommage préservant le préfixe (exit $rc, attendu 0)." >&2
    echec=true
  fi

  [ "$echec" = true ] && return 1
  echo "✅ check-migration-timestamp : auto-test OK (collision en vol, doublon local, renommage ; 0 faux positif)."
  return 0
}

# ---------------------------------------------------------------------------
if [ "$SELF_TEST" = true ]; then
  self_test || exit 2
  exit 0
fi

[ -d "$MIG_DIR" ] || exit 0

MES=$(mes_migrations)
[ -z "$MES" ] && exit 0

RC=0
controle_local "$MES"          || RC=2
controle_inter_branches "$MES" || RC=2
[ "$RC" -ne 0 ] && echo "" >&2
exit "$RC"
