// Enums `lieux` (§04) en libellés lisibles — source unique des écrans qui les
// affichent (fiche collecte Admin, fiche collecte traiteur ; référentiels Admin
// lieux/transporteurs, fiches lieu / transporteur — R-UI-2 C10).
import type { Database } from '@savr/shared/src/database.types.js';

type Enums = Database['plateforme']['Enums'];

/** `plateforme.difficulte_acces_enum` — `acces_office`, `stationnement`. */
export const DIFFICULTE_LABEL: Record<string, string> = {
  facile: 'Facile',
  difficile: 'Difficile',
  tres_difficile: 'Très difficile',
} satisfies Record<Enums['acces_difficulte'], string>;

/** `plateforme.region` — `lieux.region`. */
export const REGION_LABEL: Record<string, string> = {
  idf: 'Île-de-France',
  province: 'Province',
} satisfies Record<Enums['region'], string>;

/** Pastille DS par difficulté (facile → success … très difficile → error). */
export const DIFFICULTE_VARIANT: Record<
  string,
  'success' | 'warning' | 'error'
> = {
  facile: 'success',
  difficile: 'warning',
  tres_difficile: 'error',
} satisfies Record<Enums['acces_difficulte'], 'success' | 'warning' | 'error'>;

// `plateforme.type_vehicule` : libellés partagés avec l'adapter MTS-1 (nom de
// l'article camion), cf. @savr/shared/src/vehicules.
export { VEHICULE_LABEL } from '@savr/shared/src/vehicules/index.js';

/**
 * Gabarits proposés pour un lieu (véhicule max) et un transporteur : l'échelle
 * de taille de l'algorithme AG. Les gabarits du véhicule souhaité (Val
 * 2026-11-10) n'y entrent pas.
 */
export const GABARITS_LIEU_TRANSPORTEUR = [
  'velo_cargo',
  'camionnette',
  'fourgon',
  'vul',
  'poids_lourd',
] as const satisfies readonly Enums['type_vehicule'][];

/** Valeur admise pour `lieux.type_vehicule_max`. */
export function estGabaritLieuTransporteur(v: unknown): boolean {
  return (GABARITS_LIEU_TRANSPORTEUR as readonly unknown[]).includes(v);
}

/** Valeur admise pour `transporteurs.types_vehicules` (tableau de gabarits). */
export function sontGabaritsLieuTransporteur(v: unknown): boolean {
  return Array.isArray(v) && v.every(estGabaritLieuTransporteur);
}

export const MESSAGE_GABARIT_INVALIDE = `Type de véhicule invalide (attendu : ${GABARITS_LIEU_TRANSPORTEUR.join(', ')})`;
