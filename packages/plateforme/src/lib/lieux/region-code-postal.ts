// Région d'un lieu déduite de son code postal (choix C1, Val 2026-11-03) :
// département = 2 premiers caractères ; 75, 77, 78, 91, 92, 93, 94, 95 → idf,
// tout autre code postal non vide → province. Même règle dans l'algorithme
// d'attribution AG (migration 20261103170000), qui s'en sert quand la région
// du lieu est vide. Une région saisie reste prioritaire et n'est jamais écrasée.

export type RegionLieu = 'idf' | 'province';

const DEPARTEMENTS_IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];

export function regionDepuisCodePostal(codePostal: unknown): RegionLieu | null {
  if (typeof codePostal !== 'string') return null;
  const cp = codePostal.trim();
  if (!cp) return null;
  return DEPARTEMENTS_IDF.includes(cp.slice(0, 2)) ? 'idf' : 'province';
}

// Région à écrire à la création : celle reçue si elle est renseignée, sinon
// celle du code postal.
export function regionLieu(
  region: unknown,
  codePostal: unknown,
): RegionLieu | null {
  if (region === 'idf' || region === 'province') return region;
  return regionDepuisCodePostal(codePostal);
}
