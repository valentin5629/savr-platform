import {
  toCsv,
  formatDateFr,
  formatPoidsKg,
  type CsvColumn,
} from '@savr/shared/src/csv/index.js';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  type ExportContext,
  type ExportOutput,
  resolveTraiteurNoms,
  resolveRepas,
  sommePoidsFlux,
  unwrap,
} from './shared.js';

// Export Événements — grain ÉVÉNEMENT (1 ligne = 1 événement, données agrégées).
// Colonnes FIGÉES par §12 §2. Module partagé entre l'endpoint unifié (tous rôles
// autorisés, scopés par RLS) et la route dédiée gestionnaire (périmètre
// organisations_lieux explicite, défense en profondeur).

export const EVENEMENTS_SELECT = `id, nom_evenement, date_evenement, pax,
  traiteur_operationnel_organisation_id,
  lieux!lieu_id(nom),
  types_evenements!type_evenement_id(libelle),
  collectes(id, type, statut, date_collecte, taux_recyclage,
    collecte_flux(poids_reel_kg))`;

interface CollecteAgg {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  taux_recyclage: number | null;
  collecte_flux: { poids_reel_kg?: number | null }[];
}

export interface EvenementRow {
  date_evenement: string;
  nom_evenement: string;
  lieu: string;
  traiteur: string;
  type_evenement: string;
  taille_bracket: string;
  pax: number;
  nb_collectes_zd: number;
  nb_collectes_ag: number;
  tonnage_zd_kg: string;
  taux_recyclage_pct: number | '';
  repas_ag: number;
  statut_consolide: string;
  premiere_collecte: string;
  derniere_collecte: string;
}

function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

function statutConsolide(collectes: { statut: string }[]): string {
  if (collectes.length === 0) return 'En cours';
  if (collectes.every((c) => c.statut === 'annulee')) return 'Annulé';
  const terminaux = new Set(['realisee', 'cloturee', 'annulee']);
  const tousTerminaux = collectes.every((c) => terminaux.has(c.statut));
  const auMoinsUnRealise = collectes.some(
    (c) => c.statut === 'realisee' || c.statut === 'cloturee',
  );
  if (tousTerminaux && auMoinsUnRealise) return 'Terminé';
  return 'En cours';
}

const COLUMNS: CsvColumn<EvenementRow>[] = [
  { header: 'Date événement', value: (r) => formatDateFr(r.date_evenement) },
  { header: 'Nom événement', value: (r) => r.nom_evenement },
  { header: 'Lieu', value: (r) => r.lieu },
  { header: 'Traiteur', value: (r) => r.traiteur },
  { header: "Type d'événement", value: (r) => r.type_evenement },
  { header: 'Taille', value: (r) => r.taille_bracket },
  { header: 'Pax', value: (r) => r.pax },
  { header: 'Nb collectes ZD', value: (r) => r.nb_collectes_zd },
  { header: 'Nb collectes AG', value: (r) => r.nb_collectes_ag },
  { header: 'Tonnage ZD (kg)', value: (r) => r.tonnage_zd_kg },
  { header: 'Taux recyclage ZD (%)', value: (r) => r.taux_recyclage_pct },
  { header: 'Repas AG donnés', value: (r) => r.repas_ag },
  { header: 'Statut consolidé', value: (r) => r.statut_consolide },
  {
    header: 'Première collecte',
    value: (r) => formatDateFr(r.premiere_collecte),
  },
  {
    header: 'Dernière collecte',
    value: (r) => formatDateFr(r.derniere_collecte),
  },
];

/**
 * Transforme les événements (avec collectes imbriquées) en CSV. Résout les noms
 * de traiteur (vue whitelist) et les repas AG (helper C-1-safe) de façon
 * RLS-safe et uniforme pour tous les rôles.
 */
export async function evenementsToCsv(
  supabase: SupabaseClient,
  evts: Record<string, unknown>[],
  isStaff = false,
): Promise<string> {
  const traiteurNoms = await resolveTraiteurNoms(
    supabase,
    evts.map(
      (e) => (e.traiteur_operationnel_organisation_id as string | null) ?? '',
    ),
  );

  const agCollecteIds: string[] = [];
  for (const e of evts) {
    const cs = (Array.isArray(e.collectes) ? e.collectes : []) as CollecteAgg[];
    for (const c of cs) if (c.type === 'anti_gaspi') agCollecteIds.push(c.id);
  }
  const repasMap = await resolveRepas(supabase, agCollecteIds, isStaff);

  const rows: EvenementRow[] = evts.map((e) => {
    const collectes = (
      Array.isArray(e.collectes) ? e.collectes : []
    ) as CollecteAgg[];
    const zd = collectes.filter((c) => c.type === 'zero_dechet');
    const ag = collectes.filter((c) => c.type === 'anti_gaspi');

    const tonnage = zd.reduce((s, c) => s + sommePoidsFlux(c.collecte_flux), 0);
    const repas = ag.reduce((s, c) => s + (repasMap.get(c.id) ?? 0), 0);

    // Taux de recyclage moyen pondéré par tonnage (ZD).
    let num = 0;
    let den = 0;
    for (const c of zd) {
      const poids = sommePoidsFlux(c.collecte_flux);
      if (c.taux_recyclage != null && poids > 0) {
        num += c.taux_recyclage * poids;
        den += poids;
      }
    }
    const tauxPct = den > 0 ? Math.round(num / den) : '';

    const dates = collectes
      .map((c) => c.date_collecte)
      .filter((d): d is string => !!d)
      .sort();

    const lieu = unwrap(e.lieux);
    const typeEvt = unwrap(e.types_evenements);
    const pax = (e.pax as number) ?? 0;

    return {
      date_evenement: (e.date_evenement as string) ?? '',
      nom_evenement: (e.nom_evenement as string) ?? '',
      lieu: (lieu.nom as string) ?? '',
      traiteur:
        traiteurNoms.get(e.traiteur_operationnel_organisation_id as string) ??
        '',
      type_evenement: (typeEvt.libelle as string) ?? '',
      taille_bracket: tailleBracket(pax),
      pax,
      nb_collectes_zd: zd.length,
      nb_collectes_ag: ag.length,
      tonnage_zd_kg: formatPoidsKg(tonnage),
      taux_recyclage_pct: tauxPct,
      repas_ag: repas,
      statut_consolide: statutConsolide(collectes),
      premiere_collecte: dates[0] ?? '',
      derniere_collecte: dates[dates.length - 1] ?? '',
    };
  });

  return toCsv(rows, COLUMNS);
}

/** Builder unifié : Événements scopés par RLS (tous rôles autorisés). */
export async function buildEvenementsExport(
  ctx: ExportContext,
  sp: URLSearchParams,
): Promise<ExportOutput> {
  const from = sp.get('from');
  const to = sp.get('to');

  let q = ctx.supabase
    .from('evenements')
    .select(EVENEMENTS_SELECT)
    .order('date_evenement', { ascending: false });

  if (from) q = q.gte('date_evenement', from);
  if (to) q = q.lte('date_evenement', to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const csv = await evenementsToCsv(
    ctx.supabase,
    (data ?? []) as Record<string, unknown>[],
    ctx.isStaff,
  );
  return { filenamePrefix: 'evenements', csv };
}
