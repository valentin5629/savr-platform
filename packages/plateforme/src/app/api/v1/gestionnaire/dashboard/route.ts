import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';
import {
  computeDashboardKpi,
  tailleBracket,
  type DashboardCollecteRow,
} from '@/lib/dashboard-kpi.js';
import {
  kgParPaxParFluxFrom,
  type BlocsCollecteRow,
} from '@/lib/dashboards/loaders.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/dashboard
// KPI 4 cartes (onglet ZD ou AG) + pack actif.
// Filtrés sur les lieux de l'organisation via RLS + evenements.lieu_id ∈ organisations_lieux.
// Paramètres : type ('zero_dechet'|'anti_gaspi'), from, to, lieu_ids, traiteur_ids,
//              type_evenement_ids, taille_evenements
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type') ?? 'zero_dechet';
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuIds = sp.getAll('lieu_ids[]');
  const traiteurIds = sp.getAll('traiteur_ids[]');
  const typesDemandes = sp.getAll('type_evenement_ids[]');
  const typeEvtIds = typesDemandes.filter(estUuid);
  const tailleEvts = sp.getAll('taille_evenements[]');
  // Filtre Type demandé sans identifiant lisible : aucune collecte retenue,
  // jamais un filtre ignoré ni une erreur de PostgREST (comme
  // lireFiltresCollectesGestionnaire).
  const typeIllisible = typesDemandes.length > 0 && typeEvtIds.length === 0;

  // Lieux du périmètre gestionnaire
  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const perimetreLieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  const lieuFilter =
    lieuIds.length > 0
      ? lieuIds.filter((id) => perimetreLieuIds.includes(id))
      : perimetreLieuIds;

  if (lieuFilter.length === 0) {
    return NextResponse.json({ data: { kpis: nullKpis(type), pack: null } });
  }

  // Collectes cloturees sur le périmètre
  const lireCollectes = async () => {
    let q = supabase
      .from('collectes')
      .select(
        `id, type, taux_recyclage, realisee_at, pax, type_evenement_id,
         evenements!inner(id, lieu_id, traiteur_operationnel_organisation_id),
         collecte_flux(poids_reel_kg, flux_dechets(code)),
         attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)`,
      )
      .eq('statut', 'cloturee')
      .eq('type', type)
      .in('evenements.lieu_id', lieuFilter);

    // Filtre de période sur date_collecte (NOT NULL), cohérent avec les vues KPI
    // M3.5 (date_trunc month sur date_collecte) et la règle revenus §06.06 §1.
    // realisee_at (nullable) excluait à tort des collectes cloturées sans realisee_at.
    if (from) q = q.gte('date_collecte', from);
    if (to) q = q.lte('date_collecte', to);
    if (traiteurIds.length > 0)
      q = q.in('evenements.traiteur_operationnel_organisation_id', traiteurIds);
    // Type et taille d'événement : ceux de la COLLECTE (décisions Val C3 du
    // 2026-10-22, lot C1 Q3 du 2026-10-24 « Collecte, dès C1 »).
    if (typeEvtIds.length > 0) q = q.in('type_evenement_id', typeEvtIds);
    return q;
  };

  const { data: collectes, error } = typeIllisible
    ? { data: [], error: null }
    : await lireCollectes();
  if (error) return serverError(error, 'gestionnaire.dashboard.list');

  const rows = (collectes ?? []).filter((c) => {
    const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
    if (!evt) return false;
    if (tailleEvts.length > 0) {
      const bracket = tailleBracket(c.pax ?? 0);
      if (!tailleEvts.includes(bracket)) return false;
    }
    return true;
  });

  // KPI et kg/pax par flux (jauge §06.05 Bloc 3, comparée à SON repère parc) :
  // même calcul que le Dashboard Client Admin — pax des COLLECTES, collecte à
  // 0 convive écartée des ratios (lot 3, décisions Val Q1 et Q2 du 2026-10-25).
  const kpis = computeDashboardKpi(
    rows as unknown as DashboardCollecteRow[],
    type === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet',
  );
  const kgParPaxParFlux =
    type === 'zero_dechet'
      ? kgParPaxParFluxFrom(rows as unknown as BlocsCollecteRow[])
      : {};

  // Pack AG (conditionnel — navigation)
  const { data: pack } = await supabase
    .from('packs_antgaspi')
    .select('id, credits_initiaux, credits_consommes, credits_restants, statut')
    .eq('statut', 'actif')
    .maybeSingle();

  return NextResponse.json({
    data: { kpis, pack: pack ?? null, kg_par_pax_par_flux: kgParPaxParFlux },
  });
}

function nullKpis(type: string): Record<string, null> {
  if (type === 'zero_dechet') {
    return {
      nb_collectes: null,
      tonnage_kg: null,
      taux_recyclage_pondere: null,
      kg_par_pax: null,
    };
  }
  return {
    nb_collectes: null,
    nb_repas_donnes: null,
    pax_total: null,
    repas_par_pax: null,
  };
}
