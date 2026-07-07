// Snapshot de données pour le rapport de synthèse agrégé PDF (§12 Reporting §1.6).
//
// Construit — SOUS LE JWT DU DEMANDEUR (RLS plateforme.f_collecte_visible appliquée) —
// l'objet passé au renderer Railway (type_document 'synthese-dashboard'). Agrégation
// TS sur les tables sources (aucune vue), mêmes jointures que /dashboards/blocs et
// /dashboards/evolution.
//
// Périmètre PAR RÔLE (§1.6 l.246-249), en défense en profondeur EN PLUS de la RLS :
//   - traiteur (manager + commercial) : evenements.traiteur_operationnel_organisation_id = org
//     (collectes OPÉRÉES, peu importe le programmateur — distinct du dashboard qui
//     scope sur organisation_id).
//   - agence : evenements.organisation_id = org (collectes programmées).
//   - gestionnaire : collectes sur ses lieux (lieu_id ∈ organisations_lieux) OU
//     celles qu'il a programmées (organisation_id = org) — union de 2 requêtes.
//
// Prédicat d'inclusion (§1.6 l.326, F4 2026-06-07) : statut='cloturee' ET
// realisee_at + 24h <= now() (embargo canonique H+24 — filtre les collectes, ne
// bloque jamais la génération). Sections rendues selon le(s) type(s) sélectionné(s)
// (décision Val 2026-07-07) : la route omet flux/co2/évolution hors ZD, assos hors AG.

import type { createSupabaseServerClient } from '@/lib/api-auth.js';

type Supa = ReturnType<typeof createSupabaseServerClient>;

export type SyntheseRole =
  | 'traiteur_manager'
  | 'traiteur_commercial'
  | 'agence'
  | 'gestionnaire_lieux';

export interface SyntheseParams {
  from: string | null; // date_collecte >= (YYYY-MM-DD)
  to: string | null; // date_collecte <= (YYYY-MM-DD)
  types: ('zero_dechet' | 'anti_gaspi')[]; // vide OU 2 → ZD + AG
  lieuIds: string[];
  traiteurIds: string[]; // gestionnaire : filtre traiteur opérationnel
  clientOrgaIds: string[]; // traiteur/agence : filtre client organisateur
  commercialIds: string[]; // manager : filtre commercial (evenements.created_by)
  typeEvtIds: string[];
  tailleEvts: string[];
}

// ── Forme du payload envoyé au renderer (mirroir de SyntheseDashboardData) ───
export interface SyntheseFluxLigne {
  nom: string;
  poids_kg: number;
}
export interface SyntheseAssoLigne {
  association_nom: string;
  nb_collectes: number;
  repas_donnes: number;
  poids_kg: number;
}
export interface SyntheseLieuLigne {
  lieu_nom: string;
  nb_collectes: number;
  tonnage_kg: number;
}
export interface SyntheseTraiteurLigne {
  traiteur_nom: string;
  nb_collectes: number;
  tonnage_kg: number;
}
export interface SyntheseEvolutionMois {
  mois: string;
  tonnage_kg: number;
  taux_recyclage: number | null;
}
export interface SyntheseDetailLigne {
  date_evenement: string;
  evenement: string;
  lieu: string;
  type: string;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
}
export interface SyntheseCo2 {
  evite_kg: number;
  induit_kg: number;
  net_kg: number;
  energie_primaire_evitee_kwh: number;
  equiv_km_voiture?: number | null;
  facteurs_version?: string | null;
}
export interface SyntheseSnapshot {
  organisation_nom: string;
  perimetre_label: string;
  periode_label: string;
  filtres_label?: string | null;
  date_generation: string;
  nb_collectes: number;
  inclut_zd: boolean;
  inclut_ag: boolean;
  tonnage_zd_kg: number;
  tonnage_ag_kg: number;
  taux_recyclage_moyen_pondere?: number | null;
  nb_repas_donnes: number;
  co2?: SyntheseCo2 | null;
  flux_zd?: SyntheseFluxLigne[] | null;
  associations_ag?: SyntheseAssoLigne[] | null;
  lieux?: SyntheseLieuLigne[] | null;
  traiteurs?: SyntheseTraiteurLigne[] | null;
  evolution?: SyntheseEvolutionMois[] | null;
  detail: SyntheseDetailLigne[];
  co2_facteurs_snapshot?: Record<string, unknown> | null;
}

