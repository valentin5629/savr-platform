#!/usr/bin/env bash
# =============================================================================
# Hook SessionStart — applique l'hygiène git anti-dette à TOUTE session du repo
# (dev plateforme OU TMS), indépendamment du point d'entrée : skill
# cdc-next-lot-prompt, session ad-hoc « améliore cette page », flux revue-ecran,
# ou toute autre. C'est ce hook qui rend la couche 4 universelle (pas seulement
# les sessions générées par cdc-next-lot-prompt).
#
# NON BLOQUANT par construction : ne fait jamais échouer le démarrage de session
# (sort toujours 0), et no-op silencieux hors dépôt git ou si le script est
# absent (branche/worktree antérieur au merge de scripts/git-hygiene.sh).
# =============================================================================
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$root" ] && exit 0

script="$root/scripts/git-hygiene.sh"
[ -f "$script" ] || exit 0

bash "$script" || true
exit 0
