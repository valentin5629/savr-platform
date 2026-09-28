// Middlewares applicatifs d'onboarding (CDC §09 §5) — BL-P1-ONB-05.
// Factorisation des gates « profil entreprise » qui étaient dupliqués inline
// (risque de drift entre copies, audit onboarding #12).
//
// SIRET NON BLOQUANT POUR PROGRAMMER (décision Val 2026-09-28, cf.
// _Divergences/M1.2_20260928) : l'absence de SIRET vérifié ne bloque plus aucune
// programmation de collecte. Le SIRET reste bloquant là où il protège réellement :
// l'ÉMISSION de facture (`siret_verification = 'verifie'`, CDC §05 §8 étape 3 ;
// requireValidatedOrganisation ci-dessous + batch facturation).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

const MESSAGE_SANS_ENTITE =
  "Aucune entité de facturation active pour votre organisation — contactez l'équipe Savr.";

// requireCompletedOrganisation — résout l'entité de facturation de l'organisation
// programmatrice (evenements.entite_facturation_id est NOT NULL, règle V1
// programmateur = facturé, §05 §8). AUCUN filtre sur siret_verification : une entité
// « en_attente » (inscription sans SIRET) suffit à programmer. Préférence à l'entité
// par défaut ; `limit(1)` évite l'erreur maybeSingle d'une orga à plusieurs entités.
// Renvoie un 422 prêt à retourner si l'organisation n'a aucune entité active.
export async function requireCompletedOrganisation(
  supabase: SupabaseClient,
  organisationId: string,
  message: string = MESSAGE_SANS_ENTITE,
): Promise<
  { ok: true; entiteFacturationId: string } | { ok: false; error: NextResponse }
> {
  const { data: entite } = await supabase
    .from('entites_facturation')
    .select('id')
    .eq('organisation_id', organisationId)
    .eq('actif', true)
    .order('entite_par_defaut', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
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
