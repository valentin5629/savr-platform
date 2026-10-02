/**
 * Compteur de résultats d'une liste (R-UI-4b, D5) — formulation unique du pied
 * de `FilterBar` : « N <objets> correspondent à votre sélection ». Avant :
 * « N organisations », « N lieux », « N lignes »… une formulation par écran.
 * Pluriel à partir de 2 (règle française : « 0 facture correspond »).
 */
export function compteurResultats(
  total: number,
  singulier: string,
  pluriel: string,
): string {
  const plusieurs = total > 1;
  return `${total} ${plusieurs ? pluriel : singulier} correspond${
    plusieurs ? 'ent' : ''
  } à votre sélection`;
}
