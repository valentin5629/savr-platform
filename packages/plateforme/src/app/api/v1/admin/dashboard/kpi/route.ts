import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const nowStr = now.toISOString().slice(0, 10);
  const in48hStr = in48h.toISOString().slice(0, 10);

  const [
    nonTransmisesZD,
    nonTransmisesAG,
    attentePrestataire,
    dirtyTms,
    zd48h,
    ag48h,
  ] = await Promise.all([
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'zd')
      .eq('statut_tms', 'non_envoye')
      .in('statut', ['programmee', 'validee']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'ag')
      .eq('statut_tms', 'non_envoye')
      .in('statut', ['programmee', 'validee']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('statut_tms', 'attribuee_en_attente_acceptation')
      .in('type', ['zd', 'ag']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('dirty_tms', true)
      .not('tms_reference', 'is', null)
      .in('type', ['zd', 'ag']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'zd')
      .gte('date_collecte', nowStr)
      .lte('date_collecte', in48hStr)
      .in('statut', ['programmee', 'validee']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'ag')
      .gte('date_collecte', nowStr)
      .lte('date_collecte', in48hStr)
      .in('statut', ['programmee', 'validee']),
  ]);

  return NextResponse.json({
    non_transmises_zd: nonTransmisesZD.count ?? 0,
    non_transmises_ag: nonTransmisesAG.count ?? 0,
    attente_prestataire: attentePrestataire.count ?? 0,
    dirty_tms: dirtyTms.count ?? 0,
    zd_48h: zd48h.count ?? 0,
    ag_48h: ag48h.count ?? 0,
  });
}
