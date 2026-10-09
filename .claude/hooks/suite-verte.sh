#!/usr/bin/env bash
# =============================================================================
# suite-verte.sh — la suite de tests complète, UNE fois par contenu.
#
# POURQUOI
# --------
# La même suite (412 s, 3 700 tests, mesuré le 2026-10-08) était rejouée sur un
# contenu qu'elle venait de valider : par `gate-pr` à chaque tentative de création
# de PR (1,4 à 3,3 tentatives par session selon les mois — la première échoue
# souvent sur un marker de revue, la suivante rejoue tout), puis par les
# relecteurs, chacun de son côté. Une suite verte sur un contenu donné le reste
# tant que ce contenu ne change pas.
#
# CE QUI FAIT FOI
# ---------------
# L'empreinte est celle de l'ARBRE git de HEAD (`HEAD^{tree}`), pas du commit : un
# message réécrit, un rebase ou un merge qui aboutit au même contenu la conserve ;
# un seul octet modifié la change. Elle n'est lue ET écrite que sur un arbre de
# travail PROPRE (rien de modifié, rien de non suivi) : sinon ce qui a été testé
# n'est pas ce que HEAD contient. Un `git status` qui échoue ne prouve rien : il
# vaut « pas propre ».
#
# La trace vit dans le `.git` commun (jamais versionnée, partagée entre worktrees :
# même arbre = même contenu, où qu'il soit extrait). Elle porte l'empreinte dans
# son contenu : un fichier vide posé à la main ne vaut rien.
#
# CE QUE LA TRACE NE COUVRE PAS — relevé en revue sécurité, assumé :
#   • un fichier IGNORÉ par git que lirait un test (`.env.local`, cache) : il
#     n'entre pas dans l'arbre, deux worktrees au même arbre peuvent en différer ;
#   • une trace écrite à la main avec la bonne empreinte : tout processus du poste
#     le peut, comme pour un marker de revue. Cela ne permet que de sauter la suite
#     LOCALE.
#
# CE QUE ÇA NE REMPLACE PAS
# -------------------------
# La CI rejoue toujours la suite, sur sa propre machine, et son job
# `lint-typecheck-test` est un status check requis. Cette trace évite de payer deux
# fois en local ; elle n'atteste rien auprès de GitHub.
#
#   bash .claude/hooks/suite-verte.sh              # joue la suite si ce contenu ne l'a pas déjà passée
#   bash .claude/hooks/suite-verte.sh --etat       # dit seulement si c'est le cas (0 = oui, 1 = non)
#   bash .claude/hooks/suite-verte.sh --self-test  # non-vacuité
# =============================================================================
set -uo pipefail

# Chemin absolu de ce script, pris avant tout `cd` (l'auto-test le rejoue en entier).
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

dossier_traces() {
  local commun
  commun="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  printf '%s/savr-suite-verte' "$commun"
}

# `--untracked-files=normal` en dur : un `status.showUntrackedFiles=no` dans la
# configuration ferait passer un fichier non suivi pour un arbre propre.
arbre_propre() {
  local s
  s="$(git status --porcelain --untracked-files=normal 2>/dev/null)" || return 1
  [ -z "$s" ]
}

empreinte() {
  git rev-parse --verify --quiet 'HEAD^{tree}' 2>/dev/null
}

# 0 si la suite a déjà été verte sur le contenu exact de HEAD, arbre propre.
deja_verte() {
  local d e
  arbre_propre || return 1
  e="$(empreinte)" && [ -n "$e" ] || return 1
  d="$(dossier_traces)" || return 1
  [ -f "$d/$e" ] && grep -q "^$e " "$d/$e"
}

# Enregistre « verte » pour l'empreinte donnée — refusé si le contenu a bougé
# pendant le run, ou si l'arbre n'est pas propre.
enregistrer_verte() {
  local d avant="$1"
  arbre_propre || return 1
  [ "$(empreinte)" = "$avant" ] || return 1
  d="$(dossier_traces)" || return 1
  mkdir -p "$d" || return 1
  printf '%s %s\n' "$avant" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$d/$avant"
  # Les traces ne servent que le temps d'un lot : on ne garde pas l'historique.
  find "$d" -type f -mtime +14 -delete 2>/dev/null || true
}

