import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const statut = searchParams.get('statut');
  const type = searchParams.get('type');
  const statut_tms = searchParams.get('statut_tms');
  const chip = searchParams.get('chip');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('collectes')
    .select(
      `id, type, statut, statut_tms, dirty_tms, date_collecte, heure_collecte,
       nb_camions_demande, tms_reference, created_at,
       evenements!inner(
         organisation_id, nom_evenement, pax,
         organisations!organisation_id(raison_sociale),
         lieux!lieu_id(nom, ville)
       )`,
      { count: 'exact' },
    )
    .order('date_collecte', { ascending: false });

  // Chips prédéfinis (§06.06 §3)
  if (chip === 'non_transmises') {
    query = query
      .eq('statut_tms', 'non_envoye')
      .in('statut', ['programmee', 'validee']);
  } else if (chip === 'attente_prestataire') {
    query = query.eq('statut_tms', 'attribuee_en_attente_acceptation');
  } else if (chip === 'dirty_tms') {
    query = query.eq('dirty_tms', true).not('tms_reference', 'is', null);
  } else if (chip === 'ag_attente_attribution') {
    query = query
      .eq('type', 'ag')
      .eq('statut_tms', 'non_envoye')
      .in('statut', ['programmee', 'validee']);
  } else if (chip === 'zd_48h') {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    query = query
      .eq('type', 'zd')
      .gte('date_collecte', now.toISOString().slice(0, 10))
      .lte('date_collecte', in48h.toISOString().slice(0, 10))
      .in('statut', ['programmee', 'validee']);
  } else if (chip === 'ag_48h') {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    query = query
      .eq('type', 'ag')
      .gte('date_collecte', now.toISOString().slice(0, 10))
      .lte('date_collecte', in48h.toISOString().slice(0, 10))
      .in('statut', ['programmee', 'validee']);
  } else {
    if (statut) query = query.eq('statut', statut);
    if (type) query = query.eq('type', type);
    if (statut_tms) query = query.eq('statut_tms', statut_tms);
    if (from) query = query.gte('date_collecte', from);
    if (to) query = query.lte('date_collecte', to);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const { evenement_id, type, date_collecte, heure_collecte } = body;

  if (!evenement_id || !type || !date_collecte || !heure_collecte) {
    return NextResponse.json(
      {
        error:
          'Champs obligatoires : evenement_id, type, date_collecte, heure_collecte',
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Calcul volume_estime_repas pour AG
  let volume_estime_repas: number | null = null;
  if (type === 'ag') {
    const { data: evt } = await supabase
      .from('evenements')
      .select('pax')
      .eq('id', evenement_id)
      .single();
    if (evt) {
      volume_estime_repas = Math.round(0.1 * (evt as { pax: number }).pax);
    }
  }

  const { data, error } = await supabase
    .from('collectes')
    .insert({
      evenement_id,
      type,
      date_collecte,
      heure_collecte,
      volume_estime_repas,
      statut: 'programmee',
      statut_tms: 'non_envoye',
      nb_camions_demande: body.nb_camions_demande ?? 1,
      controle_acces_requis: body.controle_acces_requis ?? false,
      notes_internes: body.notes_internes ?? null,
      informations_supplementaires: body.informations_supplementaires ?? null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const collecteId = (data as { id: string }).id;

  // Outbox E1 : collecte.creee (garde-fou G4)
  await supabase.from('outbox_events').insert({
    aggregate_type: 'collecte',
    aggregate_id: collecteId,
    event_type: 'collecte.creee',
    payload: { collecte_id: collecteId, type, date_collecte },
    consumer: 'adapter_mts1',
  });

  // Flux ZD auto-créés
  if (type === 'zd') {
    const flux = [
      'biodechet',
      'emballage',
      'carton',
      'verre',
      'dechet_residuel',
    ];
    await supabase.from('collecte_flux').insert(
      flux.map((code_flux) => ({
        collecte_id: collecteId,
        code_flux,
        poids_kg: null,
      })),
    );
  }

  return NextResponse.json(data, { status: 201 });
}
