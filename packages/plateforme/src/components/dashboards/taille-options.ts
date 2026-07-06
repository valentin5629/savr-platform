import type { MultiOption } from './MultiSelectFilter.js';

// Brackets « Taille d'événement » calculés sur evenements.pax (§06.05 l.107 / l.559).
// Partagé par la barre de filtres globale (dashboard), l'encart benchmark et la
// liste Événements — source unique pour éviter la dérive des seuils.
export const TAILLE_OPTIONS: MultiOption[] = [
  { id: 'XS', nom: 'XS (< 250 pax)' },
  { id: 'S', nom: 'S (250-499)' },
  { id: 'M', nom: 'M (500-749)' },
  { id: 'L', nom: 'L (750-999)' },
  { id: 'XL', nom: 'XL (≥ 1000)' },
];
