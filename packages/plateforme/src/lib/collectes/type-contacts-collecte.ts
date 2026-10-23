import { NextResponse } from 'next/server';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const renseigne = (v: unknown): boolean =>
  typeof v === 'string' && v.trim() !== '';

/**
 * Type d'événement et contacts d'une collecte (lot B1, décision Val
 * 2026-10-23) : refus en 422 avant la RPC, qui les refuserait aussi mais en
 * erreur serveur (contrainte NOT NULL, CHECK, clé étrangère).
 *   · contact principal : nom et téléphone jamais vides ;
 *   · contact de secours : vide = absent (null) ;
 *   · type d'événement : un type du référentiel, jamais vidé.
 * Les bornes de longueur et de caractères sont celles de validerChampsTexteLibre.
 * Normalise `updates` en place (secours vide → null).
 */
export async function refusTypeContactsCollecte(
  admin: AdminSupabase,
  updates: Record<string, unknown>,
): Promise<NextResponse | null> {
  for (const champ of [
    'contact_principal_nom',
    'contact_principal_telephone',
  ] as const) {
    if (Object.hasOwn(updates, champ) && !renseigne(updates[champ])) {
      return NextResponse.json(
        {
          error: 'Le contact principal et son téléphone sont obligatoires.',
          champ,
        },
        { status: 422 },
      );
    }
  }
  for (const champ of [
    'contact_secours_nom',
    'contact_secours_telephone',
  ] as const) {
    if (Object.hasOwn(updates, champ) && !renseigne(updates[champ]))
      updates[champ] = null;
  }
  if (Object.hasOwn(updates, 'type_evenement_id')) {
    const v = updates.type_evenement_id;
    if (typeof v !== 'string' || !UUID.test(v)) {
      return NextResponse.json(
        { error: "Type d'événement invalide.", champ: 'type_evenement_id' },
        { status: 422 },
      );
    }
    const { data, error } = await admin
      .from('types_evenements')
      .select('id')
      .eq('id', v)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Type d'événement inconnu.", champ: 'type_evenement_id' },
        { status: 422 },
      );
    }
  }
  return null;
}
