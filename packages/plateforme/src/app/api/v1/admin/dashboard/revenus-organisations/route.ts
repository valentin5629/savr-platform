import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

/**
 * GET /api/v1/admin/dashboard/revenus-organisations — Bloc 2 « Revenus par
 * organisation » du Dashboard Admin (§11 §1.1 Bloc 2).
 *
 * Colonnes (§11 §1.1) : nom · type · nb ZD · montant ZD HT · nb AG · montant AG HT.
 *   - nb ZD / nb AG   ← `collectes` (hors annulee/brouillon), imputées à
 *     `evenements.organisation_id` (org programmatrice, R_revenus_imputation_organisation),
 *     période sur `date_collecte`. Source « nb » distincte de « montant » (comme l'histogramme).
 *   - montant ZD/AG HT ← `factures_collectes` × `factures` emises/payees, même imputation.
 *
 * Agrégation server-side par organisation (l'ancien endpoint paginait les LIGNES
 * `factures_collectes` → totaux par org faux dès qu'une org dépassait la fenêtre de
 * 50 lignes ; corrigé ici : on agrège TOUTES les lignes de la période, puis on
 * trie/pagine les ORGANISATIONS). Tri défaut `montant_total_desc`, pagination 50/page,
 * export CSV (`?format=csv`).
 */

const ORG_TYPE_LABELS: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire de lieux',
  client_organisateur: 'Client organisateur',
};

const PAGE_SIZE = 50;
const FETCH_BATCH = 1000;

interface OrgRevenus {
  organisation_id: string;
  raison_sociale: string;
  type_organisation: string;
  nb_zd: number;
  montant_zd_ht: number;
  nb_ag: number;
  montant_ag_ht: number;
  montant_total: number;
}

type SortKey =
  | 'raison_sociale'
  | 'type_organisation'
  | 'nb_zd'
  | 'montant_zd_ht'
  | 'nb_ag'
  | 'montant_ag_ht'
  | 'montant_total';

const SORT_KEYS: SortKey[] = [
  'raison_sociale',
  'type_organisation',
  'nb_zd',
  'montant_zd_ht',
  'nb_ag',
  'montant_ag_ht',
  'montant_total',
];

// Défaut §11 §1.1 : période = mois en cours si non fournie.
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

// Récupère toutes les lignes d'une requête paginée (au-delà du plafond 1000 lignes).
// Découplé des types supabase-js (embeds inférés en tableaux) : renvoie unknown[],
// le call-site caste vers sa forme métier.
async function fetchAll(
  make: (offset: number) => Promise<{ data: unknown[] | null; error: unknown }>,
): Promise<{ rows: unknown[]; error: unknown }> {
  const rows: unknown[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await make(offset);
    if (error) return { rows, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < FETCH_BATCH) break;
    offset += FETCH_BATCH;
  }
  return { rows, error: null };
}

interface PackEmbed {
  prix_unitaire_ht: number | null;
  montant_total_ht: number | null;
  credits_initiaux: number | null;
}

interface CollecteAggRow {
  type: string;
  statut: string;
  evenements: {
    organisation_id: string;
    organisations: { raison_sociale: string; type: string } | null;
  } | null;
  // Relation to-one PostgREST → objet (ou tableau). Coût/collecte AG (CA économique).
  packs_antgaspi: PackEmbed | PackEmbed[] | null;
}

