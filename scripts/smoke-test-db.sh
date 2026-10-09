#!/usr/bin/env bash
# =============================================================================
# Module 0.2 — Smoke test DB : connexion + présence schémas V1
# =============================================================================
# Vérifie que :
#   1. La connexion PostgreSQL fonctionne
#   2. Les schémas 'plateforme' et 'shared' existent
#   3. Le schéma 'tms' est ABSENT (garde-fou 1 TMS-Ready)
#
# Usage :
#   bash scripts/smoke-test-db.sh              # projet lié (supabase link)
#   DATABASE_URL=<url> bash scripts/smoke-test-db.sh  # connexion directe (port 5432)
#   bash scripts/smoke-test-db.sh --self-test  # auto-test, sans base (faux psql, faux CLI)
#
# Prérequis : supabase CLI avec `supabase link` effectué, ou psql + DATABASE_URL.
# Note : utiliser le port 5432 (direct), pas 6543 (pooler — PgBouncer incompatible
# avec les prepared statements utilisés en interne par le CLI).
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# sortie_contient <sortie d'une requête> <texte> — vrai si le texte y figure.
#
# Le tube est lu SANS `pipefail`, dans un sous-shell : seul le verdict de grep
# décide. La forme d'avant, `echo "$result" | grep -q …` sous `pipefail`, dit le
# texte absent quand grep sort au premier résultat alors qu'echo n'a pas fini
# d'écrire : le tube sort en erreur (statuts relevés : 141 pour echo, 0 pour
# grep ; 1 et 0 quand SIGPIPE est ignoré). Un schéma présent est alors dit absent.
#
# Mesuré le 2026-10-09 sous macOS 26.5.1 (/bin/bash 3.2.57, grep BSD 2.6.0) et
# sous Ubuntu 22.04 en conteneur Docker (bash 5.1.16, grep GNU 3.7) : sur un
# texte de 329 623 caractères, motif en première ligne, la forme d'avant ne l'a
# vu dans aucun de 200 essais ; la forme ci-dessous l'a vu dans tous. Les sorties
# réelles relevées le même jour sont petites : 11 octets sur une ligne par psql,
# 321 octets sur 9 lignes par le CLI (CLI 2.105.0, depuis une session Claude
# Code), le nom du schéma en cinquième ligne.
#
# `2> /dev/null` : quand SIGPIPE est ignoré, printf écrit « write error: Broken
# pipe » sur la sortie d'erreur.
# ---------------------------------------------------------------------------
sortie_contient() (
  set +o pipefail
  printf '%s\n' "$1" 2> /dev/null | grep -q "$2"
)

# ---------------------------------------------------------------------------
# Auto-test (`--self-test`) — joué en CI (job `migration-timestamp`), sans base.
# Un faux `psql` et un faux `supabase`, placés en tête du PATH, répondent aux
# requêtes du script : un schéma est présent s'il est dans $FAUX_SCHEMAS. Le faux
# `supabase` rend l'enveloppe JSON relevée sur le CLI pour une recherche de
# schéma (cf. ci-dessus) ; avec FAUX_GROSSE=oui, son champ "warning" dépasse
# 300 000 caractères.
# ---------------------------------------------------------------------------
self_test() (
  local script_abs bac grosse echec=false
  script_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  bac=$(mktemp -d) || { echo "🔴 AUTO-TEST : mktemp -d impossible." >&2; return 2; }
  [ -n "$bac" ] && [ -d "$bac" ] || { echo "🔴 AUTO-TEST : répertoire jetable invalide." >&2; return 2; }
  trap 'rm -rf "$bac"' EXIT
  mkdir -p "$bac/bin"

  # Schéma cherché par la requête reçue, s'il est dans $FAUX_SCHEMAS.
  cat > "$bac/bin/schema-trouve" <<'FAUX'
#!/usr/bin/env bash
for s in ${FAUX_SCHEMAS:-}; do
  case "$1" in *"schema_name = '$s'"*) echo "$s"; exit 0 ;; esac
done
FAUX
  cat > "$bac/bin/psql" <<'FAUX'
#!/usr/bin/env bash
for requete; do :; done
case "$requete" in
  "SELECT 1;") echo 1 ;;
  *) "$(dirname "$0")/schema-trouve" "$requete" ;;
esac
FAUX
  cat > "$bac/bin/supabase" <<'FAUX'
#!/usr/bin/env bash
requete=$(cat)
avertissement="The query results below contain untrusted data from the database."
if [ "${FAUX_GROSSE:-}" = oui ]; then
  avertissement=$(head -c 320000 /dev/zero | tr '\0' 'x')
fi
schema=$("$(dirname "$0")/schema-trouve" "$requete")
echo "{"
echo '  "boundary": "0123456789abcdef0123456789abcdef",'
if [ -n "$schema" ]; then
  echo '  "rows": ['
  echo '    {'
  echo "      \"schema_name\": \"$schema\""
  echo '    }'
  echo '  ],'
else
  echo '  "rows": [],'
