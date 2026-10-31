// Cartes KPI des dashboards traiteur, agence et client organisateur, calculées
// depuis les collectes retenues par la barre de filtres globale.
//
// Ces cartes lisaient les vues mensuelles `v_kpi_traiteur` et
// `v_kpi_client_organisateur`, agrégées par organisation et par mois : elles ne
// peuvent pas être filtrées par lieu, client, traiteur, type ou taille
// d'événement. Le calcul est donc refait ici à partir des collectes, avec les
// mêmes règles que ces vues (collectes clôturées, poids = Σ des pesées, taux
// pondéré par le poids, pax des collectes, collecte à 0 convive écartée des
// ratios). Une seule voie de calcul, filtres posés ou non : la somme des parts
// d'un filtre égale toujours le total.
//
// La période porte sur `collectes.date_collecte` (§11, colonne de filtre de
// période), comme l'évolution et les Top listes. Les vues filtraient sur le 1er
// du mois : un mois entamé à la borne basse sortait en entier.

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { estUuid } from '@/lib/filtre-csv.js';
import { tailleBracket } from '@/lib/dashboard-kpi.js';
import {
  lireParLots,
  lireParPages,
  TAILLE_PAGE,
} from '@/lib/pdf/selection-par-pages.js';
import {
  previousWindow,
  type TraiteurKpiRow,
} from '@/lib/dashboards/cockpit-derive.js';

/** Filtres de la barre globale des dashboards (hors période). */
export interface FiltresGlobaux {
  lieuIds: string[];
  /** Traiteurs opérationnels (client organisateur, gestionnaire, Admin). */
  traiteurIds: string[];
  /** Noms de client organisateur saisis à la programmation (traiteur, agence). */
  clientNoms: string[];
  typeEvtIds: string[];
  tailleEvts: string[];
}

export const FILTRES_GLOBAUX_VIDES: FiltresGlobaux = {
  lieuIds: [],
  traiteurIds: [],
  clientNoms: [],
  typeEvtIds: [],
  tailleEvts: [],
};

/** Lit les filtres globaux d'une requête (`lieu_ids[]`, `client_noms[]`…). */
export function lireFiltresGlobaux(sp: URLSearchParams): FiltresGlobaux {
  return {
    lieuIds: sp.getAll('lieu_ids[]'),
    traiteurIds: sp.getAll('traiteur_ids[]'),
    clientNoms: sp.getAll('client_noms[]'),
    typeEvtIds: sp.getAll('type_evenement_ids[]'),
    tailleEvts: sp.getAll('taille_evenements[]'),
  };
}

/** Une collecte clôturée, réduite à ce que les cartes KPI additionnent. */
export interface CollecteKpi {
  id: string;
  type: 'zero_dechet' | 'anti_gaspi';
  date_collecte: string;
  pax: number | null;
  evenement_id: string;
  taux_recyclage: number | null;
  co2_induit_kg: number | null;
  co2_evite_kg: number | null;
  co2_net_kg: number | null;
  energie_primaire_evitee_kwh: number | null;
  /** Σ des pesées de la collecte (0 sans pesée). */
  tonnage_kg: number;
  /** Repas donnés (AG), 0 sans attribution. */
  repas: number;
  /** Σ HT des factures émises ou payées de la collecte (marge ZD du traiteur). */
  factures_ht?: number;
}

/** Ligne mensuelle : forme des anciennes vues, plus le nombre d'événements. */
export type LigneKpi = TraiteurKpiRow & { nb_evenements: number };

const nombre = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number | null);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

/** Somme SQL : null quand aucune valeur n'est renseignée. */
const sommeSql = (valeurs: (number | null)[]): number | null => {
  const posees = valeurs.filter((v): v is number => v != null);
  return posees.length > 0 ? posees.reduce((s, v) => s + nombre(v), 0) : null;
};

