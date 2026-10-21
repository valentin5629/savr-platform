import { NextResponse } from 'next/server';

// ─── Pax porté par la collecte (décision Val 2026-10-20) ─────────────────────
//
// Chaque collecte porte son nombre de convives (`collectes.pax`), saisi avec sa
// date de collecte. Le pax de l'événement en est CALCULÉ en base
// (`plateforme.f_pax_evenement`, déclencheur `trg_set_pax_evenement`) selon la
// règle C1 de Val : pour chaque jour de collecte, le plus grand pax des
// collectes non annulées de ce jour, puis la somme des jours. Une ZD et une AG
// du même soir comptent donc une fois ; deux soirées s'additionnent.

/** Entier >= 1 (borne haute = entier SQL), comme la garde de `fn_modifier_collecte`. */
export function paxCollecteValide(valeur: unknown): valeur is number {
  return (
    typeof valeur === 'number' &&
    Number.isInteger(valeur) &&
    valeur >= 1 &&
    valeur <= 2_147_483_647
  );
}

/** `null` si la valeur est valide, sinon la réponse 422 à renvoyer telle quelle. */
export function refusPaxCollecte(valeur: unknown): NextResponse | null {
  if (paxCollecteValide(valeur)) return null;
  return NextResponse.json(
    {
      error:
        'Saisie invalide : nombre de convives (obligatoire, nombre entier supérieur ou égal à 1).',
      champs_invalides: ['pax'],
    },
    { status: 422 },
  );
}
