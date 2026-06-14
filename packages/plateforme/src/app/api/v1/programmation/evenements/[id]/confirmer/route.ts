import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';

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

  // RPC atomique : brouillon → programmee + E1 pour ZD
  const { error: rpcErr } = await supabase.rpc(
    'fn_confirmer_programmation_brouillon',
    { p_evenement_id: evenementId },
  );

  if (rpcErr)
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  return NextResponse.json({ evenement_id: evenementId, statut: 'programmee' });
}
