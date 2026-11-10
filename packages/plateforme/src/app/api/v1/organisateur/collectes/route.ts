import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  creneauDeLaVue,
  lireVueCollectes,
} from '@/lib/collectes/vue-temporelle.js';
import { lireParPages, TAILLE_PAGE } from '@/lib/pdf/selection-par-pages.js';
import { resolveRepas } from '@/lib/exports/shared.js';

const ORGANISATEUR_ROLES: ClientRole[] = ['client_organisateur'];

// GET /api/v1/organisateur/collectes — liste des collectes des événements du
// client organisateur (§11 §7, lecture seule). La RLS (col_select → f_collecte_visible)
// scope sur evenements.client_organisateur_organisation_id ; on re-scope côté serveur
// (défense en profondeur) via evenements!inner. Filtres : type (onglet ZD/AG), période.
// Colonnes §11 §7 « date, nom, lieu, traiteur, pax, repas ». Le nom du traiteur passe
// par la vue whitelist v_referentiel_traiteurs (RLS organisations = self-only, A-4) ;
// les repas détournés (AG) par le helper C-1-safe f_volume_repas_realise.
// Aucune donnée financière exposée (pas de marge, pas de facture).
// La liste est lue page après page (`lireParPages`) : une réponse est amputée à
// 1 000 lignes sans erreur, les collectes les plus anciennes manquaient alors.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ORGANISATEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const vue = lireVueCollectes(searchParams.get('vue'));

  // Un seul « maintenant » pour toutes les pages de la vue.
  const maintenant = new Date();
  const lirePage = (apresId: string | null) => {
    let query = supabase
      .from('collectes')
      .select(
        `id, type, statut, date_collecte, heure_collecte, pax, taux_recyclage,
         co2_induit_kg, co2_evite_kg, co2_net_kg, energie_primaire_evitee_kwh,
         evenements!inner(
           id, client_organisateur_organisation_id, traiteur_operationnel_organisation_id,
           nom_evenement,
           lieux!lieu_id(id, nom, code_postal, ville)
         )`,
      )
      .eq(
        'evenements.client_organisateur_organisation_id',
        auth.ctx.organisationId,
      );

    if (type === 'zero_dechet' || type === 'anti_gaspi') {
      query = query.eq('type', type);
    }
    if (from) query = query.gte('date_collecte', from);
    if (to) query = query.lte('date_collecte', to);
    // Vue « à venir / passées » : rangée au créneau, à la minute (Val 2026-11-03).
    if (vue) query = query.or(creneauDeLaVue(vue, maintenant));
    if (apresId) query = query.gt('id', apresId);
    return query.order('id', { ascending: true }).limit(TAILLE_PAGE);
  };

  const lu = await lireParPages<
    { id: string; date_collecte: string } & Record<string, unknown>
  >(lirePage);
  if (lu.error) return serverError(lu.error, 'organisateur.collectes.list');
  // Date décroissante ; l'identifiant départage les collectes d'un même jour.
  const rows = lu.data.sort((a, b) =>
    a.date_collecte === b.date_collecte
      ? a.id < b.id
        ? 1
        : -1
      : a.date_collecte < b.date_collecte
        ? 1
        : -1,
  );

  // Résolution du nom du traiteur opérationnel via la vue whitelist (RLS self-only
  // sur organisations sinon). Une seule requête .in().
  const evtOf = (r: Record<string, unknown>): Record<string, unknown> => {
    const e = r.evenements as
      | Record<string, unknown>
      | Record<string, unknown>[];
    return Array.isArray(e) ? (e[0] ?? {}) : (e ?? {});
  };
  const traiteurIds = [
    ...new Set(
      rows
        .map(
          (r) =>
            evtOf(r).traiteur_operationnel_organisation_id as string | null,
        )
        .filter((v): v is string => !!v),
    ),
  ];
  const traiteurNoms = new Map<string, string>();
  if (traiteurIds.length > 0) {
    const { data: traiteurs } = await supabase
      .from('v_referentiel_traiteurs')
      .select('id, nom')
      .in('id', traiteurIds);
    for (const t of (traiteurs ?? []) as Record<string, unknown>[]) {
      // Libellé unique porté par la vue (20260922080000).
      traiteurNoms.set(t.id as string, t.nom as string);
    }
  }

  // Repas détournés (AG) — helper C-1-safe, uniquement pour les collectes
  // anti_gaspi : un appel par collecte, par vagues ; un appel en échec rend une
  // erreur, jamais des repas absents.
  let repasParCollecte: Map<string, number>;
  try {
    repasParCollecte = await resolveRepas(
      supabase as unknown as Parameters<typeof resolveRepas>[0],
      rows.filter((r) => r.type === 'anti_gaspi').map((r) => r.id),
    );
  } catch (e) {
    return serverError(e, 'organisateur.collectes.repas');
  }

  const enriched = rows.map((r) => ({
    ...r,
    traiteur_nom:
      traiteurNoms.get(
        evtOf(r).traiteur_operationnel_organisation_id as string,
      ) ?? null,
    repas_donnes: repasParCollecte.get(r.id as string) ?? null,
  }));

  return NextResponse.json({ data: enriched });
}
