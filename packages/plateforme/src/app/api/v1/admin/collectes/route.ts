import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError } from '@/lib/api-helpers.js';

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
      .is('tms_reference', null)
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
  if (error) return serverError(error, 'admin.collectes.list');

  return NextResponse.json({ data: data ?? [], total: count ?? 0 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const parsed = await readJsonBody(req);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
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

  // fn_creer_collecte : INSERT collecte + outbox E1 dans la même transaction (G4)
  const { data: collecteId, error: rpcError } = await supabase.rpc(
    'fn_creer_collecte',
    {
      p_evenement_id: evenement_id,
      p_type: type,
      p_date_collecte: date_collecte,
      p_heure_collecte: heure_collecte,
      p_nb_camions: body.nb_camions_demande ?? 1,
      p_controle_acces: body.controle_acces_requis ?? false,
      p_notes: body.notes_internes ?? null,
      p_info_suppl: body.informations_supplementaires ?? null,
    },
  );

  if (rpcError) return serverError(rpcError, 'admin.collectes.create');

  const newId = collecteId as string;

  // NB : pas de pré-création de lignes collecte_flux ici. Les pesées ZD sont
  // DÉRIVÉES de pesees_tournees par fn_agreger_terminal_collecte à l'agrégation
  // terminale (UPSERT par flux — §04 Data Model « collecte_flux dérivée »), ou
  // saisies manuellement par l'Admin via PATCH /admin/collectes/[id]/flux (UPSERT).
  // Pré-créer 5 lignes à poids NULL ferait passer le gate batch PDF « 0 ligne →
  // skip » (R-PDF3/R9, batch-pdf-j1.ts) et produirait des bordereaux vides.

  // Retourner la collecte créée
  const { data, error } = await supabase
    .from('collectes')
    .select()
    .eq('id', newId)
    .single();

  if (error) return serverError(error, 'admin.collectes.create_fetch');

  return NextResponse.json(data, { status: 201 });
}
