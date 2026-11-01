import { NextResponse } from 'next/server';

// Annulation d'une collecte par un client (traiteur, agence, gestionnaire de
// lieux). La RPC fn_annuler_collecte_client relit le statut sous le verrou de la
// collecte : si la relève l'a fait passer en cours (ou au-delà) depuis la
// lecture de la route, elle refuse et rien n'est écrit (ni E3, ni débit).

// 409 quand la RPC a refusé parce que le statut a changé entre-temps ; null pour
// toute autre erreur (à traiter en erreur serveur).
export function conflitAnnulationClient(
  error: { message?: string } | null,
): NextResponse | null {
  if (!error?.message?.includes('ANNULATION_CLIENT_STATUT')) return null;
  return NextResponse.json(
    {
      error:
        'La collecte a changé de statut entre-temps : elle ne peut plus être annulée.',
    },
    { status: 409 },
  );
}
