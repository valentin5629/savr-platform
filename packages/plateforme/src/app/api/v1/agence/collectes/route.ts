import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { enrichirLignesCollectes } from '@/lib/collectes/liste-collectes-client.js';

const AGENCE_ROLES: ClientRole[] = ['agence'];

// GET /api/v1/agence/collectes — liste des collectes de l'agence (§06.11, réplique
// §06.04 §3). Périmètre donneur d'ordre : la RLS (col_select → f_collecte_visible)
// scope sur evenements.organisation_id = agence. Tri date décroissante.
//
// Mêmes filtres que la liste traiteur (§06.04 §3 « Filtres disponibles ») :
//   type (sélecteur ZD/AG) · statut (multi) · période (from/to) · lieu_id ·
//   client (nom du client organisateur) · info_incomplete (oui|non).
// « Programmée par » n'a pas d'objet ici : l'agence est toujours la programmatrice.
// Mêmes champs calculés (résultats de la collecte réalisée, rapport réservé) —
// cf. enrichirLignesCollectes.
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
  const client = searchParams.get('client');
  const infoIncomplete = searchParams.get('info_incomplete');

  let query = supabase
    .from('collectes')
    .select(
      `id, type, statut, statut_tms, date_collecte, heure_collecte,
       informations_completes, taux_recyclage, co2_evite_kg, realisee_at,
       collecte_flux(poids_reel_kg),
       attributions_antgaspi(volume_repas_realise),
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
  if (client) query = query.eq('evenements.nom_client_organisateur', client);
  if (infoIncomplete === 'oui' || infoIncomplete === 'non')
    query = query.eq('informations_completes', infoIncomplete === 'non');

  const { data, error } = await query;
  if (error) return serverError(error, 'agence.collectes.list');

  return NextResponse.json({
    data: enrichirLignesCollectes(data, auth.ctx.organisationId),
  });
}
