#!/usr/bin/env bash
# lib-worktree.sh — rend les hooks .claude/ « worktree-aware ».
#
# PROBLÈME : les hooks PreToolUse (gate-pr / gate-brief / pre-commit-gate)
# s'exécutent dans le cwd du CLONE PRINCIPAL (souvent sur `main`), PAS dans le
# worktree dédié où tourne une session de lot (../savr-<lot>). Le `cd <worktree>`
# d'une commande n'a pas encore pris effet quand le hook se déclenche. Conséquences
# observées (lot R2, 2026-06-24) :
#   - gate-pr cherchait les markers `…-main` (vides) + lançait les tests du clone
#     principal → toute PR de worktree bloquée ;
#   - pre-commit-gate testait le clone principal, pas le diff du worktree ;
#   - gate-brief voyait `main` → s'auto-exitait → brief-ack/divergences non enforced.
#
# SOLUTION : placer le hook dans le worktree CIBLÉ par l'action avant d'évaluer
# quoi que ce soit (branche, markers, tests).
#
# Usage :  . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-worktree.sh"
#          cd_worktree_for "<hint>"
#   hint = un chemin (cible d'un `cd`, ou file_path d'un Write/Edit, même inexistant)
#          OU un nom de branche (ex. extrait de `gh pr create --head <branch>`).
# Backward-compatible : clone unique / hint vide / non résolu → no-op (reste dans le
# cwd courant, comportement historique).
cd_worktree_for() {
  hint="${1:-}"
  [ -z "$hint" ] && return 0

  # 1) hint = chemin ABSOLU (fichier existant ou à créer) → racine de SON worktree.
  case "$hint" in
    /*)
      d="$hint"
      # Remonte jusqu'au 1er dossier existant (un Write peut créer un fichier neuf).
      while [ -n "$d" ] && [ ! -d "$d" ]; do
        nd="$(dirname "$d")"
        [ "$nd" = "$d" ] && break
        d="$nd"
      done
      if [ -d "$d" ]; then
        top="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || true)"
        if [ -n "$top" ] && [ -d "$top" ]; then
          cd "$top" 2>/dev/null || true
          return 0
        fi
      fi
      ;;
  esac

  # 2) hint = nom de branche → worktree qui l'a en checkout (git worktree list).
  top="$(git worktree list --porcelain 2>/dev/null | awk -v b="refs/heads/$hint" '
    /^worktree /{ p = substr($0, 10) }
    $0 == "branch " b { print p }')"
  if [ -n "$top" ] && [ -d "$top" ]; then
    cd "$top" 2>/dev/null || true
  fi
  return 0
}
