import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const type = searchParams.get('type');

  // Action cards Bloc 1 — données live
  const now = new Date();
  const nowStr = now.toISOString().slice(0, 10);
  const in48hStr = new Date(now.getTime() + 48 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    nonTransmisesZD,
    nonTransmisesAG,
    attentePrestataire,
    dirtyTms,
    zd48h,
    ag48h,
    kpiRows,
  ] = await Promise.all([
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'zero_dechet')
      .eq('statut_tms', 'non_envoye')
      .is('tms_reference', null)
      .in('statut', ['programmee', 'validee']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'anti_gaspi')
      .eq('statut_tms', 'non_envoye')
      .is('tms_reference', null)
      .in('statut', ['programmee', 'validee']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('statut_tms', 'attribuee_en_attente_acceptation'),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('dirty_tms', true)
      .not('tms_reference', 'is', null),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'zero_dechet')
      .gte('date_collecte', nowStr)
      .lte('date_collecte', in48hStr)
      .in('statut', ['programmee', 'validee']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'anti_gaspi')
      .gte('date_collecte', nowStr)
      .lte('date_collecte', in48hStr)
      .in('statut', ['programmee', 'validee']),
    // Histogramme revenus v_kpi_admin
    (() => {
      let q = supabase.from('v_kpi_admin').select('*');
      if (from) q = q.gte('mois', from);
      if (to) q = q.lte('mois', to);
      if (type === 'zero_dechet' || type === 'anti_gaspi')
        q = q.eq('type_collecte', type);
      return q.order('mois', { ascending: false });
    })(),
  ]);

  const errors = [
    nonTransmisesZD.error,
    nonTransmisesAG.error,
    attentePrestataire.error,
    dirtyTms.error,
    zd48h.error,
    ag48h.error,
    kpiRows.error,
  ].filter(Boolean);
  if (errors.length > 0)
    return NextResponse.json({ error: errors[0]!.message }, { status: 500 });

  return NextResponse.json(
    {
      cartes_actions: {
        non_transmises_zd: nonTransmisesZD.count ?? 0,
        non_transmises_ag: nonTransmisesAG.count ?? 0,
        attente_validation_prestataire: attentePrestataire.count ?? 0,
        dirty_tms: dirtyTms.count ?? 0,
        zd_48h: zd48h.count ?? 0,
        ag_48h: ag48h.count ?? 0,
      },
      kpi: kpiRows.data ?? [],
    },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  );
}
