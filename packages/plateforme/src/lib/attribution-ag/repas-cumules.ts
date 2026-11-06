import { decalerJour, instantParis } from '@savr/shared/src/temps/index.js';

// Repas cumulés d'une association autour du créneau d'une collecte AG (compteur
// « repas cumulés / capacité bénéficiaire » de l'attribution, décision Val
// 2026-10-27) : collectes attribuées à l'association dont le créneau tombe à
// 12 h au plus avant ou après celui de la collecte, la collecte elle-même
// exclue (elle n'a encore rien donné). Volume réalisé s'il est connu, sinon estimé ; collectes
// annulées, rejetées ou en brouillon exclues ; « sans excédent » compte 0.

export const DEMI_FENETRE_MS = 12 * 60 * 60 * 1000;

const STATUTS_EXCLUS = new Set([
  'brouillon',
  'annulee',
  'rejetee_par_prestataire',
]);

export interface CollecteCible {
  id: string;
  date_collecte: string;
  heure_collecte: string | null;
}

export interface AttributionVoisine {
  association_id: string;
  volume_repas_realise: number | null;
  collecte: {
    id: string;
    statut: string;
    date_collecte: string;
    heure_collecte: string | null;
    volume_estime_repas: number | null;
  };
}

/** Jours à lire pour couvrir ±12 h autour du créneau (veille, jour, lendemain). */
export function joursFenetre(cible: CollecteCible): [string, string] {
  return [
    decalerJour(cible.date_collecte, -1),
    decalerJour(cible.date_collecte, 1),
  ];
}

function instantCreneau(date: string, heure: string | null): number {
  return instantParis(date, (heure ?? '00:00').slice(0, 5)).getTime();
}

/** Repas des AUTRES collectes de la fenêtre, par association (id → repas). */
export function repasCumulesParAssociation(
  cible: CollecteCible,
  voisines: AttributionVoisine[],
): Map<string, number> {
  const t0 = instantCreneau(cible.date_collecte, cible.heure_collecte);
  const cumul = new Map<string, number>();
  for (const v of voisines) {
    const c = v.collecte;
    if (c.id === cible.id || STATUTS_EXCLUS.has(c.statut)) continue;
    const t = instantCreneau(c.date_collecte, c.heure_collecte);
    if (Math.abs(t - t0) > DEMI_FENETRE_MS) continue;
    const repas =
      c.statut === 'realisee_sans_collecte'
        ? 0
        : (v.volume_repas_realise ?? c.volume_estime_repas ?? 0);
    cumul.set(v.association_id, (cumul.get(v.association_id) ?? 0) + repas);
  }
  return cumul;
}
