import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';

/**
 * GET /api/v1/dashboards/blocs — Blocs §11 partagés « liste/ranking » du dashboard
 * client, par onglet ZD/AG (§06.04 Bloc 3 AG / 5 / 6 / 7, §06.05 idem, §06.11 idem) :
 *   - Bloc 5  : prochaines collectes (fenêtre glissante 30 j à venir).
 *   - Bloc 6  : top 5 lieux (ZD par tonnage, AG par repas donnés).
 *   - Bloc 7  : top 5 « acteurs » — commerciaux (traiteur, evenements.created_by)
 *               ou traiteurs opérationnels (gestionnaire). RETIRÉ côté agence
 *               (§06.11 diff #8 / §11 §4 — RLS users agence = self).
 *   - Bloc 3 AG : top associations bénéficiaires (attributions_antgaspi ⋈ associations).
 *   - kgParPaxParFlux (ZD) : ratio kg-du-flux / pax pour les jauges Bloc 3 ZD
 *     traiteur/agence (le gestionnaire l'obtient déjà via /gestionnaire/dashboard).
 *
 * « 1 dashboard, 3 contextes » : endpoint PARTAGÉ (même périmètre par rôle que
 * /dashboards/evolution — défense en profondeur EN PLUS de la RLS) :
 *   - traiteur / agence → evenements.organisation_id = organisation courante.
 *   - gestionnaire      → evenements.lieu_id ∈ organisations_lieux (parc RLS-scopé).
 * Aucune vue nouvelle : agrégation TS sur les tables sources (mêmes jointures que
 * /dashboards/evolution et /gestionnaire/dashboard). RLS lit collectes via
 * plateforme.f_collecte_visible(id) → aucun débordement inter-organisation.
 */

const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
] as const;

// Collectes « à venir » (Bloc 5) : statuts non terminaux et non annulés.
const STATUTS_A_VENIR = ['programmee', 'validee', 'en_cours'] as const;
const PROCHAINES_FENETRE_JOURS = 30;
const TOP_N = 5;

