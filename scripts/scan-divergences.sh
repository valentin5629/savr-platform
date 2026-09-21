#!/usr/bin/env bash
# scripts/scan-divergences.sh — Scanne _Divergences/ après chaque module.
# Crée les markers .claude/divergences-{clair,ambigu} si des fichiers non traités existent.
# Appelé manuellement après gh pr merge dans le workflow de fin de module.
#
# Exit 0 = aucune divergence non traitée
# Exit 1 = divergences claires uniquement → Cowork requis, non bloquant immédiatement
# Exit 2 = divergences ambiguës → bloquant, décision Val requise
#
# ── Fichiers TRAITÉS mais volontairement CONSERVÉS à la racine ───────────────
# `cdc-patch-divergences` archive normalement dans _traités/. Certaines
# divergences portent une garde explicite « NE PAS archiver avant le merge de X »
# (ex. M3.2 bloc AG gestionnaire : arbitrage Val rendu, CDC patché, mais la vue
# v_attributions_gestionnaire reste à livrer). Sans le test ci-dessous, ces
# fichiers étaient comptés comme « décision en attente » : gate-brief.sh bloquait
# alors TOUTE édition de packages/ — pour tous les lots, indéfiniment — alors
# qu'aucune décision n'était en attente. Ils sont désormais AFFICHÉS (la garde
# reste visible, l'implémentation ne doit pas être oubliée) mais NON BLOQUANTS.
#
# Marqueur retenu : la section « ## Statut traitement » + un champ « **Statut** »,
# écrits par le run cdc-patch-divergences. Sûr dans les deux sens : TEMPLATE.md ne
# contient pas cette section, donc une divergence fraîchement écrite par Claude
# Code bloque toujours.
set -euo pipefail

VAULT_DIV="${HOME}/Desktop/Obsidian Savr/_Divergences"
TRAITES="${VAULT_DIV}/_traités"
MARKER_CLAIR=".claude/divergences-clair"
MARKER_AMBIGU=".claude/divergences-ambigu"
MODULE="${1:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'inconnu')}"

# Nettoyer les anciens markers
rm -f "$MARKER_CLAIR" "$MARKER_AMBIGU"

if [[ ! -d "$VAULT_DIV" ]]; then
  echo "⚠️  _Divergences/ introuvable : ${VAULT_DIV}" >&2
  exit 0
fi

# Collecter les fichiers non traités (hors _traités/, TEMPLATE.md)
FILES_CLAIR=()
FILES_AMBIGU=()
FILES_CONSERVES=()

while IFS= read -r -d '' f; do
  base=$(basename "$f")
  [[ "$base" == "TEMPLATE.md" ]] && continue
  # Vérifier si déjà traité (archivé)
  [[ -f "${TRAITES}/${base}" ]] && continue

  # Traité par cdc-patch-divergences mais conservé à la racine par une garde
  # explicite → informatif, jamais bloquant (cf. en-tête).
  statut_ligne=$(awk '/^## Statut traitement/{f=1; next} f && /^[[:space:]]*-[[:space:]]*\*\*Statut\*\*/{sub(/^[[:space:]]*-[[:space:]]*/,""); print; exit}' "$f" 2>/dev/null || true)
  if [[ -n "$statut_ligne" ]]; then
    FILES_CONSERVES+=("  • ${base} : ${statut_ligne}")
    continue
  fi

  # Lire le type
  type_val=$(grep -m1 '^clair$\|^ambigu$' "$f" 2>/dev/null || echo "inconnu")
  module_val=$(awk '/^## Module concerné/{found=1; next} found && /^##/{exit} found && NF{print; exit}' "$f" | xargs 2>/dev/null || echo "?")
  bug_val=$(awk '/^## Bug \/ ambiguïté détecté/{found=1; next} found && /^##/{exit} found && NF{print; exit}' "$f" | xargs 2>/dev/null || echo "?")

  entry="  • ${base} [${module_val}] : ${bug_val}"
  if [[ "$type_val" == "ambigu" ]]; then
    FILES_AMBIGU+=("$entry")
    echo "$f" >> "$MARKER_AMBIGU.tmp"
  else
    FILES_CLAIR+=("$entry")
    echo "$f" >> "$MARKER_CLAIR.tmp"
  fi
done < <(find "$VAULT_DIV" -maxdepth 1 -name "*.md" -print0 2>/dev/null)

# Construire les markers
if [[ -f "$MARKER_AMBIGU.tmp" ]]; then
  mv "$MARKER_AMBIGU.tmp" "$MARKER_AMBIGU"
else
  rm -f "$MARKER_AMBIGU.tmp"
fi
if [[ -f "$MARKER_CLAIR.tmp" ]]; then
  mv "$MARKER_CLAIR.tmp" "$MARKER_CLAIR"
else
  rm -f "$MARKER_CLAIR.tmp"
fi

# Afficher le résumé
TOTAL=$(( ${#FILES_CLAIR[@]} + ${#FILES_AMBIGU[@]} ))

if [[ ${#FILES_CONSERVES[@]} -gt 0 ]]; then
  echo ""
  echo "🔵 TRAITÉES — conservées volontairement (${#FILES_CONSERVES[@]}) : décision rendue,"
  echo "   CDC patché, implémentation encore à livrer. Non bloquant."
  for e in "${FILES_CONSERVES[@]}"; do echo "$e"; done
  echo ""
fi

if [[ $TOTAL -eq 0 ]]; then
  echo "✅  Aucune divergence non traitée — prochain module débloqué."
  exit 0
fi

echo ""
echo "📋 DIVERGENCES NON TRAITÉES (module : ${MODULE})"
echo "──────────────────────────────────────────────"

if [[ ${#FILES_CLAIR[@]} -gt 0 ]]; then
  echo ""
  echo "🟡 CLAIRES (${#FILES_CLAIR[@]}) — patches automatiques dans Cowork :"
  for e in "${FILES_CLAIR[@]}"; do echo "$e"; done
fi

if [[ ${#FILES_AMBIGU[@]} -gt 0 ]]; then
  echo ""
  echo "🔴 AMBIGUËS (${#FILES_AMBIGU[@]}) — décision Val requise :"
  for e in "${FILES_AMBIGU[@]}"; do echo "$e"; done
fi

echo ""
echo "──────────────────────────────────────────────"

if [[ ${#FILES_AMBIGU[@]} -gt 0 ]]; then
  echo "⛔  ACTION REQUISE avant le prochain module :"
  echo "    1. Réponds aux divergences ambiguës ci-dessus"
  echo "    2. Lance cdc-patch-divergences dans Cowork"
  echo "    3. Lance cdc-devfacing-export dans Cowork"
  echo "    4. Dis-moi 'specs sync' → je lance sync-specs.sh et débloque"
  exit 2
else
  echo "⏳  ACTION REQUISE avant le prochain module :"
  echo "    1. Lance cdc-patch-divergences dans Cowork"
  echo "    2. Lance cdc-devfacing-export dans Cowork"
  echo "    3. Dis-moi 'specs sync' → je lance sync-specs.sh et débloque"
  exit 1
fi
