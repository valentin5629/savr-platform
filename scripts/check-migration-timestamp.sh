#!/usr/bin/env bash
# R0d — anti-collision de timestamp de migration.
#
# Supabase dérive la `version` (PK de supabase_migrations.schema_migrations) du
# préfixe 14 chiffres du nom de fichier. Deux migrations qui partagent ce préfixe
# ne peuvent pas coexister. Le comportement dépend de ce qui est DÉJÀ appliqué —
# trois scénarios, tous reproduits sur base jetable le 2026-09-22 (CLI v2.105.0).
# Ne pas les confondre : deux sont bruyants, le troisième ne l'est pas.
#
#   1. Préfixe dupliqué, AUCUNE des deux versions appliquée → `supabase db reset`
#      et `db push` échouent tous deux : `duplicate key value violates unique
#      constraint "schema_migrations_pkey"`, exit 1. BRUYANT.
#   2. Migration mal ORDONNÉE (version absente, inférieure au max appliqué) →
#      `db push` refuse, exit 1, et NOMME le fichier : « Found local migration
#      files to be inserted before the last migration on remote database. Rerun
#      the command with --include-all flag … ». BRUYANT.
#   3. Version DÉJÀ dans `schema_migrations`, portée par un AUTRE nom de fichier
#      → le CLI matche par VERSION, pas par nom : le fichier n'est même pas
#      listé, `db push` sort en 0 avec « Finished », et son SQL ne tourne
#      JAMAIS. SILENCIEUX, intégralement. C'est le cas du préfixe « brûlé »
#      décrit plus bas dans `rappels_apres_collision`.
#
# ⚠ Une correction du 2026-09-22 avait affirmé que rien n'est jamais silencieux,
# sur la foi des seuls scénarios 1 et 2. Le scénario 3 la dément, et c'est
# précisément celui qu'un opérateur rencontre APRÈS une collision. Vérifier les
# trois avant de ré-écrire ce paragraphe dans un sens ou dans l'autre.
#
# DEUX contrôles, de portées différentes :
#
#   (A) LOCAL — la migration ajoutée doit porter le timestamp le plus grand du
#       dossier de la BRANCHE COURANTE, et aucun préfixe du dossier ne doit être
#       dupliqué. Nécessaire, PAS suffisant : aveugle à tout ce qui n'est pas sur
#       la branche.
#
#   (B) INTER-BRANCHES — aucun autre ref distant ne doit porter le même préfixe
#       sous un autre nom de fichier. C'est le seul qui voie une branche EN VOL,
#       ni mergée ni sur `main` (5e occurrence de la famille, PR #322 : la
#       collision était avec `fix/filtre-provider-find-tournees`, et (A) ne
#       pouvait structurellement pas la voir — il compare au max du dossier de sa
#       propre branche).
#
#   (C) CONTRE LA CIBLE, AU MERGE — mes migrations doivent encore devancer le max
#       d'`origin/main` AU MOMENT DE MERGER. (A) et (B) se jouent au commit et en
#       CI ; entre ce moment et le merge, `main` avance. Une PR ouverte avec le
#       timestamp le plus haut du jour peut être doublée par trois autres avant
#       d'être mergée — vécu le 2026-09-21 sur la PR #373, 8 commits sur `main`
#       pendant une seule revue. (A) ne le voit pas : il compare au dossier de la
#       branche, qui ignore ce qui est arrivé sur la cible depuis.
#
# ⚠ CE QUI ARRIVE VRAIMENT SI (C) MANQUE — mesuré le 2026-09-22, pas supposé.
# Le commentaire d'origine de ce fichier annonçait que `db push` « SAUTE la
# migration EN SILENCE ». C'est FAUX, et il ne faut pas le ré-écrire : reproduit
# sur base jetable, `supabase db push` REFUSE de pousser, sort en 1, et nomme le
# fichier en clair :
#     Found local migration files to be inserted before the last migration
#     on remote database.
#     Rerun the command with --include-all flag to apply these migrations:
#     supabase/migrations/20260201000000_b.sql
# Le préfixe dupliqué échoue tout aussi bruyamment (`duplicate key value violates
# unique constraint "schema_migrations_pkey"`, exit 1, migration non appliquée).
#
# Le dommage réel n'est donc PAS le silence, c'est le BLOCAGE et son remède :
#   • plus aucun déploiement ne passe tant que le désordre n'est pas résolu —
#     pour tout le monde, pas seulement pour l'auteur ;
#   • le seul remède du CLI est `--include-all`, qui applique TOUTES les
#     migrations manquantes, donc embarque les lots des autres. Vécu le
#     2026-09-21 : fermer `lieux` en prod a exigé d'appliquer 8 migrations dont
#     7 d'autres lots, deux en attente depuis 4 jours.
# (C) garde le déploiement sur un `db push` simple, lot par lot.
#
# ⚠ POURQUOI (C) N'EST PAS UN CONTRÔLE DE CI — ne pas l'y ajouter.
# Le workflow tourne `on: pull_request` avec `actions/checkout@v4` SANS `ref:`,
# donc sur le COMMIT DE MERGE (`refs/pull/N/merge`) : le dossier contient déjà les
# migrations de la cible, et (A) attrape le désordre tout seul. (C) n'y ajouterait
# rien. Le vrai trou n'est pas « la CI ne regarde pas », c'est « la CI ne regarde
# PLUS » : elle ne se rejoue pas entre son dernier run et le merge. D'où deux
# filets, et deux seulement :
#   • `.claude/hooks/gate-merge.sh` → joue (C) À L'INSTANT du merge (côté Claude
#     Code / terminal) ;
#   • le réglage GitHub « Require branches to be up to date before merging »
#     → force la mise à jour, donc la RE-exécution de la CI (couvre aussi les
#     merges faits depuis l'interface, que le hook ne voit pas). Cf.
#     BRANCH_PROTECTION.md, où la case attend d'être cochée.
#
# Usage :
#   check-migration-timestamp.sh              # pré-commit : migrations STAGÉES (A + B)
#   check-migration-timestamp.sh --branch     # CI / pré-push : migrations de HEAD absentes d'origin/main (A + B)
#   check-migration-timestamp.sh --merge      # pré-merge : (A + B + C), cible re-fetchée
#   check-migration-timestamp.sh --no-remote  # (A) seul — sans réseau
#   check-migration-timestamp.sh --self-test  # prouve que (A), (B) ET (C) rougissent vraiment (non-vacuité)
set -euo pipefail

