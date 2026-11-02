/**
 * Lot « catalogue de cas » de seed_demo — une collecte par cas de figure à tester
 * (demande Val 2026-11-02 : « tous les cas de figure, pour pouvoir tout tester »).
 *
 * Le pipeline vivant tire ses collectes au hasard : il ne garantit ni toutes les
 * heures de créneau, ni toutes les tailles, ni la province hors Rouen, ni les
 * états rares (annulation demandée, modifiée sans renvoi, en attente du
 * prestataire, informations incomplètes, contrôle d'accès…). Ce lot les pose
 * explicitement, chacun sur un événement nommé « Cas — … » pour le retrouver
 * d'un coup d'œil (recherche « Cas » dans les listes).
 *
 * Dates relatives à l'ancre du seed (comme le pipeline vivant) : les cas
 * « aujourd'hui », « < 24 h », « en cours » restent vrais quel que soit le jour
 * du seed. Déterministe à ancre égale, aucun tirage aléatoire.
 *
 * Volontairement absent :
 * - A Toutes! (Everest) : une collecte servie par lui pourrait partir chez
 *   Everest depuis dev au premier clic d'envoi ; à décider à part.
 * - « Rapport non consulté » : ce filtre lit les rapports PDF, que le seed ne
 *   sème jamais (cf. documents-non-semes) ; `pnpm documents:dev` les fabrique.
 * - Le compte Nomad, qui reste vide (fixture « nouveau client »).
 * - « Refusée par le TMS » (`rejetee_par_tms`) : aucun code V1 ne l'écrit.
 *
 * Toute collecte confiée à un prestataire reçoit en base une tournée par
 * camion (`demo.ts`), comme l'adapter la crée : sans elle, l'annulation ou la
 * relève la croiraient jamais commandée.
 */

import { decalerJour, instantParis } from '../temps/index.js';
import type { CollecteVivante } from './pipeline-vivant.js';

/** Lieux de province du seed (pour le choix du prestataire et de l'association). */
export const LIEUX_PROVINCE: ReadonlySet<string> = new Set([
  'lieu_rouen_normandie',
  'lieu_lille_grand_palais',
  'lieu_lyon_cite_internationale',
  'lieu_bordeaux_parc_expo',
  'lieu_marseille_chanot',
  'lieu_nantes_cite_congres',
]);

export type CollecteCas = CollecteVivante & {
  /** Nom de l'événement porteur (« Cas — … »). */
  nomEvenement: string;
  /** Heure du créneau « HH:MM » (Paris). */
  heure: string;
  /** Programmé par l'agence Caromy plutôt que par le traiteur. */
  parAgence: boolean;
  /** AG : association bénéficiaire imposée (sinon rotation du seed). */
  association?: string;
  /** AG : repas réellement donnés. */
  repas?: number;
  /** AG : attribution déjà validée par l'Admin (demande partie). */
  attributionValidee?: boolean;
  /** AG annulée tardivement : crédit du pack actif débité (trigger en prod). */
  packDebite?: boolean;
  informationsCompletes: boolean;
  controleAcces: boolean;
  /** Contrôle d'accès : instant d'envoi de l'email des infos d'accès. */
  infosAccesEnvoyeesAt?: string;
  dirtyTms: boolean;
  /** Instant de la demande d'annulation du client (ISO). */
  annulationDemandeeAt?: string;
  /** Annulée par Savr : motif. */
  annuleeCoteSavrMotif?: string;
  notesInternes?: string;
  informationsSupplementaires?: string;
  incident?: {
    motif: string;
    imputable: 'prestataire' | 'client' | 'association' | 'savr' | 'externe';
  };
};

type DefCas = Omit<
  CollecteCas,
  | 'slug'
  | 'date'
  | 'camions'
  | 'parAgence'
  | 'informationsCompletes'
  | 'controleAcces'
  | 'dirtyTms'
  | 'annulationDemandeeAt'
> & {
  /** Jours depuis l'ancre (négatif = passé). */
  j: number;
  camions?: number;
  parAgence?: boolean;
  informationsCompletes?: boolean;
  controleAcces?: boolean;
  dirtyTms?: boolean;
  /** Demande d'annulation : jour (relatif à l'ancre) et heure. */
  annulationDemandee?: { j: number; heure: string };
};

