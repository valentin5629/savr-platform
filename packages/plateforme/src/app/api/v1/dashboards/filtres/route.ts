import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  lireParLots,
  lireParPages,
  TAILLE_PAGE,
} from '@/lib/pdf/selection-par-pages.js';
import {
  debutFenetreOptions,
  type CollecteOptions,
  lireTypesEvenementsActifs,
  optionsDepuisCollectes,
  STATUTS_HORS_OPTIONS,
  trierOptions,
} from '@/lib/dashboards/options-barre.js';

const ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'client_organisateur',
];

/**
 * GET /api/v1/dashboards/filtres — options de la barre de filtres globale des
 * dashboards traiteur, agence (§06.04, §06.11 : Lieux, Client organisateur) et
 * client organisateur (Lieux, Traiteurs — décision Val du 2026-10-30), plus le
 * référentiel des types d'événement.
 *
 * Les options sont DÉRIVÉES des collectes des 24 derniers mois du périmètre du
 * dashboard (événements programmés par l'organisation, ou dont elle est le client
 * organisateur rattaché), lues sous l'identité de l'appelant : une option ne
 * désigne qu'un lieu, un client ou un traiteur d'une collecte qu'il voit déjà.
 * Collectes brouillon et annulées écartées (elles ne comptent dans aucun bloc).
 * Les noms de traiteur passent par la vue liste blanche `v_referentiel_traiteurs`
 * (comme la liste Collectes du client organisateur), jamais en service_role.
 * Le client organisateur d'un traiteur ou d'une agence est le NOM saisi à la
 * programmation (`evenements.nom_client_organisateur`, comme la liste Collectes).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const organisateur = auth.ctx.role === 'client_organisateur';
  const supabase = createSupabaseServerClient();
  const debut = debutFenetreOptions();

  const lu = await lireParPages<CollecteOptions>((apresId) => {
    let q = supabase
      .from('collectes')
      .select(
        `id,
           evenements!inner(organisation_id, client_organisateur_organisation_id,
             nom_client_organisateur, traiteur_operationnel_organisation_id,
             lieux!lieu_id(id, nom))`,
      )
      .eq(
        organisateur
          ? 'evenements.client_organisateur_organisation_id'
          : 'evenements.organisation_id',
        auth.ctx.organisationId,
      )
      .gte('date_collecte', debut)
      .not('statut', 'in', STATUTS_HORS_OPTIONS);
    if (apresId) q = q.gt('id', apresId);
    return q.limit(TAILLE_PAGE).order('id', { ascending: true });
  });
  if (lu.error) return serverError(lu.error, 'dashboards.filtres.collectes');
  const { lieux, clients, traiteurIds } = optionsDepuisCollectes(lu.data);

  const types = await lireTypesEvenementsActifs(supabase);
  if (types.error) return serverError(types.error, 'dashboards.filtres.types');

  const data: Record<string, unknown> = { lieux, types: types.data };
  if (organisateur) {
    const noms = await lireParLots<{ id: string; nom: string }>(
      traiteurIds,
      (lot) =>
        supabase
          .from('v_referentiel_traiteurs')
          .select('id, nom')
          .in('id', lot),
    );
    if (noms.error)
      return serverError(noms.error, 'dashboards.filtres.traiteurs');
    data.traiteurs = trierOptions(new Map(noms.data.map((t) => [t.id, t.nom])));
  } else {
    data.clients = clients;
  }

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
