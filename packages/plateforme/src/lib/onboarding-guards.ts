// Middlewares applicatifs d'onboarding (CDC §09 §5) — BL-P1-ONB-05.
// Factorisation des gates « profil entreprise » qui étaient dupliqués inline
// (risque de drift entre copies, audit onboarding #12).
//
// SIRET NON BLOQUANT POUR PROGRAMMER (décision Val 2026-09-28, cf.
// _Divergences/M1.2_20260928) : ni l'absence de SIRET vérifié, ni l'absence
// d'entité de facturation ne bloquent une programmation de collecte. Le SIRET
// reste bloquant là où il protège réellement : l'ÉMISSION de facture (`siret_verification = 'verifie'`, CDC §05 §8 étape 3 ;
// requireValidatedOrganisation ci-dessous + batch facturation).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

const MESSAGE_ERREUR =
  'Erreur lors de la résolution de l’entité de facturation.';

function isUniqueViolation(err: { code?: string } | null): boolean {
  return err?.code === '23505';
}

async function lireEntiteActive(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('entites_facturation')
    .select('id')
    .eq('organisation_id', organisationId)
    .eq('actif', true)
    .order('entite_par_defaut', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// requireCompletedOrganisation — résout l'entité de facturation de l'organisation
// programmatrice (evenements.entite_facturation_id est NOT NULL, règle V1
// programmateur = facturé, §05 §8). Ne bloque JAMAIS la programmation (décision Val
// 2026-09-28) :
//   - AUCUN filtre sur siret_verification : une entité « en_attente » suffit ;
//   - organisation SANS entité active (fiches créées par l'Admin ou le seed — le
//     signup, lui, en crée toujours une) → création à la volée d'une entité par
//     défaut vide, SIRET « en_attente », exactement comme le signup sans SIRET.
//     L'Admin la complète avant la première facture (gating facture inchangé).
// Préférence à l'entité par défaut ; `limit(1)` évite l'erreur maybeSingle d'une
// orga à plusieurs entités. Course entre deux programmations simultanées : l'index
// UNIQUE partiel uniq_entite_defaut_par_org fait échouer le second INSERT (23505)
// → on relit l'entité créée par le premier.
export async function requireCompletedOrganisation(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<
  { ok: true; entiteFacturationId: string } | { ok: false; error: NextResponse }
> {
  const existante = await lireEntiteActive(supabase, organisationId);
  if (existante) return { ok: true, entiteFacturationId: existante };

  const echec = {
    ok: false as const,
    error: NextResponse.json({ error: MESSAGE_ERREUR }, { status: 500 }),
  };

  const { data: org } = await supabase
    .from('organisations')
    .select('nom')
    .eq('id', organisationId)
    .maybeSingle();
  if (!org) return echec;

  const { data: creee, error } = await supabase
    .from('entites_facturation')
    .insert({
      organisation_id: organisationId,
      raison_sociale: (org as { nom: string }).nom,
      siret: '',
      adresse_facturation: '',
      code_postal: '',
      ville: '',
      entite_par_defaut: true,
      siret_verification: 'en_attente',
      tva_verification: 'non_applicable',
    })
    .select('id')
    .single();

  if (creee) {
    return { ok: true, entiteFacturationId: (creee as { id: string }).id };
  }
  if (isUniqueViolation(error)) {
    const gagnante = await lireEntiteActive(supabase, organisationId);
    if (gagnante) return { ok: true, entiteFacturationId: gagnante };
  }
  return echec;
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
