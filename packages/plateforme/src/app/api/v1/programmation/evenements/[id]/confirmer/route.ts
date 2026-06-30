import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';
import { requireCompletedOrganisation } from '@/lib/onboarding-guards.js';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const supabase = createAdminSupabaseClient();

  // Vérification propriété de l'événement
  const { data: evt, error: evtErr } = await supabase
    .from('evenements')
    .select('id, organisation_id, nom_evenement')
    .eq('id', evenementId)
    .eq('organisation_id', auth.ctx.organisationId)
    .single();

  if (evtErr || !evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  // Vérification collectes brouillon présentes
  const { data: collectes } = await supabase
    .from('collectes')
    .select('id, type, date_collecte')
    .eq('evenement_id', evenementId)
    .eq('statut', 'brouillon');

  if (!collectes?.length) {
    return NextResponse.json(
      { error: 'Aucune collecte en brouillon à confirmer' },
      { status: 422 },
    );
  }

  // Gate facturation (R1) — profil entreprise complet (SIRET vérifié), §09 §5,
  // même règle que le chemin direct.
  const completude = await requireCompletedOrganisation(
    supabase,
    evt.organisation_id,
    'Complétez votre profil entreprise (SIRET vérifié requis pour confirmer la programmation)',
  );
  if (!completude.ok) return completude.error;

  // Gate pack AG (R3) — si des collectes AG sont présentes dans ce brouillon
  const hasAg = collectes.some((c) => c.type === 'ag');
  if (hasAg) {
    const { data: pack } = await supabase
      .from('packs_antgaspi')
      .select('id, credits_restants')
      .eq('organisation_id', evt.organisation_id)
      .eq('statut', 'actif')
      .maybeSingle();
    if (!pack || (pack.credits_restants ?? 0) <= 0) {
      return NextResponse.json(
        { error: 'Aucun pack Anti-Gaspi actif disponible pour confirmer' },
        { status: 422 },
      );
    }
  }

  // RPC atomique : brouillon → programmee + E1 pour ZD
  const { error: rpcErr } = await supabase.rpc(
    'fn_confirmer_programmation_brouillon',
    { p_evenement_id: evenementId },
  );

  if (rpcErr)
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  return NextResponse.json({ evenement_id: evenementId, statut: 'programmee' });
}
