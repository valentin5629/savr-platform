import { NextResponse } from 'next/server';

// Client final obligatoire pour tous les rôles (décision Val 2026-10-30) :
// exigé à la confirmation d'une programmation (pas en brouillon, comme le nom
// de l'événement) et jamais vidé par une modification. Un événement ancien
// sans client final reste modifiable tant que ce champ n'est pas envoyé.

export const MESSAGE_CLIENT_FINAL_OBLIGATOIRE =
  'Le client final est obligatoire.';

export function clientFinalRenseigne(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/** 422 si `updates` porte un client final vide ; sinon null. */
export function refusClientFinalVide(
  updates: Record<string, unknown>,
): NextResponse | null {
  if (
    Object.hasOwn(updates, 'nom_client_organisateur') &&
    !clientFinalRenseigne(updates.nom_client_organisateur)
  ) {
    return NextResponse.json(
      {
        error: MESSAGE_CLIENT_FINAL_OBLIGATOIRE,
        champ: 'nom_client_organisateur',
      },
      { status: 422 },
    );
  }
  return null;
}
