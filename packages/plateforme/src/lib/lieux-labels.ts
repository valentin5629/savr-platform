// Enums `lieux` (§04) en libellés lisibles — source unique des écrans qui les
// affichent (fiche collecte Admin, fiche collecte traiteur ; référentiels Admin
// lieux/transporteurs à brancher après la PR #418 Data Table).

/** `plateforme.difficulte_acces_enum` — `acces_office`, `stationnement`. */
export const DIFFICULTE_LABEL: Record<string, string> = {
  facile: 'Facile',
  difficile: 'Difficile',
  tres_difficile: 'Très difficile',
};

/** Pastille DS par difficulté (facile → success … très difficile → error). */
export const DIFFICULTE_VARIANT: Record<
  string,
  'success' | 'warning' | 'error'
> = {
  facile: 'success',
  difficile: 'warning',
  tres_difficile: 'error',
};

/** `plateforme.type_vehicule_enum` — `type_vehicule_max`, `type_vehicule`. */
export const VEHICULE_LABEL: Record<string, string> = {
  velo_cargo: 'Vélo cargo',
  camionnette: 'Camionnette',
  fourgon: 'Fourgon',
  vul: 'VUL',
  poids_lourd: 'Poids lourd',
};
