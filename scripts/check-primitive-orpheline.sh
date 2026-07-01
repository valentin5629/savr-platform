#!/usr/bin/env bash
# =============================================================================
# G8 (volet leger) — detection des "primitives orphelines"
# =============================================================================
# Audit conformite CDC->code (2026-06-23) : plusieurs primitives transverses
# sont EXPORTEES et specifiees (logger business §07/01, alertes Slack §07/03)
# mais jamais (ou quasi jamais) IMPORTEES par le code metier => les ~50 chaines
# event->log et event->alerte du CDC sont muettes en prod, sans qu'aucun gate
# manifeste ne le voie (le test mocke la primitive, le call-site reel manque).
#
# Ce check liste, pour chaque primitive transverse, le nombre de call-sites de
# PRODUCTION (hors tests, hors module de definition). 0 call-site = ORPHELINE.
#
# MODE BLOQUANT (T1, flip R15) : logger/sendAlert/captureException sont desormais
# cables (chaines event->log/alerte). Toute REGRESSION a l'etat orphelin (une
# primitive transverse re-exportee sans call-site de prod) rougit la CI (exit 1).
# Ecrit un resume dans $GITHUB_STEP_SUMMARY (si defini) + un compteur de burn-down.
#
# Compatible bash 3.2 (macOS) et GNU bash (CI Linux).
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Racines de code de PRODUCTION (jamais les tests, jamais les seeds/scripts).
PROD_ROOTS=(packages/plateforme/src packages/adapters/src)

# Primitives transverses surveillees : "symbole|motif-de-definition|libelle".
# Le motif-de-definition sert a exclure le fichier qui DEFINIT la primitive
# (l'export n'est pas un call-site).
PRIMITIVES=(
  "logger|packages/shared/src/logger/|Logger business (§07/01)"
  "sendAlert|packages/shared/src/alerting/slack|Alerte Slack (§07/03)"
  "captureException|packages/shared/src/alerting/sentry|Capture Sentry (§07/02)"
)

# Liste des fichiers de prod (hors tests) qui IMPORTENT puis UTILISENT $symbol.
# Heuristique volontairement simple et lisible : un fichier compte si une ligne
# d'import mentionne le symbole ET le symbole reapparait ailleurs (call-site).
call_sites() {
  local symbol="$1" def_pattern="$2"
  local f imports uses
  for r in "${PROD_ROOTS[@]}"; do
    [ -d "$r" ] || continue
    # Tous les .ts/.tsx de prod, hors tests.
    while IFS= read -r f; do
      case "$f" in
        *.test.ts|*.test.tsx|*/tests/*|*/__tests__/*) continue ;;
        *"$def_pattern"*) continue ;;  # le module de definition lui-meme
      esac
      # Ligne d'import du symbole DEPUIS @savr/shared (package ou barrel) ou un
      # import relatif. On filtre sur la SOURCE, pas sur des mots-clés de chemin :
      # robuste aux imports via barrel `@savr/shared` nu, et insensible aux
      # symboles homonymes importés d'une autre lib (ex. un `logger` tiers).
      imports="$(grep -nE "import[^;]*\b${symbol}\b" "$f" 2>/dev/null | grep -E "@savr/shared|from '\.\.?/" || true)"
      [ -n "$imports" ] || continue
      # Au moins une occurrence du symbole HORS des lignes d'import = usage.
      uses="$(grep -nE "\b${symbol}\b" "$f" 2>/dev/null | grep -vE "^[0-9]+:\s*import" || true)"
      [ -n "$uses" ] || continue
      echo "$f"
    done < <(find "$r" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null)
  done
}

orphan_count=0
report=""

for entry in "${PRIMITIVES[@]}"; do
  symbol="${entry%%|*}"
  rest="${entry#*|}"
  def_pattern="${rest%%|*}"
  label="${rest#*|}"

  sites="$(call_sites "$symbol" "$def_pattern" | sort -u)"
  if [ -z "$sites" ]; then
    n=0
  else
    n="$(printf '%s\n' "$sites" | grep -c . )"
  fi

  if [ "$n" -eq 0 ]; then
    status="ORPHELINE"
    orphan_count=$((orphan_count + 1))
  else
    status="OK ($n call-site(s))"
  fi

  line="- \`${symbol}\` — ${label} : **${status}**"
  echo "[primitive-orpheline] ${symbol} (${label}) : ${status}"
  if [ -n "$sites" ]; then
    while IFS= read -r s; do
      echo "    call-site: $s"
      line="${line}"$'\n'"    - \`$s\`"
    done <<< "$sites"
  fi
  report="${report}${line}"$'\n'
done

# --- Resume GitHub Actions (mode rapport) ----------------------------------
{
  echo "## G8 — Primitives orphelines (mode rapport)"
  echo ""
  echo "Primitives transverses spécifiées au CDC mais sans call-site de production."
  echo "**0 call-site = chaîne event→log/alerte muette en prod.**"
  echo ""
  printf '%s\n' "$report"
  echo ""
  echo "**Compteur burn-down : ${orphan_count} primitive(s) orpheline(s).**"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}" 2>/dev/null || true

echo ""
echo "[primitive-orpheline] Compteur burn-down : ${orphan_count} orpheline(s)."
if [ "$orphan_count" -gt 0 ]; then
  echo "[primitive-orpheline] BLOQUANT (T1) — une primitive transverse est orpheline"
  echo "                      (chaine event->log/alerte muette en prod). Cf. §07/01-03."
  exit 1
fi
echo "[primitive-orpheline] OK — toutes les primitives transverses sont cablees."
exit 0