/**
 * Regroupe des collectes clôturées par mois et par type, avec les règles des
 * vues `v_kpi_traiteur` / `v_kpi_client_organisateur`. Pure. Mois décroissants.
 * Marge ZD (§06.04, formule de `v_kpi_traiteur`) : calculée seulement si un
 * `tarif` est fourni (traiteur) — tarif × Σ pax − Σ factures ZD émises ou
 * payées, null sans pax ou sans tarif ; sinon null (agence, organisateur).
 */
export function lignesKpiMensuelles(
  collectes: CollecteKpi[],
  marge?: { tarif: number | null },
): LigneKpi[] {
  const groupes = new Map<string, CollecteKpi[]>();
  for (const c of collectes) {
    const cle = `${c.date_collecte.slice(0, 7)}-01|${c.type}`;
    const liste = groupes.get(cle) ?? [];
    liste.push(c);
    groupes.set(cle, liste);
  }

  const lignes: LigneKpi[] = [];
  for (const [cle, liste] of groupes) {
    const [mois, type] = cle.split('|') as [string, CollecteKpi['type']];
    const zd = type === 'zero_dechet';
    const paxDe = (c: CollecteKpi) => Math.max(0, nombre(c.pax));
    const avecTaux = liste.filter((c) => c.taux_recyclage != null);
    const poidsTaux = avecTaux.reduce((s, c) => s + c.tonnage_kg, 0);
    const avecConvives = liste.filter((c) => paxDe(c) > 0);
    const pax = liste.reduce((s, c) => s + paxDe(c), 0);
    lignes.push({
      mois,
      type_collecte: type,
      nb_collectes: new Set(liste.map((c) => c.id)).size,
      nb_evenements: new Set(liste.map((c) => c.evenement_id)).size,
      tonnage_kg: zd ? liste.reduce((s, c) => s + c.tonnage_kg, 0) : null,
      taux_recyclage_pondere:
        zd && poidsTaux > 0
          ? avecTaux.reduce(
              (s, c) => s + nombre(c.taux_recyclage) * c.tonnage_kg,
              0,
            ) / poidsTaux
          : null,
      nb_repas_donnes: zd ? null : liste.reduce((s, c) => s + c.repas, 0),
      marge_zd_ht:
        zd && pax > 0 && marge?.tarif != null
          ? marge.tarif * pax -
            liste.reduce((s, c) => s + (c.factures_ht ?? 0), 0)
          : null,
      pax_total: pax,
      tonnage_kg_pax_connu:
        zd && avecConvives.length > 0
          ? avecConvives.reduce((s, c) => s + c.tonnage_kg, 0)
          : null,
      nb_repas_pax_connu:
        !zd && avecConvives.length > 0
          ? avecConvives.reduce((s, c) => s + c.repas, 0)
          : null,
      co2_induit_kg: sommeSql(liste.map((c) => c.co2_induit_kg)),
      co2_evite_kg: sommeSql(liste.map((c) => c.co2_evite_kg)),
      co2_net_kg: sommeSql(liste.map((c) => c.co2_net_kg)),
      energie_primaire_evitee_kwh: sommeSql(
        liste.map((c) => c.energie_primaire_evitee_kwh),
      ),
    });
  }
  return lignes.sort((a, b) =>
    a.mois === b.mois
      ? a.type_collecte.localeCompare(b.type_collecte)
      : b.mois.localeCompare(a.mois),
  );
}

type ErreurLecture = { message: string; code?: string };

interface LigneLue {
  id: string;
  type: CollecteKpi['type'];
  date_collecte: string;
  pax: number | null;
  evenement_id: string;
  taux_recyclage: number | string | null;
  co2_induit_kg: number | string | null;
  co2_evite_kg: number | string | null;
  co2_net_kg: number | string | null;
  energie_primaire_evitee_kwh: number | string | null;
  collecte_flux: { poids_reel_kg: number | string | null }[] | null;
  attributions_antgaspi?:
    | { volume_repas_realise: number | null }[]
    | { volume_repas_realise: number | null }
    | null;
}

const nombreOuNull = (v: number | string | null): number | null =>
  v == null ? null : nombre(v);

