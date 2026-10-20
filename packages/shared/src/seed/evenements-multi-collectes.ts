/**
 * Événements multi-collectes de seed_demo — des événements passés, terminés,
 * qui portent chacun plusieurs collectes ZD et AG.
 *
 * Pourquoi : chaque ligne de la matrice CSV et du pipeline vivant crée son
 * propre événement (1 événement = 1 collecte). Les écrans qui cumulent les
 * collectes d'un événement (page Événements du gestionnaire, export
 * Événements) n'avaient donc rien à cumuler. Demande de Val du 2026-10-20 :
 * pouvoir tester l'agrégation au niveau de l'événement. Le catalogue des
 * fixtures prévoit d'ailleurs « qq événements multi-collectes »
 * (`specs/fixtures/01 - Catalogue`).
 *
 * Chaque événement isole un cas du bilan consolidé
 * (`packages/plateforme/src/lib/evenements-gestionnaire.ts`) :
 *  - sur plusieurs jours, la même association servie deux fois (une seule ligne
 *    d'association, repas additionnés) ;
 *  - deux associations, une par soir ;
 *  - le cas simple, 1 ZD + 1 AG le même soir ;
 *  - une AG « sans excédent » (réalisée, 0 repas, sans association), événement
 *    programmé par une agence ;
 *  - dominante AG, trois associations, sur un lieu d'un autre gestionnaire ;
 *  - ZD seul, dont une collecte annulée (comptée, sans résultat) ;
 *  - AG seul, sans client organisateur.
 *
 * Les valeurs sont écrites en clair (pas de tirage) pour que le résultat
 * attendu à l'écran se lise ici. Dates relatives à l'ancre, toutes avant J-8 :
 * comme l'historique comblé du pipeline vivant, ces collectes sont clôturées.
 */

import { decalerJour } from '../temps/index.js';
import type { CollecteVivante } from './pipeline-vivant.js';

export type EvenementMultiCollectes = {
  slug: string;
  nom: string;
  /** slug d'organisation traiteur (`org_tr_*`) : traiteur opérationnel. */
  traiteur: string;
  /** Programmé par l'agence Caromy (donneur d'ordre) plutôt que le traiteur. */
  parAgence: boolean;
  lieu: string;
  /** code `types_evenements`. */
  typeEvenement: 'cocktail_repas_complet' | 'repas_assis';
  /** Jour de la première collecte non annulée (cf. `fn_set_date_evenement`). */
  date: string;
  pax: number;
  client: string | null;
};

export type CollecteEvenementMulti = CollecteVivante & {
  /** slug de l'événement porteur. */
  evenement: string;
  /** AG : association bénéficiaire (slug `asso_*`). */
  association?: string;
  /** AG : repas réellement donnés (attribution, puis attestation). */
  repas?: number;
};

type DefCollecte = {
  type: 'zero_dechet' | 'anti_gaspi';
  /** Décalage en jours par rapport au premier jour de l'événement. */
  jour?: number;
  /** Pax servis par cette collecte : base des pesées ZD. */
  pax: number;
  camions?: number;
  statut?: 'cloturee' | 'realisee_sans_collecte' | 'annulee';
  association?: string;
  repas?: number;
  motifAucunRepas?: string;
};

type DefEvenement = Omit<EvenementMultiCollectes, 'date'> & {
  /** Premier jour de l'événement, en jours avant l'ancre. */
  ilYa: number;
  collectes: DefCollecte[];
};

