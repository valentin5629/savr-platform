#!/usr/bin/env bash
# scripts/check-query-perf.sh — Vérifie l'utilisation des index sur les requêtes critiques.
# Utilise EXPLAIN (FORMAT TEXT) via psql — ne nécessite pas de données (estimateur).
# SLA cibles (CLAUDE.md §16) : listes paginées p95 < 200ms, dashboard Admin < 800ms.
# Méthode proxy : détecte les Sequential Scans sur les tables volumineuses attendues.
#
# Usage local : bash scripts/check-query-perf.sh
# Usage CI    : DATABASE_URL=postgresql://... bash scripts/check-query-perf.sh
# Auto-test   : bash scripts/check-query-perf.sh --self-test   (faux psql, sans base)
#
# Exit 0 = OK (ou tables absentes → skip gracieux)
# Exit 1 = Seq Scan détecté sur table critique
# Exit 2 = auto-test en échec
set -euo pipefail

# ---------------------------------------------------------------------------
# plan_a_seq_scan <plan> — vrai si le plan lit en entier une des tables suivies.
#
# Le tube est lu SANS `pipefail`, dans un sous-shell : seul le verdict de grep
# décide. La forme d'avant, `echo "$plan" | grep -q …` sous `pipefail`, dit le
# motif absent quand grep sort au premier résultat alors qu'echo n'a pas fini
# d'écrire : le tube sort en erreur (statuts relevés : 141 pour echo, 0 pour
# grep ; 1 et 0 quand SIGPIPE est ignoré), et le plan était rendu ✅.
#
# Mesuré le 2026-10-09 sous macOS 26.5.1 (/bin/bash 3.2.57, grep BSD 2.6.0) et
# sous Ubuntu 22.04 en conteneur Docker (bash 5.1.16, grep GNU 3.7) :
#   • texte de 329 623 caractères, motif en première ligne : la forme d'avant ne
#     l'a vu dans aucun de 200 essais ; la forme ci-dessous l'a vu dans tous ;
#   • plans réels de la base locale (130 à 560 octets, 2 à 9 lignes) : la forme
#     d'avant a manqué, rarement, sous Ubuntu, un plan de 289 octets où le Seq
#     Scan était présent.
#
# `2> /dev/null` : quand SIGPIPE est ignoré, printf écrit « write error: Broken
# pipe » sur la sortie d'erreur.
# ---------------------------------------------------------------------------
plan_a_seq_scan() (
  set +o pipefail
  printf '%s\n' "$1" 2> /dev/null | grep -qE 'Seq Scan on (collectes|evenements|outbox_events|users)'
)

# ---------------------------------------------------------------------------
# Auto-test (`--self-test`) — joué en CI (job `migration-timestamp`), sans base.
# Un faux `psql`, placé en tête du PATH, répond aux trois requêtes du script :
# la connexion, la présence d'une table (absente si elle est dans
# $FAUX_ABSENTES), et EXPLAIN, dont il rend le plan écrit dans $FAUX_PLAN.
# Un faux `grep` refuse l'option -P, comme le grep de macOS, et passe le reste
# au vrai : sans lui, un retour à `grep -oP` ne ferait rougir cet auto-test que
# sous macOS, le grep GNU de la CI comprenant -P.
# ---------------------------------------------------------------------------
self_test() (
  local script_abs bac remplissage gros_plan vrai_grep t echec=false
  script_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  bac=$(mktemp -d) || { echo "🔴 AUTO-TEST : mktemp -d impossible." >&2; return 2; }
  [ -n "$bac" ] && [ -d "$bac" ] || { echo "🔴 AUTO-TEST : répertoire jetable invalide." >&2; return 2; }
  trap 'rm -rf "$bac"' EXIT
  mkdir -p "$bac/bin"

  cat > "$bac/bin/psql" <<'FAUX'
#!/usr/bin/env bash
for requete; do :; done
case "$requete" in
  "SELECT 1") exit 0 ;;
  *information_schema.tables*)
    for t in ${FAUX_ABSENTES:-}; do
      case "$requete" in *"table_name='$t'"*) echo " 0"; exit 0 ;; esac
    done
    echo " 1" ;;
  EXPLAIN*) cat "$FAUX_PLAN" ;;