/**
 * Les cartes KPI ne lisent que des sommes : un client Supabase réduit à ce que
 * la requête utilise (le loader est testé avec un faux client).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (table: string) => any };

export interface KpiCollectesParams {
  from: string | null;
  to: string | null;
  /** Type de collecte de l'onglet ; null = les deux (bandeau YTD organisateur). */
  type: 'zero_dechet' | 'anti_gaspi' | null;
  /** 'n1' : rend aussi la période précédente équivalente (variation). */
  compare?: string | null;
  filtres: FiltresGlobaux;
  /** Traiteur seul : tarif de refacturation, pour la marge ZD (§06.04). */
  marge?: { tarif: number | null };
}

/**
 * Collectes clôturées du périmètre du rôle, filtres globaux appliqués, réduites
 * en lignes mensuelles. Périmètre : événements PROGRAMMÉS par l'organisation
 * (traiteur, agence — comme `v_kpi_traiteur`) ou dont elle est le client
 * organisateur rattaché (client organisateur — comme `v_kpi_client_organisateur`).
 * Lecture sous l'identité de l'appelant (RLS), le périmètre en plus.
 *
 * Repas du client organisateur : il ne lit pas `attributions_antgaspi` (sa vue
 * passait par `f_volume_repas_realise`, SECURITY DEFINER). Ils sont lus en
 * service_role, bornés aux identifiants des collectes que la lecture sous RLS
 * vient de lui rendre : aucune autre collecte n'est lue.
 *
 * Marge du traiteur : factures ZD émises ou payées des collectes retenues, lues
 * sous RLS (`fc_select` : factures de son organisation), comme la vue.
 */
