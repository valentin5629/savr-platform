import { NextResponse } from 'next/server';

// ─── Bornes d'ENTRÉE de cinq champs texte libre destinés au transporteur ─────
//
// Cinq colonnes `text` sans aucune contrainte de longueur ni de type :
// `evenements.contact_principal_nom`, `evenements.contact_principal_telephone`,
// `evenements.contact_secours_nom`, `evenements.contact_secours_telephone` et
// `collectes.informations_supplementaires`. Les routes qui les écrivent ne
// filtraient que les CLÉS (allowlist de champs éditables) — jamais les VALEURS,
// si bien que la colonne acceptait 5 000 caractères (mesuré).
//
// Ce que chacune coûte — relevé sur le code d'émission des adapters de CETTE
// branche (main mergé), pas déduit du nom des colonnes :
//   · `informations_supplementaires` ET `contact_secours_nom` transitent par le
//     canal de TEXTE LIBRE, agrégé par `composerInformationsSupplementaires`
//     (packages/adapters/src/infos-acces.ts), où les informations d'exploitation
//     sont concaténées en un seul message pour le chauffeur. Une valeur démesurée
//     y évinçait les lignes voisines — et le nom de secours OUVRE le bloc, donc il
//     évinçait tout ce qui suit, adresse d'accès comprise. Un nom multiligne, lui,
//     y forge une fausse ligne d'en-tête indiscernable d'une vraie.
//     ⚠ Mis à jour : l'éviction PAR `informations_supplementaires` est close
//     depuis que le canal libre réserve un budget au bloc Savr — une note de
//     1000 caractères, saisie parfaitement légale, ne fait plus disparaître ni
//     l'adresse d'accès ni le contact de secours. La borne ci-dessous ne repose
//     donc plus sur cet argument pour ce champ : elle vaut pour l'intégrité de
//     la donnée (voir plus bas), et le plafond de mise en forme de l'agrégat
//     reste nécessaire pour le nom de secours (historique + écritures hors route).
//   · `contact_secours_telephone` part dans un champ NATIF de la commande : pas
//     d'éviction possible, mais un numéro de 5 000 caractères reste une donnée
//     aberrante transmise telle quelle.
//
// L'amont borne déjà la MISE EN FORME (`nomContact`, 120 car., blancs repliés) —
// et son propre commentaire constate que la colonne n'a « ni CHECK en base, ni
// borne de longueur sur la route d'édition ». C'est précisément ce que ce module
// et la migration 20260915180000 ferment.
//
// La borne posée ici est celle de l'INTÉGRITÉ DE LA DONNÉE, en 422 à l'écriture.
// Elle est doublée :
//   - en aval, par la mise en forme du canal libre côté adapters, qui replie les
//     blancs et tronque à l'émission — nécessaire indépendamment, puisqu'elle
//     couvre l'historique et tout autre chemin d'écriture ;
//   - en base, par les CHECK des migrations 20260915180000 et 20260915190000,
//     seul niveau qui tienne une écriture ne passant par aucune route Next.
//     ⚠ Mis à jour : ce commentaire désignait `evenements` comme « le cas
//     décisif », au motif qu'`authenticated` y gardait un GRANT UPDATE
//     table-level. 20260915190000 l'a révoqué (comme #318 sur `collectes`) : le
//     PostgREST direct n'est plus un vecteur sur AUCUNE des deux tables, et cet
//     argument ne doit pas être ré-invoqué. Ce que les CHECK couvrent encore, et
//     qui suffit à les justifier : les RPC `SECURITY DEFINER` appelées sous
//     service_role par les routes, le seed, une session psql, et toute route
//     future qui oublierait `validerChampsTexteLibre` — c'est-à-dire la leçon de
//     #308 sous sa forme durable, borner les routes ne borne pas la colonne.
// Les bornes ci-dessous et celles de ces DEUX migrations DOIVENT rester identiques ;
// `champs-texte-libre.bornes-db.test.ts` relit les deux fichiers SQL et le vérifie.