MIG_DIR="supabase/migrations"
BASE_REF="${MIGRATION_BASE_REF:-origin/main}"
MODE="staged"
WITH_REMOTE=true
SELF_TEST=false
MERGE_CHECK=false

for arg in "$@"; do
  case "$arg" in
    --branch)    MODE="branch" ;;
    --merge)     MODE="branch"; MERGE_CHECK=true ;;
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
       présente et SAUTERA SA MIGRATION EN SILENCE : le fichier n'est pas listé,
       `db push` sort en 0, et son SQL ne tourne jamais (scénario 3 de l'en-tête,
       mesuré). C'est le cas le plus dangereux des trois, et c'est celui-ci.
       Correctif complet =
       DELETE de l'ancienne version + INSERT de la nouvelle, dans chaque base
       où l'ancienne a été appliquée. En PROD, cette écriture sort du système de
       migrations : STOP, demander à Val (CLAUDE.md §12).

    ⚠  Qui bouge ? Celui qui a déjà écrit le numéro dans un schema_migrations
       (c'est lui qui a armé l'ambiguïté), et à défaut celui dont la PR n'est
       pas encore ouverte. Ne pas laisser « le second au merge » trancher : à ce
       moment-là plus aucun contrôle ne regarde, et l'échec se paie au
       déploiement suivant — sur le dos de tout le monde, pas du seul auteur.
       C'est ce que ferme le contrôle (C).

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

  new_ts=$(printf '%s\n' "$mes" | while IFS= read -r f; do
    [ -n "$f" ] && prefixe "$f"
  done | sort -u)

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
  # Quotes SIMPLES : la commande du trap ne doit pas être construite par
  # interpolation à la définition (une apostrophe dans le chemin s'en échapperait).
  trap 'rm -f "$catalogue"' RETURN

  local ref
  for ref in $(refs_candidats); do
    # Le nom du ref passe par `awk -v` (affectation de variable), jamais dans un
    # script `sed` : `#` est un caractère LÉGAL dans un nom de branche (`fix/issue#322`)
    # et cassait le délimiteur, rendant ce ref invisible au contrôle — un garde
    # d'intégrité muet, soit la panne même qu'il corrige.
    git ls-tree -r --name-only "$ref" -- "$MIG_DIR" 2>/dev/null \
      | grep -E "^${MIG_DIR}/[0-9]{14}_.*\.sql$" \
      | awk -v r="$ref" '{print r " " $0}' >> "$catalogue"
  done

  local f ts mien conflits
  while IFS= read -r f; do
    [ -n "$f" ] || continue
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
  done <<EOF
