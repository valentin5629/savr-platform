import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';

// Suppression d'un événement brouillon (et ses collectes) par son propriétaire.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const supabase = createAdminSupabaseClient();

  // Vérification propriété + statut brouillon uniquement
  const { data: evt } = await supabase
    .from('evenements')
    .select('id')
    .eq('id', evenementId)
    .eq('organisation_id', auth.ctx.organisationId)
    .single();

  if (!evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  // Vérifier que toutes les collectes sont en brouillon (pas de suppression si déjà confirmé)
  const { data: collectes } = await supabase
    .from('collectes')
    .select('id, statut')
    .eq('evenement_id', evenementId);

  const hasNonBrouillon = collectes?.some((c) => c.statut !== 'brouillon');
  if (hasNonBrouillon) {
    return NextResponse.json(
      {
        error:
          "Impossible de supprimer : des collectes sont déjà confirmées. Utilisez l'annulation.",
      },
      { status: 422 },
    );
  }

  // DELETE CASCADE via FK (collectes supprimées par ON DELETE CASCADE)
  const { error } = await supabase
    .from('evenements')
    .delete()
    .eq('id', evenementId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