const KASPIA = 'org_tr_kaspia';
const POTEL = 'org_tr_potel';
const LENOTRE = 'org_tr_lenotre';
const FLEUR = 'org_tr_fleurdemets';
const BUTARD = 'org_tr_butard';
const GRANDCHEMIN = 'org_tr_grandchemin';
const CIRETTE = 'org_tr_cirette';

const ZD = 'zero_dechet' as const;
const AG = 'anti_gaspi' as const;

const CAS: DefCas[] = [
  // ── À venir : envoi au prestataire ──────────────────────────────────────
  {
    nomEvenement: 'Cas — ZD créée, non transmise',
    traiteur: KASPIA,
    type: ZD,
    j: 4,
    heure: '06:00',
    lieu: 'lieu_porte_versailles',
    pax: 350,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
  },
  {
    nomEvenement: 'Cas — AG créée, à attribuer',
    traiteur: POTEL,
    type: AG,
    j: 6,
    heure: '08:30',
    lieu: 'lieu_palais_congres',
    pax: 180,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
    sansAttribution: true,
  },
  {
    nomEvenement: 'Cas — ZD envoyée, en attente du prestataire',
    traiteur: LENOTRE,
    type: ZD,
    j: 8,
    heure: '12:00',
    lieu: 'lieu_champerret',
    pax: 600,
    statut: 'programmee',
    statutTms: 'attribuee_en_attente_acceptation',
  },
  {
    nomEvenement: 'Cas — AG envoyée, en attente du prestataire',
    traiteur: FLEUR,
    type: AG,
    j: 9,
    heure: '14:30',
    lieu: 'lieu_carrousel',
    pax: 601,
    statut: 'programmee',
    statutTms: 'attribuee_en_attente_acceptation',
    attributionValidee: true,
  },
  {
    nomEvenement: 'Cas — ZD validée, modifiée sans renvoi TMS',
    traiteur: GRANDCHEMIN,
    type: ZD,
    j: 5,
    heure: '20:00',
    lieu: 'lieu_la_serre',
    pax: 1500,
    statut: 'validee',
    statutTms: 'acceptee',
    dirtyTms: true,
  },
  {
    nomEvenement: 'Cas — AG validée, modifiée sans renvoi TMS',
    traiteur: KASPIA,
    type: AG,
    j: 7,
    heure: '23:45',
    lieu: 'lieu_rothschild',
    pax: 420,
    statut: 'validee',
    statutTms: 'acceptee',
    dirtyTms: true,
  },

  // ── Urgences (< 24 h / < 48 h) ──────────────────────────────────────────
  {
    nomEvenement: 'Cas — ZD ce soir, non validée (< 24 h)',
    traiteur: POTEL,
    type: ZD,
    j: 0,
    heure: '23:30',
    lieu: 'lieu_trianon',
    pax: 250,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
  },
  {
    nomEvenement: 'Cas — AG demain matin, à attribuer (< 48 h)',
    traiteur: LENOTRE,
    type: AG,
    j: 1,
    heure: '07:00',
    lieu: 'lieu_convention_centre',
    pax: 90,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
    sansAttribution: true,
  },
  {
    nomEvenement: 'Cas — AG après minuit, 2 camions',
    traiteur: KASPIA,
    type: AG,
    j: 1,
    heure: '00:30',
    lieu: 'lieu_porte_versailles',
    pax: 2200,
    camions: 2,
    statut: 'validee',
    statutTms: 'acceptee',
  },

  // ── Informations, contrôle d'accès, tailles ─────────────────────────────
  {
    nomEvenement: 'Cas — ZD informations incomplètes',
    traiteur: POTEL,
    type: ZD,
    j: 12,
    heure: '09:00',
    lieu: 'lieu_villepinte',
    pax: 1499,
    statut: 'validee',
    statutTms: 'acceptee',
    informationsCompletes: false,
  },
  {
    nomEvenement: "Cas — ZD contrôle d'accès, infos à envoyer",
    traiteur: KASPIA,
    type: ZD,
    j: 14,
    heure: '19:00',
    lieu: 'lieu_palais_congres',
    pax: 1200,
    statut: 'validee',
    statutTms: 'acceptee',
    controleAcces: true,
  },
  {
    nomEvenement: "Cas — AG contrôle d'accès, infos envoyées",
    traiteur: POTEL,
    type: AG,
    j: 15,
    heure: '22:00',
    lieu: 'lieu_le_bourget',
    pax: 950,
    statut: 'validee',
    statutTms: 'acceptee',
    controleAcces: true,
    // posé dans genererCatalogueCas (instant relatif à l'ancre)
  },
  {
    nomEvenement: 'Cas — ZD toute petite (8 pax)',
    traiteur: GRANDCHEMIN,
    type: ZD,
    j: 16,
    heure: '13:00',
    lieu: 'lieu_ponctuel_1',
    pax: 8,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
  },
  {
    nomEvenement: 'Cas — ZD géante (15 000 pax, 4 camions)',
    traiteur: KASPIA,
    type: ZD,
    j: 40,
    heure: '06:30',
    lieu: 'lieu_paris_nord',
    pax: 15000,
    camions: 4,
    statut: 'validee',
    statutTms: 'acceptee',
  },
  {
    nomEvenement: 'Cas — ZD avec notes internes',
    traiteur: LENOTRE,
    type: ZD,
    j: 27,
    heure: '16:00',
    lieu: 'lieu_ponctuel_2',
    pax: 520,
    statut: 'validee',
    statutTms: 'acceptee',
    notesInternes:
      'Client exigeant : appeler le maître d’hôtel 30 min avant. Badge à retirer au PC sécurité.',
    informationsSupplementaires:
      'Accès par la rue de service, quai n° 3. Bacs à laisser près de l’office. Ascenseur monte-charge réservé de 22 h à 23 h.',
  },

  // ── Province ────────────────────────────────────────────────────────────
  {
    nomEvenement: 'Cas — ZD province Lille',
    traiteur: LENOTRE,
    type: ZD,
    j: 11,
    heure: '10:00',
    lieu: 'lieu_lille_grand_palais',
    pax: 700,
    statut: 'validee',
    statutTms: 'acceptee',
  },
  {
    nomEvenement: 'Cas — AG province Lyon, en attente du prestataire',
    traiteur: POTEL,
    type: AG,
    j: 13,
    heure: '21:00',
    lieu: 'lieu_lyon_cite_internationale',
    pax: 300,
    statut: 'programmee',
    statutTms: 'attribuee_en_attente_acceptation',
    association: 'asso_echo',
    attributionValidee: true,
  },
  {
    nomEvenement: 'Cas — ZD province Bordeaux, 2 camions, non transmise',
    traiteur: FLEUR,
    type: ZD,
    j: 18,
    heure: '11:00',
    lieu: 'lieu_bordeaux_parc_expo',
    pax: 2500,
    camions: 2,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
  },
  {
    nomEvenement: 'Cas — AG province Marseille, à attribuer',
    traiteur: BUTARD,
    type: AG,
    j: 20,
    heure: '23:00',
    lieu: 'lieu_marseille_chanot',
    pax: 140,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
    sansAttribution: true,
  },
  {
    nomEvenement: 'Cas — ZD province Nantes, informations incomplètes',
    traiteur: GRANDCHEMIN,
    type: ZD,
    j: 22,
    heure: '17:00',
    lieu: 'lieu_nantes_cite_congres',
    pax: 450,
    statut: 'validee',
    statutTms: 'acceptee',
    informationsCompletes: false,
  },
  {
    nomEvenement: 'Cas — AG Rouen tôt le matin',
    traiteur: CIRETTE,
    type: AG,
    j: 3,
    heure: '05:30',
    lieu: 'lieu_rouen_normandie',
    pax: 220,
    statut: 'validee',
    statutTms: 'acceptee',
    association: 'asso_echo',
  },

  // ── Programmées par une agence ──────────────────────────────────────────
  {
    nomEvenement: 'Cas — ZD programmée par une agence',
    traiteur: KASPIA,
    type: ZD,
    j: 9,
    heure: '18:30',
    lieu: 'lieu_arts_forains',
    pax: 500,
    statut: 'validee',
    statutTms: 'acceptee',
    parAgence: true,
  },
  {
    nomEvenement: 'Cas — AG programmée par une agence, à attribuer',
    traiteur: POTEL,
    type: AG,
    j: 19,
    heure: '20:30',
    lieu: 'lieu_champerret',
    pax: 650,
    statut: 'programmee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
    sansAttribution: true,
    parAgence: true,
  },

  // ── Annulations ─────────────────────────────────────────────────────────
  // « Annulation demandée » : depuis #703 l'annulation cliente est effective
  // sur-le-champ ; ces deux cas représentent les demandes encore ouvertes
  // (héritées), que l'Admin confirme.
  {
    nomEvenement: 'Cas — AG annulation demandée tardive (< 4 h)',
    traiteur: LENOTRE,
    type: AG,
    j: 0,
    heure: '23:00',
    lieu: 'lieu_palais_congres',
    pax: 380,
    statut: 'annulation_demandee',
    statutTms: 'acceptee',
    attributionValidee: true,
    annulationDemandee: { j: 0, heure: '21:00' },
  },
  {
    nomEvenement: 'Cas — ZD annulation demandée à temps',
    traiteur: POTEL,
    type: ZD,
    j: 6,
    heure: '22:00',
    lieu: 'lieu_porte_versailles',
    pax: 900,
    statut: 'annulation_demandee',
    statutTms: 'acceptee',
    annulationDemandee: { j: 0, heure: '08:00' },
  },
  {
    nomEvenement: 'Cas — ZD annulée par le traiteur',
    traiteur: BUTARD,
    type: ZD,
    j: -4,
    heure: '22:00',
    lieu: 'lieu_cnit',
    pax: 330,
    statut: 'annulee',
    statutTms: 'annulee_par_traiteur',
    annulationDemandee: { j: -6, heure: '10:00' },
  },
  {
    nomEvenement: 'Cas — AG annulée tardivement',
    traiteur: POTEL,
    type: AG,
    j: -2,
    heure: '22:30',
    lieu: 'lieu_rothschild',
    pax: 270,
    statut: 'annulee',
    statutTms: 'annulee_par_traiteur',
    attributionValidee: true,
    packDebite: true,
    annulationDemandee: { j: -2, heure: '20:30' },
  },
  {
    nomEvenement: 'Cas — AG annulée par Savr',
    traiteur: KASPIA,
    type: AG,
    j: 12,
    heure: '21:00',
    lieu: 'lieu_carrousel',
    pax: 310,
    statut: 'annulee',
    statutTms: 'non_envoye',
    sansPrestataire: true,
    sansAttribution: true,
    annuleeCoteSavrMotif: 'Doublon de programmation',
  },

  // ── Refus, exécution, réalisées ─────────────────────────────────────────
  {
    nomEvenement: 'Cas — ZD rejetée par le prestataire',
    traiteur: GRANDCHEMIN,
    type: ZD,
    j: 2,
    heure: '21:00',
    lieu: 'lieu_champerret',
    pax: 700,
    statut: 'rejetee_par_prestataire',
    statutTms: 'rejetee_par_prestataire',
    sansPrestataire: true,
  },
  {
    nomEvenement: 'Cas — AG en cours',
    traiteur: KASPIA,
    type: AG,
    j: 0,
    heure: '19:00',
    lieu: 'lieu_carrousel',
    pax: 500,
    statut: 'en_cours',
    statutTms: 'en_attente_execution',
  },
  {
    nomEvenement: 'Cas — ZD en cours, modifiée sans renvoi TMS',
    traiteur: POTEL,
    type: ZD,
    j: 0,
    heure: '21:30',
    lieu: 'lieu_palais_congres',
    pax: 1100,
    statut: 'en_cours',
    statutTms: 'en_attente_execution',
    dirtyTms: true,
  },
  {
    nomEvenement: 'Cas — ZD réalisée hier (embargo)',
    traiteur: LENOTRE,
    type: ZD,
    j: -1,
    heure: '23:00',
    lieu: 'lieu_trianon',
    pax: 650,
    statut: 'realisee',
    statutTms: 'acceptee',
  },
  {
    nomEvenement: 'Cas — AG réalisée hier midi',
    traiteur: FLEUR,
    type: AG,
    j: -1,
    heure: '15:00',
    lieu: 'lieu_carrousel',
    pax: 300,
    statut: 'realisee',
    statutTms: 'acceptee',
    association: 'asso_bravo',
    repas: 28,
  },
  {
    nomEvenement: 'Cas — AG sans excédent',
    traiteur: KASPIA,
    type: AG,
    j: -3,
    heure: '22:00',
    lieu: 'lieu_rothschild',
    pax: 200,
    statut: 'realisee_sans_collecte',
    statutTms: 'acceptee',
    motifAucunRepas: 'Aucun invendu : buffet intégralement consommé.',
  },

  // ── Clôturées ───────────────────────────────────────────────────────────
  {
    nomEvenement: 'Cas — ZD clôturée avec incident prestataire',
    traiteur: POTEL,
    type: ZD,
    j: -10,
    heure: '22:00',
    lieu: 'lieu_villepinte',
    pax: 1700,
    camions: 2,
    statut: 'cloturee',
    statutTms: 'acceptee',
    incident: {
      motif: 'Camion arrivé avec 2 h de retard.',
      imputable: 'prestataire',
    },
  },
  {
    nomEvenement: 'Cas — AG clôturée, gros don',
    traiteur: KASPIA,
    type: AG,
    j: -12,
    heure: '23:30',
    lieu: 'lieu_porte_versailles',
    pax: 3000,
    camions: 2,
    statut: 'cloturee',
    statutTms: 'acceptee',
    association: 'asso_charlie',
    repas: 420,
  },
  {
    nomEvenement: 'Cas — AG clôturée à midi',
    traiteur: BUTARD,
    type: AG,
    j: -8,
    heure: '12:30',
    lieu: 'lieu_convention_centre',
    pax: 120,
    statut: 'cloturee',
    statutTms: 'acceptee',
    association: 'asso_bravo',
    repas: 11,
    informationsSupplementaires: 'Déjeuner assis, service à l’assiette.',
  },
  {
    nomEvenement: 'Cas — AG Rouen clôturée',
    traiteur: CIRETTE,
    type: AG,
    j: -15,
    heure: '21:30',
    lieu: 'lieu_rouen_normandie',
    pax: 260,
    statut: 'cloturee',
    statutTms: 'acceptee',
    association: 'asso_echo',
    repas: 24,
  },
  {
    nomEvenement: 'Cas — ZD province Lille clôturée',
    traiteur: LENOTRE,
    type: ZD,
    j: -20,
    heure: '20:00',
    lieu: 'lieu_lille_grand_palais',
    pax: 900,
    statut: 'cloturee',
    statutTms: 'acceptee',
  },
  {
    nomEvenement: 'Cas — ZD clôturée avec notes internes',
    traiteur: GRANDCHEMIN,
    type: ZD,
    j: -25,
    heure: '18:00',
    lieu: 'lieu_ponctuel_4',
    pax: 400,
    statut: 'cloturee',
    statutTms: 'acceptee',
    notesInternes:
      'Pesée verre contestée par le client, recompté le lendemain.',
  },

  // ── Brouillon (invisible côté Admin, visible côté traiteur) ─────────────
  {
    nomEvenement: 'Cas — ZD brouillon',
    traiteur: BUTARD,
    type: ZD,
    j: 25,
    heure: '19:30',
    lieu: 'lieu_la_serre',
    pax: 300,
    statut: 'brouillon',
    statutTms: 'non_envoye',
    sansPrestataire: true,
  },
];

