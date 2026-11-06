/**
 * Quel transporteur du seed prend quel type de collecte (Val 2026-10-27).
 *
 * Strike ne fait que du Zéro Déchet ; Marathon, Transnormandie, A Toutes! et
 * « Presta sans code » ne font que de l'Anti-Gaspi. La fiche collecte Admin ne
 * propose que les transporteurs qui prennent le type de la collecte, et l'algo
 * AG ne retient que les prestataires dont `type_prestation` contient `ag`. Sans
 * cette règle, le seed posait les prestataires en alternance et créait des
 * centaines de collectes sur un transporteur qui ne les prend pas (mesuré sur
 * savr-dev le 2026-10-27).
 *
 * Source unique pour `seed_demo` et `seed_minimal`, contrôlée par `seed:check`.
 */

export type TypeCollecte = 'zero_dechet' | 'anti_gaspi';

/** Prestataires du seed qui reçoivent des collectes (slug sans `prest_`). */
export type PrestataireSeed = 'strike' | 'marathon' | 'transnormandie';

/** Flux pris en charge, par slug de transporteur (sans `transp_`). */
export const TYPES_COLLECTE_TRANSPORTEUR: Record<string, TypeCollecte[]> = {
  strike: ['zero_dechet'],
  marathon: ['anti_gaspi'],
  transnor: ['anti_gaspi'],
  a_toutes: ['anti_gaspi'],
  sans_code: ['anti_gaspi'],
};

/** Même règle, côté `shared.prestataires.type_prestation` (`zd` / `ag`). */
export function typePrestation(transporteurSlug: string): string[] {
  const types = TYPES_COLLECTE_TRANSPORTEUR[transporteurSlug];
  if (!types)
    throw new Error(`transporteur du seed inconnu : ${transporteurSlug}`);
  return types.map((t) => (t === 'zero_dechet' ? 'zd' : 'ag'));
}

/** Transporteur (slug sans `transp_`) rattaché à chaque prestataire du seed. */
export const TRANSPORTEUR_DU_PRESTATAIRE: Record<PrestataireSeed, string> = {
  strike: 'strike',
  marathon: 'marathon',
  transnormandie: 'transnor',
};

/**
 * Prestataire d'une collecte : une ZD va chez Strike, une AG chez
 * Transnormandie en province (Rouen) et chez Marathon ailleurs.
 */
export function prestatairePourCollecte(
  type: TypeCollecte,
  province: boolean,
): PrestataireSeed {
  if (type === 'zero_dechet') return 'strike';
  return province ? 'transnormandie' : 'marathon';
}

/** Vrai si le prestataire prend ce type de collecte. */
export function prestatairePrend(
  prestataire: PrestataireSeed,
  type: TypeCollecte,
): boolean {
  return TYPES_COLLECTE_TRANSPORTEUR[
    TRANSPORTEUR_DU_PRESTATAIRE[prestataire]
  ]!.includes(type);
}

/**
 * Statuts d'une collecte dont l'attribution AG est forcément validée : en
 * production, l'attribution naît validée (`valide_at = now()` dans la RPC de
 * dispatch) et la collecte ne passe `validee` qu'après.
 */
export const STATUTS_ATTRIBUTION_VALIDEE = [
  'validee',
  'en_cours',
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
] as const;
