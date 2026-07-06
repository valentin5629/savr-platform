import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

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
  const typeEvtIds = sp.getAll('type_evenement_ids[]');
  const tailleEvts = sp.getAll('taille_evenements[]');

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
  let q = supabase
    .from('collectes')
    .select(
      `id, type, taux_recyclage, realisee_at,
       evenements!inner(id, lieu_id, pax, type_evenement_id,
         traiteur_operationnel_organisation_id),
       collecte_flux(poids_reel_kg, flux_dechets(code)),
       attributions_antgaspi(volume_repas_realise)`,
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
  if (typeEvtIds.length > 0)
    q = q.in('evenements.type_evenement_id', typeEvtIds);

  const { data: collectes, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (collectes ?? []).filter((c) => {
    const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
    if (!evt) return false;
    if (tailleEvts.length > 0) {
      const bracket = tailleBracket(evt.pax as number);
      if (!tailleEvts.includes(bracket)) return false;
    }
    return true;
  });

  let kpis: Record<string, number | null>;
  // kg/pax PAR FLUX du gestionnaire (jauge §06.05 Bloc 3 : ratio kg du flux / pax) —
  // pour comparer chaque flux à SON point rouge benchmark (ZD uniquement).
  const kgParPaxParFlux: Record<string, number> = {};
  if (type === 'zero_dechet') {
    const nbCollectes = rows.length;
    const tonnageTotal = rows.reduce((s, c) => {
      const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
      return (
        s +
        flux.reduce(
          (sf, f) =>
            sf + ((f as { poids_reel_kg?: number }).poids_reel_kg ?? 0),
          0,
        )
      );
    }, 0);
    const paxTotal = paxTotalDistinct(rows);
    // Taux pondéré excluant NULL
    const { tauxNum, tauxDen } = rows.reduce(
      (acc, c) => {
        const taux = c.taux_recyclage as number | null;
        const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
        const kg = flux.reduce(
          (sf, f) =>
            sf + ((f as { poids_reel_kg?: number }).poids_reel_kg ?? 0),
          0,
        );
        if (taux !== null && kg > 0) {
          return {
            tauxNum: acc.tauxNum + taux * kg,
            tauxDen: acc.tauxDen + kg,
          };
        }
        return acc;
      },
      { tauxNum: 0, tauxDen: 0 },
    );
    const tauxMoyen = tauxDen > 0 ? tauxNum / tauxDen : null;
    const kgParPax = paxTotal > 0 ? tonnageTotal / paxTotal : null;
    // Poids cumulé par flux (via l'embed flux_dechets(code)) / pax cumulés.
    if (paxTotal > 0) {
      const poidsParFlux: Record<string, number> = {};
      for (const c of rows) {
        const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
        for (const f of flux) {
          const fd = (
            f as { flux_dechets?: { code?: string } | { code?: string }[] }
          ).flux_dechets;
          const code = (Array.isArray(fd) ? fd[0] : fd)?.code;
          const poids = (f as { poids_reel_kg?: number }).poids_reel_kg ?? 0;
          if (code) poidsParFlux[code] = (poidsParFlux[code] ?? 0) + poids;
        }
      }
      for (const [code, p] of Object.entries(poidsParFlux))
        kgParPaxParFlux[code] = p / paxTotal;
    }
    kpis = {
      nb_collectes: nbCollectes,
      tonnage_kg: tonnageTotal,
      taux_recyclage_pondere: tauxMoyen,
      kg_par_pax: kgParPax,
    };
  } else {
    const nbCollectes = rows.length;
    const repasTotal = rows.reduce((s, c) => {
      const attrs = Array.isArray(c.attributions_antgaspi)
        ? c.attributions_antgaspi
        : [];
      return (
        s +
        attrs.reduce(
          (sa, a) =>
            sa +
            ((a as { volume_repas_realise?: number }).volume_repas_realise ??
              0),
          0,
        )
      );
    }, 0);
    const paxTotal = paxTotalDistinct(rows);
    const repasParPax = paxTotal > 0 ? repasTotal / paxTotal : null;
    kpis = {
      nb_collectes: nbCollectes,
      nb_repas_donnes: repasTotal,
      pax_total: paxTotal,
      repas_par_pax: repasParPax,
    };
  }

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

// M3 : Σ pax sur les ÉVÉNEMENTS DISTINCTS — un événement à 2+ collectes ne
// compte son pax qu'une fois (réplique v_kpi_traiteur). Sommer evt.pax par ligne
// collecte gonflait le pax → kg/pax & repas/pax faux.
type RowAvecEvt = {
  evenements:
    | { id?: string | null; pax?: number | null }
    | Array<{ id?: string | null; pax?: number | null }>
    | null;
};
function paxTotalDistinct(rows: RowAvecEvt[]): number {
  const parEvenement = new Map<string, number>();
  let sansId = 0;
  for (const c of rows) {
    const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
    const pax = evt?.pax ?? 0;
    const id = evt?.id ?? null;
    if (id == null) sansId += pax;
    else if (!parEvenement.has(id)) parEvenement.set(id, pax);
  }
  let total = sansId;
  for (const p of parEvenement.values()) total += p;
  return total;
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

function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}