/** Collectes du catalogue, datées depuis l'ancre. */
export function genererCatalogueCas(ancre: string): CollecteCas[] {
  return CAS.map((c, i) => {
    const {
      j,
      annulationDemandee,
      camions,
      parAgence,
      informationsCompletes,
      controleAcces,
      dirtyTms,
      ...reste
    } = c;
    const date = decalerJour(ancre, j);
    const suffixe = c.type === 'zero_dechet' ? 'zd' : 'ag';
    const cas: CollecteCas = {
      ...reste,
      slug: `col_cas_${String(i + 1).padStart(2, '0')}_${suffixe}`,
      date,
      camions: camions ?? 1,
      parAgence: parAgence ?? false,
      informationsCompletes: informationsCompletes ?? true,
      controleAcces: controleAcces ?? false,
      dirtyTms: dirtyTms ?? false,
    };
    if (annulationDemandee) {
      cas.annulationDemandeeAt = instantParis(
        decalerJour(ancre, annulationDemandee.j),
        annulationDemandee.heure,
      ).toISOString();
    }
    // Infos d'accès envoyées la veille du jour du seed.
    if (controleAcces && c.nomEvenement.includes('infos envoyées')) {
      cas.infosAccesEnvoyeesAt = instantParis(
        decalerJour(ancre, -1),
        '10:00',
      ).toISOString();
    }
    return cas;
  });
}