esac
FAUX
  vrai_grep=$(command -v grep)
  cat > "$bac/bin/grep" <<FAUX
#!/usr/bin/env bash
for a; do
  case "\$a" in
    -P* | -[!-]*P*) echo "grep: invalid option -- P" >&2; exit 2 ;;
  esac
done
exec "$vrai_grep" "\$@"
FAUX
  chmod +x "$bac/bin/psql" "$bac/bin/grep"

  # cas <fichier de plan> <tables absentes> <sortie attendue> <ce que l'échec veut dire>
  cas() {
    local rc=0
    PATH="$bac/bin:$PATH" FAUX_PLAN="$bac/$1" FAUX_ABSENTES="$2" DATABASE_URL="faux://base" \
      bash "$script_abs" >/dev/null 2>&1 || rc=$?
    [ "$rc" -eq "$3" ] && return 0
    echo "🔴 AUTO-TEST : plan $1 — sortie $rc, $3 attendu. $4" >&2
    echec=true
  }

  printf '%s\n' \
    " Limit  (cost=0.15..8.17 rows=1 width=603)" \
    "   ->  Index Scan using un_index on collectes c  (cost=0.15..8.17 rows=1 width=603)" \
    > "$bac/sain.txt"
  cas sain.txt "" 0 "Un plan sans Seq Scan est refusé."

  # Une table suivie par plan, le Seq Scan au milieu, comme dans un plan réel.
  for t in collectes evenements outbox_events users; do
    printf '%s\n' \
      " Limit  (cost=2.59..2.59 rows=2 width=603)" \
      "   ->  Seq Scan on $t x  (cost=0.00..1.29 rows=29 width=603)" \
      "         Filter: (id IS NOT NULL)" \
      > "$bac/seq_$t.txt"
    cas "seq_$t.txt" "" 1 "Un Seq Scan sur $t n'est plus détecté."
  done

  # Très gros plan : le Seq Scan en première ligne, plus de 300 000 caractères
  # après lui.
  remplissage=$(head -c 320000 /dev/zero | tr '\0' 'x' | fold -w 100 | sed 's/^/         Filter: /')
  gros_plan=" Seq Scan on users  (cost=0.00..1.05 rows=1 width=300)
$remplissage"
  printf '%s\n' "$gros_plan" > "$bac/gros.txt"
  # Gardes anti-essai-vacant : ce cas ne prouve quelque chose que si le plan est
  # VRAIMENT gros, et si la lecture d'avant le manque VRAIMENT sur la machine qui
  # joue ce test. Tube nu sous `pipefail` VOULU, donc. `2>/dev/null` : le message
  # d'echo quand SIGPIPE est ignoré.
  if [ "${#remplissage}" -le 300000 ]; then
    echo "🔴 AUTO-TEST : gros plan VACANT — ${#remplissage} caractères de remplissage, plus de 300 000 attendus." >&2
    echec=true
  elif ( set -o pipefail; echo "$gros_plan" 2>/dev/null | grep -q "Seq Scan on users" ); then
    echo "🔴 AUTO-TEST : gros plan VACANT — la lecture d'avant voit son Seq Scan ici (${#gros_plan} caractères) : grossir le remplissage." >&2
    echec=true
  fi
  cas gros.txt "" 1 "Un Seq Scan suivi d'un très gros plan n'est plus détecté."

  # Toutes les tables dites absentes : chaque requête est sautée avant EXPLAIN,
  # ce qui exige que le nom de la table ait été tiré de la requête.
  cas seq_users.txt "collectes evenements outbox_events users" 0 \
    "Le nom de la table n'est plus tiré de la requête : une table absente n'est plus sautée."

  [ "$echec" = true ] && return 1
  echo "✅ check-query-perf : auto-test OK (plan sans Seq Scan, Seq Scan sur chacune des 4 tables suivies, très gros plan, tables absentes)."
  return 0
)

