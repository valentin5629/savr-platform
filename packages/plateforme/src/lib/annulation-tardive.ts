import { instantParis } from '@savr/shared/src/temps/index.js';

// Seuil de l'annulation tardive, AG comme ZD (décision Val 2026-10-15, au lieu
// de 12h). Le trigger SQL de débit du pack porte le même : INTERVAL '4 hours'.
// Sans dépendance serveur : lu par l'alerte Admin (tpl 22) et par la fenêtre
// d'annulation des espaces clients.
export const SEUIL_ANNULATION_TARDIVE_HEURES = 4;

const HEURE_MS = 60 * 60 * 1000;

// True si l'annulation est « tardive » : moins de 4h avant le créneau
// (date_collecte + heure_collecte), strict. CDC §05. Pure, testable.
export function estAnnulationTardive(
  dateCollecte: string,
  heureCollecte: string | null | undefined,
  nowMs: number,
): boolean {
  if (!dateCollecte) return false;
  // Heure murale parisienne, comme le trigger SQL de débit du pack : sinon
  // l'alerte Admin peut annoncer « 4h ou plus » alors que le crédit a été débité.
  const creneau = instantParis(
    dateCollecte,
    heureCollecte && heureCollecte.length ? heureCollecte : '00:00:00',
  ).getTime();
  if (Number.isNaN(creneau)) return false;
  return creneau - nowMs < SEUIL_ANNULATION_TARDIVE_HEURES * HEURE_MS;
}
