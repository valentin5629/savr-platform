import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import type { AnyRole } from '@/lib/api-auth.js';
import { erreurInterne } from '@/lib/api-helpers.js';
import { estUuid, listeCsv, parmi } from '@/lib/filtre-csv.js';

// ---------------------------------------------------------------------------
// Registre réglementaire ZD (§06.03) — types, filtres, requête.
// Source unique : vue `v_registre_dechets` (grain collecte, cloturee + ZD only,
// cloisonnement interne f_collecte_visible + exclusion agence). L'UI/API ne
// porte aucune logique de visibilité : la vue est RLS-safe par construction.
// ---------------------------------------------------------------------------

// Rôles autorisés au registre (§06.03 + §09 F6 : l'agence est exclue — elle est
// donneuse d'ordre, non productrice du déchet). La vue renvoie 0 ligne à
// l'agence ; on refuse en plus au niveau route (matrice, défense en profondeur).
export const REGISTRE_ROLES: AnyRole[] = [
  'admin_savr',
  'ops_savr',
  'traiteur_manager',
  'traiteur_commercial',
  'gestionnaire_lieux',
  'client_organisateur',
];

export function isRegistreRole(role: AnyRole): boolean {
  return REGISTRE_ROLES.includes(role);
}

// Les 5 flux ZD V1, dans l'ordre d'affichage (badges + colonnes CSV).
export const FLUX_ORDER = [
  'biodechet',
  'emballage',
  'carton',
  'verre',
  'dechet_residuel',
] as const;

export const FLUX_LABELS: Record<string, string> = {
  biodechet: 'Biodéchets',
  emballage: 'Emballages',
  carton: 'Cartons',
  verre: 'Verre',
  dechet_residuel: 'Déchet résiduel',
};

export interface RegistreRow {
  collecte_id: string;
  date_evenement: string | null;
  date_collecte: string | null;
  evenement_nom: string | null;
  pax: number | null;
  taille_bracket: string | null;
  lieu_id: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  programmateur_organisation_id: string | null;
  traiteur_operationnel_organisation_id: string | null;
  traiteur_raison_sociale: string | null;
  prestataire_logistique_id: string | null;
  transporteur_nom: string | null;
  exutoire_nom: string | null;
  poids_total_kg: number | null;
  flux_codes: string[] | null;
  taux_recyclage: number | null;
  co2_induit_kg: number | null;
  co2_evite_kg: number | null;
  co2_net_kg: number | null;
  bordereau_id: string | null;
  bordereau_numero: string | null;
  bordereau_statut: string | null;
  bordereau_pdf_fichier_id: string | null;
  bordereau_date_emission: string | null;
  bordereau_version: number | null;
  historique_partiel: boolean | null;
}

export const SORT_COLUMNS = [
  'date_evenement',
  'lieu_nom',
  'traiteur_raison_sociale',
  'poids_total_kg',
  'exutoire_nom',
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export const PAGE_SIZES = [25, 50, 100] as const;

export interface RegistreFilters {
  from?: string;
  to?: string;
  lieuIds: string[];
  traiteurIds: string[];
  fluxCodes: string[];
  bordereauStatut?: 'dispo' | 'manquant';
  sortBy: SortColumn;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** Parse les filtres du registre depuis la query string (valeurs CSV-listées). */
export function parseRegistreFilters(sp: URLSearchParams): RegistreFilters {
  // Lieu / Traiteur / Flux à choix multiple (§06.03) : ids validés UUID, flux
  // en liste blanche, avant `.in()` / `.overlaps()` — une valeur invalide est
  // écartée en silence.
  const list = (k: string, valide: (v: string) => boolean): string[] =>
    listeCsv(sp.get(k), valide);

  const sortByRaw = sp.get('sortBy') ?? 'date_evenement';
  const sortBy: SortColumn = (SORT_COLUMNS as readonly string[]).includes(
    sortByRaw,
  )
    ? (sortByRaw as SortColumn)
    : 'date_evenement';
  const sortDir = sp.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const pageSizeRaw = Number(sp.get('pageSize') ?? 25);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeRaw)
    ? pageSizeRaw
    : 25;
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);

  const bs = sp.get('bordereau');
  return {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    lieuIds: list('lieu', estUuid),
    traiteurIds: list('traiteur', estUuid),
    fluxCodes: list('flux', parmi(FLUX_ORDER)),
    bordereauStatut: bs === 'dispo' || bs === 'manquant' ? bs : undefined,
    sortBy,
    sortDir,
    page,
    pageSize,
  };
}

