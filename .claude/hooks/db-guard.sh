#!/usr/bin/env bash
# =============================================================================
# db-guard.sh — hook PreToolUse(Bash). Sérialise les ÉCRITURES dans la DB
# PARTAGÉE savr-dev entre sessions parallèles.
#
# Bloque (exit 2) une commande qui MUTE savr-dev (seed / supabase db push /
# migration up / db reset) SI une AUTRE session tient déjà un « lease savr-dev »
# frais. Sinon : acquiert/rafraîchit le lease et laisse passer (exit 0).
#
# FAIL-SAFE : tout ce qui n'est pas un conflit AVÉRÉ → exit 0 (jamais de blocage
# d'un travail légitime). Commande non-DB, session hors savr-dev (local/jetable),
# lease libre/périmé/à soi, hors git, jq absent → passent instantanément.
#
# Le lease vit dans le `.git` COMMUN → partagé par tous les worktrees du clone.
# Libérer le lease d'une session morte :  pnpm session:db-unlock
# =============================================================================
set -uo pipefail

SAVR_DEV_REF="nvbyuajdvtuezcvyxtkd" # ref projet Supabase savr-dev (partagé)
LEASE_STALE=1800                    # 30 min : au-delà, lease considéré périmé

# ── Auto-test : le hook ENTIER, dans un dépôt jetable ───────────────────────
# Ce hook n'est joué que par Claude Code, jamais en CI : sans cet auto-test, rien
# ne le verrait redevenir muet. Chaque cas repasse le script entier dans un dépôt
# jetable qui pointe savr-dev et dont une AUTRE session tient le lease :
#   B = écriture en base, doit être bloquée (code 2) ;
#   P = doit passer (code 0) — autre commande, lecture seule, ou `--dry-run`.
if [ "${1:-}" = "--self-test" ]; then
  # AVANT tout appel à git : toute variable GIT_* héritée est retirée. Lancé depuis
  # un hook git, un `rebase --exec` ou un alias shell, cet auto-test hérite de
  # celles que git exporte, et travaillait alors sur le dépôt qu'elles désignent au
  # lieu du dépôt jetable. Mesuré le 2026-10-09 sur un FAUX clone à worktree lié,
  # sans cette ligne :
  #   • GIT_DIR d'un worktree lié : `git init` passait le `.git/config` du clone à
  #     `bare = true`, AVANT la vérification plus bas, qui arrêtait ensuite ;
  #   • GIT_DIR=.git avec GIT_WORK_TREE, ou GIT_COMMON_DIR seul : la vérification
  #     passait, et le hook rejoué réécrivait le lease du clone.
  # Avec cette ligne, les mêmes cas laissent le `.git` du faux clone inchangé.
  unset ${!GIT_*}
  ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  bac="$(mktemp -d)" || { echo "🔴 db-guard : mktemp impossible." >&2; exit 1; }
  # Le `trap` supprime `$bac` : il n'est posé qu'une fois ce dossier vérifié. Avec
  # un `mktemp` qui rendait 0 sans rien écrire, `bac` restait vide, `cd ""` ne
  # bougeait pas, et c'est le dossier de lancement qui était supprimé en sortie
  # (mesuré avec un faux `mktemp`, depuis un dossier jetable).
  { [ -n "$bac" ] && [ -d "$bac" ]; } || { echo "🔴 db-guard : mktemp n'a pas rendu de dossier." >&2; exit 1; }
  bac="$(cd "$bac" && pwd -P)" || { echo "🔴 db-guard : dossier jetable inaccessible." >&2; exit 1; }
  trap 'rm -rf "$bac"' EXIT
  depot="$bac/depot"
  git init -q "$depot" > /dev/null 2>&1
  # Seconde vérification, après la construction. Le hook rejoué part de l'arbre de
  # travail que git lui montre, puis pose son lease dans le `.git` commun de cet
  # arbre. On s'arrête avant de poser un lease — le vrai est partagé entre les
  # sessions — si l'une de ces trois valeurs n'est pas celle du dépôt jetable : son
  # `.git`, son arbre de travail, son `.git` commun. Mesuré : un modèle
  # `init.templateDir` de la configuration git globale déplace l'arbre de travail
  # seul quand son `config` porte `core.worktree` (sur le faux clone, la première
  # valeur passait et le lease du clone était réécrit), et le `.git` commun seul
  # quand il porte un fichier `commondir`. Les deux dernières vérifications sont
  # épinglées par les rejeux de la fin ; la première, non : retirée, l'auto-test
  # reste vert.
  commun_vu="$(git -C "$depot" rev-parse --git-common-dir 2> /dev/null || true)"
  case "$commun_vu" in
    /*) : ;;
    *) commun_vu="$(cd "$depot" 2> /dev/null && cd "$commun_vu" 2> /dev/null && pwd -P)" ;;
  esac
  [ "$(git -C "$depot" rev-parse --absolute-git-dir 2> /dev/null)" = "$depot/.git" ] \
    || { echo "🔴 db-guard : dépôt jetable non construit, ou git en voit un autre." >&2; exit 1; }
  [ "$(git -C "$depot" rev-parse --show-toplevel 2> /dev/null)" = "$depot" ] \
    || { echo "🔴 db-guard : git place l'arbre de travail du dépôt jetable ailleurs." >&2; exit 1; }
  [ "$commun_vu" = "$depot/.git" ] \
    || { echo "🔴 db-guard : git place le .git commun du dépôt jetable ailleurs." >&2; exit 1; }
  printf 'NEXT_PUBLIC_SUPABASE_URL=https://%s.supabase.co\n' "$SAVR_DEV_REF" > "$depot/.env.local"
  lease="$depot/.git/.savr-dev.lease"
  lease_autre="/une/autre/session|branche-autre|$(date +%s)"
  echec=false
  nb=0; np=0; ng=0
  passe() {  # passe <commande> : le hook entier sur cette commande ; son code dans $rc
    local charge
    rc=0
    # La commande passe par l'entrée standard de jq, jamais en argument : sous
    # Linux un argument de 131 072 caractères ne lance plus le programme
    # (« Argument list too long », mesuré sur Ubuntu 22.04).
    charge="$(jq -Rs --arg d "$depot" '{tool_input: {command: .}, cwd: $d}' <<< "$1")" || { rc='« charge JSON non construite : jq absent ? »'; return 0; }
    (cd "$depot" && "$BASH" "$ICI" <<< "$charge" > /dev/null 2>&1) || rc=$?
  }
  joue() {  # joue <B|P> <commande> — le lease de l'autre session est reposé avant chaque cas
    local voulu
    case "$1" in
      B) voulu=2; nb=$((nb + 1)) ;;
      P) voulu=0; np=$((np + 1)) ;;
      *) echo "🔴 type de cas inconnu : [$1]" >&2; echec=true; return 0 ;;
    esac
    if [ "${#2}" -gt 300000 ]; then ng=$((ng + 1)); fi
    printf '%s\n' "$lease_autre" > "$lease"
    passe "$2"
    [ "$rc" = "$voulu" ] || { echo "🔴 db-guard [$1] : [${2:0:160}] → code $rc (attendu $voulu)" >&2; echec=true; }
  }
  while IFS= read -r ligne; do
    [ -n "$ligne" ] || continue
    joue "${ligne%%:*}" "${ligne#*:}"
  done <<'FORMES'
B:pnpm seed:minimal
B:pnpm seed:demo
B:pnpm seed:auth
B:pnpm seed:jwt
B:tsx src/seed/index.ts
B:tsx src/seed/auth.ts
B:tsx src/seed/jwt.ts
B:supabase db push
B:supabase db reset
B:supabase migration up
B:pnpm db:push
B:pnpm db:reset
B:cd /tmp/wt && SUPABASE DB PUSH
P:git status --short
P:pnpm seed:check
P:supabase db diff
P:supabase db push --dry-run
FORMES
  # Une très grosse commande : sous `pipefail`, le tube manquait chacune des deux
  # lectures quand 300 000 caractères suivaient la ligne du motif (cf. plus bas,
  # étape 1).
  remplissage="$(head -c 300000 /dev/zero | tr '\0' 'x')"
  joue B "$(printf 'supabase db push\n%s' "$remplissage")"
  joue B "$(printf '%s\npnpm seed:demo\n%s' "$remplissage" "$remplissage")"
  joue P "$(printf 'supabase db push --dry-run\n%s' "$remplissage")"
  joue P "$(printf 'git status --short\n%s' "$remplissage")"

  # Le même lease, tenu cette fois par CE dépôt : la même écriture passe. Le code 2
  # des cas B vient donc de qui tient le lease, pas de sa seule présence.
  printf '%s|%s|%s\n' "$depot" branche-a-soi "$(date +%s)" > "$lease"
  passe 'supabase db push'
  [ "$rc" = 0 ] || { echo "🔴 db-guard [lease à soi] : code $rc (attendu 0)" >&2; echec=true; }

  # L'auto-test lui-même, rejoué sous trois sortes de piège (quatre rejeux). Il ne
  # doit rien écrire hors de son bac. Les deux premières sortes désignent un SECOND
  # dépôt jetable, le leurre.
  #   1. Les trois variables GIT_* qui déplacent un dépôt : il doit rester vert.
  #      C'est ce qui épingle le `unset` de tête — retiré, ou réduit à deux de ces
  #      trois variables, le rejeu rougit.
  #   2. Une configuration git globale dont le modèle `init.templateDir` porte
  #      `core.worktree`, puis une autre dont il porte un fichier `commondir` : il
  #      doit s'arrêter (code 1) les deux fois. C'est ce qui épingle, plus haut, la
  #      vérification de l'arbre de travail puis celle du `.git` commun.
  #   3. Un `mktemp` qui rend 0 sans rien écrire : il doit s'arrêter (code 1) sans
  #      supprimer le dossier d'où il est lancé. C'est ce qui épingle le contrôle
  #      de `$bac` posé avant le `trap`.
  sous_leurre=""
  if [ -z "${DB_GUARD_SOUS_LEURRE:-}" ]; then
    sous_leurre=" ; rejoué sous des variables GIT_*, sous une configuration git et sous un mktemp piégés : dépôt désigné par les pièges intact, dossier de lancement présent"
    leurre="$bac/leurre"
    git init -q "$leurre" > /dev/null 2>&1
    printf 'NEXT_PUBLIC_SUPABASE_URL=https://%s.supabase.co\n' "$SAVR_DEV_REF" > "$leurre/.env.local"
    cp "$leurre/.git/config" "$bac/config-du-leurre"
    leurre_intact() { cmp -s "$leurre/.git/config" "$bac/config-du-leurre" && [ ! -e "$leurre/.git/.savr-dev.lease" ]; }
    rc=0
    (cd "$leurre" && DB_GUARD_SOUS_LEURRE=1 GIT_DIR="$leurre/.git" GIT_WORK_TREE="$leurre" GIT_COMMON_DIR="$leurre/.git" "$BASH" "$ICI" --self-test > /dev/null 2>&1) || rc=$?
    { [ "$rc" = 0 ] && leurre_intact; } \
      || { echo "🔴 db-guard [variables GIT_* héritées] : code $rc (attendu 0), ou le dépôt qu'elles désignent a été touché" >&2; echec=true; }
    mkdir -p "$bac/maison-1/modele" "$bac/maison-2/modele"
    printf '[core]\n\tworktree = %s\n' "$leurre" > "$bac/maison-1/modele/config"
    printf '%s\n' "$leurre/.git" > "$bac/maison-2/modele/commondir"
    for maison in "$bac/maison-1" "$bac/maison-2"; do
      printf '[init]\n\ttemplateDir = %s\n' "$maison/modele" > "$maison/.gitconfig"
      rc=0
      (cd "$leurre" && DB_GUARD_SOUS_LEURRE=1 HOME="$maison" XDG_CONFIG_HOME="$maison/.config" "$BASH" "$ICI" --self-test > /dev/null 2>&1) || rc=$?
      { [ "$rc" = 1 ] && leurre_intact; } \
        || { echo "🔴 db-guard [configuration git héritée, ${maison##*/}] : code $rc (attendu 1), ou le dépôt qu'elle désigne a été touché" >&2; echec=true; }
    done
    mkdir -p "$bac/faux" "$bac/lancement"
    printf '#!/bin/sh\nexit 0\n' > "$bac/faux/mktemp"
    chmod +x "$bac/faux/mktemp"
    rc=0
    (cd "$bac/lancement" && DB_GUARD_SOUS_LEURRE=1 PATH="$bac/faux:$PATH" "$BASH" "$ICI" --self-test > /dev/null 2>&1) || rc=$?
    { [ "$rc" = 1 ] && [ -d "$bac/lancement" ]; } \
      || { echo "🔴 db-guard [mktemp sans dossier] : code $rc (attendu 1), ou le dossier de lancement a été supprimé" >&2; echec=true; }
  fi

  if [ "$echec" = true ]; then
    echo "🔴 db-guard : auto-test EN ÉCHEC — la garde peut être muette ou bloquer à tort." >&2
    exit 2
  fi
  echo "✅ db-guard : auto-test OK ($nb écritures bloquées sous le lease d'une autre session, $np autres commandes laissées passer, hook rejoué en entier ; dont $ng commandes de plus de 300 000 caractères ; lease à soi : écriture passée$sous_leurre)."
  exit 0