$mes
EOF

  [ "$fail" = true ] && return 1
  return 0
}

# ---------------------------------------------------------------------------
# (C) CONTRE LA CIBLE, AU MERGE — le contrôle que (A) ne peut pas faire.
#
# (A) compare au max du DOSSIER DE MA BRANCHE. Tant que je n'ai pas mergé la
# cible, ce dossier ignore les migrations arrivées sur `main` depuis. Ici on
# compare au max de la CIBLE elle-même, re-fetchée à l'instant : c'est le seul
# moment où la question « ma migration passera-t-elle encore en `db push` simple »
# a une réponse vraie.
#
# (C) ne traite QUE l'ORDRE : ma migration est antérieure au max de la cible →
# `db push` sort en 1 et exige `--include-all`.
#
# ⚠ Le DOUBLON contre la cible (mon préfixe déjà pris sur `main` sous un autre
# nom) n'est PAS traité ici : (B) le couvre déjà, parce que `refs_candidats`
# n'exclut jamais `$BASE_REF` lui-même — `origin/main` est un ref candidat comme
# les autres. Une première version de (C) le re-testait ; la sonde de mutation
# l'a démasqué (neutraliser (C) laissait le cas au vert, attrapé par (B)). Code
# mort retiré : un contrôle qui ne peut pas rougir donne une fausse assurance.
# Le cas 12 de l'auto-test verrouille cette répartition.
# ---------------------------------------------------------------------------
controle_vs_cible() {
  local mes="$1" fail=false
  local cible_noms cible_prefixes max_cible ts mien

  cible_noms=$(git ls-tree -r --name-only "$BASE_REF" -- "$MIG_DIR" 2>/dev/null | sed 's#.*/##' || true)
  if [ -z "$cible_noms" ]; then
    echo "" >&2
    echo "⚠️  ${BASE_REF} illisible (pas de fetch ?) — contrôle (C) NON JOUÉ." >&2
    echo "    C'est le seul contrôle qui voie ce qui a été mergé pendant la revue." >&2
    return 0
  fi

  cible_prefixes=$(printf '%s\n' "$cible_noms" | grep -oE '^[0-9]{14}' | sort -u)
  max_cible=$(printf '%s\n' "$cible_prefixes" | sort | tail -1)

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    ts=$(prefixe "$f")
    mien=$(basename "$f")

    # ORDRE : comparaison lexicographique = numérique (14 chiffres, même longueur).
    # Un préfixe ÉGAL au max est refusé ici comme un préfixe inférieur : c'est le
    # doublon, dont (B) donnera le détail (quel ref, quel fichier).
    if ! [[ "$ts" > "$max_cible" ]]; then
      echo "" >&2
      echo "❌  (C) Migration $ts <= max de ${BASE_REF} ($max_cible)." >&2
      echo "      $mien" >&2
      echo "" >&2
      echo "    ${BASE_REF} a avancé depuis l'ouverture de cette branche. Merger en" >&2
      echo "    l'état rendrait tout \`supabase db push\` suivant impossible :" >&2
      echo "      Found local migration files to be inserted before the last" >&2
      echo "      migration on remote database.  (exit 1)" >&2
      echo "    Le seul remède du CLI est \`--include-all\`, qui applique AUSSI les" >&2
      echo "    migrations en attente des autres lots. C'est ce couplage qu'on évite." >&2
      echo "" >&2
      echo "    Remède : merger ${BASE_REF} dans la branche, puis \`git mv\` la" >&2
      echo "    migration vers un préfixe > $max_cible (et recaler les références" >&2
      echo "    au timestamp : tests, manifestes, divergences)." >&2
      fail=true
    fi
  done <<EOF
$mes
EOF

  [ "$fail" = true ] && return 1
  return 0
}

