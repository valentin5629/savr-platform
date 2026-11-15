/**
 * Types partagés par les transformations : ce que l'import reçoit de la base et
 * des fichiers de décision (`Contexte`), et ce qu'il s'apprête à écrire (`Plan`).
 * Le plan est calculé en mémoire, sans toucher la base : c'est lui que les
 * tests unitaires vérifient.
 */

export type CodeFlux =
  | 'biodechet'
  | 'carton'
  | 'dechet_residuel'
  | 'emballage'
  | 'verre';

export interface Geocode {
  latitude: number;
  longitude: number;
  /** Confiance du service d'adresses, de 0 à 1. */
  score: number;
  /** Position au numéro de rue (et non au milieu d'une rue ou d'une commune). */
  precis: boolean;
  codePostal: string | null;
  ville: string | null;
}

/** En dessous, la position rendue par le service d'adresses n'est pas retenue. */
export const SCORE_GEOCODE_MINIMAL = 0.5;

export interface Contexte {
  /** Jour de l'import, heure de Paris (AAAA-MM-JJ) : sert aux seuils d'ancienneté. */
  jourReference: string;
  /** Instant de l'import, tel que rendu par la base (posé sur les lignes sans date source). */
  instantImport: string;
  /** Domaines qui ne rattachent jamais à une organisation (publics, jetables, Savr). */
  domainesExclus: Set<string>;
  /** Réponses du service d'adresses, par adresse normalisée ; `null` = adresse non trouvée. */
  geocodes: Map<string, Geocode | null>;
  decisions: {
    /** clé de fiche lieu → `distinct` ou clé de la fiche à rejoindre. */
    lieux: Map<string, string>;
    /** identifiant Bubble d'un client → `distinct` ou identifiant à rejoindre. */
    clients: Map<string, string>;
    /** identifiant Bubble d'un client → type d'organisation validé par Val. */
    types: Map<string, string>;
    /** Identifiants Bubble (clients ou collectes) écartés par Val : données de test. */
    exclusions: Set<string>;
  };
  /** Répétition : appliquer le type proposé par règle quand Val n'a pas encore validé. */
  appliquerTypesProposes: boolean;
  typeEvenementAutreId: string;
  fluxParCode: Record<CodeFlux, string>;
  poidsParRepasKg: number;
  /** Organisation des comptes Savr déjà présente dans la base, sinon `null` (elle est alors créée). */
  organisationSavrId: string | null;
}

export type LigneCible = Record<string, unknown>;

/** Tables écrites, dans l'ordre d'écriture (03 - Ordre d'execution). */
export const TABLES_CIBLES = [
  'organisations',
  'users',
  'lieux',
  'associations',
  'transporteurs',
  'entites_facturation',
  'organisations_domaines_email',
  'contacts_traiteurs',
  'packs_antgaspi',
  'evenements',
  'collectes',
  'collecte_contacts',
  'collecte_flux',
  'attributions_antgaspi',
] as const;

export type TableCible = (typeof TABLES_CIBLES)[number];

export interface Correspondance {
  sourceType: string;
  bubbleId: string;
  table: TableCible;
  cibleId: string;
  /** Fiche Bubble absorbée par une autre (perdant d'un regroupement). */
  fusionne: boolean;
}

export interface Rejet {
  sourceType: string;
  bubbleId: string;
  motif: string;
}

export interface Plan {
  tables: Record<TableCible, LigneCible[]>;
  correspondances: Correspondance[];
  rejets: Rejet[];
  /** Listes de complétion ou d'arbitrage, par nom de fichier (sans extension). */
  listings: Record<string, LigneCible[]>;
  /**
   * Ce qui interdit d'écrire dans la base tant que Val n'a pas tranché : référence
   * ambiguë (un nom ou un email qui désigne deux organisations), décision qui
   * nomme une fiche inconnue (04 - Transformations §8 : jamais résolu au hasard).
   */
  blocages: string[];
  /**
   * Email Bubble du commercial et du compte créateur, par événement importé : ce
   * qui permettra de rendre son historique au commercial à son inscription
   * (décision Val 2026-11-15). Gardé dans le schéma technique, fermé aux clients.
   */
  auteursEvenements: LigneCible[];
  /** Fichiers à valider par Val, rejoués comme décisions au passage suivant. */
  aValider: {
    lieux: LigneCible[];
    clients: LigneCible[];
    types: LigneCible[];
    exclusions: LigneCible[];
  };
}

export function planVide(): Plan {
  return {
    tables: Object.fromEntries(
      TABLES_CIBLES.map((t) => [t, []]),
    ) as unknown as Plan['tables'],
    correspondances: [],
    rejets: [],
    listings: {},
    blocages: [],
    auteursEvenements: [],
    aValider: { lieux: [], clients: [], types: [], exclusions: [] },
  };
}

export function ajouterAuListing(
  plan: Plan,
  nom: string,
  ligne: LigneCible,
): void {
  (plan.listings[nom] ??= []).push(ligne);
}
