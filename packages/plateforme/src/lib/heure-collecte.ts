import { NextResponse } from 'next/server';

// ─── Format d'ENTRÉE de `collectes.heure_collecte` ───────────────────────────
//
// La colonne est `time NOT NULL`, écrite par `fn_creer_collecte` (paramètre
// `time`) et `fn_modifier_collecte` (`(p_updates->>'heure_collecte')::time`).
// Les routes ne vérifiaient que la PRÉSENCE du champ : une valeur malformée
// (« abc », « 25:00 », un nombre) ou vide en modification échouait au cast ou
// sur le NOT NULL, et remontait en 500 — après rollback de l'événement côté
// programmation. Ce contrôle la refuse en 422, avant tout appel base.
//
// Format seul : `HH:MM` ou `HH:MM:SS`, 00:00 → 23:59. La grille de 15 min
// (CDC §06.01 « Time picker (pas de 15min) ») est une contrainte de SAISIE,
// portée par le TimePicker : elle n'est PAS imposée ici, sinon les heures
// historiques hors grille (migration Bubble, ex. 10:10) deviendraient
// impossibles à réenregistrer telles quelles.
const HEURE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function heureCollecteValide(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && HEURE.test(valeur);
}

/** `null` si la valeur est valide, sinon la réponse 422 à renvoyer telle quelle. */
export function refusHeureCollecte(valeur: unknown): NextResponse | null {
  if (heureCollecteValide(valeur)) return null;
  return NextResponse.json(
    {
      error:
        'Saisie invalide : heure_collecte (obligatoire, format HH:MM, de 00:00 à 23:59).',
      champs_invalides: ['heure_collecte'],
    },
    { status: 422 },
  );
}