# ---------------------------------------------------------------------------
# Auto-test : prouve que (B) rougit sur une vraie collision, reste vert sinon,
# et ne se signale pas lui-même une fois la branche poussée. Sans ça le gate
# pourrait être inerte et personne ne le saurait.
# ---------------------------------------------------------------------------
# NB : corps entre parenthèses = SOUS-SHELL. Aucun `cd` ne peut fuir vers
# l'appelant, et si le clone échoue le script ne peut pas se mettre à muter le
# dépôt réel (les `git reset --hard` / `git push` des cas suivants y frapperaient).
# `set -e` ne protège pas ici : `self_test` est appelée en partie gauche d'un `||`,
# ce qui le neutralise dans tout le corps — d'où les gardes explicites.
self_test() (
  local script_abs tmp origine clone rc echec=false
  script_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  tmp=$(mktemp -d) || { echo "🔴 AUTO-TEST : mktemp -d impossible." >&2; return 2; }
  [ -n "$tmp" ] && [ -d "$tmp" ] || { echo "🔴 AUTO-TEST : répertoire jetable invalide." >&2; return 2; }
  trap 'rm -rf "$tmp"' EXIT
  origine="$tmp/origine.git"
  clone="$tmp/clone"

  git init --quiet --bare --initial-branch=main "$origine"
  git init --quiet --initial-branch=main "$tmp/amorce"
  (
    cd "$tmp/amorce"
    git config user.email t@t.t && git config user.name t && git config commit.gpgsign false
    mkdir -p "$MIG_DIR"
    echo "-- socle" > "$MIG_DIR/20260101100000_plateforme_socle.sql"
    echo "-- socle 2" > "$MIG_DIR/20260101120000_plateforme_socle_deux.sql"
    git add -A && git -c core.hooksPath=/dev/null commit --quiet --no-verify -m socle
    git remote add origin "$origine" && git push --quiet origin main
    # Branche concurrente EN VOL : jamais mergée dans main.
    git checkout --quiet -b concurrente
    echo "-- concurrente" > "$MIG_DIR/20260101130000_plateforme_concurrente.sql"
    git add -A && git -c core.hooksPath=/dev/null commit --quiet --no-verify -m concurrente
    git push --quiet origin concurrente
  ) >/dev/null 2>&1

  # Gardes non négociables : sans elles, un clone en échec (par ex. sous
  # `protocol.file.allow=never`, le durcissement post-CVE-2022-39253) laisse les
  # commandes mutantes de ce test s'appliquer au dépôt RÉEL. Cas 8 le prouve.
  if ! git clone --quiet "$origine" "$clone"; then
    echo "🔴 AUTO-TEST : clone du dépôt jetable impossible — test non joué." >&2
    return 2
  fi
  cd "$clone" || { echo "🔴 AUTO-TEST : accès au dépôt jetable impossible." >&2; return 2; }
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

  # Cas 7 — l'exemption de renommage EN MODE --branch (celui de la CI), ses deux
  # faces. Sans elles, lire `ref_prefixes` sur HEAD au lieu de la cible passerait
  # inaperçu : en mode branch la migration examinée appartient TOUJOURS à HEAD,
  # donc tout nouveau timestamp serait exempté et le contrôle « > max » n'existerait
  # plus en CI — en silence.
  git reset --quiet --hard HEAD >/dev/null 2>&1

  # 7a — VERT : renommage cosmétique d'une migration déjà sur la cible.
  git checkout --quiet -B cas7a "$BASE_REF" >/dev/null 2>&1
  git mv "$MIG_DIR/20260101100000_plateforme_socle.sql" "$MIG_DIR/20260101100000_plateforme_socle_corrige.sql"
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "renommage cosmetique" >/dev/null 2>&1
  if ! git ls-tree -r --name-only HEAD -- "$MIG_DIR" | grep -q 'socle_corrige'; then
    echo "🔴 AUTO-TEST : cas 7a VACANT — le renommage n'est pas sur HEAD." >&2
    echec=true
  fi
  rc=0; bash "$script_abs" --branch --no-remote >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "🔴 AUTO-TEST : faux positif en mode --branch sur un renommage préservant le préfixe (exit $rc, attendu 0)." >&2
    echec=true
  fi

  # 7b — ROUGE : une migration RÉELLEMENT neuve et mal ordonnée reste refusée.
  # C'est cette face qui tombe si `ref_prefixes` est lu sur HEAD en mode branch.
  git checkout --quiet -B cas7b "$BASE_REF" >/dev/null 2>&1
  echo "-- neuve" > "$MIG_DIR/20260101090000_plateforme_neuve.sql"
  git add -A
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "migration neuve mal ordonnee" >/dev/null 2>&1
  rc=0; bash "$script_abs" --branch --no-remote >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "🔴 AUTO-TEST : migration neuve mal ordonnée acceptée en mode --branch (exit $rc, attendu 2)." >&2
    echo "   L'exemption de renommage déborde : le contrôle « > max » ne tient plus en CI." >&2
    echec=true
  fi

  # Cas 9 — un ref dont le NOM contient « # » (caractère légal : `fix/issue#322`)
  # doit rester vu. Construire un script `sed` à partir du nom de ref le rendait
  # invisible au contrôle (B) : un garde d'intégrité muet, soit la panne même
  # qu'il corrige.
  git checkout --quiet -B pousse-diese "$BASE_REF" >/dev/null 2>&1
  echo "-- diese" > "$MIG_DIR/20260101160000_plateforme_diese.sql"
  git add -A
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m diese >/dev/null 2>&1
  git push --quiet origin 'pousse-diese:refs/heads/fix/issue#9' >/dev/null 2>&1
  git checkout --quiet -B cas9 "$BASE_REF" >/dev/null 2>&1
  echo "-- mien" > "$MIG_DIR/20260101160000_plateforme_mon_lot.sql"
  git add -A
  rc=0; bash "$script_abs" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "🔴 AUTO-TEST : collision non détectée face à un ref contenant « # » (exit $rc, attendu 2)." >&2
    echec=true
  fi

  # ── Cas 10-12 — le contrôle (C), celui du MOMENT DU MERGE ────────────────
  # Scénario reconstitué à l'identique : ma branche part de la cible, puis la
  # CIBLE AVANCE (un autre lot merge une migration plus récente) pendant que je
  # suis en revue. Au commit et en CI, (A) et (B) étaient verts — à juste titre.
  # C'est seulement au merge que ma migration devient mal ordonnée.
  # ⚠ Repartir d'un état PROPRE. Le cas 9 laisse un fichier INDEXÉ non commité
  # (20260101160000_plateforme_mon_lot.sql) ; `git checkout -B` ne l'emporte pas.
  # Sans ce nettoyage, les cas 10 et 12 sortaient bien en 2 — mais par le contrôle
  # (B), sur la collision résiduelle du cas 9, et (C) n'était jamais exercé :
  # ils passaient pour la mauvaise raison. Détecté par sonde de mutation
  # (`controle_vs_cible` neutralisé → l'auto-test restait vert). Ne pas retirer.
  git checkout --quiet -B cas10 "$BASE_REF" >/dev/null 2>&1
  git reset --quiet --hard "$BASE_REF" >/dev/null 2>&1
  git clean --quiet -fd -- "$MIG_DIR" >/dev/null 2>&1
  echo "-- mienne" > "$MIG_DIR/20260101150000_plateforme_mon_lot_c.sql"
  git add -A
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "ma migration, la plus haute du jour" >/dev/null 2>&1

  # La cible avance APRÈS moi, avec un timestamp SUPÉRIEUR au mien.
  # On mémorise l'ANCIENNE cible : les cas 10 et 12 doivent partir de là, comme
  # une vraie branche ouverte avant que l'autre lot ne merge. Partir de la
  # NOUVELLE cible mettrait la migration de l'autre lot dans mon dossier, et le
  # contrôle (A) attraperait le doublon avant (C) — le cas passerait pour la
  # mauvaise raison (c'est ce qui arrivait au cas 12).
  local vieille_cible
  vieille_cible=$(git rev-parse "$BASE_REF" 2>/dev/null || echo "")
  git checkout --quiet -B avance-cible "$BASE_REF" >/dev/null 2>&1
  echo "-- autre lot" > "$MIG_DIR/20260101170000_plateforme_autre_lot.sql"
  git add -A
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "autre lot, mergé pendant ma revue" >/dev/null 2>&1
  git push --quiet origin avance-cible:main >/dev/null 2>&1
  git fetch --quiet origin >/dev/null 2>&1
  git checkout --quiet cas10 >/dev/null 2>&1

  # Garde anti-fixture-vacante : si la cible n'a pas réellement avancé, les trois
  # cas qui suivent passeraient au vert quoi que fasse le script.
  if ! git ls-tree -r --name-only "$BASE_REF" -- "$MIG_DIR" 2>/dev/null | grep -q '20260101170000'; then
    echo "🔴 AUTO-TEST : cas 10 VACANT — la cible n'a pas avancé, (C) n'est pas exercé." >&2
    echec=true
  fi

  # Cas 10 — ROUGE attendu : (C) voit que la cible m'a dépassé.
  rc=0; bash "$script_abs" --merge >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "🔴 AUTO-TEST : (C) n'a PAS vu la cible avancer (exit $rc, attendu 2)." >&2
    echo "   C'est le trou de la 6e occurrence : merge accepté, déploiements bloqués ensuite." >&2
    echec=true
  fi

  # Cas 10bis — VERT attendu en mode --branch : c'est LA démonstration du trou.
  # (A) compare au max du DOSSIER DE MA BRANCHE, qui ignore la migration arrivée
  # sur la cible. Si ce cas rougissait, (C) serait redondant et la prémisse fausse.
  rc=0; bash "$script_abs" --branch --no-remote >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "🔴 AUTO-TEST : --branch rougit déjà sur le cas (C) (exit $rc, attendu 0)." >&2
    echo "   Prémisse cassée : le cas ne démontre plus le trou que (C) est censé fermer." >&2
    echec=true
  fi

  # Cas 11 — VERT attendu : migration POSTÉRIEURE au max de la cible. Sans ce cas,
  # un (C) qui refuserait tout ferait passer le cas 10 au vert.
  git checkout --quiet -B cas11 "$BASE_REF" >/dev/null 2>&1
  git reset --quiet --hard "$BASE_REF" >/dev/null 2>&1
  git clean --quiet -fd -- "$MIG_DIR" >/dev/null 2>&1
  echo "-- mienne, bien ordonnée" > "$MIG_DIR/20260101180000_plateforme_mon_lot_ok.sql"
  git add -A
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "migration posterieure au max de la cible" >/dev/null 2>&1
  rc=0; bash "$script_abs" --merge >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "🔴 AUTO-TEST : faux positif de (C) sur une migration bien ordonnée (exit $rc, attendu 0)." >&2
    echec=true
  fi

  # Cas 12 — ROUGE attendu, mais par (B), PAS par (C) : mon préfixe est déjà pris
  # sur la cible sous un autre nom. Ce cas verrouille la RÉPARTITION du travail —
  # il s'assure que personne ne ré-ajoute à (C) un contrôle de doublon qui ne
  # pourrait jamais rougir. L'assertion porte donc sur `--branch` (sans (C)).
  git checkout --quiet -B cas12 "$vieille_cible" >/dev/null 2>&1
  git reset --quiet --hard "$vieille_cible" >/dev/null 2>&1
  git clean --quiet -fd -- "$MIG_DIR" >/dev/null 2>&1
  # Garde anti-fixture-vacante : mon dossier ne doit PAS contenir la migration de
  # l'autre lot, sinon (A) attrape le doublon et (C) n'est pas exercé.
  if ls "$MIG_DIR"/20260101170000_*.sql >/dev/null 2>&1; then
    echo "🔴 AUTO-TEST : cas 12 VACANT — la migration de l'autre lot est dans mon dossier, (A) masquera (C)." >&2
    echec=true
  fi
  echo "-- mienne, meme prefixe qu'un lot deja merge" > "$MIG_DIR/20260101170000_plateforme_mon_homonyme.sql"
  git add -A
  git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "prefixe deja pris sur la cible" >/dev/null 2>&1
  rc=0; bash "$script_abs" --branch >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "🔴 AUTO-TEST : (B) n'attrape plus un préfixe déjà pris sur la cible (exit $rc, attendu 2)." >&2
    echo "   Si (B) cesse de couvrir ce cas, (C) doit le reprendre — il ne le fait PAS." >&2
    echec=true
  fi

  # Cas 8 — un clone impossible ne doit RIEN muter dans le dépôt APPELANT.
  # Sauté dans le sous-test qu'il lance lui-même : sans ce garde-fou, un script
  # dont les gardes ont sauté relance le cas 8 en boucle au lieu de rougir.
  if [ -n "${MIGRATION_SELFTEST_INTERNE:-}" ]; then
    [ "$echec" = true ] && return 1
    return 0
  fi
  # Sans les gardes sur `clone`/`cd`, les commandes mutantes des cas précédents
  # (`git reset --hard`, `git push`…) s'appliquent au dépôt courant : démontré en
  # revue sécurité, fichier non commité détruit et branche poussée.
  local appelant faux_bin temoin git_reel
  appelant="$tmp/appelant"
  faux_bin="$tmp/faux-bin"
  git_reel=$(command -v git)
  mkdir -p "$appelant/$MIG_DIR" "$faux_bin"
  printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = clone ] && exit 128; done\nexec "%s" "$@"\n' "$git_reel" > "$faux_bin/git"
  chmod +x "$faux_bin/git"
  (
    cd "$appelant" \
      && git init --quiet --initial-branch=main . \
      && git config user.email t@t.t && git config user.name t \
      && echo "-- socle" > "$MIG_DIR/20260101100000_plateforme_socle.sql" \
      && git add -A \
      && git -c core.hooksPath=/dev/null commit --quiet --no-verify -m socle
  ) >/dev/null 2>&1
  echo "TRAVAIL NON COMMITE" > "$appelant/temoin.txt"
  rc=0
  ( cd "$appelant" && PATH="$faux_bin:$PATH" MIGRATION_SELFTEST_INTERNE=1 \
      bash "$script_abs" --self-test ) >/dev/null 2>&1 || rc=$?
  temoin=$(cat "$appelant/temoin.txt" 2>/dev/null || echo MANQUANT)
  if [ "$temoin" != "TRAVAIL NON COMMITE" ]; then
    echo "🔴 AUTO-TEST : un clone en échec a DÉTRUIT un fichier du dépôt appelant." >&2
    echec=true
  fi
  if [ -n "$( (cd "$appelant" && git branch --format='%(refname:short)' 2>/dev/null | grep -vx main) || true )" ]; then
    echo "🔴 AUTO-TEST : un clone en échec a créé des branches dans le dépôt appelant." >&2
    echec=true
  fi
  if [ "$rc" -eq 0 ]; then
    echo "🔴 AUTO-TEST : clone en échec non signalé (exit 0) — le test se croit joué." >&2
    echec=true
  fi

  [ "$echec" = true ] && return 1
  echo "✅ check-migration-timestamp : auto-test OK (collision en vol, doublon local, renommage staged + branch, ref « # », cible qui avance au merge (C), dépôt appelant intact)."
  return 0
)

