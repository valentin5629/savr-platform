import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';

/**
 * GET /api/v1/dashboards/evolution — Bloc 2 (évolution mensuelle) + Bloc 4 (donut)
 * du dashboard client (§11 §2/§4/§5, §06.04 Bloc 2/4, §06.05 Bloc 2/4).
 *
 * « 1 dashboard, 3 contextes » : endpoint PARTAGÉ traiteur / agence / gestionnaire.
 * Le périmètre change par rôle (défense en profondeur EN PLUS de la RLS) :
 *   - traiteur / agence → evenements.organisation_id = organisation courante
 *     (org programmatrice, identique à v_kpi_traiteur / kpi-traiteur).
 *   - gestionnaire      → evenements.lieu_id ∈ organisations_lieux (parc RLS-scopé).
 *
 * Renvoie une série temporelle à granularité automatique (§06.04 Bloc 2 : jour si
 * <30 j, semaine si <12 mois, mois sinon) agrégée depuis collecte_flux (par flux ZD)
 * et attributions_antgaspi (repas/pax AG). Aucune vue nouvelle : agrégation TS sur
 * les tables sources (mêmes jointures que /gestionnaire/dashboard).
 */

const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
] as const;

const FLUX_CODES = [
  'biodechet',
  'emballage',
  'carton',
  'verre',
  'dechet_residuel',
] as const;

type Granularite = 'jour' | 'semaine' | 'mois';

interface EvtEmbed {
  id: string;
  lieu_id: string | null;
  pax: number | null;
  organisation_id: string;
  type_evenement_id: string | null;
  traiteur_operationnel_organisation_id: string | null;
}

interface CollecteRow {
  id: string;
  type: string;
  taux_recyclage: number | null;
  date_collecte: string;
  evenements: EvtEmbed | EvtEmbed[] | null;
  collecte_flux:
    | { poids_reel_kg: number | null; flux_dechets: { code: string } | null }[]
    | null;
  attributions_antgaspi: { volume_repas_realise: number | null }[] | null;
}

function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

function evtOf(c: CollecteRow): EvtEmbed | null {
  return Array.isArray(c.evenements) ? (c.evenements[0] ?? null) : c.evenements;
}

// Granularité auto (§06.04 Bloc 2). Bornes en jours calendaires.
function granulariteFor(from: string, to: string): Granularite {
  const spanDays = (Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60 * 24);
  if (spanDays < 30) return 'jour';
  if (spanDays < 365) return 'semaine';
  return 'mois';
}