interface EvtEmbed {
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

interface CollecteRow {
  id: string;
  type: string;
  taux_recyclage: number | null;
  date_collecte: string;
  evenements: EvtEmbed | EvtEmbed[] | null;
  collecte_flux: { poids_reel_kg: number | null }[] | null;
  attributions_antgaspi: AttrEmbed[] | AttrEmbed | null;
}

function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

function evtOf(c: {
  evenements: EvtEmbed | EvtEmbed[] | null;
}): EvtEmbed | null {
  return Array.isArray(c.evenements) ? (c.evenements[0] ?? null) : c.evenements;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function attrsOf(c: CollecteRow): AttrEmbed[] {
  const a = c.attributions_antgaspi;
  return Array.isArray(a) ? a : a ? [a] : [];
}

function kgOf(c: CollecteRow): number {
  const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
  return flux.reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}

// Somme des pax sur événements DISTINCTS (un événement à 2+ collectes ne compte
// son pax qu'une fois — réplique v_kpi_traiteur / gestionnaire dashboard).
function paxDistinct(rows: CollecteRow[]): number {
  const parEvt = new Map<string, number>();
  let sansId = 0;
  for (const c of rows) {
    const evt = evtOf(c);
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

  const role = auth.ctx.role;
  const isGestionnaire = role === 'gestionnaire_lieux';
  const isAgence = role === 'agence';

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
        data: emptyBlocs(type, isGestionnaire, isAgence),
      });
    }
    perimetreLieuIds = lieuFilter;
  }

  // Applique le périmètre par rôle + filtres globaux communs à une requête collectes.
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
      // traiteur / agence — org programmatrice (donneur d'ordre pour l'agence).
      query = query.eq('evenements.organisation_id', auth.ctx.organisationId);
      if (lieuIds.length > 0) query = query.in('evenements.lieu_id', lieuIds);
    }
    if (typeEvtIds.length > 0)
      query = query.in('evenements.type_evenement_id', typeEvtIds);
    return query as unknown as T;
  };

  const tailleOk = (evt: EvtEmbed | null): boolean => {
    if (!evt) return false;
    if (tailleEvts.length === 0) return true;
    return tailleEvts.includes(tailleBracket(evt.pax ?? 0));
  };

  // ── Fetch A — collectes clôturées de la période (Bloc 6 / 7 / 3AG / perFlux) ──
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

  const { data: histData, error: histErr } = await qHist;
  if (histErr)
    return NextResponse.json({ error: histErr.message }, { status: 500 });
  const histRows = ((histData ?? []) as unknown as CollecteRow[]).filter((c) =>
    tailleOk(evtOf(c)),
  );

  // ── Fetch B — prochaines collectes (fenêtre glissante 30 j) ──────────────────
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

  const { data: prochData, error: prochErr } = await qProch;
  if (prochErr)
    return NextResponse.json({ error: prochErr.message }, { status: 500 });

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
      const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
      if (!evt) return false;
      if (tailleEvts.length === 0) return true;
      return tailleEvts.includes(tailleBracket(evt.pax ?? 0));
    })
    .map((c) => {
      const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
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
        // Colonne « Traiteur » du Bloc 5 gestionnaire (§06.05 l.194) — résolue plus
        // bas. Null côté traiteur/agence (pas de colonne Traiteur, §06.04 l.169).
        traiteur_nom: null as string | null,
      };
    });

  // ── Bloc 6 — Top 5 lieux ─────────────────────────────────────────────────────
  const topLieux = topLieuxFrom(histRows, type);

  // ── Bloc 7 — Top 5 acteurs (commerciaux / traiteurs), retiré côté agence ─────
  let topActeurs: ActeurRow[] | null = null;
  let acteurLabel: 'Commercial' | 'Traiteur' | null = null;
  if (isGestionnaire) {
    acteurLabel = 'Traiteur';
    topActeurs = aggregateActeurs(
      histRows,
      type,
      (evt) => evt.traiteur_operationnel_organisation_id,
    );
    // Résolution des noms traiteurs — une seule requête pour Bloc 7 + colonne
    // Traiteur du Bloc 5 (union des ids).
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
    // traiteur_manager / traiteur_commercial — Bloc 7 « Top 5 commerciaux ».
    acteurLabel = 'Commercial';
    topActeurs = aggregateActeurs(histRows, type, (evt) => evt.created_by);
    await resolveCommercialNoms(supabase, topActeurs);
  }
  // Agence : Bloc 7 retiré (§06.11 diff #8) → topActeurs reste null.

  // ── Bloc 3 AG — Top associations bénéficiaires ───────────────────────────────
  const topAssociations =
    type === 'anti_gaspi' ? topAssociationsFrom(histRows) : null;

  // ── Bloc 3 ZD — kg/pax par flux (jauges « Vous ») ────────────────────────────
  const kgParPaxParFlux =
    type === 'zero_dechet' ? kgParPaxParFluxFrom(histRows) : {};

  return NextResponse.json(
    {
      data: {
        prochaines,
        topLieux,
        topActeurs,
        acteurLabel,
        topAssociations,
        kgParPaxParFlux,
      },
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}

interface LieuRow {
  lieu_id: string;
  lieu_nom: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}

function topLieuxFrom(rows: CollecteRow[], type: string): LieuRow[] {
  const groups = new Map<
    string,
    {
      nom: string;
      nb: number;
      tonnage: number;
      tauxNum: number;
      tauxDen: number;
      repas: number;
      rowsForPax: CollecteRow[];
    }
  >();
  for (const c of rows) {
    const evt = evtOf(c);
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

interface ActeurRow {
  id: string;
  label: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}

function aggregateActeurs(
  rows: CollecteRow[],
  type: string,
  keyOf: (evt: EvtEmbed) => string | null,
): ActeurRow[] {
  const groups = new Map<
    string,
    {
      nb: number;
      tonnage: number;
      tauxNum: number;
      tauxDen: number;
      repas: number;
      rowsForPax: CollecteRow[];
    }
  >();
  for (const c of rows) {
    const evt = evtOf(c);
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
  // Bloc 7 : ordonné par NOMBRE de collectes décroissant (§06.04 l.187/269).
  list.sort((a, b) => b.nb_collectes - a.nb_collectes);
  return list.slice(0, TOP_N);
}

async function resolveCommercialNoms(
  supabase: ReturnType<typeof createSupabaseServerClient>,
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
  supabase: ReturnType<typeof createSupabaseServerClient>,
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

interface AssociationRow {
  association_id: string;
  nom: string;
  ville: string | null;
  nb_collectes: number;
  repas_recus: number;
}

function topAssociationsFrom(rows: CollecteRow[]): AssociationRow[] {
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

function kgParPaxParFluxFrom(rows: CollecteRow[]): Record<string, number> {
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