# ── Auto-test : une trace qui survit à un changement de contenu = un faux vert ──
self_test() (
  set -uo pipefail
  # Rien hors du dossier jetable : cf. `lib-auto-test.sh`, qui dit ce que cet
  # auto-test écrivait ailleurs sans ces lignes, et ce que veut dire le code 3.
  # Le `unset` et `git_isole` viennent avant tout appel à git.
  unset ${!GIT_*}
  LIB="$(dirname "$ICI")/lib-auto-test.sh"
  [ -f "$LIB" ] || { echo "🔴 suite-verte : lib-auto-test.sh introuvable — auto-test non joué." >&2; exit 3; }
  . "$LIB"
  bac="$(bac_jetable)" || { echo "🔴 suite-verte : pas de dossier temporaire — auto-test non joué." >&2; exit 3; }
  trap 'rm -rf "$bac"' EXIT
  git_isole "$bac" || { echo "🔴 suite-verte : dossier d'isolement non créé — auto-test non joué." >&2; exit 3; }
  echec=false
  tmp="$bac/depot"
  faux="$bac/faux"
  mkdir "$tmp" "$faux" || exit 2
  cd "$tmp" || exit 2
  { git init -q -b main . && git config user.email t@t && git config user.name t \
      && echo a > f.ts && git add -A && git commit -qm base; } >/dev/null 2>&1 \
    || { echo "🔴 suite-verte : dépôt jetable non construit." >&2; exit 2; }
  etat() { if deja_verte; then echo VERTE; else echo NON; fi; }
  attendu() {  # attendu <libellé> <voulu>
    r="$(etat)"
    [ "$r" = "$2" ] || { echo "🔴 $1 : obtenu $r, attendu $2" >&2; echec=true; }
  }

  attendu 'contenu jamais testé' 'NON'
  initiale="$(empreinte)"
  enregistrer_verte "$initiale" || { echo "🔴 enregistrement refusé sur un arbre propre." >&2; echec=true; }
  attendu 'même contenu, arbre propre' 'VERTE'

  echo b >> f.ts
  attendu 'fichier suivi modifié, non commité' 'NON'
  if enregistrer_verte "$initiale"; then echo "🔴 enregistrement accepté sur un arbre modifié." >&2; echec=true; fi
  git commit -qam change >/dev/null 2>&1
  attendu 'contenu commité différent' 'NON'

  echo a > f.ts && git commit -qam retour >/dev/null 2>&1
  attendu 'autre commit, contenu revenu à l’identique' 'VERTE'

  echo x > non-suivi.ts
  attendu 'fichier non suivi présent' 'NON'
  git config status.showUntrackedFiles no
  attendu 'fichier non suivi masqué par la configuration de git' 'NON'
  git config --unset status.showUntrackedFiles
  rm non-suivi.ts

  # `git status` en erreur (index illisible) : ne prouve pas que l'arbre est propre.
  cp .git/index "$faux/index.sauf" && printf 'illisible' > .git/index
  attendu 'git status en erreur' 'NON'
  if enregistrer_verte "$initiale"; then echo "🔴 enregistrement accepté alors que git status échoue." >&2; echec=true; fi
  cp "$faux/index.sauf" .git/index
  attendu 'index rétabli' 'VERTE'

  # Une trace posée à la main, sans l'empreinte dedans, ne vaut rien.
  echo c > f.ts && git commit -qam autre >/dev/null 2>&1
  mkdir -p "$(dossier_traces)" && : > "$(dossier_traces)/$(empreinte)"
  attendu 'trace vide posée à la main' 'NON'

  # Le contenu bouge pendant le run : l'empreinte d'avant n'est plus celle de HEAD.
  avant="$(empreinte)"
  echo d > f.ts && git commit -qam pendant >/dev/null 2>&1
  if enregistrer_verte "$avant"; then echo "🔴 enregistrement accepté alors que HEAD a changé pendant le run." >&2; echec=true; fi

  # — De bout en bout, avec un faux `pnpm` : c'est le flux principal qui écrit la
  # trace, pas les fonctions ci-dessus. Une suite ROUGE mémorisée comme verte est
  # le pire défaut possible de ce script, et rien d'autre ne le ferait rougir. —
  printf '#!/bin/sh\necho "$*" >> "%s/journal"\nexit "${FAUX_PNPM_CODE:-0}"\n' "$faux" > "$faux/pnpm"
  chmod +x "$faux/pnpm"
  : > "$faux/journal"
  joue() { PATH="$faux:$PATH" FAUX_PNPM_CODE="$1" bash "$ICI" ${2:-} >/dev/null 2>&1; }
  appels() { wc -l < "$faux/journal" | tr -d ' '; }
  echo e > f.ts && git commit -qam e2e >/dev/null 2>&1

  if joue 1; then echo "🔴 suite rouge : le script sort en 0." >&2; echec=true; fi
  attendu 'suite rouge : rien de mémorisé' 'NON'
  joue 0 || { echo "🔴 suite verte : le script sort en erreur." >&2; echec=true; }
  attendu 'suite verte : mémorisée' 'VERTE'
  [ "$(appels)" = 2 ] || { echo "🔴 la suite n'a pas été lancée une fois par passage ($(appels) appels, attendu 2)." >&2; echec=true; }
  [ "$(tail -1 "$faux/journal")" = '-w test:unit' ] || { echo "🔴 commande lancée inattendue : $(tail -1 "$faux/journal")" >&2; echec=true; }
  joue 1 || { echo "🔴 contenu déjà vert : le script a rejoué la suite (et elle était rouge)." >&2; echec=true; }
  [ "$(appels)" = 2 ] || { echo "🔴 contenu déjà vert : la suite a été rejouée." >&2; echec=true; }
  joue 1 --etat || { echo "🔴 --etat ne reconnaît pas un contenu déjà vert." >&2; echec=true; }
  echo x > non-suivi.ts
  joue 0 || { echo "🔴 arbre non propre, suite verte : le script sort en erreur." >&2; echec=true; }
  [ "$(appels)" = 3 ] || { echo "🔴 arbre non propre : la suite n'a pas été rejouée." >&2; echec=true; }
  rm non-suivi.ts

  pieges_tenus "$ICI" "$bac" || echec=true

  if [ "$echec" = true ]; then
    echo "🔴 suite-verte : auto-test EN ÉCHEC — une suite pourrait être tenue pour verte sur un contenu jamais testé." >&2
    exit 2
  fi
  echo "✅ suite-verte : auto-test OK (identité par contenu ; arbre sale, fichier non suivi même masqué, git status en erreur, trace vide et contenu mouvant refusés ; de bout en bout : suite rouge jamais mémorisée, suite verte jouée une seule fois${PIEGES_BILAN})."
)

case "${1:-}" in
  --self-test)
    self_test
    exit $?
    ;;
  --etat | '') ;;
  *)
    echo "Argument inconnu : $1" >&2
    exit 64
    ;;
esac

racine="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "suite-verte : pas dans un dépôt git." >&2; exit 2; }
cd "$racine" || exit 2

if [ "${1:-}" = "--etat" ]; then
  if deja_verte; then
    echo "✅ suite complète déjà verte sur ce contenu (arbre $(empreinte | cut -c1-12))."
    exit 0
  fi
  echo "suite complète pas encore jouée sur ce contenu."
  exit 1
fi

if deja_verte; then
  echo "✅ suite complète déjà verte sur ce contenu (arbre $(empreinte | cut -c1-12)) — non rejouée."
  exit 0
fi

avant=""
arbre_propre && avant="$(empreinte)"

pnpm -w test:unit || exit $?

if [ -n "$avant" ] && enregistrer_verte "$avant"; then
  echo "✅ suite complète verte — mémorisée pour ce contenu (arbre $(printf '%s' "$avant" | cut -c1-12))."
else
  echo "✅ suite complète verte — NON mémorisée : arbre de travail non propre, ou contenu modifié pendant le run."
fi
exit 0