const FLUX_LABELS: Record<string, string> = {
  biodechet: 'Biodéchets',
  emballage: 'Emballages',
  carton: 'Carton',
  verre: 'Verre',
  dechet_residuel: 'Déchet résiduel',
};
const FLUX_ORDER = [
  'biodechet',
  'emballage',
  'carton',
  'verre',
  'dechet_residuel',
];
const TOP_ASSOS = 3;
const PERIMETRE_LABELS: Record<SyntheseRole, string> = {
  traiteur_manager: 'traiteur',
  traiteur_commercial: 'traiteur',
  agence: 'agence',
  gestionnaire_lieux: 'gestionnaire de lieux',
};

// ── Types des lignes remontées ───────────────────────────────────────────────
interface EvtEmbed {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  lieu_id: string | null;
  pax: number | null;
  organisation_id: string;
  client_organisateur_organisation_id: string | null;
  type_evenement_id: string | null;
  traiteur_operationnel_organisation_id: string | null;
  created_by: string | null;
  lieux: { id: string; nom: string } | { id: string; nom: string }[] | null;
}
interface AttrEmbed {
  volume_repas_realise: number | null;
  association_id: string | null;
  associations:
    | { id: string; nom: string; ville: string | null }
    | { id: string; nom: string; ville: string | null }[]
    | null;
}
interface CollecteRow {
  id: string;
  type: string;
  taux_recyclage: number | null;
  date_collecte: string;
  co2_evite_kg: number | null;
  co2_induit_kg: number | null;
  co2_net_kg: number | null;
  energie_primaire_evitee_kwh: number | null;
  co2_facteurs_snapshot: Record<string, unknown> | null;
  evenements: EvtEmbed | EvtEmbed[] | null;
  collecte_flux:
    | { poids_reel_kg: number | null; flux_dechets: { code: string } | null }[]
    | null;
  attributions_antgaspi: AttrEmbed[] | AttrEmbed | null;
}

const SELECT = `id, type, taux_recyclage, date_collecte,
  co2_evite_kg, co2_induit_kg, co2_net_kg, energie_primaire_evitee_kwh, co2_facteurs_snapshot,
  evenements!inner(id, nom_evenement, date_evenement, lieu_id, pax, organisation_id,
    client_organisateur_organisation_id, type_evenement_id,
    traiteur_operationnel_organisation_id, created_by, lieux(id, nom)),
  collecte_flux(poids_reel_kg, flux_dechets(code)),
  attributions_antgaspi(volume_repas_realise, association_id,
    associations!association_id(id, nom, ville))`;

// ── Helpers de normalisation embed PostgREST ─────────────────────────────────
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function evtOf(c: CollecteRow): EvtEmbed | null {
  return firstOf(c.evenements);
}
function attrsOf(c: CollecteRow): AttrEmbed[] {
  const a = c.attributions_antgaspi;
  return Array.isArray(a) ? a : a ? [a] : [];
}
function kgOf(c: CollecteRow): number {
  const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
  return flux.reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}
