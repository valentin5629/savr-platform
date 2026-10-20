// Écrans Événements du gestionnaire de lieux (§06.05 §2) — retirés le
// 2026-10-07 (doublon de la liste Collectes), remis par Val le 2026-10-18 pour
// donner une vision CONSOLIDÉE d'un événement sur lequel il y a plusieurs
// collectes.
//
// Ce module porte ce que la route de la liste, la route de la fiche et les deux
// écrans doivent calculer de la même façon : le bilan d'un événement, cumulé
// sur ses collectes. Fonctions pures, sans accès base.
//
// Règles du bilan, alignées sur celles des écrans existants pour qu'un même
// chiffre ne diffère jamais d'un écran à l'autre :
//  - seules les collectes RÉALISÉES (vue client : statut `cloturee`, cf.
//    STATUT_BILAN) portent des résultats — comme la colonne « Résultats » de la
//    liste Collectes et l'onglet Bilan de la fiche collecte, qui n'en montrent
//    aucun avant. Une collecte AG `realisee_sans_collecte` compte réalisée, avec
//    0 repas (« Sans excédent ») ;
//  - tonnage = Σ des pesées par flux ; taux de recyclage = moyenne des taux
//    figés de chaque collecte, PONDÉRÉE par son tonnage — la règle du dashboard
//    (`buildEvolutionSeries`) et de l'export Événements (§12 §2) ;
//  - CO₂ : valeurs figées à la clôture, sommées, jamais recalculées ;
//  - repas donnés = volume de l'attribution, lu par la vue
//    `v_attributions_gestionnaire` (une collecte d'un traiteur tiers n'est pas
//    lisible autrement par le rôle, C-1).

import { STATUT_BILAN } from '@/lib/collectes/fiche-client-types';
import { FLUX_ZD_CODES, type FluxZdCode } from '@/lib/libelles/flux';
import {
  statutEvenementConsolide,
  type StatutEvenementConsolide,
} from '@/lib/libelles/evenement';

/** Événements par page de la liste (même taille que la liste Collectes). */
export const EVENEMENTS_PAGE_SIZE = 50;

