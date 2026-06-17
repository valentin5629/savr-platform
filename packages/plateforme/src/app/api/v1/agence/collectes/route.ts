import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const AGENCE_ROLES: ClientRole[] = ['agence'];

// GET /api/v1/agence/collectes — liste des collectes de l'agence (§06.11, réplique
// §06.04 §3). Périmètre donneur d'ordre : la RLS (col_select → f_collecte_visible)
// scope sur evenements.organisation_id = agence. Filtres : type (onglet ZD/AG),
// statut, période, lieu. Tri date décroissante.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const statut = searchParams.get('statut');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const lieuId = searchParams.get('lieu_id');

  let query = supabase
    .from('collectes')
    .select(
      `id, type, statut, statut_tms, date_collecte, heure_collecte,
       informations_completes, taux_recyclage, realisee_at,
       evenements!inner(
         id, organisation_id, traiteur_operationnel_organisation_id,
         nom_evenement, pax, nom_client_organisateur,
         lieux!lieu_id(id, nom, adresse_acces, code_postal, ville)
       )`,
    )
    .order('date_collecte', { ascending: false });

  if (type === 'zero_dechet' || type === 'anti_gaspi') {
    query = query.eq('type', type);
  }
  if (statut) query = query.in('statut', statut.split(','));
  if (from) query = query.gte('date_collecte', from);
  if (to) query = query.lte('date_collecte', to);
  if (lieuId) query = query.eq('evenements.lieu_id', lieuId);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