fi

INPUT="$(cat 2>/dev/null || true)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || exit 0

# --- (1) commande qui MUTE une DB ? sinon on passe (cas courant, instantané). ---
# seed:check est READ-ONLY → volontairement exclu (pas dans la liste des mutations).
MUTATE_RE='seed:(minimal|demo|auth|jwt)|src/seed/(index|auth|jwt)\.ts|supabase[[:space:]]+db[[:space:]]+(push|reset)|supabase[[:space:]]+migration[[:space:]]+up|(^|[^a-z])db:(push|reset)([^a-z]|$)'
# Les deux lectures ci-dessous passent par un tube lu SANS `pipefail` (sous-shell) :
# seul le verdict de grep décide. Avec `pipefail`, `printf … | grep -q` sortait en
# erreur sur une grosse commande (grep sort au premier résultat, printf n'a pas
# fini d'écrire), et chaque lecture concluait « motif absent ». Mesuré le
# 2026-10-08 sur une copie de ce hook, dans un dépôt jetable dont une autre
# session tient le lease, 10 passages par cas, sous macOS (/bin/bash 3.2.57) et
# sous Ubuntu 22.04 (bash 5.1.16), avec LC_ALL=C comme avec LC_ALL=en_US.UTF-8 :
#   • 1re lecture, côté DANGEREUX : chacune des 9 écritures essayées, en première
#     ligne et suivie de 300 000 caractères, sortait en 0 au lieu de 2 (10 fois
#     sur 10) — l'écriture partait malgré le lease de l'autre session ;
#   • 2e lecture, côté sûr : une commande qui porte `--dry-run` en première ligne,
#     puis 300 000 caractères, puis une écriture en dernière ligne, sortait en 2 au
#     lieu de 0 (10 fois sur 10) — `--dry-run` n'était pas vu, la commande était
#     gardée au lieu d'être exemptée. La 1re lecture corrigée seule, une commande
#     `… --dry-run` dont la ligne est suivie de 300 000 caractères a ce sort (cas
#     P de l'auto-test, rouge si cette 2e lecture revient au tube nu).
# Mécanisme, seuils relevés, pourquoi pas une chaîne-ici, pourquoi `2>&-` : cf.
# block-destructive.sh (destructive_matche).
# ⚠ La règle de la 2e lecture est inchangée, et n'est pas jugée ici : `--dry-run`
# écrit N'IMPORTE OÙ dans la commande l'exempte tout entière. Mesuré, avant comme
# après ce correctif, sous le lease d'une autre session : la commande
# `supabase db push --dry-run && supabase db push` sort en 0.
(set +o pipefail; printf '%s' "$CMD" 2>&- | grep -Eiq "$MUTATE_RE") || exit 0
# --dry-run ne mute rien (preview) → on ne garde pas.
(set +o pipefail; printf '%s' "$CMD" 2>&- | grep -Eiq -- '--dry-run') && exit 0