export interface RegistreResult {
  rows: RegistreRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Interroge `v_registre_dechets` avec filtres + tri (mono-colonne) + pagination.
 * `all=true` ramène toutes les lignes filtrées (export CSV — pas de pagination).
 */
export async function fetchRegistre(
  supabase: SupabaseClient,
  f: RegistreFilters,
  opts: { all?: boolean } = {},
): Promise<RegistreResult> {
  let q = supabase.from('v_registre_dechets').select('*', { count: 'exact' });

  if (f.from) q = q.gte('date_evenement', f.from);
  if (f.to) q = q.lte('date_evenement', f.to);
  if (f.lieuIds.length) q = q.in('lieu_id', f.lieuIds);
  if (f.traiteurIds.length)
    q = q.in('traiteur_operationnel_organisation_id', f.traiteurIds);
  if (f.fluxCodes.length) q = q.overlaps('flux_codes', f.fluxCodes);
  if (f.bordereauStatut === 'dispo')
    q = q.in('bordereau_statut', ['emis', 'corrige']);
  if (f.bordereauStatut === 'manquant')
    q = q.or('bordereau_statut.is.null,bordereau_statut.eq.brouillon');

  // Tri mono-colonne (sobriété B1) ; départage stable par collecte_id.
  q = q
    .order(f.sortBy, { ascending: f.sortDir === 'asc', nullsFirst: false })
    .order('collecte_id', { ascending: true });

  if (!opts.all) {
    const fromIdx = (f.page - 1) * f.pageSize;
    q = q.range(fromIdx, fromIdx + f.pageSize - 1);
  }

  const { data, count, error } = await q;
  if (error) throw erreurInterne(error, 'registre.lecture');
  return {
    rows: (data ?? []) as unknown as RegistreRow[],
    total: count ?? 0,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export interface OptionRegistre {
  id: string;
  nom: string;
}

/**
 * Options des filtres « Lieu » et « Traiteur » (§06.03, multi-select) : tous
 * les lieux et traiteurs présents au registre du périmètre, et pas seulement
 * ceux de la page affichée — sinon cocher un lieu faisait disparaître les
 * autres de la liste. Même vue RLS-safe que la liste (aucune donnée de plus),
 * lue par tranches jusqu'à une tranche vide : rien n'est tronqué, quel que
 * soit le plafond `max_rows` du projet.
 */
export async function fetchRegistreOptions(
  supabase: SupabaseClient,
): Promise<{ lieux: OptionRegistre[]; traiteurs: OptionRegistre[] }> {
  const lieux = new Map<string, string>();
  const traiteurs = new Map<string, string>();
  const TRANCHE = 1000;
  for (let debut = 0; ; ) {
    const { data, error } = await supabase
      .from('v_registre_dechets')
      .select(
        'collecte_id, lieu_id, lieu_nom, traiteur_operationnel_organisation_id, traiteur_raison_sociale',
      )
      .order('collecte_id', { ascending: true })
      .range(debut, debut + TRANCHE - 1);
    if (error) throw erreurInterne(error, 'registre.options');
    const lignes = (data ?? []) as unknown as RegistreRow[];
    if (lignes.length === 0) break;
    for (const r of lignes) {
      if (r.lieu_id && r.lieu_nom) lieux.set(r.lieu_id, r.lieu_nom);
      if (r.traiteur_operationnel_organisation_id && r.traiteur_raison_sociale)
        traiteurs.set(
          r.traiteur_operationnel_organisation_id,
          r.traiteur_raison_sociale,
        );
    }
    debut += lignes.length;
  }
  const trier = (m: Map<string, string>): OptionRegistre[] =>
    [...m]
      .map(([id, nom]) => ({ id, nom }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return { lieux: trier(lieux), traiteurs: trier(traiteurs) };
}

/** Libellé du statut bordereau pour l'affichage (dispo / manquant / —). */
export function bordereauDisponible(statut: string | null): boolean {
  return statut === 'emis' || statut === 'corrige';
}
