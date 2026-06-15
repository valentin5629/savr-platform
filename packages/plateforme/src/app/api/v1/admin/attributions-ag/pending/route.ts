import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

// GET /api/v1/admin/attributions-ag/pending
// File d'attente AG en attente d'attribution (statut='programmee', type='anti_gaspi', pas d'attribution)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('collectes')
    .select(
      `id, date_collecte, heure_collecte, volume_estime_repas, statut, statut_tms, created_at,
       evenements!evenement_id(
         nom_evenement, pax,
         organisations!organisation_id(raison_sociale),
         lieux!lieu_id(nom, ville, code_postal)
       )`,
      { count: 'exact' },
    )
    .eq('type', 'anti_gaspi')
    .eq('statut', 'programmee')
    .is('attributions_antgaspi', null)
    .order('date_collecte', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}