# ---------------------------------------------------------------------------
if [ "$SELF_TEST" = true ]; then
  self_test || exit 2
  exit 0
fi

[ -d "$MIG_DIR" ] || exit 0

# En mode --merge, la fraîcheur de la cible EST le sujet : la re-fetcher avant de
# lire quoi que ce soit. Sans ça le contrôle (C) jugerait sur une cible périmée —
# exactement l'angle mort qu'il ferme. Un fetch impossible ne bloque pas le merge
# (fail-safe, cohérent avec le reste du fichier) mais le dit fort : (C) est alors
# non joué, et c'est le seul contrôle qui voie ce qui a été mergé pendant la revue.
if [ "$MERGE_CHECK" = true ] && [ "$WITH_REMOTE" = true ] && [ -z "${MIGRATION_SCAN_REFS:-}" ]; then
  if ! git fetch --quiet --prune origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null; then
    echo "" >&2
    echo "⚠️  git fetch impossible (hors ligne ?) — contrôle (C) joué sur une cible PÉRIMÉE." >&2
  fi
fi

MES=$(mes_migrations)
[ -z "$MES" ] && exit 0

RC=0
controle_local "$MES"          || RC=2
controle_inter_branches "$MES" || RC=2
if [ "$MERGE_CHECK" = true ]; then
  controle_vs_cible "$MES"     || RC=2
fi
[ "$RC" -ne 0 ] && echo "" >&2
exit "$RC"
