// ─── Bornes d'entrée des champs texte libre — module PUR (client + serveur) ───
//
// Extrait de `champs-texte-libre.ts` (R-UI-5, F11) pour que les formulaires
// (`'use client'`) bornent leur `maxLength` sur la MÊME constante que la route :
// `champs-texte-libre.ts` importe `next/server` (NextResponse), qu'un composant
// client ne doit pas embarquer. Seul l'emplacement change : valeurs, drapeaux et
// commentaires sont repris tels quels, et `champs-texte-libre.ts` les ré-exporte
// (API inchangée pour les routes et `champs-texte-libre.bornes-db.test.ts`).
// Ces bornes et les CHECK des migrations 20260915180000 et 20260915190000
// DOIVENT rester identiques.

export interface BorneChamp {
  /** Longueur maximale, en caractères, APRÈS `trim()`. */
  readonly max: number;
  /** Tabulation et sauts de ligne admis (champ saisi dans un `<textarea>`). */
  readonly multiligne: boolean;
  /**
   * Colonne NOT NULL en base ET champ obligatoire au CDC : une saisie vide est un
   * REFUS (422), jamais une normalisation en `null`. Sans ce drapeau, le `'' → null`
   * de la normalisation de `validerChampsTexteLibre` ferait remonter un 23502 (violation NOT NULL)
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