if [ "${1:-}" = "--self-test" ]; then
  self_test || exit 2
  exit 0
fi

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:54322/postgres}"

# Vérifier que psql est disponible
if ! command -v psql &>/dev/null; then
  echo "⚠️  psql introuvable — check-query-perf skippé." >&2
  exit 0
fi

# Vérifier que la DB répond
if ! psql "$DB_URL" -c "SELECT 1" &>/dev/null 2>&1; then
  echo "⚠️  DB inaccessible ($DB_URL) — check-query-perf skippé." >&2
  exit 0
fi

echo "🔍 check-query-perf : analyse des plans de requêtes critiques..." >&2

# ── Requêtes critiques à analyser ────────────────────────────────────────────
# Format : "description|SQL"
declare -a QUERIES=(
  "Liste collectes par org|SELECT c.* FROM plateforme.collectes c JOIN plateforme.evenements e ON e.id = c.evenement_id WHERE e.organisation_id = '00000000-0000-0000-0000-000000000001'::uuid ORDER BY c.created_at DESC LIMIT 50"
  "Collectes par statut|SELECT c.* FROM plateforme.collectes c WHERE c.statut = 'programmee' ORDER BY c.created_at DESC LIMIT 100"
  "Outbox pending|SELECT * FROM plateforme.outbox_events WHERE status = 'pending' ORDER BY seq LIMIT 20"
  "Evénements par org|SELECT * FROM plateforme.evenements WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid ORDER BY date_evenement DESC LIMIT 50"
  "Users par org|SELECT * FROM plateforme.users WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid"
)

VIOLATIONS=()

# Première table « schéma.table » qui suit un FROM. Par l'expression régulière
# de bash : `grep -oP`, la forme d'avant, n'existe pas dans le grep de macOS
# (« invalid option -- P »), et le script y sortait en 2 dès que la base répondait.
TABLE_RE='FROM ([A-Za-z0-9_]+\.[A-Za-z0-9_]+)'

for entry in "${QUERIES[@]}"; do
  desc="${entry%%|*}"
  sql="${entry##*|}"

  # Vérifier que la table principale existe
  table=""
  if [[ "$sql" =~ $TABLE_RE ]]; then
    table="${BASH_REMATCH[1]}"
  fi
  if [[ -n "$table" ]]; then
    schema="${table%%.*}"
    tname="${table##*.}"
    exists=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${schema}' AND table_name='${tname}'" 2>/dev/null | tr -d ' ')
    if [[ "$exists" == "0" ]]; then
      echo "  ⏭  ${desc} — table ${table} absente, skip" >&2
      continue
    fi
  fi

  # Récupérer le plan EXPLAIN
  plan=$(psql "$DB_URL" -t -c "EXPLAIN ${sql}" 2>/dev/null || echo "ERROR")

  if [[ "$plan" == "ERROR" ]]; then
    echo "  ⚠️  ${desc} — EXPLAIN a échoué, skip" >&2
    continue
  fi

  # Détecter un Seq Scan sur les tables volumineuses attendues (hors petites tables)
  if plan_a_seq_scan "$plan"; then
    VIOLATIONS+=("$desc")
    echo "  ❌ Seq Scan détecté : ${desc}" >&2
    # `sed` lit le plan jusqu'au bout. `head -5`, la forme d'avant, sort après
    # cinq lignes : sur un très gros plan le tube sortait en erreur et `set -e`
    # arrêtait le script avant la fin (sortie 141 relevée, 1 attendue).
    printf '%s\n' "$plan" | sed -n '1,5p' >&2
  else
    echo "  ✅ ${desc}" >&2
  fi
done

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo "" >&2
  echo "❌ ${#VIOLATIONS[@]} requête(s) sans index :" >&2
  for v in "${VIOLATIONS[@]}"; do echo "   • $v" >&2; done
  echo "   → Ajouter les index manquants dans la prochaine migration." >&2
  exit 1
fi

echo "" >&2
echo "✅ check-query-perf OK — aucun Seq Scan sur tables critiques" >&2
exit 0