// Clé de bucket (ISO date) selon la granularité. Le front formate l'étiquette.
function bucketKey(dateStr: string, g: Granularite): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (g === 'mois') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  if (g === 'semaine') {
    // Lundi de la semaine ISO.
    const dow = (d.getUTCDay() + 6) % 7; // 0 = lundi
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuIds = sp.getAll('lieu_ids[]');
  const traiteurIds = sp.getAll('traiteur_ids[]');
  const typeEvtIds = sp.getAll('type_evenement_ids[]');
  const tailleEvts = sp.getAll('taille_evenements[]');

  const isGestionnaire = auth.ctx.role === 'gestionnaire_lieux';

  // Périmètre gestionnaire = lieux de l'organisation (RLS sur organisations_lieux).
  let perimetreLieuIds: string[] = [];
  if (isGestionnaire) {
    const { data: orgLieux } = await supabase
      .from('organisations_lieux')
      .select('lieu_id');
    perimetreLieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
    const lieuFilter =
      lieuIds.length > 0
        ? lieuIds.filter((id) => perimetreLieuIds.includes(id))
        : perimetreLieuIds;
    if (lieuFilter.length === 0) {
      return NextResponse.json({
        data: { granularite: granulariteFor(from ?? '', to ?? ''), series: [] },
      });
    }
    perimetreLieuIds = lieuFilter;
  }

  let q = supabase
    .from('collectes')
    .select(
      `id, type, taux_recyclage, date_collecte,
       evenements!inner(id, lieu_id, pax, organisation_id, type_evenement_id,
         traiteur_operationnel_organisation_id),
       collecte_flux(poids_reel_kg, flux_dechets(code)),
       attributions_antgaspi(volume_repas_realise)`,
    )
    .eq('statut', 'cloturee')
    .eq('type', type);

  if (isGestionnaire) {
    q = q.in('evenements.lieu_id', perimetreLieuIds);
    if (traiteurIds.length > 0)
      q = q.in('evenements.traiteur_operationnel_organisation_id', traiteurIds);
  } else {
    // traiteur / agence — org programmatrice (donneur d'ordre pour l'agence).
    q = q.eq('evenements.organisation_id', auth.ctx.organisationId);
    if (lieuIds.length > 0) q = q.in('evenements.lieu_id', lieuIds);
  }
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);
  if (typeEvtIds.length > 0)
    q = q.in('evenements.type_evenement_id', typeEvtIds);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as unknown as CollecteRow[]).filter((c) => {
    const evt = evtOf(c);
    if (!evt) return false;
    if (tailleEvts.length > 0) {
      if (!tailleEvts.includes(tailleBracket(evt.pax ?? 0))) return false;
    }
    return true;
  });

  const g =
    from && to
      ? granulariteFor(from, to)
      : granulariteFor(from ?? to ?? '', to ?? from ?? '');

  if (type === 'zero_dechet') {
    // Bucket → { flux → kg, tonnage, tauxNum, tauxDen }
    const buckets = new Map<
      string,
      {
        flux: Record<string, number>;
        tonnage: number;
        tauxNum: number;
        tauxDen: number;
      }
    >();
    for (const c of rows) {
      const key = bucketKey(c.date_collecte, g);
      let b = buckets.get(key);
      if (!b) {
        b = { flux: {}, tonnage: 0, tauxNum: 0, tauxDen: 0 };
        for (const fc of FLUX_CODES) b.flux[fc] = 0;
        buckets.set(key, b);
      }
      const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
      let kgCollecte = 0;
      for (const f of flux) {
        const kg = f.poids_reel_kg ?? 0;
        const code = f.flux_dechets?.code;
        if (code && code in b.flux) b.flux[code] = (b.flux[code] ?? 0) + kg;
        kgCollecte += kg;
      }
      b.tonnage += kgCollecte;
      // Taux pondéré par tonnage, exclut les collectes sans taux (§05 R_taux_recyclage).
      if (c.taux_recyclage != null && kgCollecte > 0) {
        b.tauxNum += c.taux_recyclage * kgCollecte;
        b.tauxDen += kgCollecte;
      }
    }
    const series = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periode, b]) => ({
        periode,
        ...b.flux,
        tonnage_total: b.tonnage,
        taux_recyclage: b.tauxDen > 0 ? b.tauxNum / b.tauxDen : null,
      }));
    return NextResponse.json(
      { data: { granularite: g, series } },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  }

  // anti_gaspi — repas donnés + pax distinct par événement par bucket.
  const buckets = new Map<
    string,
    { repas: number; paxParEvt: Map<string, number> }
  >();
  for (const c of rows) {
    const key = bucketKey(c.date_collecte, g);
    let b = buckets.get(key);
    if (!b) {
      b = { repas: 0, paxParEvt: new Map() };
      buckets.set(key, b);
    }
    const attrs = Array.isArray(c.attributions_antgaspi)
      ? c.attributions_antgaspi
      : [];
    for (const a of attrs) b.repas += a.volume_repas_realise ?? 0;
    const evt = evtOf(c);
    if (evt?.id && !b.paxParEvt.has(evt.id))
      b.paxParEvt.set(evt.id, evt.pax ?? 0);
  }
  const series = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periode, b]) => {
      const pax = [...b.paxParEvt.values()].reduce((s, p) => s + p, 0);
      return {
        periode,
        repas_donnes: b.repas,
        pax,
        ratio: pax > 0 ? b.repas / pax : null,
      };
    });
  return NextResponse.json(
    { data: { granularite: g, series } },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
