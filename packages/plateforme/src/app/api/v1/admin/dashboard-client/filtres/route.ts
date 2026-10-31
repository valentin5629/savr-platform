import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';
import {
  lireParLots,
  lireParPages,
  TAILLE_PAGE,
} from '@/lib/pdf/selection-par-pages.js';

interface Option {
  id: string;
  nom: string;
}
type Lieu = { id: string; nom: string | null };
interface Evt {
  traiteur_operationnel_organisation_id: string | null;
  lieux: Lieu | Lieu[] | null;
}

const un = <T>(v: T | T[] | null): T | null =>
  !v ? null : Array.isArray(v) ? (v[0] ?? null) : v;

const trie = (m: Map<string, string>): Option[] =>
  [...m.entries()]
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

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
  const depuis = new Date();
  depuis.setMonth(depuis.getMonth() - 24);

  const lu = await lireParPages<{ id: string; evenements: Evt | Evt[] | null }>(
    (apresId) => {
      let q = admin
        .from('collectes')
        .select(
          `id, evenements!inner(organisation_id,
             traiteur_operationnel_organisation_id, lieux!lieu_id(id, nom))`,
        )
        .gte('date_collecte', jourParis(depuis));
      if (orgIds.length > 0) {
        const ids = orgIds.join(',');
        q = q.or(
          `organisation_id.in.(${ids}),traiteur_operationnel_organisation_id.in.(${ids})`,
          { referencedTable: 'evenements' },
        );
      }
      if (apresId) q = q.gt('id', apresId);
      return q.limit(TAILLE_PAGE).order('id', { ascending: true });
    },
  );
  if (lu.error)
    return serverError(lu.error, 'admin.dashboard_client.filtres.collectes');

  const lieux = new Map<string, string>();
  const traiteurIds = new Set<string>();
  for (const ligne of lu.data) {
    const evt = un(ligne.evenements);
    if (!evt) continue;
    const lieu = un(evt.lieux);
    if (lieu?.id) lieux.set(lieu.id, lieu.nom ?? 'Lieu');
    if (evt.traiteur_operationnel_organisation_id)
      traiteurIds.add(evt.traiteur_operationnel_organisation_id);
  }

  const noms = await lireParLots<{ id: string; nom: string }>(
    [...traiteurIds],
    (lot) => admin.from('organisations').select('id, nom').in('id', lot),
  );
  if (noms.error)
    return serverError(noms.error, 'admin.dashboard_client.filtres.traiteurs');

  const { data: types, error: erreurTypes } = await admin
    .from('types_evenements')
    .select('id, libelle')
    .eq('actif', true)
    .order('ordre_affichage', { ascending: true });
  if (erreurTypes)
    return serverError(erreurTypes, 'admin.dashboard_client.filtres.types');

  return NextResponse.json({
    data: {
      lieux: trie(lieux),
      traiteurs: trie(new Map(noms.data.map((t) => [t.id, t.nom]))),
      types: (types ?? []).map((t) => ({
        id: t.id as string,
        libelle: t.libelle as string,
      })),
    },
  });
}
