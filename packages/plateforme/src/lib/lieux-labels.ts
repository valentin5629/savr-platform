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

/** `plateforme.type_vehicule_enum` — `type_vehicule_max`, `type_vehicule`. */
export const VEHICULE_LABEL: Record<string, string> = {
  velo_cargo: 'Vélo cargo',
  camionnette: 'Camionnette',
  fourgon: 'Fourgon',
  vul: 'VUL',
  poids_lourd: 'Poids lourd',
} satisfies Record<Enums['type_vehicule'], string>;
