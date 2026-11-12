// Template PDF — Rapport de recyclage cumulé sur un événement (Zéro Déchet).
//
// Fabriqué au clic depuis la fiche événement (décision Val 2026-10-26), jamais
// stocké, sur les chiffres CUMULÉS des collectes ZD réalisées de l'événement
// (mêmes règles que le bilan consolidé de l'écran).
//
// @2 (2026-11-12) : même gabarit que le rapport d'une collecte (@4, maquettes
// Claude Design v76), décisions Val du 2026-11-12 :
//  - le radar, au choix du demandeur, compare l'événement entier ;
//  - l'annexe liste les numéros de bordereau de toutes les collectes cumulées ;
//  - l'exutoire de chaque flux est celui du référentiel (le même pour toutes
//    les collectes).
// Plus de CO₂ net ni de tableau des collectes.

import {
  esc,
  renderRapportRecyclageZd,
  type RapportRecyclageZdData,
} from './rapport-recyclage-zd.js';

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-recyclage-evenement'] du contrat partagé
// (@savr/shared). Vérifié par check:pdf-contract.
export const TEMPLATE_VERSION = 'rapport-recyclage-evenement@2';

/** Bordereau de pesée d'une collecte cumulée (dernière version). */
export interface BordereauCumule {
  numero: string;
  /** « JJ/MM/AAAA ». */
  date_emission: string;
}

export interface RapportRecyclageEvenementData extends Omit<
  RapportRecyclageZdData,
  'bordereau_numero' | 'bordereau_date_emission' | 'caps_appliques'
> {
  /** « Cumul des 2 collectes réalisées, sur 3 collectes de l'événement. » */
  couverture: string;
  /** Dans l'ordre des collectes ; une collecte sans bordereau n'y figure pas. */
  bordereaux: BordereauCumule[];
  /** Σ des forfaits transport figés de chaque collecte, en kg CO₂e. */
  majoration_transport_kg?: number | null;
}

/** « Bordereau n° X · Date d'émission : D » ou « Bordereaux n° X du D1 · Y du D2 ». */
function ligneBordereaux(bordereaux: BordereauCumule[]): string {
  if (bordereaux.length === 0) return '';
  if (bordereaux.length === 1) {
    const [b] = bordereaux as [BordereauCumule];
    return `Bordereau n° ${esc(b.numero)} · Date d'émission : ${esc(b.date_emission)}`;
  }
  // Un numéro et sa date ne se séparent jamais en fin de ligne.
  return `Bordereaux n° ${bordereaux
    .map(
      (b) =>
        `<span style="white-space:nowrap">${esc(b.numero)} du ${esc(b.date_emission)}</span>`,
    )
    .join(' · ')}`;
}

export function renderRapportRecyclageEvenement(
  data: RapportRecyclageEvenementData,
): string {
  const bordereaux = ligneBordereaux(data.bordereaux ?? []);
  return renderRapportRecyclageZd(
    // Les taux de captation diffèrent d'une collecte à l'autre : pas de détail
    // de captation sous la méthodologie d'un cumul.
    {
      ...data,
      caps_appliques: null,
      bordereau_numero: '',
      bordereau_date_emission: '',
    },
    {
      surTitre: 'RAPPORT DE RECYCLAGE · BILAN DE L’ÉVÉNEMENT',
      votre: 'Votre événement',
      references: [esc(data.couverture), bordereaux]
        .filter(Boolean)
        .join('<br>'),
      forfaitParCollecte: true,
      majorationTransportKg: data.majoration_transport_kg ?? null,
    },
  );
}
