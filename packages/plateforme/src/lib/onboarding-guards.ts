// Middlewares applicatifs d'onboarding (CDC §09 §5) — BL-P1-ONB-05.
// Factorisation des gates « profil entreprise complet » qui étaient dupliqués inline
// (risque de drift entre copies, audit onboarding #12). La règle opérationnelle de
// complétude/validation = `siret_verification = 'verifie'` (gating facturation tranché
// Val, §4 CLAUDE.md / §15 §2.6 l.73 ; CGV persistée au signup R6 ; TVA VIES non bloquante).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

const MESSAGE_PROFIL_INCOMPLET =
  'Complétez votre profil entreprise (SIRET vérifié requis).';

// requireCompletedOrganisation — bloque la programmation tant que l'organisation n'a
// pas d'entité de facturation avec un SIRET vérifié (§09 §5). Renvoie un 422 prêt à
// retourner si le profil est incomplet.
export async function requireCompletedOrganisation(
  supabase: SupabaseClient,
  organisationId: string,
  message: string = MESSAGE_PROFIL_INCOMPLET,
): Promise<
  { ok: true; entiteFacturationId: string } | { ok: false; error: NextResponse }
> {
  const { data: entite } = await supabase
    .from('entites_facturation')
    .select('id')
    .eq('organisation_id', organisationId)
    .eq('siret_verification', 'verifie')
    .maybeSingle();

  if (!entite) {
    return {
      ok: false,
      error: NextResponse.json({ error: message }, { status: 422 }),
    };
  }
  return { ok: true, entiteFacturationId: (entite as { id: string }).id };
}

// requireValidatedOrganisation — bloque le push Pennylane tant que l'entité de
// facturation n'est pas validée (SIRET vérifié, §09 §5). Garde pure sur l'entité déjà
// chargée (le push Pennylane se fait côté lib, pas via une route HTTP).
export function requireValidatedOrganisation(
  ef: { siret_verification: string } | null | undefined,
): { ok: true } | { ok: false; raison: string } {
  if (!ef || ef.siret_verification !== 'verifie') {
    return { ok: false, raison: 'SIRET non vérifié — envoi Pennylane bloqué' };
  }
  return { ok: true };
}
