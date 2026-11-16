import type { Database } from '../database.types.js';

type TypeVehicule = Database['plateforme']['Enums']['type_vehicule'];

/**
 * `plateforme.type_vehicule` — libellé de toute valeur (`type_vehicule_max`,
 * `types_vehicules`, `type_vehicule`, `type_vehicule_souhaite`). Source unique
 * des écrans et du nom de l'article camion d'une commande MTS-1 zéro déchet
 * (décision Val 2026-11-16 : le libellé de l'écran, tel que l'Admin l'a choisi).
 */
export const VEHICULE_LABEL: Record<string, string> = {
  velo_cargo: 'Vélo cargo',
  camionnette: 'Camionnette',
  fourgon: 'Fourgon',
  vul: 'VUL',
  poids_lourd: 'Poids lourd',
  camionnette_frigo: 'Camionnette frigo',
  camion_frigo: 'Camion frigo',
  camion_16m3_simple: '16 m³ simple',
  camion_16m3_double: '16 m³ double',
  camion_20m3_simple: '20 m³ simple',
  camion_20m3_double: '20 m³ double',
} satisfies Record<TypeVehicule, string>;
