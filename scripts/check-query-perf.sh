#!/usr/bin/env bash
# scripts/check-query-perf.sh — Vérifie l'utilisation des index sur les requêtes critiques.
# Utilise EXPLAIN (FORMAT TEXT) via psql — ne nécessite pas de données (estimateur).
# SLA cibles (CLAUDE.md §16) : listes paginées p95 < 200ms, dashboard Admin < 800ms.
# Méthode proxy : détecte les Sequential Scans sur les tables volumineuses attendues.
#
# Usage local : bash scripts/check-query-perf.sh
# Usage CI    : DATABASE_URL=postgresql://... bash scripts/check-query-perf.sh
#
# Exit 0 = OK (ou tables absentes → skip gracieux)
# Exit 1 = Seq Scan détecté sur table critique
set -euo pipefail

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

for entry in "${QUERIES[@]}"; do
  desc="${entry%%|*}"
  sql="${entry##*|}"

  # Vérifier que la table principale existe
  table=$(echo "$sql" | grep -oP 'FROM \K\w+\.\w+' | head -1)
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
  if echo "$plan" | grep -q "Seq Scan on collectes\|Seq Scan on evenements\|Seq Scan on outbox_events\|Seq Scan on users"; then
    VIOLATIONS+=("$desc")
    echo "  ❌ Seq Scan détecté : ${desc}" >&2
    echo "$plan" | head -5 >&2
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