// Embed to-one PostgREST : objet ou tableau selon le cache de schéma.
export type UnOuListe<T> = T | T[] | null | undefined;
export function un<T>(v: UnOuListe<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Une collecte de l'événement, telle que les routes la lisent. */
export interface CollecteAConsolider {
  type: string;
  statut: string;
  date_collecte: string | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  collecte_flux?:
    | {
        poids_reel_kg: number | null;
        flux_dechets?: UnOuListe<{ code: string | null }>;
      }[]
    | null;
  attributions_antgaspi?: UnOuListe<{
    volume_repas_realise: number | null;
    association_id?: string | null;
    association_nom?: string | null;
    association_ville?: string | null;
  }>;
}

export interface AssociationBeneficiaire {
  /** Identifiant de l'association (son nom à défaut) : clé de la ligne. */
  id: string;
  nom: string;
  ville: string | null;
  repas: number;
}

/** Bilan d'un événement, cumulé sur ses collectes. */
export interface BilanEvenement {
  /** Toutes les collectes de l'événement, annulées comprises. */
  nb_collectes_zd: number;
  nb_collectes_ag: number;
  /** Collectes qui portent un résultat (cf. en-tête). */
  nb_realisees_zd: number;
  nb_realisees_ag: number;
  /** Dont collectes AG réalisées sans excédent (« Sans excédent », 0 repas). */
  nb_sans_excedent: number;
  /** null tant qu'aucune collecte ZD n'est réalisée. */
  tonnage_zd_kg: number | null;
  /** Σ par flux des collectes ZD réalisées (0 pour un flux jamais pesé). */
  flux_kg: Record<FluxZdCode, number>;
  taux_recyclage: number | null;
  co2_evite_zd_kg: number | null;
  /** null tant qu'aucune collecte AG n'est réalisée. */
  repas_donnes: number | null;
  co2_evite_ag_kg: number | null;
  associations: AssociationBeneficiaire[];
  premiere_collecte: string | null;
  derniere_collecte: string | null;
  statut_consolide: StatutEvenementConsolide;
}

const ZD = 'zero_dechet';
const AG = 'anti_gaspi';
const SANS_EXCEDENT = 'realisee_sans_collecte';

/** La collecte porte-t-elle un résultat (bilan disponible côté client) ? */
export function collecteRealisee(c: { type: string; statut: string }): boolean {
  return (
    c.statut === STATUT_BILAN || (c.type === AG && c.statut === SANS_EXCEDENT)
  );
}

/** Σ des pesées d'une collecte (une pesée absente compte 0). */
export function poidsCollecte(c: CollecteAConsolider): number {
  return (c.collecte_flux ?? []).reduce(
    (s, f) => s + (Number(f.poids_reel_kg) || 0),
    0,
  );
}

/** Repas donnés d'une collecte AG (0 sans attribution ni volume saisi). */
export function repasCollecte(c: CollecteAConsolider): number {
  if (c.statut === SANS_EXCEDENT) return 0;
  return Number(un(c.attributions_antgaspi)?.volume_repas_realise) || 0;
}

// Somme d'une valeur figée : null si aucune collecte ne la porte, pour que
// l'écran rende « — » plutôt qu'un 0 qui se lirait comme un résultat.
function sommeFigee(
  collectes: CollecteAConsolider[],
  valeur: (c: CollecteAConsolider) => number | null | undefined,
): number | null {
  let total: number | null = null;
  for (const c of collectes) {
    const v = valeur(c);
    if (v == null || !Number.isFinite(Number(v))) continue;
    total = (total ?? 0) + Number(v);
  }
  return total;
}

/** Bilan consolidé d'un événement à partir de ses collectes. */
export function consoliderEvenement(
  collectes: readonly CollecteAConsolider[],
): BilanEvenement {
  const zd = collectes.filter((c) => c.type === ZD);
  const ag = collectes.filter((c) => c.type === AG);
  const zdRealisees = zd.filter(collecteRealisee);
  const agRealisees = ag.filter(collecteRealisee);

  const flux = Object.fromEntries(FLUX_ZD_CODES.map((f) => [f, 0])) as Record<
    FluxZdCode,
    number
  >;
  let tonnage = 0;
  let tauxNum = 0;
  let tauxDen = 0;
  for (const c of zdRealisees) {
    for (const f of c.collecte_flux ?? []) {
      const code = un(f.flux_dechets)?.code;
      const kg = Number(f.poids_reel_kg) || 0;
      if (code && code in flux) flux[code as FluxZdCode] += kg;
    }
    const kg = poidsCollecte(c);
    tonnage += kg;
    if (c.taux_recyclage != null && kg > 0) {
      tauxNum += Number(c.taux_recyclage) * kg;
      tauxDen += kg;
    }
  }

  // Une ligne par association (une même association peut recevoir les dons de
  // plusieurs collectes de l'événement), reconnue par son identifiant — par son
  // nom à défaut ; ordre : la plus servie d'abord.
  const parAssociation = new Map<string, AssociationBeneficiaire>();
  for (const c of agRealisees) {
    const a = un(c.attributions_antgaspi);
    const nom = a?.association_nom?.trim();
    if (!nom || c.statut === SANS_EXCEDENT) continue;
    const cle = a?.association_id || nom;
    const deja = parAssociation.get(cle);
    if (deja) deja.repas += repasCollecte(c);
    else
      parAssociation.set(cle, {
        id: cle,
        nom,
        ville: a?.association_ville ?? null,
        repas: repasCollecte(c),
      });
  }

  const dates = collectes
    .map((c) => c.date_collecte)
    .filter((d): d is string => !!d)
    .sort();

  return {
    nb_collectes_zd: zd.length,
    nb_collectes_ag: ag.length,
    nb_realisees_zd: zdRealisees.length,
    nb_realisees_ag: agRealisees.length,
    nb_sans_excedent: agRealisees.filter((c) => c.statut === SANS_EXCEDENT)
      .length,
    tonnage_zd_kg: zdRealisees.length > 0 ? tonnage : null,
    flux_kg: flux,
    taux_recyclage: tauxDen > 0 ? tauxNum / tauxDen : null,
    co2_evite_zd_kg: sommeFigee(zdRealisees, (c) => c.co2_evite_kg),
    repas_donnes:
      agRealisees.length > 0
        ? agRealisees.reduce((s, c) => s + repasCollecte(c), 0)
        : null,
    co2_evite_ag_kg: sommeFigee(agRealisees, (c) => c.co2_evite_kg),
    associations: [...parAssociation.values()].sort(
      (a, b) => b.repas - a.repas || a.nom.localeCompare(b.nom, 'fr'),
    ),
    premiere_collecte: dates[0] ?? null,
    derniere_collecte: dates[dates.length - 1] ?? null,
    statut_consolide: statutEvenementConsolide(collectes),
  };
}

/** CO₂ évité total (ZD + AG), tel que la liste l'affiche. */
export function co2EviteTotal(b: BilanEvenement): number | null {
  if (b.co2_evite_zd_kg == null && b.co2_evite_ag_kg == null) return null;
  return (b.co2_evite_zd_kg ?? 0) + (b.co2_evite_ag_kg ?? 0);
}

/** Adresse du lieu sur une ligne (« 1 place de la Porte de Versailles 75015 Paris »). */
export function adresseLieu(
  l: {
    adresse_acces?: string | null;
    code_postal?: string | null;
    ville?: string | null;
  } | null,
): string | null {
  return (
    [l?.adresse_acces, l?.code_postal, l?.ville].filter(Boolean).join(' ') ||
    null
  );
}
