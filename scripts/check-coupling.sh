#!/usr/bin/env bash
# =============================================================================
# Garde-fou 3 TMS-Ready : interdiction du couplage direct a MTS-1 / Everest
# =============================================================================
# La Plateforme ne parle JAMAIS directement a MTS-1 / Everest depuis le code
# metier : tout passe par l'interface logistique_provider (impl. adapter_mts1 /
# adapter_everest), confinee a packages/adapters/. Un swap d'adapter (V2 = TMS
# natif) doit etre trivial → 0 reference directe hors de cette zone.
#
# Regles :
#   - Motifs "mts1" / "everest" : scannes dans le code TS/JS + SQL, HORS
#     packages/adapters/, HORS chemins listes dans scripts/coupling-allowlist.txt
#     (exceptions legitimes rares — ex. valeur d'enum transporteurs.type_tms —
#      visibles et revues en PR, jamais silencieuses).
#   - Motif "customerOrders" (ressource API MTS-1 V3) : INTERDIT PARTOUT hors
#     adapters, AUCUNE exception (l'allowlist est ignoree pour ce motif).
#
# Sortie : exit 1 (build rouge) + chaque fichier:ligne fautif si violation,
#          exit 0 sinon. Compatible bash 3.2 (macOS) et GNU bash (CI Linux).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ALLOWLIST="scripts/coupling-allowlist.txt"
EXTS_REGEX='\.(ts|tsx|js|jsx|mjs|cjs|sql)$'

# Bornes "mot" portables (GNU + BSD grep), sans \b (non portable).
WB='(^|[^A-Za-z0-9_])'
WE='([^A-Za-z0-9_]|$)'
PAT_PROVIDER="${WB}(mts1|everest)${WE}"
PAT_CUSTORDERS="${WB}customerOrders${WE}"

# Fichiers suivis hors zone autorisee, filtres sur les extensions scannees.
# Un seul `git grep` par motif au lieu de deux `grep` par fichier : 20 s → ~1 s
# (mesure 2026-10-25). Hors d'un depot git, repli sur `grep -r`.
#   -z : nom de fichier suivi d'un octet NUL, tel quel (un `:` ou un caractere
#        non ASCII dans le nom ne fait plus sauter la ligne) ;
#   -a : un fichier juge binaire (octet NUL, attribut `-diff`/`binary` de
#        .gitattributes) est lu comme du texte — sinon il echapperait a la garde.
# Une recherche en echec (code > 1) fait echouer la garde : jamais de faux OK.
EXCLUS=(':(exclude)packages/adapters/*' ':(exclude)scripts/check-coupling.sh' ":(exclude)$ALLOWLIST")
SORTIE="$(mktemp "${TMPDIR:-/tmp}/couplage.XXXXXX")"
trap 'rm -f "$SORTIE"' EXIT

# Sortie « fichier NUL ligne:texte » pour le motif $1, fichiers des extensions scannees.
chercher() {
  local rc=0 mode
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    mode=git
    git grep -z -n -a -i -E "$1" -- "${EXCLUS[@]}" > "$SORTIE" 2>/dev/null || rc=$?
  else
    mode=grep
    grep -r -n -a -i -E --null "$1" . > "$SORTIE" 2>/dev/null || rc=$?
  fi
  if [ "$rc" -gt 1 ]; then
    echo "Garde-fou 3 anti-couplage : la recherche a echoue (code $rc) — rien n'est etabli, commit refuse." >&2
    exit 1
  fi
  EXTS_REGEX="$EXTS_REGEX" ALLOWLIST="$ALLOWLIST" perl -e '
    my ($mode) = @ARGV; my $ext = $ENV{EXTS_REGEX}; my $allow = $ENV{ALLOWLIST};
    while (my $l = <STDIN>) {
      chomp $l;
      my ($p, $r);
      if ($mode eq "git") { my ($f, $n, $t) = split /\0/, $l, 3; ($p, $r) = ($f, "$n:" . ($t // "")); }
      else {
        ($p, $r) = split /\0/, $l, 2; $p =~ s{^\./}{};
        next if $p =~ m{^packages/adapters/} || $p eq "scripts/check-coupling.sh" || $p eq $allow;
      }
      next unless $p =~ /$ext/;
      print "$p\0$r\n";
    }' "$mode" < "$SORTIE"
}

# Vrai si le chemin $1 correspond a un glob de l'allowlist (# = commentaire).
ALLOW_PATS=()
if [ -f "$ALLOWLIST" ]; then
  while IFS= read -r pat; do
    case "$pat" in ''|\#*) continue ;; esac
    ALLOW_PATS+=("$pat")
  done < "$ALLOWLIST"
fi
allowed() {
  local f="$1" pat
  [ "${#ALLOW_PATS[@]}" -gt 0 ] || return 1
  for pat in "${ALLOW_PATS[@]}"; do
    # shellcheck disable=SC2254
    case "$f" in $pat) return 0 ;; esac
  done
  return 1
}

violations=0

# Les resultats sont lus dans un fichier, pas par `< <(…)` : un echec de la
# recherche doit arreter la garde, ce qu'une substitution de processus tairait.
RESULTATS="$(mktemp "${TMPDIR:-/tmp}/couplage-res.XXXXXX")"
trap 'rm -f "$SORTIE" "$RESULTATS"' EXIT

# customerOrders : interdit partout, zero exception.
chercher "$PAT_CUSTORDERS" > "$RESULTATS"
while IFS= read -r -d '' f && IFS= read -r reste; do
  echo "COUPLAGE [customerOrders] $f:$reste"
  violations=1
done < "$RESULTATS"

# mts1 / everest : exception possible via allowlist (jugee une fois par fichier).
chercher "$PAT_PROVIDER" > "$RESULTATS"
dernier=""; exempt=1
while IFS= read -r -d '' f && IFS= read -r reste; do
  if [ "$f" != "$dernier" ]; then
    dernier="$f"
    if allowed "$f"; then exempt=0; else exempt=1; fi
  fi
  [ "$exempt" -eq 0 ] && continue
  echo "COUPLAGE [mts1|everest] $f:$reste"
  violations=1
done < "$RESULTATS"

if [ "$violations" -ne 0 ]; then
  {
    echo ""
    echo "Garde-fou 3 (anti-couplage TMS) : reference directe a MTS-1/Everest hors packages/adapters/."
    echo "→ Router l'appel via l'interface logistique_provider (adapter_mts1 / adapter_everest)."
    echo "→ Exception legitime ? Ajouter le chemin a $ALLOWLIST (revu en PR)."
    echo "  customerOrders n'admet JAMAIS d'exception."
  } >&2
  exit 1
fi

echo "Garde-fou 3 anti-couplage : OK (0 reference directe hors packages/adapters/)."
exit 0
