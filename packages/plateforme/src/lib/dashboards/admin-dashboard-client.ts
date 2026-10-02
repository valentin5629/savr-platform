/**
 * Loader Admin « Dashboard Client » (§06.06 §2) — réplique LECTURE SEULE du
 * dashboard gestionnaire (§06.05) agrégée sur un périmètre d'organisations, pour
 * l'équipe Savr. Contrairement aux loaders client (`loaders.ts`, RLS sous
 * l'identité appelante), celui-ci tourne en **service_role** (bypass RLS) et
 * scope EXPLICITEMENT par `organisation_ids[]` — l'admin voit tout, ou le
 * périmètre sélectionné. La garde d'accès (requireStaff) est faite par la route.
 *
 * Réutilise EXACTEMENT les mêmes algorithmes purs que le dashboard client
 * (computeDashboardKpi + buildEvolutionSeries + topLieuxFrom + aggregateActeurs +
 * topAssociationsFrom + kgParPaxParFluxFrom) → parité de sémantique garantie ;
 * seul le SCOPE (service_role + org filter) diffère.
 */
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  computeDashboardKpi,
  emptyKpi,
  tailleBracket,
  type DashboardKpi,
  type DashboardCollecteRow,
  type DashboardCollecteType,
} from '@/lib/dashboard-kpi.js';
import {
  buildEvolutionSeries,
  granulariteFor,
  topLieuxFrom,
  aggregateActeurs,
  topAssociationsFrom,
  kgParPaxParFluxFrom,
  lireFacteursCo2,
  lireMethodeCo2,
  type EvoCollecteRow,
  type BlocsCollecteRow,
  type LieuRow,
  type ActeurRow,
  type AssociationRow,
  type EvolutionResult,
  type Co2Methode,
} from '@/lib/dashboards/loaders.js';
import {
  co2Totals,
  type Co2Totals,
  type FacteursCo2,
  type TraiteurKpiRow,
} from '@/lib/dashboards/cockpit-derive.js';
import { erreurInterne } from '@/lib/api-helpers.js';
import { periodeBenchmark } from '@/lib/dashboards/periode-benchmark.js';

type AdminDbClient = ReturnType<typeof createAdminSupabaseClient>;

export interface AdminDashboardClientParams {
  type: DashboardCollecteType;
  from: string | null;
  to: string | null;
  /** Périmètre : vide = « Toutes les organisations » (totalité des collectes Savr). */
  organisationIds: string[];
  lieuIds: string[];
  traiteurIds: string[];
  typeEvtIds: string[];
  tailleEvts: string[];
}

export interface AdminDashboardClientPayload {
  kpi: DashboardKpi;
  /** Bloc 3 ZD — « mon » kg/pax par flux (repère parc servi à part par la route benchmark). */
  kgParPaxParFlux: Record<string, number>;
  evolution: EvolutionResult;
  /** KPI CO₂ évité (Σ figées collectes.co2_*) + variables de la modale « méthode ». */
  co2: Co2Totals;
  facteursCo2: FacteursCo2;
  co2Methode: Co2Methode;
  blocs: {
    topLieux: LieuRow[];
    topActeurs: ActeurRow[];
    acteurLabel: 'Traiteur';
    topAssociations: AssociationRow[] | null;
  };
}

const SELECT_HISTORIQUE = `id, type, taux_recyclage, date_collecte,
   co2_evite_kg, co2_induit_kg, co2_net_kg, energie_primaire_evitee_kwh,
   evenements!inner(id, lieu_id, pax, organisation_id, type_evenement_id,
     traiteur_operationnel_organisation_id, created_by, lieux!inner(id, nom)),
   collecte_flux(poids_reel_kg, flux_dechets(code)),
   attributions_antgaspi(volume_repas_realise, association_id,
     associations!association_id(id, nom, ville))`;

// Les ids d'org sont interpolés dans une chaîne de filtre `.or()` PostgREST (non
// paramétrée). Ils viennent d'un staff authentifié qui voit déjà tout — donc pas
// de frontière de confidentialité — mais on valide en UUID par défense en
// profondeur (empêche tout id malformé de casser/élargir le filtre, revue rls R24c).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function onlyUuids(ids: string[]): string[] {
  return ids.filter((id) => UUID_RE.test(id));
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Noms des organisations (traiteurs opérationnels) — service_role, voit tout. */
async function orgNames(
  admin: AdminDbClient,
  ids: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (uniq.length === 0) return new Map();
  const { data } = await admin
    .from('organisations')
    .select('id, nom')
    .in('id', uniq);
  return new Map(
    (data ?? []).map((o) => [o.id as string, (o.nom as string) ?? '']),
  );
}

/**
 * Charge le dashboard Admin Client complet (KPI + kg/pax par flux + évolution +
 * blocs top) pour un onglet donné, scopé au périmètre d'organisations.
 * `organisationIds` vide = agrégation sur la totalité des collectes Savr.
 */
