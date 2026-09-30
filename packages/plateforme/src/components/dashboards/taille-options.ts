import type { MultiOption } from './MultiSelectFilter.js';

// Brackets « Taille d'événement » calculés sur evenements.pax (§06.05 l.107 / l.559).
// Partagé par la barre de filtres globale (dashboard), l'encart benchmark et la
// liste Événements — source unique pour éviter la dérive des seuils. `court` =
// valeur affichée dans le déclencheur du filtre (« Taille d'événement  XL »).
export const TAILLE_OPTIONS: MultiOption[] = [
  { id: 'XS', nom: 'XS (< 250 pax)', court: 'XS' },
  { id: 'S', nom: 'S (250-499)', court: 'S' },
  { id: 'M', nom: 'M (500-749)', court: 'M' },
  { id: 'L', nom: 'L (750-999)', court: 'L' },
  { id: 'XL', nom: 'XL (≥ 1000)', court: 'XL' },
];
