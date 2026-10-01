import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  enrichirLignesCollectes,
  lireFiltresListeCollectes,
} from '@/lib/collectes/liste-collectes-client.js';
import { inTextes } from '@/lib/filtre-csv.js';

const AGENCE_ROLES: ClientRole[] = ['agence'];

// GET /api/v1/agence/collectes — liste des collectes de l'agence (§06.11, réplique
// §06.04 §3). Périmètre donneur d'ordre : la RLS (col_select → f_collecte_visible)
// scope sur evenements.organisation_id = agence. Tri date décroissante.
//
// Mêmes filtres que la liste traiteur (§06.04 §3 « Filtres disponibles »), lus
// par la même fonction (lireFiltresListeCollectes) :
//   type (sélecteur ZD/AG) · statut (multi) · période (from/to) · lieu_ids
//   (multi) · client (multi, noms du client organisateur) · info_incomplete
//   (oui|non).
// « Programmée par » n'a pas d'objet ici : l'agence est toujours la programmatrice.
// Mêmes champs calculés (résultats de la collecte réalisée, rapport réservé) —
// cf. enrichirLignesCollectes.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const filtres = lireFiltresListeCollectes(searchParams);

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
  if (filtres.statuts.length > 0) query = query.in('statut', filtres.statuts);
  if (from) query = query.gte('date_collecte', from);
  if (to) query = query.lte('date_collecte', to);
  if (filtres.lieuIds.length > 0)
    query = query.in('evenements.lieu_id', filtres.lieuIds);
  if (filtres.clients.length > 0)
    query = query.filter(
      'evenements.nom_client_organisateur',
      'in',
      inTextes(filtres.clients),
    );
  if (filtres.informationsCompletes !== null)
    query = query.eq('informations_completes', filtres.informationsCompletes);

  const { data, error } = await query;
  if (error) return serverError(error, 'agence.collectes.list');

  return NextResponse.json({
    data: enrichirLignesCollectes(data, auth.ctx.organisationId),
  });
}