interface BorneChamp {
  /** Longueur maximale, en caractères, APRÈS `trim()`. */
  readonly max: number;
  /** Tabulation et sauts de ligne admis (champ saisi dans un `<textarea>`). */
  readonly multiligne: boolean;
  /**
   * Colonne NOT NULL en base ET champ obligatoire au CDC : une saisie vide est un
   * REFUS (422), jamais une normalisation en `null`. Sans ce drapeau, le `'' → null`
   * de la normalisation ci-dessous ferait remonter un 23502 (violation NOT NULL)
   * en 500, là où l'utilisateur doit lire « champ obligatoire ». Défaut par
   * `false` = facultatif, le cas de tous les champs d'origine de ce module. Le
   * drapeau est REQUIS sur chaque entrée : `as const satisfies` fige les littéraux,
   * et une propriété absente d'une seule entrée disparaît du type de l'union.
   */
  readonly obligatoire: boolean;
}

/**
 * `informations_supplementaires` : 1000 caractères = plafond du CDC, pas un
 * arbitrage local (§06.01 l.167 « Textarea (1000 car. max) », repris par §08 E1
 * « text nullable, max 1000 car. »). Le compteur du formulaire tronque déjà à
 * 1000 côté client — il n'y avait simplement aucune barrière derrière lui.
 *
 * Les quatre champs de contact n'ont pas de plafond au CDC (§06.01 l.122-123 : le
 * contact principal n'en porte pas, et le contact de secours y renvoie par
 * « Idem » ; le JSON Schema §08 donne `telephone` en « format libre V1,
 * normalisation E.164 reportée »). Les valeurs retenues sont donc applicatives,
 * dimensionnées sur une saisie de terrain plausible : 120 pour un nom, 40 pour un
 * numéro au format libre — « +33 6 12 34 56 78 poste 1234 » en fait 28. Le 120 est
 * exactement `LIMITE_NOM_SECOURS` (packages/adapters/src/infos-acces.ts) : la borne
 * d'entrée et le plafond de mise en forme du canal libre sont volontairement le
 * même nombre, pour qu'un nom accepté à la saisie ne puisse jamais être tronqué à
 * l'émission.
 *
 * `contact_principal_nom` / `contact_principal_telephone` ont été AJOUTÉS après
 * coup : la divergence de ce lot les déclarait « NON bornés, hors périmètre — les
 * borner serait cohérent, décision Val », au motif qu'ils ne transitent pas par le
 * canal libre et n'exposent donc pas au risque d'ÉVICTION. C'est exact, mais ils
 * partent dans les champs NATIFS de la commande (`contact` / `phone` côté camion,
 * `pickup.contact` côté vélo-cargo) : un nom de 5 000 caractères y reste une donnée
 * aberrante transmise au transporteur, exactement comme le téléphone de secours que
 * ce module bornait déjà pour ce motif-là. Mêmes valeurs que leurs homologues de
 * secours, pour qu'un couple nom/téléphone ne soit pas borné différemment selon
 * qu'il est principal ou de secours.
 *
 * Différence unique : ils sont `obligatoire`. Les colonnes sont NOT NULL et le
 * §06.01 l.320 les exige « renseignés » dans les validations bloquantes — un
 * contact principal effacé, c'est un chauffeur sans personne à appeler. La
 * normalisation `'' → null` du reste du module y est donc remplacée par un refus.
 */
export const BORNES_TEXTE_LIBRE = {
  contact_principal_nom: { max: 120, multiligne: false, obligatoire: true },
  contact_principal_telephone: {
    max: 40,
    multiligne: false,
    obligatoire: true,
  },
  contact_secours_nom: { max: 120, multiligne: false, obligatoire: false },
  contact_secours_telephone: { max: 40, multiligne: false, obligatoire: false },
  informations_supplementaires: {
    max: 1000,
    multiligne: true,
    obligatoire: false,
  },
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
      // Effacer un champ obligatoire est un refus, pas un no-op silencieux : la
      // colonne est NOT NULL, laisser passer produirait un 23502 → 500.
      if (BORNES_TEXTE_LIBRE[champ].obligatoire) invalides.push(champ);
      else valeurs[champ] = null;
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

    if (propre === '' && borne.obligatoire) {
      invalides.push(champ);
      continue;
    }
    valeurs[champ] = propre === '' ? null : propre;
  }

  if (invalides.length > 0) {
    const details = invalides
      .map((c) =>
        BORNES_TEXTE_LIBRE[c].obligatoire
          ? `${c} (obligatoire, max ${BORNES_TEXTE_LIBRE[c].max} caractères)`
          : `${c} (max ${BORNES_TEXTE_LIBRE[c].max} caractères)`,
      )
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
