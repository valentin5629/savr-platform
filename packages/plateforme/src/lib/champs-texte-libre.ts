import { NextResponse } from 'next/server';

// ─── Bornes d'ENTRÉE des champs texte libre transmis au transporteur ──────────
//
// Trois colonnes `text` sans aucune contrainte de longueur ni de type :
// `evenements.contact_secours_nom`, `evenements.contact_secours_telephone` et
// `collectes.informations_supplementaires`. Les routes qui les écrivent ne
// filtraient que les CLÉS (allowlist de champs éditables) — jamais les VALEURS.
//
// Ce que cela coûtait concrètement : ces trois champs partent au transporteur, et
// deux d'entre eux passent par le canal de texte libre de l'adapter logistique
// (quel que soit le transporteur), où toutes les informations d'exploitation sont
// concaténées en un seul message pour le chauffeur. Un nom de contact de 5 000
// caractères (mesuré : la colonne les acceptait) évince les lignes suivantes —
// dont l'adresse d'accès — de ce message. Un nom multiligne, lui, y forge une
// fausse ligne d'en-tête indiscernable d'une vraie.
//
// La borne posée ici est celle de l'INTÉGRITÉ DE LA DONNÉE, en 422 à l'écriture.
// Elle est doublée :
//   - en aval, par la mise en forme du canal libre côté adapters, qui replie les
//     blancs et tronque à l'émission — nécessaire indépendamment, puisqu'elle
//     couvre l'historique et tout autre chemin d'écriture ;
//   - en base, par les CHECK de la migration 20260915170000, seul niveau qui
//     tienne une écriture PostgREST directe (`authenticated` porte un GRANT UPDATE
//     table-level sur `plateforme.*`, cf. #308 : borner les routes ne borne pas la
//     colonne).
// Les bornes ci-dessous et celles de cette migration DOIVENT rester identiques ;
// `champs-texte-libre.bornes-db.test.ts` relit le fichier SQL et le vérifie.

interface BorneChamp {
  /** Longueur maximale, en caractères, APRÈS `trim()`. */
  readonly max: number;
  /** Tabulation et sauts de ligne admis (champ saisi dans un `<textarea>`). */
  readonly multiligne: boolean;
}

/**
 * `informations_supplementaires` : 1000 caractères = plafond du CDC, pas un
 * arbitrage local (§06.01 l.167 « Textarea (1000 car. max) », repris par §08 E1
 * « text nullable, max 1000 car. »). Le compteur du formulaire tronque déjà à
 * 1000 côté client — il n'y avait simplement aucune barrière derrière lui.
 *
 * Les deux champs de contact n'ont pas de plafond au CDC (§06.01 l.123 renvoie au
 * contact principal, sans borne ; le JSON Schema §08 donne `telephone` en « format
 * libre V1, normalisation E.164 reportée »). Les valeurs retenues sont donc
 * applicatives, dimensionnées sur une saisie de terrain plausible : 120 pour un
 * nom (aligné sur le plafond de mise en forme du canal libre, pour que les deux
 * niveaux ne puissent pas se contredire), 40 pour un numéro au format libre —
 * « +33 6 12 34 56 78 poste 1234 » en fait 28.
 */
export const BORNES_TEXTE_LIBRE = {
  contact_secours_nom: { max: 120, multiligne: false },
  contact_secours_telephone: { max: 40, multiligne: false },
  informations_supplementaires: { max: 1000, multiligne: true },
} as const satisfies Record<string, BorneChamp>;

export type ChampTexteLibre = keyof typeof BORNES_TEXTE_LIBRE;

const CHAMPS: readonly ChampTexteLibre[] = Object.keys(
  BORNES_TEXTE_LIBRE,
) as ChampTexteLibre[];

/**
 * Caractères de contrôle C0 (U+0000 à U+001F), DEL et C1 (U+007F à U+009F).
 *
 * Exactement l'ensemble que la classe POSIX `[[:cntrl:]]` désigne sur ce serveur
 * (Postgres 17, vérifié codepoint par codepoint : U+00A0 et U+00E9 n'en sont pas).
 * Les CHECK de la migration s'appuient sur cette classe : les deux niveaux
 * refusent donc le MÊME ensemble, et aucune valeur acceptée par la route ne peut
 * ressortir en 500 sur la contrainte.
 *
 * Le NUL a un effet propre : Postgres refuse U+0000 dans un `text` — sans ce
 * filtre, la valeur casserait à l'INSERT et sortirait en 500 au lieu du 422 dû.
 */
/* eslint-disable no-control-regex -- désigner ces plages EST l'objet des deux
   gardes ci-dessous ; un `disable-next-line` se décalerait au premier reformatage
   qui répartit le littéral sur deux lignes. */
const CONTROLE = /[\u0000-\u001F\u007F-\u009F]/;
/** Idem, tabulation et sauts de ligne exceptés (champs `<textarea>`). */
const CONTROLE_HORS_BLANCS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
/* eslint-enable no-control-regex */

/**
 * Valide et normalise les champs texte libre PRÉSENTS dans `source`. Les clés
 * absentes ne sont pas touchées : la fonction sert aussi bien un corps de création
 * (tous les champs) qu'un `updates` d'édition partielle (un seul).
 *
 * Normalisation : `trim()`, puis chaîne vide → `null`. Effacer un champ facultatif
 * se fait donc indifféremment par `null` ou par `""`, et une saisie qui n'est que
 * des blancs ne laisse pas une ligne fantôme dans le message du chauffeur.
 *
 * Convention de retour identique à `validerLieuOverrides` (#308) : `{ valeurs }`,
 * ou `{ error }` portant un 422 `champs_invalides`.
 */
export function validerChampsTexteLibre(
  source: unknown,
):
  | { valeurs: Partial<Record<ChampTexteLibre, string | null>> }
  | { error: NextResponse } {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return { valeurs: {} };
  }

  const objet = source as Record<string, unknown>;
  const valeurs: Partial<Record<ChampTexteLibre, string | null>> = {};
  const invalides: ChampTexteLibre[] = [];

  for (const champ of CHAMPS) {
    if (!Object.hasOwn(objet, champ)) continue;

    const brut = objet[champ];
    if (brut === null || brut === undefined) {
      valeurs[champ] = null;
      continue;
    }

    const borne = BORNES_TEXTE_LIBRE[champ];
    // Le point du défaut : sans ce test, un nombre, un objet ou un tableau
    // traverse la route et se retrouve stocké tel quel par `p_updates->>champ`,
    // qui coerce n'importe quel jsonb en texte.
    if (typeof brut !== 'string') {
      invalides.push(champ);
      continue;
    }

    const propre = brut.trim();
    const interdits = borne.multiligne ? CONTROLE_HORS_BLANCS : CONTROLE;
    if (propre.length > borne.max || interdits.test(propre)) {
      invalides.push(champ);
      continue;
    }

    valeurs[champ] = propre === '' ? null : propre;
  }

  if (invalides.length > 0) {
    const details = invalides
      .map((c) => `${c} (max ${BORNES_TEXTE_LIBRE[c].max} caractères)`)
      .join(', ');
    return {
      error: NextResponse.json(
        {
          error: `Saisie invalide : ${details}. Le texte doit être une chaîne, sans caractère de contrôle.`,
          champs_invalides: invalides,
        },
        { status: 422 },
      ),
    };
  }

  return { valeurs };
}