# --- (2) la session cible-t-elle savr-dev ? (local/jetable/aucune = pas de risque partagé) ---
root="$CWD"
{ [ -n "$root" ] && [ -d "$root" ]; } || root="$PWD"
top="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$top" ] || exit 0
envf="$top/.env.local"
[ -f "$envf" ] || exit 0
grep -q "$SAVR_DEV_REF" "$envf" 2>/dev/null || exit 0

# --- (3) lease savr-dev (dans le .git commun, visible de tous les worktrees) ---
common="$(git -C "$root" rev-parse --git-common-dir 2>/dev/null || true)"
[ -n "$common" ] || exit 0
case "$common" in
  /*) : ;;
  *) common="$(cd "$top" 2>/dev/null && cd "$common" 2>/dev/null && pwd)" || exit 0 ;;
esac
lease="$common/.savr-dev.lease"
branch="$(git -C "$top" branch --show-current 2>/dev/null || echo '?')"
now="$(date +%s 2>/dev/null || echo 0)"

# --- MUTEX ATOMIQUE autour de la section critique lecture-décision-écriture.
# `mkdir` est atomique en POSIX (échoue si le dossier existe déjà) → un seul hook
# entre ici à la fois. Sans lui, deux hooks simultanés pourraient tous deux lire
# « pas de lease frais » et acquérir en même temps (TOCTOU). La section critique
# ne dure que quelques ms.
lockdir="$lease.lock"
held=0
i=0
while [ "$held" -eq 0 ]; do
  if mkdir "$lockdir" 2>/dev/null; then
    held=1
    break
  fi
  i=$((i + 1))
  if [ "$i" -ge 40 ]; then
    # ~2s d'attente : la section critique durant des ms, un verrou encore tenu
    # ici est quasi certainement ORPHELIN (hook tué avant libération). On le
    # force pour ne JAMAIS deadlocker, puis dernière tentative d'acquisition.
    rmdir "$lockdir" 2>/dev/null || true
    mkdir "$lockdir" 2>/dev/null && held=1
    break
  fi
  sleep 0.05
done
cleanup() {
  [ "$held" -eq 1 ] && rmdir "$lockdir" 2>/dev/null
  return 0
}
trap cleanup EXIT

if [ -f "$lease" ]; then
  IFS='|' read -r l_wt l_branch l_epoch <"$lease" 2>/dev/null || true
  l_epoch="${l_epoch:-0}"
  age=$((now - l_epoch))
  if [ "${l_wt:-}" != "$top" ] && [ "$age" -ge 0 ] && [ "$age" -lt "$LEASE_STALE" ]; then
    {
      echo "🔴 CONFLIT savr-dev : la DB partagée est déjà utilisée par une AUTRE session."
      echo "   Détenteur : branche '$l_branch'  ($l_wt)  — lease posé il y a ${age}s."
      echo "   Ta session ('$branch') s'apprête à ÉCRIRE dans savr-dev (seed/migration) → risque de clobber."
      echo "   Options :"
      echo "     • attends que l'autre session finisse, puis relance ;"
      echo "     • si cette autre session est MORTE : 'pnpm session:db-unlock' puis relance ;"
      echo "     • ou isole cette session sur une base jetable / Supabase local (aucun lease requis)."
      echo "   Diagnostic complet : 'pnpm session:doctor'."
    } >&2
    exit 2
  fi
fi

# Libre / périmé / à moi → acquiert (ou rafraîchit) le lease, puis laisse passer.
printf '%s|%s|%s\n' "$top" "$branch" "$now" >"$lease" 2>/dev/null || true
exit 0