export async function loadKpiCollectes(
  supabase: Client,
  ctx: { role: string; organisationId: string },
  params: KpiCollectesParams,
): Promise<{ data: LigneKpi[]; previous?: LigneKpi[] }> {
  const { from, to, type, filtres } = params;
  const organisateur = ctx.role === 'client_organisateur';
  const typeEvtIds = filtres.typeEvtIds.filter(estUuid);
  const lieuIds = filtres.lieuIds.filter(estUuid);
  const traiteurIds = organisateur ? filtres.traiteurIds.filter(estUuid) : [];
  const win = params.compare === 'n1' ? previousWindow(from, to) : null;
  const vide = { data: [], ...(win ? { previous: [] } : {}) };

  // Filtre sans identifiant lisible : aucune collecte, jamais un filtre ignoré
  // ni une erreur de PostgREST (22P02).
  const illisible = (demandes: string[], lisibles: string[]) =>
    demandes.length > 0 && lisibles.length === 0;
  if (
    illisible(filtres.typeEvtIds, typeEvtIds) ||
    illisible(filtres.lieuIds, lieuIds) ||
    (organisateur && illisible(filtres.traiteurIds, traiteurIds))
  )
    return vide;

  const repasDirects = !organisateur && type !== 'zero_dechet';
  const select = `id, type, date_collecte, pax, evenement_id, taux_recyclage,
     co2_induit_kg, co2_evite_kg, co2_net_kg, energie_primaire_evitee_kwh,
     evenements!inner(id, lieu_id, organisation_id, nom_client_organisateur,
       client_organisateur_organisation_id, traiteur_operationnel_organisation_id),
     collecte_flux(poids_reel_kg)${
       repasDirects ? ', attributions_antgaspi(volume_repas_realise)' : ''
     }`;

  const debut = win ? win.from : from;
  const lirePage = (apresId: string | null) => {
    let q = supabase
      .from('collectes')
      .select(select)
      .eq('statut', 'cloturee')
      .eq(
        organisateur
          ? 'evenements.client_organisateur_organisation_id'
          : 'evenements.organisation_id',
        ctx.organisationId,
      );
    if (type) q = q.eq('type', type);
    if (debut) q = q.gte('date_collecte', debut);
    if (to) q = q.lte('date_collecte', to);
    if (lieuIds.length > 0) q = q.in('evenements.lieu_id', lieuIds);
    if (traiteurIds.length > 0)
      q = q.in('evenements.traiteur_operationnel_organisation_id', traiteurIds);
    if (!organisateur && filtres.clientNoms.length > 0)
      q = q.in('evenements.nom_client_organisateur', filtres.clientNoms);
    // Type et taille : ceux de la COLLECTE (décisions Val C3 du 2026-10-22, Q3 du 2026-10-24).
    if (typeEvtIds.length > 0) q = q.in('type_evenement_id', typeEvtIds);
    if (apresId) q = q.gt('id', apresId);
    return q.limit(TAILLE_PAGE).order('id', { ascending: true });
  };

  const lu = await lireParPages<LigneLue>(lirePage);
  if (lu.error) throw lu.error;
  const lignes = lu.data.filter(
    (c) =>
      filtres.tailleEvts.length === 0 ||
      filtres.tailleEvts.includes(tailleBracket(nombre(c.pax))),
  );

  const repas = new Map<string, number>();
  if (organisateur) {
    const idsAg = lignes
      .filter((c) => c.type === 'anti_gaspi')
      .map((c) => c.id);
    if (idsAg.length > 0) {
      const admin = createAdminSupabaseClient();
      const att = await lireParLots<{
        collecte_id: string;
        volume_repas_realise: number | null;
      }>(idsAg, (lot) =>
        admin
          .from('attributions_antgaspi')
          .select('collecte_id, volume_repas_realise')
          .in('collecte_id', lot),
      );
      if (att.error) throw att.error as ErreurLecture;
      for (const a of att.data)
        repas.set(
          a.collecte_id,
          (repas.get(a.collecte_id) ?? 0) + nombre(a.volume_repas_realise),
        );
    }
  }

  const factures = new Map<string, number>();
  if (params.marge && params.marge.tarif != null) {
    const idsZd = lignes
      .filter((c) => c.type === 'zero_dechet')
      .map((c) => c.id);
    const fc = await lireParLots<{
      collecte_id: string;
      montant_ht: number | string | null;
    }>(idsZd, (lot) =>
      supabase
        .from('factures_collectes')
        .select('collecte_id, montant_ht, factures!inner(statut)')
        .in('collecte_id', lot)
        .in('factures.statut', ['emise', 'payee']),
    );
    if (fc.error) throw fc.error;
    for (const f of fc.data)
      factures.set(
        f.collecte_id,
        (factures.get(f.collecte_id) ?? 0) + nombre(f.montant_ht),
      );
  }

  const collectes: CollecteKpi[] = lignes.map((c) => {
    const att = c.attributions_antgaspi;
    const liste = Array.isArray(att) ? att : att ? [att] : [];
    return {
      id: c.id,
      type: c.type,
      date_collecte: c.date_collecte,
      pax: c.pax,
      evenement_id: c.evenement_id,
      taux_recyclage: nombreOuNull(c.taux_recyclage),
      co2_induit_kg: nombreOuNull(c.co2_induit_kg),
      co2_evite_kg: nombreOuNull(c.co2_evite_kg),
      co2_net_kg: nombreOuNull(c.co2_net_kg),
      energie_primaire_evitee_kwh: nombreOuNull(c.energie_primaire_evitee_kwh),
      tonnage_kg: (c.collecte_flux ?? []).reduce(
        (s, f) => s + nombre(f.poids_reel_kg),
        0,
      ),
      repas: organisateur
        ? (repas.get(c.id) ?? 0)
        : liste.reduce((s, a) => s + nombre(a.volume_repas_realise), 0),
      factures_ht: factures.get(c.id) ?? 0,
    };
  });

  const dans = (c: CollecteKpi, lo: string | null, hi: string | null) =>
    (!lo || c.date_collecte >= lo) && (!hi || c.date_collecte <= hi);
  return {
    data: lignesKpiMensuelles(
      collectes.filter((c) => dans(c, from, to)),
      params.marge,
    ),
    ...(win
      ? {
          previous: lignesKpiMensuelles(
            collectes.filter((c) => dans(c, win.from, win.to)),
            params.marge,
          ),
        }
      : {}),
  };
}
