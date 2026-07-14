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
  type EvoCollecteRow,
  type BlocsCollecteRow,
  type LieuRow,
  type ActeurRow,
  type AssociationRow,
  type ProchaineCollecteRow,
  type EvolutionResult,
} from '@/lib/dashboards/loaders.js';

type AdminDbClient = ReturnType<typeof createAdminSupabaseClient>;

const STATUTS_A_VENIR = ['programmee', 'validee', 'en_cours'] as const;
const PROCHAINES_FENETRE_JOURS = 30;

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
  blocs: {
    topLieux: LieuRow[];
    topActeurs: ActeurRow[];
    acteurLabel: 'Traiteur';
    topAssociations: AssociationRow[] | null;
    prochaines: ProchaineCollecteRow[];
  };
}

const SELECT_HISTORIQUE = `id, type, taux_recyclage, date_collecte,
   evenements!inner(id, lieu_id, pax, organisation_id, type_evenement_id,
     traiteur_operationnel_organisation_id, created_by, lieux!inner(id, nom)),
   collecte_flux(poids_reel_kg, flux_dechets(code)),
   attributions_antgaspi(volume_repas_realise, association_id,
     associations!association_id(id, nom, ville))`;

const SELECT_PROCHAINES = `id, date_collecte, heure_collecte, statut, type,
   evenements!inner(id, nom_evenement, lieu_id, pax, organisation_id,
     type_evenement_id, traiteur_operationnel_organisation_id, created_by,
     lieux!inner(id, nom))`;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
 * blocs top/prochaines) pour un onglet donné, scopé au périmètre d'organisations.
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

  // Scope cross-org (service_role) : « Toutes » = aucun filtre org ; sinon `.in`.
  const applyScope = <
    Q extends {
      in: (c: string, v: readonly unknown[]) => Q;
    },
  >(
    q: Q,
  ): Q => {
    let query = q;
    if (organisationIds.length > 0)
      query = query.in('evenements.organisation_id', organisationIds);
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

  // ── Prochaines (Bloc 5, fenêtre 30 j) ───────────────────────────────────────
  const today = new Date();
  const in30 = new Date(today.getTime());
  in30.setDate(in30.getDate() + PROCHAINES_FENETRE_JOURS);
  let qProch = admin
    .from('collectes')
    .select(SELECT_PROCHAINES)
    .eq('type', type)
    .in('statut', [...STATUTS_A_VENIR])
    .gte('date_collecte', isoDate(today))
    .lte('date_collecte', isoDate(in30));
  qProch = applyScope(qProch as never) as typeof qProch;
  // Tri (date puis heure) fait en JS après lecture — la liste « prochaines » est
  // bornée à 30 jours, l'ordre serveur n'apporte rien et évite un chaînage
  // `.order()` sensible.

  const [histRes, prochRes] = await Promise.all([qHist, qProch]);
  if (histRes.error) throw new Error(histRes.error.message);
  if (prochRes.error) throw new Error(prochRes.error.message);

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

  // Prochaines → objets front + résolution des noms de traiteur.
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
  const prochaines: ProchaineCollecteRow[] = (
    (prochRes.data ?? []) as unknown as ProchRow[]
  )
    .filter((c) => tailleOk(firstOf(c.evenements)))
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
    })
    .sort((a, b) => {
      const d = (a.date_collecte ?? '').localeCompare(b.date_collecte ?? '');
      return d !== 0
        ? d
        : (a.heure_collecte ?? '').localeCompare(b.heure_collecte ?? '');
    });

  // Résolution des noms de traiteur (top acteurs + prochaines) — service_role.
  const traiteurIdsAResoudre = [
    ...topActeurs.map((a) => a.id),
    ...prochaines.map((p) => p.traiteur_id).filter((x): x is string => !!x),
  ];
  const noms = await orgNames(admin, traiteurIdsAResoudre);
  for (const a of topActeurs)
    a.label = noms.get(a.id) || 'Traiteur hors référentiel';
  for (const p of prochaines)
    p.traiteur_nom = p.traiteur_id ? (noms.get(p.traiteur_id) ?? null) : null;

  return {
    kpi,
    kgParPaxParFlux,
    evolution: { granularite: g, series },
    blocs: {
      topLieux,
      topActeurs,
      acteurLabel: 'Traiteur',
      topAssociations,
      prochaines,
    },
  };
}