export async function loadAdminDashboardClient(
  admin: AdminDbClient,
  params: AdminDashboardClientParams,
): Promise<AdminDashboardClientPayload> {
  const type: DashboardCollecteType =
    params.type === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const { from, to, organisationIds, lieuIds, traiteurIds, typeEvtIds } =
    params;
  const tailleEvts = params.tailleEvts;

  // Scope cross-org (service_role) : « Toutes » = aucun filtre org.
  const applyScope = <
    Q extends {
      in: (c: string, v: readonly unknown[]) => Q;
      or: (f: string, opts: { referencedTable: string }) => Q;
    },
  >(
    q: Q,
  ): Q => {
    let query = q;
    // Périmètre org — DÉCISION VAL R24c (divergence §06.06 §2 tracée) : sélectionner
    // un TRAITEUR = voir toute son ACTIVITÉ D'OPÉRATEUR. On matche donc les collectes
    // où une org sélectionnée est PROGRAMMATRICE (organisation_id) OU TRAITEUR
    // OPÉRATIONNEL (traiteur_operationnel_organisation_id) : un traiteur → ses
    // collectes opérées (incl. sous-traité pour une agence, ex. Kaspia 97 et non 85) ;
    // une agence → ses événements programmés (jamais opératrice). §06.06 §2 ne scopait
    // que par organisation_id.
    const safeOrgIds = onlyUuids(organisationIds);
    if (safeOrgIds.length > 0) {
      const ids = safeOrgIds.join(',');
      query = query.or(
        `organisation_id.in.(${ids}),traiteur_operationnel_organisation_id.in.(${ids})`,
        { referencedTable: 'evenements' },
      );
    }
    if (lieuIds.length > 0) query = query.in('evenements.lieu_id', lieuIds);
    if (traiteurIds.length > 0)
      query = query.in(
        'evenements.traiteur_operationnel_organisation_id',
        traiteurIds,
      );
    if (typeEvtIds.length > 0)
      query = query.in('evenements.type_evenement_id', typeEvtIds);
    return query;
  };

  // ── Historique (KPI + évolution + blocs) ────────────────────────────────────
  let qHist = admin
    .from('collectes')
    .select(SELECT_HISTORIQUE)
    .eq('statut', 'cloturee')
    .eq('type', type);
  qHist = applyScope(qHist as never) as typeof qHist;
  if (from) qHist = qHist.gte('date_collecte', from);
  if (to) qHist = qHist.lte('date_collecte', to);

  // La vue (requête lourde) + facteurs/méthode CO₂ (clients service_role séparés,
  // constantes ADEME globales) sont indépendants → lancés en parallèle.
  const [histRes, facteursCo2, co2Methode] = await Promise.all([
    qHist,
    lireFacteursCo2(),
    lireMethodeCo2(),
  ]);
  if (histRes.error)
    throw erreurInterne(histRes.error, 'admin.dashboard_client.historique');

  // Filtre taille (pax) en JS — parité §06.05.
  const tailleOk = (evt: { pax?: number | null } | null): boolean => {
    if (!evt) return false;
    if (tailleEvts.length === 0) return true;
    return tailleEvts.includes(tailleBracket(evt.pax ?? 0));
  };

  const histAll = (histRes.data ?? []) as unknown as BlocsCollecteRow[];
  const histRows = histAll.filter((c) => tailleOk(firstOf(c.evenements)));

  const kpi =
    histRows.length > 0
      ? computeDashboardKpi(histRows as unknown as DashboardCollecteRow[], type)
      : emptyKpi(type);

  const g =
    from && to
      ? granulariteFor(from, to)
      : granulariteFor(from ?? to ?? '', to ?? from ?? '');
  const series = buildEvolutionSeries(
    histRows as unknown as EvoCollecteRow[],
    type,
    g,
  );

  // CO₂ évité (Σ des grandeurs figées collectes.co2_*, jamais recalculées §11 l.185).
  const co2 = co2Totals(histRows as unknown as TraiteurKpiRow[]);

  const topLieux = topLieuxFrom(histRows, type);
  const topActeurs = aggregateActeurs(
    histRows,
    type,
    (evt) => evt.traiteur_operationnel_organisation_id,
  );
  const topAssociations =
    type === 'anti_gaspi' ? topAssociationsFrom(histRows) : null;
  const kgParPaxParFlux =
    type === 'zero_dechet' ? kgParPaxParFluxFrom(histRows) : {};

  // Résolution des noms de traiteur (top acteurs) — service_role.
  const noms = await orgNames(
    admin,
    topActeurs.map((a) => a.id),
  );
  for (const a of topActeurs)
    a.label = noms.get(a.id) || 'Traiteur hors référentiel';

  return {
    kpi,
    kgParPaxParFlux,
    evolution: { granularite: g, series },
    co2,
    facteursCo2,
    co2Methode,
    blocs: {
      topLieux,
      topActeurs,
      acteurLabel: 'Traiteur',
      topAssociations,
    },
  };
}

// ─── Bloc 3 ZD — ligne de référence du radar, version Admin ─────────────────────

/** Filtres de la ligne de référence (encart « Comparer avec » du radar). */
export interface AdminBenchmarkFiltres {
  /** Traiteurs OPÉRATIONNELS (même clé que le périmètre et le Top 5). */
  traiteurIds: string[];
  lieuIds: string[];
  typeEvtIds: string[];
  tailleEvts: string[];
}

