// ─── SIRET d'une organisation : contrôle de FORMAT seul ─────────────────────
//
// CDC §06.06 (modale « Nouvelle organisation », ligne SIRET) : « contrôle de
// format seul (14 chiffres, espaces tolérés puis retirés), comme la fiche
// organisation — aucun appel INSEE sur organisations.siret ». La vérification
// INSEE porte exclusivement sur `entites_facturation.siret` (qui gate la
// facturation) — ne pas en ajouter ici.
//
// Module pur (aucun import serveur) : utilisable par les routes ET par l'UI.

export type SiretOrganisationNormalise =
  | { readonly valide: true; readonly siret: string | null }
  | { readonly valide: false };

/**
 * Normalise une saisie de SIRET d'organisation.
 *  - `null`, `''` ou blancs seuls ⇒ `null` (champ facultatif) ;
 *  - sinon tous les blancs sont retirés (espaces, espaces insécables, tabulations)
 *    et le résultat doit faire exactement 14 chiffres ASCII ;
 *  - tout autre type (nombre, booléen, objet) est invalide : un nombre perdrait
 *    les zéros de tête d'un SIRET.
 * `undefined` (champ absent du body) est à traiter par l'appelant AVANT l'appel.
 */
export function normaliserSiretOrganisation(
  valeur: unknown,
): SiretOrganisationNormalise {
  if (valeur === null) return { valide: true, siret: null };
  if (typeof valeur !== 'string') return { valide: false };
  const compact = valeur.replace(/\s/g, '');
  if (compact === '') return { valide: true, siret: null };
  return /^[0-9]{14}$/.test(compact)
    ? { valide: true, siret: compact }
    : { valide: false };
}

export const MESSAGE_SIRET_INVALIDE =
  'Saisie invalide : SIRET (14 chiffres attendus, espaces tolérés).';
