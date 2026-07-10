/**
 * Référence courte d'une collecte pour l'affichage (sous-titre fiche, traçabilité
 * support). CDC §06.04 l.381 : « Ancien titre = numéro de collecte
 * (`collectes.tms_reference` ou `id` court) → … reste affiché en sous-titre discret
 * pour traçabilité support ». On préfère la référence TMS lisible quand elle existe ;
 * sinon on abrège l'UUID technique (jamais l'UUID brut à l'écran, BL-P3-03).
 */
export function refCourteCollecte(c: {
  tms_reference?: string | null;
  id: string;
}): string {
  const tms = c.tms_reference?.trim();
  if (tms) return tms;
  // UUID court : 8 premiers caractères hexadécimaux, en majuscules (lisibilité).
  return c.id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
