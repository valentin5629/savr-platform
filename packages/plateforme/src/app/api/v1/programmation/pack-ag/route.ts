import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  // Toujours filtrer sur l'org du caller — jamais de param cross-org (service_role bypasse RLS)
  const orgId = auth.ctx.organisationId;

  const { data, error } = await supabase
    .from('packs_antgaspi')
    .select(
      'id, credits_initiaux, credits_consommes, credits_restants, date_expiration, statut',
    )
    .eq('organisation_id', orgId)
    .eq('statut', 'actif')
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) return NextResponse.json({ pack_actif: false });

  return NextResponse.json({
    pack_actif: true,
    pack_id: data.id,
    credits_initiaux: data.credits_initiaux,
    credits_consommes: data.credits_consommes,
    credits_restants: data.credits_restants,
    date_expiration: data.date_expiration,
  });
}
