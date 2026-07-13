/**
 * Loaders serveur des dashboards clients (§11 / §06.04 / §06.05 / §06.11).
 *
 * Chaque fonction encapsule la requête + la transformation d'UN bloc de données,
 * en prenant `(supabase, ctx, params)` et en renvoyant EXACTEMENT le payload que
 * renvoyait le route handler correspondant (contrat de réponse inchangé). Les
 * routes (`/api/v1/dashboards/*`) deviennent de fines enveloppes autour de ces
 * loaders — et la page traiteur (Server Component) + l'endpoint consolidé
 * `/api/v1/dashboards/traiteur-full` les appellent EN PARALLÈLE côté serveur
 * (Promise.all), à côté de la base, au lieu de 6 fetch client sérialisés par
 * l'hydratation (R-perf : dashboard visible < 1 s).
 *
 * Aucune vue matérialisée, aucun cron de refresh : `v_kpi_traiteur` reste une vue
 * LIVE (décision CDC A1 §11 §9). L'isolement RLS est préservé — mêmes claims, même
 * scope org en défense en profondeur que les routes d'origine.
 */
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth.js';
import {
  previousWindow,
  FACTEURS_CO2_DEFAUT,
  type FacteursCo2,
} from '@/lib/dashboards/cockpit-derive.js';

/** Client Supabase serveur (schéma `plateforme`, RLS sous l'identité appelant). */
export type DbClient = ReturnType<typeof createSupabaseServerClient>;

/** Contexte d'auth minimal requis par les loaders (défense en profondeur). */
export type LoaderCtx = Pick<
  UserAuthContext,
  'userId' | 'role' | 'organisationId'
>;

/** Erreur métier d'un loader → mappée en réponse HTTP par le route handler. */
export class LoaderError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'LoaderError';
    this.status = status;
  }
}

// ─── Helpers partagés (bruts PostgREST : relations to-one = objet ou tableau) ──

/** Première valeur d'une relation to-one (PostgREST : objet OU tableau selon version). */
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Bracket de taille (pax) — §06.05. */
function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

// ══════════════════════════════════════════════════════════════════════════
// KPI TRAITEUR — v_kpi_traiteur (Bloc 1 + N-1 + facteurs/méthode CO₂)
// ══════════════════════════════════════════════════════════════════════════

// Clés d'équivalence ADEME dans parametres_co2_divers (héros CO₂ Cockpit R24).
const EQUIV_KEYS = {
  km_voiture: 'equiv_km_voiture_kgco2',
  repas_boeuf: 'equiv_repas_boeuf_kgco2',
  foyer_kwh: 'equiv_foyer_elec_kwh_an',
} as const;

// Forfait transport collecte (parametres_co2_divers) — méthode de calcul CO₂.
const FORFAIT_KEYS = {
  km: 'km_collecte_aller_retour',
  fe_camion: 'fe_camion_benne_kg_km',
} as const;

/** Variables du calcul CO₂ (forfait transport + facteurs d'émission par flux),
 *  affichées dans la modale « méthode de calcul » du KPI CO₂ évité (retour Val). */
export interface Co2Methode {
  forfait: { km: number; fe_camion: number };
  flux: {
    code: string;
    nom: string;
    fe_evite: number;
    fe_induit: number;
    energie: number;
  }[];
}

/**
 * Lit les variables de calcul CO₂ (forfait transport + facteurs par flux) via le
 * client service_role (tables RLS ops/admin). Best-effort : toute erreur retombe
 * sur les constantes ADEME du trigger m4_3 (jamais bloquant pour l'affichage).
 */
async function lireMethodeCo2(): Promise<Co2Methode> {
  const methode: Co2Methode = { forfait: { km: 50, fe_camion: 2.1 }, flux: [] };
  try {
    const admin = createAdminSupabaseClient();
    const { data: div } = await admin
      .from('parametres_co2_divers')
      .select('cle, valeur')
      .in('cle', Object.values(FORFAIT_KEYS));
    if (Array.isArray(div)) {
      const byCle = new Map(
        div.map((r) => [
          (r as { cle: string }).cle,
          Number((r as { valeur: number }).valeur),
        ]),
      );
      const km = byCle.get(FORFAIT_KEYS.km);
      const fe = byCle.get(FORFAIT_KEYS.fe_camion);
      if (Number.isFinite(km) && km! > 0) methode.forfait.km = km!;
      if (Number.isFinite(fe) && fe! > 0) methode.forfait.fe_camion = fe!;
    }
    const { data: fc } = await admin
      .from('parametres_facteurs_co2')
      .select(
        'code_flux, nom_flux, fe_evite_kg_t, fe_induit_kg_t, energie_primaire_evitee_kwh_t',
      )
      .eq('actif', true);
    if (Array.isArray(fc)) {
      methode.flux = fc.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          code: String(row.code_flux),
          nom: String(row.nom_flux),
          fe_evite: Number(row.fe_evite_kg_t),
          fe_induit: Number(row.fe_induit_kg_t),
          energie: Number(row.energie_primaire_evitee_kwh_t),
        };
      });
    }
  } catch {
    // conserve les défauts ADEME (jamais bloquant)
  }
  return methode;
}

