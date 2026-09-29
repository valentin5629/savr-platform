// Rattachement gestionnaire d'un lieu (`organisations_lieux`) posé par les
// routes admin lieux (POST /admin/lieux, PATCH /admin/lieux/{id}).
//
// CDC §04 Data Model (`organisations_lieux`, note V1 2026-05-07) : la table
// est réservée aux organisations `gestionnaire_lieux`. Rien ne l'imposait côté
// serveur — seul le sélecteur de la modale filtrait (`?type=gestionnaire_lieux`).
// Or `f_collecte_visible` (source unique de la visibilité collecte, §09 3ter)
// ouvre les collectes DATÉES d'un lieu à TOUTE organisation rattachée, sans
// garde de rôle : une organisation traiteur rattachée par erreur (appel API
// direct, id collé à la main) lisait via PostgREST les collectes des autres
// traiteurs sur ce lieu, et leurs tables filles. Mesuré sur base locale le
// 2026-09-29 (collecte + `notes_internes` + lieu visibles, événement non).
// Ce contrôle refuse le rattachement en 422, AVANT toute écriture.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError } from '@/lib/api-helpers.js';

export type GestionnaireLu =
  | { ok: true; organisationId: string | null }
  | { ok: false; reponse: NextResponse };

function refus(message: string): GestionnaireLu {
  return {
    ok: false,
    reponse: NextResponse.json(
      {
        error: message,
        champs_invalides: ['gestionnaire_organisation_id'],
      },
      { status: 422 },
    ),
  };
}

/**
 * Valide `gestionnaire_organisation_id` du corps. Absent, `null` ou `''` =
 * aucun gestionnaire (non obligatoire, décision Val 2026-07-02). Sinon
 * l'organisation doit exister et être de type `gestionnaire_lieux`.
 */
export async function lireGestionnaireLieu(
  supabase: SupabaseClient,
  valeur: unknown,
): Promise<GestionnaireLu> {
  if (valeur === undefined || valeur === null || valeur === '') {
    return { ok: true, organisationId: null };
  }
  if (typeof valeur !== 'string') {
    return refus('Saisie invalide : gestionnaire_organisation_id.');
  }

  const { data, error } = await supabase
    .from('organisations')
    .select('type')
    .eq('id', valeur)
    .maybeSingle();
  // 22P02 : identifiant mal formé → donnée invalide, pas une panne.
  if (error && error.code !== '22P02') {
    return {
      ok: false,
      reponse: serverError(error, 'admin.lieux.gestionnaire'),
    };
  }
  if (!data || (data as { type: string }).type !== 'gestionnaire_lieux') {
    return refus(
      'Le gestionnaire rattaché doit être une organisation de type « gestionnaire de lieux ».',
    );
  }
  return { ok: true, organisationId: valeur };
}
