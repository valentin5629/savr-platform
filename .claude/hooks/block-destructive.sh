#!/usr/bin/env bash
# Bloque les commandes destructives.
set -euo pipefail

PATTERNS='rm[[:space:]]+-rf[[:space:]]+/|git[[:space:]]+push[[:space:]]+.*--force|drop[[:space:]]+(table|schema|database).*cascade|supabase[[:space:]]+db[[:space:]]+reset|truncate[[:space:]]'

# La commande est donnee a grep par un tube lu SANS `pipefail` (sous-shell) : seul
# le verdict de grep decide. Avec `pipefail`, `printf … | grep -q` rendait « motif
# absent » pour une grosse commande — grep sort au premier resultat, printf n'a
# pas fini d'ecrire, le tube sort en erreur (statuts releves : 141 et 0 ; 1 et 0
# quand SIGPIPE est ignore) — et le `if` lisait cette erreur comme « rien a
# bloquer ».
#
# Mesure le 2026-10-08 sur une copie de ce hook, 10 passages par cas, sous macOS
# 26.5.1 (/bin/bash 3.2.57, grep BSD 2.6.0) et sous Ubuntu 22.04 (bash 5.1.16,
# grep GNU 3.7), avec LC_ALL=C comme avec LC_ALL=en_US.UTF-8 :
#   • chacune des 5 formes du motif, en premiere ligne et suivie de 300 000
#     caracteres : code 0 au lieu de 2, 10 fois sur 10 ;
#   • ce qui compte est ce qui SUIT la ligne du motif, pas sa place : apres
#     300 000 caracteres, seul sur sa ligne et suivi de 100 000 autres, il n'etait
#     pas vu non plus (10 fois sur 10) ; en derniere ligne, ou tout le texte sur
#     une seule ligne, il l'etait (10 fois sur 10).
# La borne est la taille du tube, et elle varie : 65 536 octets pour un
# utilisateur ordinaire sous Ubuntu, 8 192 pour root dans un conteneur lance sans
# CAP_SYS_RESOURCE (lues par F_GETPIPE_SZ) ; sous macOS, un tube a absorbe 65 536
# octets d'un coup. Releves du tube nu, motif en premiere ligne, de quelques
# centaines a quelques milliers d'essais par taille :
#   • quand la suite depasse largement cette taille (300 000 caracteres), l'echec
#     est constant : 10 fois sur 10 dans chacun des releves ;
#   • juste au-dessus, il est frequent sans etre constant ;
#   • en dessous, il existe aussi :
#       – sous macOS en_US.UTF-8, il est courant a l'approche de la taille du tube
#         (a 49 152 comme a 65 536 octets) ;
#       – sous Ubuntu, il depend de la charge de la machine : sur 3 000 essais
#         par taille, aucun au repos et des echecs avec 20 processus de calcul
#         en parallele, a 8 192 comme a 27 250 octets (tube de 65 536) ;
#       – sous macOS LC_ALL=C, des echecs ont ete releves dans plusieurs releves,
#         a 27 250 octets notamment ; leur nombre varie d'un releve et d'une
#         charge a l'autre.
# Ces releves changent d'une passe a l'autre ; seul le 10 sur 10 s'est retrouve
# dans chacune. Aucune taille n'a ete etablie en dessous de laquelle le tube nu
# serait sur.
#
# Pourquoi pas une chaine-ici (`grep … <<< "$1"`) : bash peut l'ecrire dans un
# fichier temporaire — releve : en 3.2.57, a 1 caractere comme a 300 000 ; en
# 5.1.16, un tube a 4 096 caracteres et un fichier a 65 535. Quand ce fichier ne
# peut pas etre ecrit, grep n'est pas lance et le motif est lu « absent ». Mesure
# sur ce hook entier, variante chaine-ici, 20 passages par cas :
#   • Ubuntu, /tmp plein : une commande destructive suivie de 300 000 caracteres
#     sort en 0, que le repertoire courant soit inscriptible ou non ; la commande
#     courte reste bloquee ;
#   • Ubuntu, racine en lecture seule : meme echec, mais seulement si le
#     repertoire courant n'est pas inscriptible non plus ; s'il l'est, la
#     commande est bloquee ;
#   • macOS, ecriture interdite dans les repertoires temporaires : commande
#     courte ET grosse commande sortent en 0, la aussi seulement si le repertoire
#     courant n'est pas inscriptible ; s'il l'est, elles sont bloquees.
# Le tube lu sans `pipefail` bloquait la commande dans ces six situations.
# L'auto-test ne distingue pas les deux lectures : il tourne avec un repertoire
# temporaire inscriptible. Ce choix repose sur la mesure, pas sur lui.
#
# `2>&-` : quand SIGPIPE est ignore, printf ecrit « write error: Broken pipe »,
# qui s'afficherait au-dessus du motif du blocage ; sa sortie d'erreur est donc
# fermee (mesure : code 2 et motif seul affiche, macOS et Ubuntu). Fermee, et non
# renvoyee vers /dev/null : la ou /dev/null ne s'ouvre pas en ecriture, cette
# redirection echouait, printf n'etait pas lance, et une commande destructive —
# courte comprise — sortait en 0, 10 fois sur 10 (mesure sous macOS). L'auto-test
# ne voit pas cette difference non plus.
destructive_matche() (
  set +o pipefail
  printf '%s' "$1" 2>&- | grep -Eiq "$PATTERNS"
)