// Cache process des 3 facteurs d'équivalence CO₂ (constantes ADEME globales,
// éditables Admin mais quasi immuables). Sans lui, CHAQUE chargement de dashboard
// crée un client service_role + une requête. TTL court : une modif Admin se
// propage en < 5 min (et par instance serverless). Partagé entre tous les
// traiteurs/agences car les facteurs sont globaux, pas par organisation.
let _facteursCo2Cache: { at: number; val: FacteursCo2 } | null = null;
const FACTEURS_CO2_TTL_MS = 5 * 60_000;

async function lireFacteursCo2(): Promise<FacteursCo2> {
  if (
    _facteursCo2Cache &&
    Date.now() - _facteursCo2Cache.at < FACTEURS_CO2_TTL_MS
  ) {
    return _facteursCo2Cache.val;
  }
  const facteurs: FacteursCo2 = { ...FACTEURS_CO2_DEFAUT };
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from('parametres_co2_divers')
      .select('cle, valeur')
      .in('cle', Object.values(EQUIV_KEYS));
    if (Array.isArray(data)) {
      const byCle = new Map(
        data.map((r) => [
          (r as { cle: string }).cle,
          Number((r as { valeur: number }).valeur),
        ]),
      );
      const km = byCle.get(EQUIV_KEYS.km_voiture);
      const boeuf = byCle.get(EQUIV_KEYS.repas_boeuf);
      const foyer = byCle.get(EQUIV_KEYS.foyer_kwh);
      if (Number.isFinite(km) && km! > 0) facteurs.km_voiture = km!;
      if (Number.isFinite(boeuf) && boeuf! > 0) facteurs.repas_boeuf = boeuf!;
      if (Number.isFinite(foyer) && foyer! > 0) facteurs.foyer_kwh = foyer!;
    }
    // Ne met en cache que les lectures réussies (une erreur → réessai au prochain
    // appel plutôt que de figer les défauts ADEME pendant 5 min).
    _facteursCo2Cache = { at: Date.now(), val: facteurs };
  } catch {
    // conserve les défauts ADEME (non mis en cache)
  }
  return facteurs;
}

export interface KpiLoaderResult {
  data: unknown[];
  previous?: unknown[];
  tarif_refacture_pax_zd: number | null;
  facteurs_co2: FacteursCo2;
  co2_methode: Co2Methode;
}

/**
 * Bloc 1 (KPIs) + fenêtre N-1 (variation) + facteurs/méthode CO₂ (héros + modale).
 * ⚠ Contrat identique à `GET /api/v1/dashboards/kpi-traiteur`.
 */
