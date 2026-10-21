import { NextResponse } from 'next/server';

import { PAX_COLLECTE_MAX } from './pax-collecte-borne';

// ─── Pax porté par la collecte (décision Val 2026-10-20) ─────────────────────
//
// Chaque collecte porte son nombre de convives (`collectes.pax`), saisi avec sa
// date de collecte. Le pax de l'événement en est CALCULÉ en base
// (`plateforme.f_pax_evenement`, déclencheur `trg_set_pax_evenement`) selon la
// règle C1 de Val : pour chaque jour de collecte, le plus grand pax des
// collectes non annulées de ce jour, puis la somme des jours. Une ZD et une AG
// du même soir comptent donc une fois ; deux soirées s'additionnent.

/** Entier de 1 à PAX_COLLECTE_MAX (plafond métier), comme les gardes en base. */
export function paxCollecteValide(valeur: unknown): valeur is number {
  return (
    typeof valeur === 'number' &&
    Number.isInteger(valeur) &&
    valeur >= 1 &&
    valeur <= PAX_COLLECTE_MAX
  );
}

/** `null` si la valeur est valide, sinon la réponse 422 à renvoyer telle quelle. */
export function refusPaxCollecte(valeur: unknown): NextResponse | null {
  if (paxCollecteValide(valeur)) return null;
  return NextResponse.json(
    {
      error:
        'Saisie invalide : nombre de convives (obligatoire, nombre entier de 1 à 100 000).',
      champs_invalides: ['pax'],
    },
    { status: 422 },
  );
}
