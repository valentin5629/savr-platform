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
    collectes48hNonValidees,
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
      .eq('statut_tms', 'attribuee_en_attente_acceptation')
      .in('type', ['zero_dechet', 'anti_gaspi']),
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .eq('dirty_tms', true)
      .not('tms_reference', 'is', null)
      .in('type', ['zero_dechet', 'anti_gaspi']),
    // Collectes ZD + AG prévues dans les 48 h, encore actives, que le prestataire
    // logistique n'a PAS validées (= statut_tms hors `acceptee`/`en_attente_execution`) :
    // englobe donc les non transmises (`non_envoye`), en attente d'acceptation et
    // rejetées. Fusion des ex-cartes « ZD dans 48h » + « AG dans 48h » (revue E2E Val 2026-07-15).
    supabase
      .from('collectes')
      .select('id', { count: 'exact', head: true })
      .in('type', ['zero_dechet', 'anti_gaspi'])
      .gte('date_collecte', nowStr)
      .lte('date_collecte', in48hStr)
      .in('statut', ['programmee', 'validee'])
      .not('statut_tms', 'in', '("acceptee","en_attente_execution")'),
  ]);

  return NextResponse.json({
    non_transmises_zd: nonTransmisesZD.count ?? 0,
    non_transmises_ag: nonTransmisesAG.count ?? 0,
    attente_prestataire: attentePrestataire.count ?? 0,
    dirty_tms: dirtyTms.count ?? 0,
    collectes_48h_non_validees: collectes48hNonValidees.count ?? 0,
  });
}
