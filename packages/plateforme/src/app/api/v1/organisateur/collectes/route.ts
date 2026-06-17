import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ORGANISATEUR_ROLES: ClientRole[] = ['client_organisateur'];

// GET /api/v1/organisateur/collectes — liste des collectes des événements du
// client organisateur (§11 §7, lecture seule). La RLS (col_select → f_collecte_visible)
// scope sur evenements.client_organisateur_organisation_id ; on re-scope côté serveur
// (défense en profondeur) via evenements!inner. Filtres : type (onglet ZD/AG), période.
// Aucune donnée financière exposée (pas de marge, pas de facture).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ORGANISATEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let query = supabase
    .from('collectes')
    .select(
      `id, type, statut, date_collecte, heure_collecte, taux_recyclage,
       co2_induit_kg, co2_evite_kg, co2_net_kg, energie_primaire_evitee_kwh,
       evenements!inner(
         id, client_organisateur_organisation_id,
         nom_evenement, pax,
         lieux!lieu_id(id, nom, code_postal, ville)
       )`,
    )
    .eq(
      'evenements.client_organisateur_organisation_id',
      auth.ctx.organisationId,
    )
    .order('date_collecte', { ascending: false });

  if (type === 'zero_dechet' || type === 'anti_gaspi') {
    query = query.eq('type', type);
  }
  if (from) query = query.gte('date_collecte', from);
  if (to) query = query.lte('date_collecte', to);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