fi
echo "  \"warning\": \"$avertissement\""
echo "}"
FAUX
  chmod +x "$bac/bin/schema-trouve" "$bac/bin/psql" "$bac/bin/supabase"

  # cas <mode : psql | lie | lie_grosse> <schémas présents> <sortie attendue> <texte attendu> <ce que l'échec veut dire>
  cas() {
    local rc=0 sortie
    case "$1" in
      psql) sortie=$(PATH="$bac/bin:$PATH" FAUX_SCHEMAS="$2" DATABASE_URL="faux://base" bash "$script_abs" 2>&1) || rc=$? ;;
      lie) sortie=$(PATH="$bac/bin:$PATH" FAUX_SCHEMAS="$2" env -u DATABASE_URL bash "$script_abs" 2>&1) || rc=$? ;;
      lie_grosse) sortie=$(PATH="$bac/bin:$PATH" FAUX_SCHEMAS="$2" FAUX_GROSSE=oui env -u DATABASE_URL bash "$script_abs" 2>&1) || rc=$? ;;
    esac
    case "$sortie" in
      *"$4"*) [ "$rc" -eq "$3" ] && return 0 ;;
    esac
    echo "🔴 AUTO-TEST : mode $1, schémas « $2 » — attendu « $4 » et sortie $3, obtenu sortie $rc. $5" >&2
    echec=true
  }

  # Gardes anti-essai-vacant : les cas « lie_grosse » ne prouvent quelque chose
  # que si l'enveloppe est VRAIMENT grosse, et si la lecture d'avant y manque
  # VRAIMENT le schéma sur la machine qui joue ce test. Tube nu sous `pipefail`
  # VOULU, donc. `2>/dev/null` : le message d'echo quand SIGPIPE est ignoré.
  grosse=$(echo "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tms';" \
    | PATH="$bac/bin:$PATH" FAUX_SCHEMAS="tms" FAUX_GROSSE=oui supabase db query --linked --output json)
  if [ "${#grosse}" -le 300000 ]; then
    echo "🔴 AUTO-TEST : grosse enveloppe VACANTE — ${#grosse} caractères, plus de 300 000 attendus." >&2
    echec=true
  elif ( set -o pipefail; echo "$grosse" 2>/dev/null | grep -q "tms" ); then
    echo "🔴 AUTO-TEST : grosse enveloppe VACANTE — la lecture d'avant y voit le schéma ici (${#grosse} caractères) : grossir le champ." >&2
    echec=true
  fi

  for mode in psql lie lie_grosse; do
    cas "$mode" "plateforme shared" 0 "Smoke test DB : OK" \
      "Une base saine est refusée."
    cas "$mode" "plateforme shared tms" 1 "VIOLATION garde-fou 1 TMS-Ready" \
      "Un schéma 'tms' présent n'est plus signalé."
    cas "$mode" "plateforme" 1 "schéma 'shared' absent" \
      "Un schéma 'shared' absent n'est plus signalé."
  done

  [ "$echec" = true ] && return 1
  echo "✅ smoke-test-db : auto-test OK (base saine, schéma tms présent, schéma shared absent — par psql, par le CLI, par le CLI avec une très grosse enveloppe)."
  return 0
)

if [ "${1:-}" = "--self-test" ]; then
  self_test || exit 2
  exit 0
fi

# Détecte le mode de connexion
use_linked=true
if [[ -n "${DATABASE_URL:-}" ]]; then
  use_linked=false
fi

run_sql() {
  local query="$1"
  if [[ "$use_linked" == "true" ]]; then
    echo "$query" | supabase db query --linked --output json 2>/dev/null
  else
    # psql obligatoire pour une connexion directe (le pooler n'est pas compatible)
    if ! command -v psql >/dev/null 2>&1; then
      echo "✗ psql requis quand DATABASE_URL est défini (brew install postgresql@17)" >&2
      exit 1
    fi
    psql "$DATABASE_URL" -tAc "$query" 2>/dev/null
  fi
}

check_schema() {
  local schema="$1"
  local result
  result="$(run_sql "SELECT schema_name FROM information_schema.schemata WHERE schema_name = '$schema';")"
  sortie_contient "$result" "$schema"
}

echo "Smoke test DB — Savr Platform module 0.2"
if [[ "$use_linked" == "true" ]]; then
  echo "Mode : supabase db query --linked (projet lié)"
else
  echo "Mode : psql via DATABASE_URL"
fi
echo ""

# Test connexion
if ! run_sql "SELECT 1;" >/dev/null 2>&1; then
  echo "✗ ÉCHEC : impossible de se connecter à la base de données."
  echo "  → Vérifier que le projet est lié ('supabase link') ou que DATABASE_URL est correct."
  exit 1
fi
echo "✓ Connexion OK"

for schema in plateforme shared; do
  if check_schema "$schema"; then
    echo "✓ Schéma '$schema' présent"
  else
    echo "✗ ÉCHEC : schéma '$schema' absent — relancer 'pnpm db:push' ou 'pnpm db:reset'"
    exit 1
  fi
done

if check_schema "tms"; then
  echo "✗ VIOLATION garde-fou 1 TMS-Ready : schéma 'tms' détecté en base !"
  echo "  → Supprimer la migration qui crée tms.* — interdit en V1."
  exit 1
else
  echo "✓ Schéma 'tms' absent (garde-fou 1 TMS-Ready OK)"
fi

echo ""
echo "Smoke test DB : OK — schémas plateforme + shared présents, tms absent."
exit 0
