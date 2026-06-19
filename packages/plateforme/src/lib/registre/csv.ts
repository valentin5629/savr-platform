import {
  toCsv,
  formatDateFr,
  formatPoidsKg,
  type CsvColumn,
} from '@savr/shared/src/csv/index.js';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  FLUX_ORDER,
  FLUX_LABELS,
  bordereauDisponible,
  type RegistreRow,
} from './registre.js';

// ---------------------------------------------------------------------------
// Export CSV du registre réglementaire (§06.03 Exports). Grain COLLECTE : une
// ligne = une collecte (nb_lignes exports_registre = nb de lignes affichées).
// Colonnes = celles du tableau + détail par flux (poids par flux, filières,
// codes). Format canonique Savr garanti par @savr/shared/src/csv.
// ---------------------------------------------------------------------------

interface FluxDetail {
  poids: number;
  filiere: string;
}
// collecte_id → (flux_code → { poids, filiere })
type FluxByCollecte = Map<string, Map<string, FluxDetail>>;

/**
 * Charge le détail des pesées par flux pour les collectes données (RLS-safe :
 * collecte_flux est filtré par f_collecte_visible, comme la vue registre).
 */
export async function fetchFluxDetail(
  supabase: SupabaseClient,
  collecteIds: string[],
): Promise<FluxByCollecte> {
  const out: FluxByCollecte = new Map();
  if (collecteIds.length === 0) return out;

  const { data, error } = await supabase
    .from('collecte_flux')
    .select(
      'collecte_id, poids_reel_kg, flux_dechets!flux_id(code, filiere_valorisation)',
    )
    .in('collecte_id', collecteIds);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const cid = row.collecte_id as string;
    const fd = (
      Array.isArray(row.flux_dechets) ? row.flux_dechets[0] : row.flux_dechets
    ) as { code?: string; filiere_valorisation?: string } | null;
    const code = fd?.code;
    if (!code) continue;
    const m = out.get(cid) ?? new Map<string, FluxDetail>();
    m.set(code, {
      poids: Number(row.poids_reel_kg ?? 0),
      filiere: fd?.filiere_valorisation ?? '',
    });
    out.set(cid, m);
  }
  return out;
}

interface RegistreCsvRow {
  row: RegistreRow;
  flux: Map<string, FluxDetail>;
}

const COLUMNS: CsvColumn<RegistreCsvRow>[] = [
  {
    header: 'Date événement',
    value: (r) => formatDateFr(r.row.date_evenement),
  },
  { header: 'Lieu', value: (r) => r.row.lieu_nom ?? '' },
  { header: 'Traiteur', value: (r) => r.row.traiteur_raison_sociale ?? '' },
  {
    header: 'Flux',
    value: (r) =>
      (r.row.flux_codes ?? []).map((c) => FLUX_LABELS[c] ?? c).join(' / '),
  },
  {
    header: 'Poids total (kg)',
    value: (r) => formatPoidsKg(r.row.poids_total_kg),
  },
  { header: 'Exutoire', value: (r) => r.row.exutoire_nom ?? '' },
  { header: 'N° bordereau', value: (r) => r.row.bordereau_numero ?? '' },
  {
    header: 'Statut bordereau',
    value: (r) =>
      bordereauDisponible(r.row.bordereau_statut) ? 'Disponible' : 'Manquant',
  },
  // Poids par flux détaillé (5 colonnes ZD).
  ...FLUX_ORDER.map(
    (code): CsvColumn<RegistreCsvRow> => ({
      header: `${FLUX_LABELS[code]} (kg)`,
      value: (r) => {
        const d = r.flux.get(code);
        return d ? formatPoidsKg(d.poids) : '';
      },
    }),
  ),
  {
    header: 'Filières',
    value: (r) =>
      [
        ...new Set([...r.flux.values()].map((d) => d.filiere).filter(Boolean)),
      ].join(' / '),
  },
  {
    header: 'Codes déchets',
    value: (r) => (r.row.flux_codes ?? []).join(' / '),
  },
];

/** Sérialise les lignes du registre filtré en CSV canonique Savr. */
export function buildRegistreCsv(
  rows: RegistreRow[],
  fluxByCollecte: FluxByCollecte,
): string {
  const csvRows: RegistreCsvRow[] = rows.map((row) => ({
    row,
    flux: fluxByCollecte.get(row.collecte_id) ?? new Map(),
  }));
  return toCsv(csvRows, COLUMNS);
}