function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}
function frDate(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso;
}
function num(n: number | null | undefined): number {
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

/**
 * Construit le snapshot du rapport de synthèse. `nowIso` (horodatage de
 * génération) et `cutoffIso` (borne embargo = now-24h) sont injectés pour la
 * testabilité (Date.now() interdit dans les tests déterministes).
 */
export async function buildSyntheseSnapshot(
  supabase: Supa,
  ctx: { role: SyntheseRole; organisationId: string; organisationNom: string },
  params: SyntheseParams,
  clock: { nowIso: string; cutoffIso: string; dateGenerationLabel: string },
): Promise<SyntheseSnapshot> {
  const includeZd =
    params.types.length === 0 || params.types.includes('zero_dechet');
  const includeAg =
    params.types.length === 0 || params.types.includes('anti_gaspi');

  const rows = await fetchScopedRows(supabase, ctx, params, clock.cutoffIso);

  // Filtre taille d'événement (bracket sur pax) — post-fetch comme les endpoints blocs.
  const filtered = rows.filter((c) => {
    const evt = evtOf(c);
    if (!evt) return false;
    if (params.tailleEvts.length > 0) {
      if (!params.tailleEvts.includes(tailleBracket(evt.pax ?? 0)))
        return false;
    }
    return true;
  });

  const zdRows = filtered.filter((c) => c.type === 'zero_dechet');
  const agRows = filtered.filter((c) => c.type === 'anti_gaspi');

  // ── Section 1 — chiffres clés ──
  const tonnageZd = zdRows.reduce((s, c) => s + kgOf(c), 0);
  const tonnageAg = agRows.reduce((s, c) => s + kgOf(c), 0);
  let tauxNum = 0;
  let tauxDen = 0;
  for (const c of zdRows) {
    const kg = kgOf(c);
    if (c.taux_recyclage != null && kg > 0) {
      tauxNum += c.taux_recyclage * kg;
      tauxDen += kg;
    }
  }
  const tauxMoyen = tauxDen > 0 ? tauxNum / tauxDen : null;
  const nbRepas = agRows.reduce(
    (s, c) =>
      s + attrsOf(c).reduce((x, a) => x + num(a.volume_repas_realise), 0),
    0,
  );

  // Impact carbone agrégé (ZD).
  let co2: SyntheseCo2 | null = null;
  if (includeZd && zdRows.length > 0) {
    const evite = zdRows.reduce((s, c) => s + num(c.co2_evite_kg), 0);
    const induit = zdRows.reduce((s, c) => s + num(c.co2_induit_kg), 0);
    const net = zdRows.reduce((s, c) => s + num(c.co2_net_kg), 0);
    const energie = zdRows.reduce(
      (s, c) => s + num(c.energie_primaire_evitee_kwh),
      0,
    );
    const snap = snapshotOf(zdRows);
    co2 = {
      evite_kg: Math.round(evite),
      induit_kg: Math.round(induit),
      net_kg: Math.round(net),
      energie_primaire_evitee_kwh: Math.round(energie),
      equiv_km_voiture: equivKmVoiture(snap, evite),
      facteurs_version: facteursVersion(snap),
    };
  }

  // ── Section 2 — ventilation par flux (ZD) ──
  const fluxZd = includeZd ? ventilationFlux(zdRows) : null;

  // ── Section 3 — ventilation Anti-Gaspi ──
  const assos = includeAg ? topAssociations(agRows) : null;

  // ── Section 4 — ventilation géographique (+ Section traiteurs gestionnaire) ──
  const lieux = ventilationLieux(filtered);
  const traiteurs =
    ctx.role === 'gestionnaire_lieux'
      ? await ventilationTraiteurs(supabase, filtered)
      : null;
  // §1.6 l.302 : géographique si ≥2 lieux ; §06.05 §4 l.417 : systématique (gestionnaire).
  const showLieux =
    ctx.role === 'gestionnaire_lieux' ? lieux.length > 0 : lieux.length >= 2;

  // ── Section 5 — évolution mensuelle (ZD) ──
  const evolution = includeZd ? evolutionMensuelle(zdRows) : null;

  // ── Section 6 — détail (1 ligne par événement) ──
  const detail = detailParEvenement(filtered);

  // ── Métadonnées page de garde ──
  const perimetre = PERIMETRE_LABELS[ctx.role];
  const periodeLabel = `${frDate(params.from)} → ${frDate(params.to)}`;
  const filtresLabel = buildFiltresLabel(params, includeZd, includeAg);

  return {
    organisation_nom: ctx.organisationNom,
    perimetre_label: perimetre,
    periode_label: periodeLabel,
    filtres_label: filtresLabel,
    date_generation: clock.dateGenerationLabel,
    nb_collectes: filtered.length,
    inclut_zd: includeZd,
    inclut_ag: includeAg,
    tonnage_zd_kg: tonnageZd,
    tonnage_ag_kg: tonnageAg,
    taux_recyclage_moyen_pondere: includeZd ? tauxMoyen : null,
    nb_repas_donnes: nbRepas,
    co2,
    flux_zd: fluxZd,
    associations_ag: assos,
    lieux: showLieux ? lieux : null,
    traiteurs,
    evolution,
    detail,
    co2_facteurs_snapshot: co2 ? snapshotOf(zdRows) : null,
  };
}

// Builder PostgREST minimal — chaînage typé (eq/in/gte/lte → FB), awaité comme un
// thenable. Évite `any` (no-explicit-any) tout en s'affranchissant de la distinction
// QueryBuilder/FilterBuilder du client Supabase généré.
interface FB {
  eq(column: string, value: unknown): FB;
  in(column: string, values: unknown[]): FB;
  gte(column: string, value: unknown): FB;
  lte(column: string, value: unknown): FB;
}

// ── Fetch scopé par rôle (défense en profondeur + RLS) ───────────────────────
async function fetchScopedRows(
  supabase: Supa,
  ctx: { role: SyntheseRole; organisationId: string },
  params: SyntheseParams,
  cutoffIso: string,
): Promise<CollecteRow[]> {
  // Filtres communs (période, type, type d'événement, client orga, commerciaux) +
  // prédicat d'inclusion (cloturee ET realisee_at + 24h <= now(), embargo H+24 —
  // `.lte('realisee_at', cutoff)` exclut aussi les realisee_at NULL).
  const applyCommon = (q: FB): FB => {
    let x = q.eq('statut', 'cloturee').lte('realisee_at', cutoffIso);
    if (params.types.length === 1) x = x.eq('type', params.types[0] as string);
    if (params.from) x = x.gte('date_collecte', params.from);
    if (params.to) x = x.lte('date_collecte', params.to);
    if (params.typeEvtIds.length > 0)
      x = x.in('evenements.type_evenement_id', params.typeEvtIds);
    if (params.clientOrgaIds.length > 0)
      x = x.in(
        'evenements.client_organisateur_organisation_id',
        params.clientOrgaIds,
      );
    if (params.commercialIds.length > 0)
      x = x.in('evenements.created_by', params.commercialIds);
    return x;
  };

  const runQuery = async (scope: (q: FB) => FB): Promise<CollecteRow[]> => {
    const base = supabase.from('collectes').select(SELECT) as unknown as FB;
    const q = scope(applyCommon(base));
    const { data, error } = await (q as unknown as Promise<{
      data: unknown;
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CollecteRow[];
  };

  const withTraiteurFilter = (q: FB): FB =>
    params.traiteurIds.length > 0
      ? q.in(
          'evenements.traiteur_operationnel_organisation_id',
          params.traiteurIds,
        )
      : q;

  if (ctx.role === 'gestionnaire_lieux') {
    const { data: orgLieux } = await supabase
      .from('organisations_lieux')
      .select('lieu_id');
    const parc = (orgLieux ?? []).map((r) => r.lieu_id as string);
    const effectiveParc =
      params.lieuIds.length > 0
        ? params.lieuIds.filter((id) => parc.includes(id))
        : parc;

    const byId = new Map<string, CollecteRow>();
    // (A) collectes sur ses lieux.
    if (effectiveParc.length > 0) {
      const a = await runQuery((q) =>
        withTraiteurFilter(q.in('evenements.lieu_id', effectiveParc)),
      );
      for (const r of a) byId.set(r.id, r);
    }
    // (B) collectes qu'il a programmées (org = current) — seulement sans filtre lieu
    // explicite (sinon l'utilisateur a restreint le périmètre à des lieux précis).
    if (params.lieuIds.length === 0) {
      const b = await runQuery((q) =>
        withTraiteurFilter(
          q.eq('evenements.organisation_id', ctx.organisationId),
        ),
      );
      for (const r of b) byId.set(r.id, r);
    }
    return [...byId.values()];
  }

  // traiteur (opérationnel) / agence (programmateur).
  const orgCol =
    ctx.role === 'agence'
      ? 'evenements.organisation_id'
      : 'evenements.traiteur_operationnel_organisation_id';
  return runQuery((q) => {
    const scoped = q.eq(orgCol, ctx.organisationId);
    return params.lieuIds.length > 0
      ? scoped.in('evenements.lieu_id', params.lieuIds)
      : scoped;
  });
}

// ── Agrégateurs ──────────────────────────────────────────────────────────────
function ventilationFlux(zdRows: CollecteRow[]): SyntheseFluxLigne[] {
  const parCode: Record<string, number> = {};
  for (const c of zdRows) {
    const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
    for (const f of flux) {
      const code = f.flux_dechets?.code;
      if (code) parCode[code] = (parCode[code] ?? 0) + num(f.poids_reel_kg);
    }
  }
  const ordered = FLUX_ORDER.filter((code) => (parCode[code] ?? 0) > 0).map(
    (code) => ({
      nom: FLUX_LABELS[code] ?? code,
      poids_kg: parCode[code] ?? 0,
    }),
  );
  // Flux hors nomenclature connue (défensif).
  for (const [code, poids] of Object.entries(parCode)) {
    if (!FLUX_ORDER.includes(code) && poids > 0)
      ordered.push({ nom: FLUX_LABELS[code] ?? code, poids_kg: poids });
  }
  return ordered;
}

function topAssociations(agRows: CollecteRow[]): SyntheseAssoLigne[] {
  const groups = new Map<
    string,
    { nom: string; collectes: Set<string>; repas: number; poids: number }
  >();
  for (const c of agRows) {
    const kg = kgOf(c);
    for (const a of attrsOf(c)) {
      const asso = firstOf(a.associations);
      const id = a.association_id ?? asso?.id ?? null;
      if (!id || !asso) continue;
      let g = groups.get(id);
      if (!g) {
        g = { nom: asso.nom, collectes: new Set(), repas: 0, poids: 0 };
        groups.set(id, g);
      }
      g.collectes.add(c.id);
      g.repas += num(a.volume_repas_realise);
      g.poids += kg;
    }
  }
  const list: SyntheseAssoLigne[] = [...groups.values()].map((g) => ({
    association_nom: g.nom,
    nb_collectes: g.collectes.size,
    repas_donnes: g.repas,
    poids_kg: g.poids,
  }));
  list.sort((a, b) => b.repas_donnes - a.repas_donnes);
  return list.slice(0, TOP_ASSOS);
}

function ventilationLieux(rows: CollecteRow[]): SyntheseLieuLigne[] {
  const groups = new Map<
    string,
    { nom: string; nb: number; tonnage: number }
  >();
  for (const c of rows) {
    const evt = evtOf(c);
    const lieu = firstOf(evt?.lieux ?? null);
    if (!evt?.lieu_id || !lieu) continue;
    let g = groups.get(evt.lieu_id);
    if (!g) {
      g = { nom: lieu.nom, nb: 0, tonnage: 0 };
      groups.set(evt.lieu_id, g);
    }
    g.nb += 1;
    g.tonnage += kgOf(c);
  }
  const list: SyntheseLieuLigne[] = [...groups.values()].map((g) => ({
    lieu_nom: g.nom,
    nb_collectes: g.nb,
    tonnage_kg: g.tonnage,
  }));
  list.sort((a, b) => b.tonnage_kg - a.tonnage_kg);
  return list;
}

async function ventilationTraiteurs(
  supabase: Supa,
  rows: CollecteRow[],
): Promise<SyntheseTraiteurLigne[]> {
  const groups = new Map<string, { nb: number; tonnage: number }>();
  for (const c of rows) {
    const evt = evtOf(c);
    const id = evt?.traiteur_operationnel_organisation_id ?? null;
    if (!id) continue;
    let g = groups.get(id);
    if (!g) {
      g = { nb: 0, tonnage: 0 };
      groups.set(id, g);
    }
    g.nb += 1;
    g.tonnage += kgOf(c);
  }
  if (groups.size === 0) return [];
  const noms = new Map<string, string>();
  const { data } = await supabase
    .from('v_referentiel_traiteurs')
    .select('id, nom, raison_sociale')
    .in('id', [...groups.keys()]);
  for (const t of data ?? [])
    noms.set(
      t.id as string,
      ((t.nom as string) || (t.raison_sociale as string)) ?? '',
    );
  const list: SyntheseTraiteurLigne[] = [...groups.entries()].map(
    ([id, g]) => ({
      traiteur_nom: noms.get(id) || 'Traiteur hors référentiel',
      nb_collectes: g.nb,
      tonnage_kg: g.tonnage,
    }),
  );
  list.sort((a, b) => b.tonnage_kg - a.tonnage_kg);
  return list;
}

function evolutionMensuelle(zdRows: CollecteRow[]): SyntheseEvolutionMois[] {
  const buckets = new Map<
    string,
    { tonnage: number; tauxNum: number; tauxDen: number }
  >();
  for (const c of zdRows) {
    const d = c.date_collecte.slice(0, 7); // YYYY-MM
    let b = buckets.get(d);
    if (!b) {
      b = { tonnage: 0, tauxNum: 0, tauxDen: 0 };
      buckets.set(d, b);
    }
    const kg = kgOf(c);
    b.tonnage += kg;
    if (c.taux_recyclage != null && kg > 0) {
      b.tauxNum += c.taux_recyclage * kg;
      b.tauxDen += kg;
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, b]) => {
      const [y, m] = ym.split('-');
      return {
        mois: `${m}/${(y ?? '').slice(2)}`,
        tonnage_kg: b.tonnage,
        taux_recyclage: b.tauxDen > 0 ? b.tauxNum / b.tauxDen : null,
      };
    });
}

function detailParEvenement(rows: CollecteRow[]): SyntheseDetailLigne[] {
  const groups = new Map<
    string,
    {
      date_evenement: string | null;
      nom: string;
      lieu: string;
      types: Set<string>;
      tonnage: number;
      tauxNum: number;
      tauxDen: number;
      repas: number;
    }
  >();
  for (const c of rows) {
    const evt = evtOf(c);
    if (!evt) continue;
    const key = evt.id;
    let g = groups.get(key);
    if (!g) {
      const lieu = firstOf(evt.lieux ?? null);
      g = {
        date_evenement: evt.date_evenement,
        nom: evt.nom_evenement ?? '—',
        lieu: lieu?.nom ?? '—',
        types: new Set(),
        tonnage: 0,
        tauxNum: 0,
        tauxDen: 0,
        repas: 0,
      };
      groups.set(key, g);
    }
    const kg = kgOf(c);
    g.tonnage += kg;
    if (c.type === 'zero_dechet') {
      g.types.add('ZD');
      if (c.taux_recyclage != null && kg > 0) {
        g.tauxNum += c.taux_recyclage * kg;
        g.tauxDen += kg;
      }
    } else {
      g.types.add('AG');
      g.repas += attrsOf(c).reduce(
        (s, a) => s + num(a.volume_repas_realise),
        0,
      );
    }
  }
  const list: SyntheseDetailLigne[] = [...groups.values()].map((g) => ({
    date_evenement: frDate(g.date_evenement),
    evenement: g.nom,
    lieu: g.lieu,
    type: [...g.types].sort().join(' + '),
    tonnage_kg: g.tonnage > 0 ? g.tonnage : null,
    taux_recyclage: g.tauxDen > 0 ? g.tauxNum / g.tauxDen : null,
    repas_donnes: g.types.has('AG') ? g.repas : null,
  }));
  // Antéchronologique sur date_evenement (§1.6 l.310).
  list.sort((a, b) => b.date_evenement.localeCompare(a.date_evenement));
  return list;
}

// ── Extraction du snapshot de facteurs CO₂ (annexe) ──────────────────────────
function snapshotOf(zdRows: CollecteRow[]): Record<string, unknown> | null {
  // Snapshot de la collecte la plus récente (référentiel figé, §1.6 annexes).
  const withSnap = zdRows
    .filter((c) => c.co2_facteurs_snapshot != null)
    .sort((a, b) => b.date_collecte.localeCompare(a.date_collecte));
  return withSnap[0]?.co2_facteurs_snapshot ?? null;
}
function facteursVersion(snap: Record<string, unknown> | null): string | null {
  if (!snap) return null;
  const v =
    (snap['version'] as string) ??
    (snap['facteurs_version'] as string) ??
    (snap['date_maj'] as string) ??
    null;
  return v ? String(v) : null;
}
function equivKmVoiture(
  snap: Record<string, unknown> | null,
  eviteKg: number,
): number | null {
  if (!snap || eviteKg <= 0) return null;
  const equiv = snap['equivalences'] as Record<string, unknown> | undefined;
  const fe =
    (equiv?.['km_voiture_kgco2'] as number) ??
    (snap['equiv_km_voiture_kgco2'] as number) ??
    null;
  if (typeof fe !== 'number' || fe <= 0) return null;
  return Math.round(eviteKg / fe);
}

function buildFiltresLabel(
  params: SyntheseParams,
  includeZd: boolean,
  includeAg: boolean,
): string | null {
  const parts: string[] = [];
  if (params.lieuIds.length > 0)
    parts.push(`Lieux : ${params.lieuIds.length} sélectionné(s)`);
  if (params.typeEvtIds.length > 0)
    parts.push(`Types d'événement : ${params.typeEvtIds.length}`);
  if (params.tailleEvts.length > 0)
    parts.push(`Tailles : ${params.tailleEvts.join(', ')}`);
  if (params.traiteurIds.length > 0)
    parts.push(`Traiteurs : ${params.traiteurIds.length} sélectionné(s)`);
  if (params.clientOrgaIds.length > 0)
    parts.push(`Clients : ${params.clientOrgaIds.length} sélectionné(s)`);
  if (!(includeZd && includeAg)) {
    parts.push(`Type : ${includeZd ? 'Zéro-Déchet' : 'Anti-Gaspi'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