interface FactureAggRow {
  montant_ht: number;
  collectes: {
    type: string;
    evenements: { organisation_id: string } | null;
  } | null;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Coût par collecte AG = prix_unitaire du pack (fallback montant / crédits).
function coutCollecteAg(pack: PackEmbed | null): number {
  if (!pack) return 0;
  if (pack.prix_unitaire_ht != null) return pack.prix_unitaire_ht;
  if (pack.montant_total_ht != null && pack.credits_initiaux)
    return pack.montant_total_ht / pack.credits_initiaux;
  return 0;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const sp = new URL(req.url).searchParams;
  const defaults = currentMonthRange();
  const from = sp.get('from') ?? defaults.from;
  const to = sp.get('to') ?? defaults.to;
  const format = sp.get('format');
  const sortParam = sp.get('sort');
  const sortKey: SortKey = SORT_KEYS.includes(sortParam as SortKey)
    ? (sortParam as SortKey)
    : 'montant_total';
  const sortDir = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));

  const byOrg = new Map<string, OrgRevenus>();
  function ensure(
    id: string,
    raison_sociale: string,
    type_organisation: string,
  ): OrgRevenus {
    let o = byOrg.get(id);
    if (!o) {
      o = {
        organisation_id: id,
        raison_sociale,
        type_organisation,
        nb_zd: 0,
        montant_zd_ht: 0,
        nb_ag: 0,
        montant_ag_ht: 0,
        montant_total: 0,
      };
      byOrg.set(id, o);
    }
    return o;
  }

  // ── Query 1 : nb collectes par org × type + CA économique AG (coût/collecte pack) ──
  const collectesRes = await fetchAll(async (offset) => {
    const { data, error } = await supabase
      .from('collectes')
      .select(
        `type, statut,
         evenements!inner(
           organisation_id,
           organisations!organisation_id(raison_sociale, type)
         ),
         packs_antgaspi(prix_unitaire_ht, montant_total_ht, credits_initiaux)`,
      )
      .not('statut', 'in', '(annulee,brouillon)')
      .gte('date_collecte', from)
      .lte('date_collecte', to)
      .range(offset, offset + FETCH_BATCH - 1);
    return { data: data as unknown[] | null, error };
  });
  if (collectesRes.error)
    return NextResponse.json(
      {
        error: String(
          (collectesRes.error as { message?: string }).message ??
            collectesRes.error,
        ),
      },
      { status: 500 },
    );

  for (const r of collectesRes.rows as CollecteAggRow[]) {
    const evt = Array.isArray(r.evenements) ? r.evenements[0] : r.evenements;
    if (!evt) continue;
    const org = Array.isArray(evt.organisations)
      ? evt.organisations[0]
      : evt.organisations;
    const o = ensure(
      evt.organisation_id,
      org?.raison_sociale ?? '—',
      org?.type ?? '',
    );
    if (r.type === 'zero_dechet') o.nb_zd += 1;
    else if (r.type === 'anti_gaspi') {
      o.nb_ag += 1;
      // CA économique AG = coût/collecte du pack, sur les collectes livrées.
      if (r.statut === 'realisee' || r.statut === 'cloturee') {
        const pack = Array.isArray(r.packs_antgaspi)
          ? (r.packs_antgaspi[0] ?? null)
          : r.packs_antgaspi;
        o.montant_ag_ht += coutCollecteAg(pack);
      }
    }
  }

  // ── Query 2 : montant ZD HT par org (factures emises/payees) ──
  // AG exclu : son CA « économique » est calculé en Query 1 (coût/collecte du pack),
  // pas via les factures (décision Val 2026-07-07, cf. _Divergences §11 §1.1).
  const facturesRes = await fetchAll(async (offset) => {
    const { data, error } = await supabase
      .from('factures_collectes')
      .select(
        `montant_ht,
         factures!inner(statut),
         collectes!inner(
           type,
           date_collecte,
           evenements!inner(organisation_id)
         )`,
      )
      .in('factures.statut', ['emise', 'payee'])
      .eq('collectes.type', 'zero_dechet')
      .gte('collectes.date_collecte', from)
      .lte('collectes.date_collecte', to)
      .range(offset, offset + FETCH_BATCH - 1);
    return { data: data as unknown[] | null, error };
  });
  if (facturesRes.error)
    return NextResponse.json(
      {
        error: String(
          (facturesRes.error as { message?: string }).message ??
            facturesRes.error,
        ),
      },
      { status: 500 },
    );

  for (const r of facturesRes.rows as FactureAggRow[]) {
    const col = Array.isArray(r.collectes) ? r.collectes[0] : r.collectes;
    const evt = col
      ? Array.isArray(col.evenements)
        ? col.evenements[0]
        : col.evenements
      : null;
    if (!col || !evt) continue;
    // Une org peut n'apparaître que dans les factures (collecte hors période nb ?
    // non : même filtre date_collecte). ensure() sans nom si absente de Q1.
    const o = ensure(evt.organisation_id, '—', '');
    // Query 2 filtrée sur type=zero_dechet → seul le montant ZD est agrégé ici.
    if (col.type === 'zero_dechet') o.montant_zd_ht += r.montant_ht ?? 0;
  }

  const rows = [...byOrg.values()].map((o) => ({
    ...o,
    montant_total: o.montant_zd_ht + o.montant_ag_ht,
  }));

  rows.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), 'fr');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (format === 'csv') {
    const header = [
      'Organisation',
      'Type',
      'Nb ZD',
      'Montant ZD HT',
      'Nb AG',
      'Montant AG HT',
      'Montant total HT',
    ];
    const lines = [header.join(';')];
    for (const o of rows) {
      lines.push(
        [
          csvEscape(o.raison_sociale),
          csvEscape(
            ORG_TYPE_LABELS[o.type_organisation] ?? o.type_organisation,
          ),
          o.nb_zd,
          o.montant_zd_ht.toFixed(2),
          o.nb_ag,
          o.montant_ag_ht.toFixed(2),
          o.montant_total.toFixed(2),
        ].join(';'),
      );
    }
    // BOM UTF-8 (\uFEFF) pour qu'Excel lise correctement les accents du CSV.
    const csv = `\uFEFF${lines.join('\n')}`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="revenus-organisations_${from}_${to}.csv"`,
      },
    });
  }

  const total = rows.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE).map((o) => ({
    ...o,
    type_label: ORG_TYPE_LABELS[o.type_organisation] ?? o.type_organisation,
  }));

  return NextResponse.json({
    data: pageRows,
    total,
    page,
    limit: PAGE_SIZE,
    periode: { from, to },
  });
}