export async function loadKpiTraiteur(
  supabase: DbClient,
  ctx: LoaderCtx,
  params: {
    from: string | null;
    to: string | null;
    type: string | null;
    compare?: string | null;
  },
): Promise<KpiLoaderResult> {
  const { from, to, type } = params;
  const isAgence = ctx.role === 'agence';

  // §06.11 diff #7 — l'agence n'a pas de KPI « Marge générée » : marge_zd_ht est
  // retiré de la réponse côté serveur (aucune donnée de marge ne transite), ni
  // sur la période courante ni sur N-1.
  const stripMarge = (rows: unknown[] | null): unknown[] =>
    isAgence
      ? (rows ?? []).map((r) => {
          const { marge_zd_ht: _omit, ...rest } = r as Record<string, unknown>;
          void _omit;
          return rest;
        })
      : (rows ?? []);

  // v_kpi_traiteur pour une fenêtre donnée (défense en profondeur : scope org
  // côté serveur EN PLUS de la RLS security_invoker).
  const runFenetre = async (
    f: string | null,
    t: string | null,
  ): Promise<{ rows: unknown[] | null; error: string | null }> => {
    let query = supabase
      .from('v_kpi_traiteur')
      .select('*')
      .eq('organisation_id', ctx.organisationId);
    if (f) query = query.gte('mois', f);
    if (t) query = query.lte('mois', t);
    if (type === 'zero_dechet' || type === 'anti_gaspi') {
      query = query.eq('type_collecte', type);
    }
    query = query.order('mois', { ascending: false });
    const { data, error } = await query;
    return { rows: data, error: error ? error.message : null };
  };

  // N-1 (Cockpit R24) : variation vs période précédente équivalente, déclenchée
  // UNIQUEMENT via compare='n1'. previousWindow rend une fenêtre CONTIGUË et
  // strictement antérieure à `from` → on interroge la vue UNE seule fois sur
  // [N-1 → courante] puis on découpe en JS (la vue est la requête la plus lourde).
  const win = params.compare === 'n1' ? previousWindow(from, to) : null;
  const unionFrom = win ? win.from : from;

  // La vue (requête lourde) et les facteurs/méthode CO₂ (client service_role
  // séparé) sont indépendants → lancés en parallèle.
  const [union, facteurs_co2, co2_methode] = await Promise.all([
    runFenetre(unionFrom, to),
    lireFacteursCo2(),
    lireMethodeCo2(),
  ]);

  if (union.error) throw new LoaderError(union.error);

  // tarif_refacture_pax_zd (BL-P3-02) — tooltip formule du KPI Marge. Lecture
  // traiteur autorisée (§04 l.928). Non exposé à l'agence (pas de carte Marge).
  let tarif_refacture_pax_zd: number | null = null;
  if (!isAgence) {
    const { data: org } = await supabase
      .from('organisations')
      .select('tarif_refacture_pax_zd')
      .eq('id', ctx.organisationId)
      .maybeSingle();
    tarif_refacture_pax_zd =
      (org?.tarif_refacture_pax_zd as number | null) ?? null;
  }

  // Découpe la fenêtre unique en courante / précédente (réplique .gte/.lte SQL).
  const rows = union.rows ?? [];
  const inWindow = (
    r: unknown,
    lo: string | null,
    hi: string | null,
  ): boolean => {
    const m = (r as { mois?: unknown }).mois;
    const lowOk = !lo || (typeof m === 'string' && m >= lo);
    const highOk = !hi || (typeof m === 'string' && m <= hi);
    return lowOk && highOk;
  };
  const currentRows = rows.filter((r) => inWindow(r, from, to));
  const previous = win
    ? stripMarge(rows.filter((r) => inWindow(r, win.from, win.to)))
    : undefined;

  return {
    data: stripMarge(currentRows),
    tarif_refacture_pax_zd,
    facteurs_co2,
    co2_methode,
    ...(previous !== undefined ? { previous } : {}),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// ÉVOLUTION — Bloc 2 (série temporelle) + Bloc 4 (donut), partagé 3 contextes
// ══════════════════════════════════════════════════════════════════════════

const FLUX_CODES = [
  'biodechet',
  'emballage',
  'carton',
  'verre',
  'dechet_residuel',
] as const;

type Granularite = 'jour' | 'semaine' | 'mois';

interface EvoEvtEmbed {
  id: string;
  lieu_id: string | null;
  pax: number | null;
  organisation_id: string;
  type_evenement_id: string | null;
  traiteur_operationnel_organisation_id: string | null;
}

interface EvoCollecteRow {
  id: string;
  type: string;
  taux_recyclage: number | null;
  date_collecte: string;
  evenements: EvoEvtEmbed | EvoEvtEmbed[] | null;
  collecte_flux:
    | { poids_reel_kg: number | null; flux_dechets: { code: string } | null }[]
    | null;
  attributions_antgaspi:
    | { volume_repas_realise: number | null }[]
    | { volume_repas_realise: number | null }
    | null;
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
    const dow = (d.getUTCDay() + 6) % 7; // 0 = lundi
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export interface EvolutionParams {
  type: string;
  from: string | null;
  to: string | null;
  lieuIds?: string[];
  traiteurIds?: string[];
  typeEvtIds?: string[];
  tailleEvts?: string[];
}

export interface EvolutionResult {
  granularite: Granularite;
  series: Record<string, unknown>[];
}

/**
 * Bloc 2 (évolution mensuelle) + Bloc 4 (donut), § « 1 dashboard, 3 contextes ».
 * ⚠ Contrat identique à `GET /api/v1/dashboards/evolution` (renvoie `{ granularite, series }`).
 */
export async function loadEvolution(
  supabase: DbClient,
  ctx: LoaderCtx,
  params: EvolutionParams,
): Promise<EvolutionResult> {
  const type = params.type === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const from = params.from;
  const to = params.to;
  const lieuIds = params.lieuIds ?? [];
  const traiteurIds = params.traiteurIds ?? [];
  const typeEvtIds = params.typeEvtIds ?? [];
  const tailleEvts = params.tailleEvts ?? [];

  const isGestionnaire = ctx.role === 'gestionnaire_lieux';

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
      return { granularite: granulariteFor(from ?? '', to ?? ''), series: [] };
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
    q = q.eq('evenements.organisation_id', ctx.organisationId);
    if (lieuIds.length > 0) q = q.in('evenements.lieu_id', lieuIds);
  }
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);
  if (typeEvtIds.length > 0)
    q = q.in('evenements.type_evenement_id', typeEvtIds);

  const { data, error } = await q;
  if (error) throw new LoaderError(error.message);

  const rows = ((data ?? []) as unknown as EvoCollecteRow[]).filter((c) => {
    const evt = firstOf(c.evenements);
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
    return { granularite: g, series };
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
      : c.attributions_antgaspi
        ? [c.attributions_antgaspi]
        : [];
    for (const a of attrs) b.repas += a.volume_repas_realise ?? 0;
    const evt = firstOf(c.evenements);
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
  return { granularite: g, series };
}

// ══════════════════════════════════════════════════════════════════════════
// BLOCS — prochaines (5) + top lieux (6) + top acteurs (7) + top asso (3AG) + kg/pax
// ══════════════════════════════════════════════════════════════════════════

const STATUTS_A_VENIR = ['programmee', 'validee', 'en_cours'] as const;
const PROCHAINES_FENETRE_JOURS = 30;
const TOP_N = 5;

interface BlocsEvtEmbed {
  id: string;
  lieu_id: string | null;
  pax: number | null;
  organisation_id: string;
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

interface BlocsCollecteRow {
  id: string;
  type: string;
  taux_recyclage: number | null;
  date_collecte: string;
  evenements: BlocsEvtEmbed | BlocsEvtEmbed[] | null;
  collecte_flux: { poids_reel_kg: number | null }[] | null;
  attributions_antgaspi: AttrEmbed[] | AttrEmbed | null;
}

function attrsOf(c: BlocsCollecteRow): AttrEmbed[] {
  const a = c.attributions_antgaspi;
  return Array.isArray(a) ? a : a ? [a] : [];
}

function kgOf(c: BlocsCollecteRow): number {
  const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
  return flux.reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}

// Somme des pax sur événements DISTINCTS (réplique v_kpi_traiteur).
function paxDistinct(rows: BlocsCollecteRow[]): number {
  const parEvt = new Map<string, number>();
  let sansId = 0;
  for (const c of rows) {
    const evt = firstOf(c.evenements);
    const pax = evt?.pax ?? 0;
    const id = evt?.id ?? null;
    if (id == null) sansId += pax;
    else if (!parEvt.has(id)) parEvt.set(id, pax);
  }
  let total = sansId;
  for (const p of parEvt.values()) total += p;
  return total;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface LieuRow {
  lieu_id: string;
  lieu_nom: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}

export function topLieuxFrom(
  rows: BlocsCollecteRow[],
  type: string,
): LieuRow[] {
  const groups = new Map<
    string,
    {
      nom: string;
      nb: number;
      tonnage: number;
      tauxNum: number;
      tauxDen: number;
      repas: number;
      rowsForPax: BlocsCollecteRow[];
    }
  >();
  for (const c of rows) {
    const evt = firstOf(c.evenements);
    const lieu = firstOf(evt?.lieux ?? null);
    if (!evt?.lieu_id || !lieu) continue;
    let g = groups.get(evt.lieu_id);
    if (!g) {
      g = {
        nom: lieu.nom,
        nb: 0,
        tonnage: 0,
        tauxNum: 0,
        tauxDen: 0,
        repas: 0,
        rowsForPax: [],
      };
      groups.set(evt.lieu_id, g);
    }
    g.nb += 1;
    g.rowsForPax.push(c);
    if (type === 'zero_dechet') {
      const kg = kgOf(c);
      g.tonnage += kg;
      if (c.taux_recyclage != null && kg > 0) {
        g.tauxNum += c.taux_recyclage * kg;
        g.tauxDen += kg;
      }
    } else {
      for (const a of attrsOf(c)) g.repas += a.volume_repas_realise ?? 0;
    }
  }
  const list: LieuRow[] = [...groups.entries()].map(([lieu_id, g]) => {
    if (type === 'zero_dechet') {
      return {
        lieu_id,
        lieu_nom: g.nom,
        nb_collectes: g.nb,
        tonnage_kg: g.tonnage,
        taux_recyclage: g.tauxDen > 0 ? g.tauxNum / g.tauxDen : null,
        repas_donnes: null,
        repas_par_pax: null,
      };
    }
    const pax = paxDistinct(g.rowsForPax);
    return {
      lieu_id,
      lieu_nom: g.nom,
      nb_collectes: g.nb,
      tonnage_kg: null,
      taux_recyclage: null,
      repas_donnes: g.repas,
      repas_par_pax: pax > 0 ? g.repas / pax : null,
    };
  });
  list.sort((a, b) =>
    type === 'zero_dechet'
      ? (b.tonnage_kg ?? 0) - (a.tonnage_kg ?? 0)
      : (b.repas_donnes ?? 0) - (a.repas_donnes ?? 0),
  );
  return list.slice(0, TOP_N);
}

export interface ActeurRow {
  id: string;
  label: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}

export function aggregateActeurs(
  rows: BlocsCollecteRow[],
  type: string,
  keyOf: (evt: BlocsEvtEmbed) => string | null,
): ActeurRow[] {
  const groups = new Map<
    string,
    {
      nb: number;
      tonnage: number;
      tauxNum: number;
      tauxDen: number;
      repas: number;
      rowsForPax: BlocsCollecteRow[];
    }
  >();
  for (const c of rows) {
    const evt = firstOf(c.evenements);
    if (!evt) continue;
    const key = keyOf(evt);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = {
        nb: 0,
        tonnage: 0,
        tauxNum: 0,
        tauxDen: 0,
        repas: 0,
        rowsForPax: [],
      };
      groups.set(key, g);
    }
    g.nb += 1;
    g.rowsForPax.push(c);
    if (type === 'zero_dechet') {
      const kg = kgOf(c);
      g.tonnage += kg;
      if (c.taux_recyclage != null && kg > 0) {
        g.tauxNum += c.taux_recyclage * kg;
        g.tauxDen += kg;
      }
    } else {
      for (const a of attrsOf(c)) g.repas += a.volume_repas_realise ?? 0;
    }
  }
  const list: ActeurRow[] = [...groups.entries()].map(([id, g]) => {
    if (type === 'zero_dechet') {
      return {
        id,
        label: '',
        nb_collectes: g.nb,
        tonnage_kg: g.tonnage,
        taux_recyclage: g.tauxDen > 0 ? g.tauxNum / g.tauxDen : null,
        repas_donnes: null,
        repas_par_pax: null,
      };
    }
    const pax = paxDistinct(g.rowsForPax);
    return {
      id,
      label: '',
      nb_collectes: g.nb,
      tonnage_kg: null,
      taux_recyclage: null,
      repas_donnes: g.repas,
      repas_par_pax: pax > 0 ? g.repas / pax : null,
    };
  });
  list.sort((a, b) => b.nb_collectes - a.nb_collectes);
  return list.slice(0, TOP_N);
}

async function resolveCommercialNoms(
  supabase: DbClient,
  acteurs: ActeurRow[],
): Promise<void> {
  const ids = acteurs.map((a) => a.id);
  if (ids.length === 0) return;
  const { data } = await supabase
    .from('users')
    .select('id, prenom, nom')
    .in('id', ids);
  const byId = new Map(
    (data ?? []).map((u) => [
      u.id as string,
      `${(u.prenom as string) ?? ''} ${(u.nom as string) ?? ''}`.trim(),
    ]),
  );
  for (const a of acteurs) a.label = byId.get(a.id) || 'Commercial inconnu';
}

async function traiteurNamesMap(
  supabase: DbClient,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('v_referentiel_traiteurs')
    .select('id, nom, raison_sociale')
    .in('id', ids);
  return new Map(
    (data ?? []).map((t) => [
      t.id as string,
      ((t.nom as string) || (t.raison_sociale as string)) ?? '',
    ]),
  );
}

export interface AssociationRow {
  association_id: string;
  nom: string;
  ville: string | null;
  nb_collectes: number;
  repas_recus: number;
}

export function topAssociationsFrom(
  rows: BlocsCollecteRow[],
): AssociationRow[] {
  const groups = new Map<
    string,
    { nom: string; ville: string | null; collectes: Set<string>; repas: number }
  >();
  for (const c of rows) {
    for (const a of attrsOf(c)) {
      const asso = firstOf(a.associations);
      const id = a.association_id ?? asso?.id ?? null;
      if (!id || !asso) continue;
      let g = groups.get(id);
      if (!g) {
        g = {
          nom: asso.nom,
          ville: asso.ville,
          collectes: new Set(),
          repas: 0,
        };
        groups.set(id, g);
      }
      g.collectes.add(c.id);
      g.repas += a.volume_repas_realise ?? 0;
    }
  }
  const list: AssociationRow[] = [...groups.entries()].map(([id, g]) => ({
    association_id: id,
    nom: g.nom,
    ville: g.ville,
    nb_collectes: g.collectes.size,
    repas_recus: g.repas,
  }));
  list.sort((a, b) => b.repas_recus - a.repas_recus);
  return list.slice(0, TOP_N);
}

export function kgParPaxParFluxFrom(
  rows: BlocsCollecteRow[],
): Record<string, number> {
  const pax = paxDistinct(rows);
  if (pax <= 0) return {};
  const poidsParFlux: Record<string, number> = {};
  for (const c of rows) {
    const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
    for (const f of flux) {
      const fd = (
        f as { flux_dechets?: { code?: string } | { code?: string }[] }
      ).flux_dechets;
      const code = (Array.isArray(fd) ? fd[0] : fd)?.code;
      const poids = f.poids_reel_kg ?? 0;
      if (code) poidsParFlux[code] = (poidsParFlux[code] ?? 0) + poids;
    }
  }
  const out: Record<string, number> = {};
  for (const [code, p] of Object.entries(poidsParFlux)) out[code] = p / pax;
  return out;
}

function emptyBlocs(type: string, isGestionnaire: boolean, isAgence: boolean) {
  return {
    prochaines: [],
    topLieux: [],
    topActeurs: isAgence ? null : [],
    acteurLabel: isAgence ? null : isGestionnaire ? 'Traiteur' : 'Commercial',
    topAssociations: type === 'anti_gaspi' ? [] : null,
    kgParPaxParFlux: {},
  };
}

export interface BlocsParams {
  type: string;
  from: string | null;
  to: string | null;
  lieuIds?: string[];
  traiteurIds?: string[];
  typeEvtIds?: string[];
  tailleEvts?: string[];
}

/** Élément « prochaine collecte » (Bloc 5) — miroir de `ProchaineCollecte` (front). */
export interface ProchaineCollecteRow {
  id: string;
  evenement_id: string | null;
  date_collecte: string;
  heure_collecte: string | null;
  statut: string;
  evenement_nom: string | null;
  lieu_nom: string | null;
  traiteur_id: string | null;
  traiteur_nom: string | null;
}

export interface BlocsResult {
  prochaines: ProchaineCollecteRow[];
  topLieux: LieuRow[];
  topActeurs: ActeurRow[] | null;
  acteurLabel: 'Commercial' | 'Traiteur' | null;
  topAssociations: AssociationRow[] | null;
  kgParPaxParFlux: Record<string, number>;
}

/**
 * Blocs « liste/ranking » (5/6/7/3AG/perFlux). ⚠ Contrat identique à
 * `GET /api/v1/dashboards/blocs` (payload sous `data`).
 */
export async function loadBlocs(
  supabase: DbClient,
  ctx: LoaderCtx,
  params: BlocsParams,
): Promise<BlocsResult> {
  const type = params.type === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const from = params.from;
  const to = params.to;
  const lieuIds = params.lieuIds ?? [];
  const traiteurIds = params.traiteurIds ?? [];
  const typeEvtIds = params.typeEvtIds ?? [];
  const tailleEvts = params.tailleEvts ?? [];

  const role = ctx.role;
  const isGestionnaire = role === 'gestionnaire_lieux';
  const isAgence = role === 'agence';

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
      return emptyBlocs(type, isGestionnaire, isAgence) as BlocsResult;
    }
    perimetreLieuIds = lieuFilter;
  }

  const scoped = <T>(q: T): T => {
    let query = q as {
      eq: (c: string, v: unknown) => typeof query;
      in: (c: string, v: unknown[]) => typeof query;
    };
    if (isGestionnaire) {
      query = query.in('evenements.lieu_id', perimetreLieuIds);
      if (traiteurIds.length > 0)
        query = query.in(
          'evenements.traiteur_operationnel_organisation_id',
          traiteurIds,
        );
    } else {
      query = query.eq('evenements.organisation_id', ctx.organisationId);
      if (lieuIds.length > 0) query = query.in('evenements.lieu_id', lieuIds);
    }
    if (typeEvtIds.length > 0)
      query = query.in('evenements.type_evenement_id', typeEvtIds);
    return query as unknown as T;
  };

  const tailleOk = (evt: BlocsEvtEmbed | null): boolean => {
    if (!evt) return false;
    if (tailleEvts.length === 0) return true;
    return tailleEvts.includes(tailleBracket(evt.pax ?? 0));
  };

  const selectHistorique =
    type === 'zero_dechet'
      ? `id, type, taux_recyclage, date_collecte,
         evenements!inner(id, lieu_id, pax, organisation_id, type_evenement_id,
           traiteur_operationnel_organisation_id, created_by, lieux!inner(id, nom)),
         collecte_flux(poids_reel_kg, flux_dechets(code))`
      : `id, type, taux_recyclage, date_collecte,
         evenements!inner(id, lieu_id, pax, organisation_id, type_evenement_id,
           traiteur_operationnel_organisation_id, created_by, lieux!inner(id, nom)),
         attributions_antgaspi(volume_repas_realise, association_id,
           associations!association_id(id, nom, ville))`;

  let qHist = supabase
    .from('collectes')
    .select(selectHistorique)
    .eq('statut', 'cloturee')
    .eq('type', type);
  qHist = scoped(qHist);
  if (from) qHist = qHist.gte('date_collecte', from);
  if (to) qHist = qHist.lte('date_collecte', to);

  const today = new Date();
  const in30 = new Date(today.getTime());
  in30.setDate(in30.getDate() + PROCHAINES_FENETRE_JOURS);

  let qProch = supabase
    .from('collectes')
    .select(
      `id, date_collecte, heure_collecte, statut, type,
       evenements!inner(id, nom_evenement, lieu_id, pax, organisation_id,
         type_evenement_id, traiteur_operationnel_organisation_id, created_by,
         lieux!inner(id, nom))`,
    )
    .eq('type', type)
    .in('statut', [...STATUTS_A_VENIR])
    .gte('date_collecte', isoDate(today))
    .lte('date_collecte', isoDate(in30));
  qProch = scoped(qProch);
  qProch = qProch
    .order('date_collecte', { ascending: true })
    .order('heure_collecte', { ascending: true, nullsFirst: false });

  const [histRes, prochRes] = await Promise.all([qHist, qProch]);
  const { data: histData, error: histErr } = histRes;
  if (histErr) throw new LoaderError(histErr.message);
  const { data: prochData, error: prochErr } = prochRes;
  if (prochErr) throw new LoaderError(prochErr.message);

  const histRows = ((histData ?? []) as unknown as BlocsCollecteRow[]).filter(
    (c) => tailleOk(firstOf(c.evenements)),
  );

  interface ProchEvt {
    id: string;
    nom_evenement: string | null;
    pax: number | null;
    traiteur_operationnel_organisation_id: string | null;
    lieux: { nom: string } | { nom: string }[] | null;
  }
  interface ProchRow {
    id: string;
    date_collecte: string;
    heure_collecte: string | null;
    statut: string;
    evenements: ProchEvt | ProchEvt[] | null;
  }
  const prochaines = ((prochData ?? []) as unknown as ProchRow[])
    .filter((c) => {
      const evt = firstOf(c.evenements);
      if (!evt) return false;
      if (tailleEvts.length === 0) return true;
      return tailleEvts.includes(tailleBracket(evt.pax ?? 0));
    })
    .map((c) => {
      const evt = firstOf(c.evenements);
      const lieu = firstOf(evt?.lieux ?? null);
      return {
        id: c.id,
        evenement_id: evt?.id ?? null,
        date_collecte: c.date_collecte,
        heure_collecte: c.heure_collecte,
        statut: c.statut,
        evenement_nom: evt?.nom_evenement ?? null,
        lieu_nom: lieu?.nom ?? null,
        traiteur_id: evt?.traiteur_operationnel_organisation_id ?? null,
        traiteur_nom: null as string | null,
      };
    });

  const topLieux = topLieuxFrom(histRows, type);

  let topActeurs: ActeurRow[] | null = null;
  let acteurLabel: 'Commercial' | 'Traiteur' | null = null;
  if (isGestionnaire) {
    acteurLabel = 'Traiteur';
    topActeurs = aggregateActeurs(
      histRows,
      type,
      (evt) => evt.traiteur_operationnel_organisation_id,
    );
    const traiteurIdsAResoudre = [
      ...new Set([
        ...topActeurs.map((a) => a.id),
        ...prochaines.map((p) => p.traiteur_id).filter((x): x is string => !!x),
      ]),
    ];
    const noms = await traiteurNamesMap(supabase, traiteurIdsAResoudre);
    for (const a of topActeurs)
      a.label = noms.get(a.id) || 'Traiteur hors référentiel';
    for (const p of prochaines)
      p.traiteur_nom = p.traiteur_id ? (noms.get(p.traiteur_id) ?? null) : null;
  } else if (!isAgence) {
    acteurLabel = 'Commercial';
    topActeurs = aggregateActeurs(histRows, type, (evt) => evt.created_by);
    await resolveCommercialNoms(supabase, topActeurs);
  }

  const topAssociations =
    type === 'anti_gaspi' ? topAssociationsFrom(histRows) : null;

  const kgParPaxParFlux =
    type === 'zero_dechet' ? kgParPaxParFluxFrom(histRows) : {};

  return {
    prochaines,
    topLieux,
    topActeurs,
    acteurLabel,
    topAssociations,
    kgParPaxParFlux,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// MARGE EN ATTENTE DE FACTURATION — badge F3 (§06.04 KPI Marge), ZD only
// ══════════════════════════════════════════════════════════════════════════

/**
 * Compte les collectes ZD cloturee du périmètre sans facture emise/payee.
 * ⚠ Contrat identique à `GET /api/v1/traiteur/marge-attente-facturation`.
 */
export async function loadMargeAttente(
  supabase: DbClient,
  params: { from: string | null; to: string | null },
): Promise<{ nb_en_attente: number }> {
  const { from, to } = params;
  let q = supabase
    .from('collectes')
    .select(
      'id, date_collecte, factures_collectes(facture_id, factures(statut))',
    )
    .eq('type', 'zero_dechet')
    .eq('statut', 'cloturee');
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);

  const { data, error } = await q;
  if (error) throw new LoaderError(error.message);

  type FactureLien = {
    factures: { statut: string } | { statut: string }[] | null;
  };
  const enAttente = (data ?? []).filter((c) => {
    const liens = (c.factures_collectes ?? []) as FactureLien[];
    const aFactureEmise = liens.some((l) => {
      const f = Array.isArray(l.factures) ? l.factures[0] : l.factures;
      return f?.statut === 'emise' || f?.statut === 'payee';
    });
    return !aFactureEmise;
  });

  return { nb_en_attente: enAttente.length };
}

// ══════════════════════════════════════════════════════════════════════════
// PACK ANTI-GASPI — Bloc 4 AG (pack unique actif), AG only
// ══════════════════════════════════════════════════════════════════════════

export interface PackAgResult {
  pack_actif: boolean;
  pack_id?: string;
  credits_initiaux?: number;
  credits_consommes?: number;
  credits_restants?: number;
  date_expiration?: string | null;
}

/**
 * Pack Anti-Gaspi actif unique de l'organisation. ⚠ Contrat identique à
 * `GET /api/v1/programmation/pack-ag` (lecture service_role, filtrée sur l'org
 * du caller — jamais de param cross-org).
 */
export async function loadPackAg(ctx: LoaderCtx): Promise<PackAgResult> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('packs_antgaspi')
    .select(
      'id, credits_initiaux, credits_consommes, credits_restants, date_expiration, statut',
    )
    .eq('organisation_id', ctx.organisationId)
    .eq('statut', 'actif')
    .maybeSingle();

  if (error) throw new LoaderError(error.message);
  if (!data) return { pack_actif: false };

  return {
    pack_actif: true,
    pack_id: data.id as string,
    credits_initiaux: data.credits_initiaux as number,
    credits_consommes: data.credits_consommes as number,
    credits_restants: data.credits_restants as number,
    date_expiration: data.date_expiration as string | null,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// BENCHMARK — Bloc 3 ZD (repère parc, RPC k-anonyme) + options des filtres
// ══════════════════════════════════════════════════════════════════════════

export interface BenchmarkParams {
  tailleCodes?: string[] | null;
  bracket?: string | null;
  typeIds?: string[] | null;
  lieuIds?: string[] | null;
  traiteurIds?: string[] | null;
  periodeDebut?: string | null;
  periodeFin?: string | null;
}

/**
 * Repère parc kg/pax (RPC f_benchmark_kg_pax_zd, SECURITY DEFINER k-anonyme).
 * ⚠ Contrat identique à `GET /api/v1/dashboards/benchmark` (renvoie le tableau
 * `data`). Le filtre `traiteurIds` est INTERDIT pour traiteur/agence (§04
 * préservation compétitive) → LoaderError 403.
 */
export async function loadBenchmark(
  supabase: DbClient,
  ctx: LoaderCtx,
  params: BenchmarkParams,
): Promise<unknown[]> {
  const tailleCodes =
    params.tailleCodes && params.tailleCodes.length
      ? params.tailleCodes
      : params.bracket
        ? [params.bracket]
        : ['XS', 'S', 'M', 'L', 'XL'];
  const typeIds = params.typeIds ?? null;
  const lieuIds = params.lieuIds ?? null;
  const traiteurIds = params.traiteurIds ?? null;
  const periodeDebut = params.periodeDebut ?? null;
  const periodeFin = params.periodeFin ?? null;

  const isTraiteur =
    ctx.role === 'traiteur_manager' ||
    ctx.role === 'traiteur_commercial' ||
    ctx.role === 'agence';
  if (isTraiteur && traiteurIds && traiteurIds.length) {
    throw new LoaderError(
      'Le filtre traiteur_ids est interdit pour ce rôle (§04 préservation compétitive)',
      403,
    );
  }

  const args = {
    p_taille_evenement_codes: tailleCodes,
    ...(typeIds && typeIds.length ? { p_type_evenement_ids: typeIds } : {}),
    ...(periodeDebut ? { p_periode_debut: periodeDebut } : {}),
    ...(periodeFin ? { p_periode_fin: periodeFin } : {}),
    ...(lieuIds && lieuIds.length ? { p_lieu_ids: lieuIds } : {}),
    ...(traiteurIds && traiteurIds.length
      ? { p_traiteur_ids: traiteurIds }
      : {}),
  };

  const { data, error } = await supabase.rpc('f_benchmark_kg_pax_zd', args);
  if (error) throw new LoaderError(error.message);
  return data ?? [];
}

export interface BenchmarkFiltresResult {
  lieux: unknown[];
  traiteurs: unknown[];
  types: unknown[];
}

/**
 * Options des multi-selects de l'encart « Filtres benchmark ». ⚠ Contrat
 * identique à `GET /api/v1/dashboards/benchmark/filtres` (payload sous `data`).
 * Traiteur/agence : pas de liste traiteurs (préservation compétitive) → 4 dims.
 */
export async function loadBenchmarkFiltres(
  supabase: DbClient,
  ctx: LoaderCtx,
): Promise<BenchmarkFiltresResult> {
  const isTraiteur =
    ctx.role === 'traiteur_manager' ||
    ctx.role === 'traiteur_commercial' ||
    ctx.role === 'agence';

  const [lieux, traiteurs, types] = await Promise.all([
    supabase.rpc('f_benchmark_lieux_parc'),
    isTraiteur
      ? Promise.resolve({ data: [], error: null })
      : supabase.rpc('f_benchmark_traiteurs_parc'),
    supabase
      .from('types_evenements')
      .select('id, libelle')
      .eq('actif', true)
      .order('ordre_affichage'),
  ]);

  const firstError = lieux.error ?? traiteurs.error ?? types.error;
  if (firstError) throw new LoaderError(firstError.message);

  return {
    lieux: lieux.data ?? [],
    traiteurs: traiteurs.data ?? [],
    types: types.data ?? [],
  };
}

// ══════════════════════════════════════════════════════════════════════════
// ORCHESTRATEUR — 1 Promise.all serveur pour le dashboard traiteur complet
// ══════════════════════════════════════════════════════════════════════════

export interface TraiteurDashboardParams {
  from: string | null;
  to: string | null;
  type: string; // 'zero_dechet' | 'anti_gaspi'
  lieuIds?: string[];
  traiteurIds?: string[];
  typeEvtIds?: string[];
  tailleEvts?: string[];
}

export interface TraiteurDashboardPayload {
  kpi: KpiLoaderResult;
  evolution: EvolutionResult;
  blocs: BlocsResult;
  /** ZD only — badge « en attente de facturation » (null en AG). */
  marge: { nb_en_attente: number } | null;
  /** AG only — pack unique actif (null en ZD). */
  pack: PackAgResult | null;
}

/**
 * Charge le dashboard traiteur complet pour un onglet donné en UN seul
 * Promise.all serveur (kpi + évolution + blocs + marge|pack), à côté de la base.
 * N-1 toujours actif (compare='n1'). Le benchmark (Bloc 3 ZD) est chargé
 * séparément car piloté par ses propres filtres — voir loadBenchmark /
 * loadBenchmarkFiltres, appelés dans le MÊME Promise.all initial côté page SSR.
 */
export async function loadTraiteurDashboard(
  supabase: DbClient,
  ctx: LoaderCtx,
  params: TraiteurDashboardParams,
): Promise<TraiteurDashboardPayload> {
  const type = params.type === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const isZd = type === 'zero_dechet';
  const shared = {
    from: params.from,
    to: params.to,
    lieuIds: params.lieuIds ?? [],
    traiteurIds: params.traiteurIds ?? [],
    typeEvtIds: params.typeEvtIds ?? [],
    tailleEvts: params.tailleEvts ?? [],
  };

  const [kpi, evolution, blocs, marge, pack] = await Promise.all([
    loadKpiTraiteur(supabase, ctx, {
      from: params.from,
      to: params.to,
      type,
      compare: 'n1',
    }),
    loadEvolution(supabase, ctx, { type, ...shared }),
    loadBlocs(supabase, ctx, { type, ...shared }),
    isZd
      ? loadMargeAttente(supabase, { from: params.from, to: params.to })
      : Promise.resolve(null),
    isZd ? Promise.resolve(null) : loadPackAg(ctx),
  ]);

  return { kpi, evolution, blocs, marge, pack };
}