export interface AdminBenchmarkComparaison {
  /** kg/pax par code de flux sur le périmètre de référence (Σ kg flux / Σ pax). */
  kgParPaxParFlux: Record<string, number>;
  /** Collectes clôturées ZD qui composent la référence (taille d'échantillon). */
  nbCollectes: number;
  /** Bornes de la période fixe 24 mois glissants (affichage). */
  periode: { debut: string; fin: string };
}

const SELECT_REFERENCE = `id, type, taux_recyclage, date_collecte,
   evenements!inner(id, lieu_id, pax, organisation_id, type_evenement_id,
     traiteur_operationnel_organisation_id),
   collecte_flux(poids_reel_kg, flux_dechets(code))`;

/**
 * Ligne de référence du radar Admin (« Moyenne parc » paramétrable, décision Val
 * 2026-10-02) : kg/pax par flux des collectes clôturées ZD du parc, sur la
 * période fixe 24 mois glissants, restreint aux filtres reçus. Aucun filtre =
 * tout le parc Savr.
 *
 * ⚠ Volontairement SANS k-anonymat : l'Admin voit déjà chaque organisation en
 * clair (sélecteur de périmètre) ; masquer un segment ne protégerait rien et
 * empêcherait la comparaison « un traiteur contre un autre ». La fonction SQL
 * `f_benchmark_kg_pax_zd` (k ≥ 5 collectes et ≥ 3 acteurs) reste la seule source
 * des dashboards CLIENTS, inchangée. Même formule que la ligne « Vous »
 * (`kgParPaxParFluxFrom`) : les deux lignes se comparent à grain identique.
 */
export async function loadAdminBenchmarkComparaison(
  admin: AdminDbClient,
  filtres: AdminBenchmarkFiltres,
): Promise<AdminBenchmarkComparaison> {
  const periode = periodeBenchmark();
  let q = admin
    .from('collectes')
    .select(SELECT_REFERENCE)
    .eq('statut', 'cloturee')
    .eq('type', 'zero_dechet')
    .gte('date_collecte', periode.debut)
    .lte('date_collecte', periode.fin);
  const traiteurIds = onlyUuids(filtres.traiteurIds);
  const lieuIds = onlyUuids(filtres.lieuIds);
  const typeEvtIds = onlyUuids(filtres.typeEvtIds);
  if (traiteurIds.length > 0)
    q = q.in('evenements.traiteur_operationnel_organisation_id', traiteurIds);
  if (lieuIds.length > 0) q = q.in('evenements.lieu_id', lieuIds);
  if (typeEvtIds.length > 0)
    q = q.in('evenements.type_evenement_id', typeEvtIds);

  const res = await q;
  if (res.error)
    throw erreurInterne(
      res.error,
      'admin.dashboard_client.benchmark.reference',
    );

  // Filtre taille (pax) en JS — même règle que le dashboard (parité §06.05).
  const tailleEvts = filtres.tailleEvts;
  const rows = ((res.data ?? []) as unknown as BlocsCollecteRow[]).filter(
    (c) => {
      if (tailleEvts.length === 0) return true;
      const evt = firstOf(c.evenements);
      return evt != null && tailleEvts.includes(tailleBracket(evt.pax ?? 0));
    },
  );

  return {
    kgParPaxParFlux: kgParPaxParFluxFrom(rows),
    nbCollectes: rows.length,
    periode,
  };
}

export interface AdminBenchmarkFiltresOptions {
  lieux: { id: string; nom: string }[];
  traiteurs: { id: string; nom: string }[];
  types: { id: string; libelle: string }[];
}

/**
 * Options des filtres de la ligne de référence (encart « Comparer avec »), en
 * service_role : lieux actifs du parc, traiteurs actifs non fantômes, types
 * d'événements actifs — mêmes critères que `f_benchmark_lieux_parc` /
 * `f_benchmark_traiteurs_parc` côté clients (fonctions dont la liste blanche de
 * rôles exige un JWT métier, absent sous service_role).
 */
export async function loadAdminBenchmarkFiltres(
  admin: AdminDbClient,
): Promise<AdminBenchmarkFiltresOptions> {
  const [lieux, traiteurs, types] = await Promise.all([
    admin.from('lieux').select('id, nom').neq('actif', false).order('nom'),
    admin
      .from('organisations')
      .select('id, nom')
      .eq('type', 'traiteur')
      .neq('actif', false)
      .neq('est_shadow', true)
      .order('nom'),
    admin
      .from('types_evenements')
      .select('id, libelle')
      .eq('actif', true)
      .order('ordre_affichage'),
  ]);
  const firstError = lieux.error ?? traiteurs.error ?? types.error;
  if (firstError)
    throw erreurInterne(firstError, 'admin.dashboard_client.benchmark.filtres');
  return {
    lieux: (lieux.data ?? []) as { id: string; nom: string }[],
    traiteurs: (traiteurs.data ?? []) as { id: string; nom: string }[],
    types: (types.data ?? []) as { id: string; libelle: string }[],
  };
}
