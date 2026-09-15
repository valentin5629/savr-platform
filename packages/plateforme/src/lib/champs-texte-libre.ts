import { NextResponse } from 'next/server';

// ─── Bornes d'ENTRÉE de trois champs texte libre destinés au transporteur ─────
//
// Trois colonnes `text` sans aucune contrainte de longueur ni de type :
// `evenements.contact_secours_nom`, `evenements.contact_secours_telephone` et
// `collectes.informations_supplementaires`. Les routes qui les écrivent ne
// filtraient que les CLÉS (allowlist de champs éditables) — jamais les VALEURS,
// si bien que la colonne acceptait 5 000 caractères (mesuré).
//
// Ce que chacune coûte AUJOURD'HUI — relevé sur le code d'émission des adapters,
// pas déduit du nom des colonnes ; les trois cas sont différents :
//   · `informations_supplementaires` est le SEUL des trois à transiter par le
//     canal de TEXTE LIBRE de l'adapter logistique, où les informations
//     d'exploitation sont concaténées en un seul message pour le chauffeur : une
//     valeur démesurée y évince les lignes voisines — dont l'adresse d'accès. Son
//     plafond est pourtant écrit au CDC (1000 car.) ; il n'était appliqué à AUCUNE
//     écriture, seul le compteur du formulaire tronquait, côté client.
//   · `contact_secours_telephone` part dans un champ NATIF de la commande, pas
//     dans le texte libre : aucune éviction possible, mais un numéro de 5 000
//     caractères reste une donnée aberrante transmise telle quelle.
//   · `contact_secours_nom` n'est émis NULLE PART à ce jour. Sa transmission fait
//     l'objet d'une PR encore ouverte, qui le concatène précisément dans le canal
//     de texte libre — il rejoindra donc le premier cas, où un nom démesuré évince
//     les lignes suivantes et un nom multiligne forge une fausse ligne d'en-tête.
//     Le borner ici est une anticipation assumée, pas la fermeture d'une fuite en
//     cours : la borne est simplement en place avant que le champ ne circule.
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
 * nom, 40 pour un numéro au format libre — « +33 6 12 34 56 78 poste 1234 » en
 * fait 28. Le 120 reprend le plafond que la PR d'émission du nom de secours
 * (encore ouverte) applique à la mise en forme du canal libre, pour que les deux
 * niveaux ne puissent pas se contredire le jour où elle sera mergée.
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
 * Demi-surrogate orphelin — une unité UTF-16 de la plage D800-DFFF sans sa paire.
 *
 * Il ne bute sur AUCUN des CHECK : il meurt une couche plus tôt, à l'analyse du
 * `jsonb` que reçoivent les RPC (« invalid input syntax for type json »), donc en
 * 500 alors que la valeur est invalide et mérite un 422. Défaut PRÉ-EXISTANT et
 * plus large que ce lot (il vaut pour tout champ passant par `p_updates`) ; on le
 * ferme ici pour les trois colonnes bornées, à une ligne près.
 *
 * Le drapeau `u` est indispensable : sans lui, la plage D800-DFFF matcherait aussi
 * la moitié haute d'une paire LÉGITIME et un emoji serait refusé. Avec lui, la
 * regex raisonne en points de code — une paire bien formée en est un seul, qui
 * n'est pas un surrogate.
 */
const SURROGATE_ORPHELIN = /\p{Surrogate}/u;

/**
 * Valide et normalise les champs texte libre PRÉSENTS dans `source`. Les clés
 * absentes ne sont pas touchées : la fonction sert aussi bien un corps de création
 * (tous les champs) qu'un `updates` d'édition partielle (un seul).
 *
 * Normalisation : `trim()`, puis chaîne vide → `null`. Effacer un champ facultatif
 * se fait donc indifféremment par `null` ou par `""`, et une saisie qui n'est que
 * des blancs ne laisse pas une ligne fantôme dans le message du chauffeur.
 *
 * Effet de bord assumé, relevé en revue : resoumettre `""` sur une collecte dont
 * `informations_supplementaires` valait déjà `""` était un no-op ; c'est désormais
 * un passage à `null`, que `fn_set_collectes_dirty_tms` voit comme un changement
 * (`IS DISTINCT FROM`) — donc une propagation TMS de plus. Portée mesurée nulle :
 * aucune ligne n'a cette colonne renseignée, ni en dev ni en prod.
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
    if (
      propre.length > borne.max ||
      interdits.test(propre) ||
      SURROGATE_ORPHELIN.test(propre)
    ) {
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