# ── Auto-test : le hook ENTIER, rejoue sur une commande ─────────────────────
# Ce hook n'est joue que par Claude Code, jamais en CI : sans cet auto-test, rien
# ne le verrait redevenir muet. Chaque cas repasse le script entier — la commande
# dans la charge JSON de l'entree standard, le code de sortie lu — et pas la seule
# fonction : un `exit 2` retire rougit aussi.
#   B = doit etre bloquee (code 2) ;
#   P = doit passer (code 0).
if [ "${1:-}" = "--self-test" ]; then
  ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  echec=false
  nb=0; np=0; ng=0
  joue() {  # joue <B|P> <commande>
    local voulu charge rc=0
    case "$1" in
      B) voulu=2; nb=$((nb + 1)) ;;
      P) voulu=0; np=$((np + 1)) ;;
      *) echo "🔴 type de cas inconnu : [$1]" >&2; echec=true; return 0 ;;
    esac
    if [ "${#2}" -gt 300000 ]; then ng=$((ng + 1)); fi
    # La commande passe par l'entree standard de jq, jamais en argument : sous
    # Linux un argument de 131 072 caracteres ne lance plus le programme
    # (« Argument list too long », mesure sur Ubuntu 22.04).
    charge="$(jq -Rs '{tool_input: {command: .}}' <<< "$2")" || { echo "🔴 block-destructive : charge JSON non construite (jq absent ?)." >&2; echec=true; return 0; }
    "$BASH" "$ICI" <<< "$charge" > /dev/null 2>&1 || rc=$?
    [ "$rc" = "$voulu" ] || { echo "🔴 block-destructive [$1] : [${2:0:160}] → code $rc (attendu $voulu)" >&2; echec=true; }
  }
  while IFS= read -r ligne; do
    [ -n "$ligne" ] || continue
    joue "${ligne%%:*}" "${ligne#*:}"
  done <<'FORMES'
B:rm -rf /tmp/x
B:git push origin main --force
B:psql -c "DROP TABLE plateforme.t CASCADE"
B:psql -c "drop schema plateforme cascade"
B:psql -c "drop database savr cascade"
B:supabase db reset
B:psql -c "truncate plateforme.t"
P:git status --short
P:rm -r dist
P:git push -u origin ma-branche
P:psql -c "drop table plateforme.t"
FORMES
  # Une tres grosse commande : le tube sous `pipefail` la laissait passer des
  # qu'il restait trop de texte APRES la ligne du motif (cf. destructive_matche).
  remplissage="$(head -c 300000 /dev/zero | tr '\0' 'x')"
  joue B "$(printf 'supabase db reset\n%s' "$remplissage")"
  joue B "$(printf '%s\nrm -rf /tmp/x\n%s' "$remplissage" "$remplissage")"
  joue B "$(printf '%s\nsupabase db reset' "$remplissage")"
  joue P "$(printf 'git status --short\n%s' "$remplissage")"

  if [ "$echec" = true ]; then
    echo "🔴 block-destructive : auto-test EN ECHEC — la garde peut etre muette ou bloquer a tort." >&2
    exit 2
  fi
  echo "✅ block-destructive : auto-test OK ($nb commandes destructives bloquees, $np autres commandes laissees passer, hook rejoue en entier ; dont $ng commandes de plus de 300 000 caracteres)."
  exit 0
fi

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"
if destructive_matche "$CMD"; then
  echo "Commande destructive bloquee par le harnais : revue humaine obligatoire." >&2
  exit 2
fi
exit 0