const DEFINITIONS: DefEvenement[] = [
  {
    slug: 'evt_multi_salon_habitat',
    nom: 'Salon Habitat & Design',
    traiteur: 'org_tr_kaspia',
    parAgence: false,
    lieu: 'lieu_porte_versailles',
    typeEvenement: 'cocktail_repas_complet',
    pax: 2400,
    client: 'Groupe Zéphirane',
    ilYa: 41,
    collectes: [
      { type: 'zero_dechet', jour: 0, pax: 800 },
      {
        type: 'anti_gaspi',
        jour: 0,
        pax: 800,
        association: 'asso_alpha',
        repas: 95,
      },
      { type: 'zero_dechet', jour: 1, pax: 800 },
      { type: 'zero_dechet', jour: 2, pax: 800 },
      {
        type: 'anti_gaspi',
        jour: 2,
        pax: 800,
        association: 'asso_alpha',
        repas: 70,
      },
    ],
  },
  {
    slug: 'evt_multi_congres_sante',
    nom: 'Congrès Santé Numérique',
    traiteur: 'org_tr_potel',
    parAgence: false,
    lieu: 'lieu_palais_congres',
    typeEvenement: 'cocktail_repas_complet',
    pax: 1800,
    client: 'Laboratoires Sénéor',
    ilYa: 26,
    collectes: [
      { type: 'zero_dechet', jour: 0, pax: 900 },
      {
        type: 'anti_gaspi',
        jour: 0,
        pax: 900,
        association: 'asso_alpha',
        repas: 110,
      },
      { type: 'zero_dechet', jour: 1, pax: 900 },
      {
        type: 'anti_gaspi',
        jour: 1,
        pax: 900,
        association: 'asso_charlie',
        repas: 85,
      },
    ],
  },
  {
    slug: 'evt_multi_gala_horizon',
    nom: 'Gala Fondation Horizon',
    traiteur: 'org_tr_lenotre',
    parAgence: false,
    lieu: 'lieu_champerret',
    typeEvenement: 'repas_assis',
    pax: 600,
    client: 'Fondation Avelune',
    ilYa: 12,
    collectes: [
      { type: 'zero_dechet', pax: 600 },
      { type: 'anti_gaspi', pax: 600, association: 'asso_bravo', repas: 48 },
    ],
  },
  {
    slug: 'evt_multi_forum_ingenieurs',
    nom: 'Forum Ingénieurs & Industrie',
    traiteur: 'org_tr_fleurdemets',
    parAgence: true,
    lieu: 'lieu_cnit',
    typeEvenement: 'cocktail_repas_complet',
    pax: 1100,
    client: 'Institut Kervalen',
    ilYa: 54,
    collectes: [
      // Deux collectes ZD le même soir : salle plénière et espace exposants.
      { type: 'zero_dechet', pax: 550 },
      { type: 'zero_dechet', pax: 550 },
      { type: 'anti_gaspi', pax: 550, association: 'asso_charlie', repas: 60 },
      {
        type: 'anti_gaspi',
        pax: 550,
        statut: 'realisee_sans_collecte',
        association: 'asso_bravo',
        repas: 0,
        motifAucunRepas:
          'Aucun invendu : cocktail déjeunatoire intégralement consommé.',
      },
    ],
  },
  {
    slug: 'evt_multi_festival_gastronomie',
    nom: 'Festival Gastronomie de Paris',
    traiteur: 'org_tr_butard',
    parAgence: false,
    lieu: 'lieu_arts_forains',
    typeEvenement: 'cocktail_repas_complet',
    pax: 1500,
    client: 'Maison Halbrenne',
    ilYa: 33,
    collectes: [
      { type: 'zero_dechet', jour: 0, pax: 1500 },
      {
        type: 'anti_gaspi',
        jour: 0,
        pax: 750,
        association: 'asso_alpha',
        repas: 80,
      },
      {
        type: 'anti_gaspi',
        jour: 1,
        pax: 750,
        association: 'asso_bravo',
        repas: 55,
      },
      {
        type: 'anti_gaspi',
        jour: 1,
        pax: 750,
        association: 'asso_charlie',
        repas: 40,
      },
    ],
  },
  {
    slug: 'evt_multi_convention_atlas',
    nom: 'Convention annuelle Atlas',
    traiteur: 'org_tr_grandchemin',
    parAgence: false,
    lieu: 'lieu_villepinte',
    typeEvenement: 'cocktail_repas_complet',
    pax: 3200,
    client: 'Banque Montclar',
    ilYa: 68,
    collectes: [
      { type: 'zero_dechet', jour: 0, pax: 1600, camions: 2 },
      { type: 'zero_dechet', jour: 1, pax: 1600, camions: 2 },
      // Collecte du démontage, annulée par le traiteur : comptée dans
      // l'événement, sans résultat.
      { type: 'zero_dechet', jour: 1, pax: 400, statut: 'annulee' },
    ],
  },
  {
    slug: 'evt_multi_diner_mecenes',
    nom: 'Dîner des mécènes',
    traiteur: 'org_tr_kaspia',
    parAgence: false,
    lieu: 'lieu_rothschild',
    typeEvenement: 'repas_assis',
    pax: 420,
    client: null,
    ilYa: 19,
    collectes: [
      { type: 'anti_gaspi', pax: 420, association: 'asso_alpha', repas: 30 },
      { type: 'anti_gaspi', pax: 420, association: 'asso_charlie', repas: 22 },
    ],
  },
];

/** Événements multi-collectes et leurs collectes, datés depuis l'ancre. */
export function genererEvenementsMultiCollectes(ancre: string): {
  evenements: EvenementMultiCollectes[];
  collectes: CollecteEvenementMulti[];
} {
  const evenements: EvenementMultiCollectes[] = [];
  const collectes: CollecteEvenementMulti[] = [];
  for (const { ilYa, collectes: defs, ...evenement } of DEFINITIONS) {
    const premierJour = decalerJour(ancre, -ilYa);
    evenements.push({ ...evenement, date: premierJour });
    defs.forEach((d, k) => {
      const statut = d.statut ?? 'cloturee';
      collectes.push({
        slug: `col_${evenement.slug.replace(/^evt_/, '')}_${k + 1}`,
        evenement: evenement.slug,
        traiteur: evenement.traiteur,
        type: d.type,
        date: decalerJour(premierJour, d.jour ?? 0),
        lieu: evenement.lieu,
        pax: d.pax,
        camions: d.camions ?? 1,
        statut,
        statutTms: statut === 'annulee' ? 'annulee_par_traiteur' : 'acceptee',
        ...(d.association ? { association: d.association } : {}),
        ...(d.repas !== undefined ? { repas: d.repas } : {}),
        ...(d.motifAucunRepas ? { motifAucunRepas: d.motifAucunRepas } : {}),
      });
    });
  }
  return { evenements, collectes };
}
