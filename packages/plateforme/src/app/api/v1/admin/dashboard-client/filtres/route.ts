import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';
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

/**
 * GET /api/v1/admin/dashboard-client/filtres?organisation_ids[]=… — options
 * Lieux et Traiteurs de la barre du Dashboard Client (§06.06 §2, reprise du
 * dashboard gestionnaire), plus le référentiel des types d'événement.
 *
 * Décision Val du 2026-10-30 : les options sont celles des organisations
 * choisies, toutes sans choix. Elles sont DÉRIVÉES des collectes des 24 derniers
 * mois du même périmètre que le dashboard (organisation programmatrice OU traiteur
 * opérationnel, cf. `loadAdminDashboardClient`), comme le gestionnaire voit les
 * traiteurs intervenus sur ses lieux. Équipe Savr seule (service_role).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const admin = createAdminSupabaseClient();
  const orgIds = new URL(req.url).searchParams
    .getAll('organisation_ids[]')
    .filter(estUuid);
  const debut = debutFenetreOptions();

  const lu = await lireParPages<CollecteOptions>((apresId) => {
    let q = admin
      .from('collectes')
      .select(
        `id, evenements!inner(organisation_id,
             traiteur_operationnel_organisation_id, lieux!lieu_id(id, nom))`,
      )
      .gte('date_collecte', debut)
      .not('statut', 'in', STATUTS_HORS_OPTIONS);
    if (orgIds.length > 0) {
      const ids = orgIds.join(',');
      q = q.or(
        `organisation_id.in.(${ids}),traiteur_operationnel_organisation_id.in.(${ids})`,
        { referencedTable: 'evenements' },
      );
    }
    if (apresId) q = q.gt('id', apresId);
    return q.limit(TAILLE_PAGE).order('id', { ascending: true });
  });
  if (lu.error)
    return serverError(lu.error, 'admin.dashboard_client.filtres.collectes');
  const { lieux, traiteurIds } = optionsDepuisCollectes(lu.data);

  const noms = await lireParLots<{ id: string; nom: string }>(
    traiteurIds,
    (lot) => admin.from('organisations').select('id, nom').in('id', lot),
  );
  if (noms.error)
    return serverError(noms.error, 'admin.dashboard_client.filtres.traiteurs');

  const types = await lireTypesEvenementsActifs(admin);
  if (types.error)
    return serverError(types.error, 'admin.dashboard_client.filtres.types');

  return NextResponse.json({
    data: {
      lieux,
      traiteurs: trierOptions(new Map(noms.data.map((t) => [t.id, t.nom]))),
      types: types.data,
    },
  });
}
