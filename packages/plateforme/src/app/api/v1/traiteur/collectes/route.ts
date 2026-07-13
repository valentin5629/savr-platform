import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// GET /api/v1/traiteur/collectes — liste des collectes de l'orga (§06.04 §3).
// La RLS (col_select) garantit le cloisonnement : toutes les collectes de l'orga
// (lecture alignée manager pour le commercial — révision 2026-05-29) + collectes
// où le traiteur est opérationnel. Filtres : type (onglet ZD/AG), statut, période,
// lieu, client organisateur, programmée par. Tri date décroissante.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'zero_dechet' | 'anti_gaspi'
  const statut = searchParams.get('statut');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const lieuId = searchParams.get('lieu_id');
  // Drill-down « Top 5 commerciaux » du dashboard → filtre sur le commercial
  // créateur (evenements.created_by). Reste scopé org par la RLS col_select.
  const commercialId = searchParams.get('commercial_id');

  let query = supabase
    .from('collectes')
    .select(
      `id, type, statut, statut_tms, date_collecte, heure_collecte,
       informations_completes, taux_recyclage, realisee_at,
       evenements!inner(
         id, organisation_id, traiteur_operationnel_organisation_id, created_by,
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
  if (commercialId) query = query.eq('evenements.created_by', commercialId);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Indicateur "programmée par tiers" : evenement.organisation_id != traiteur opérationnel
  const orgId = auth.ctx.organisationId;
  const rows = (data ?? []).map((c) => {
    const evt = (
      Array.isArray(c.evenements) ? c.evenements[0] : c.evenements
    ) as
      | {
          organisation_id: string;
          traiteur_operationnel_organisation_id: string | null;
        }
      | undefined;
    const programmeeParTiers =
      evt?.traiteur_operationnel_organisation_id === orgId &&
      evt?.organisation_id !== orgId;
    return { ...c, programmee_par_tiers: programmeeParTiers };
  });

  return NextResponse.json({ data: rows });
}
