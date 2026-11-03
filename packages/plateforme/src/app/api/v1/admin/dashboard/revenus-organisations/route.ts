import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { serverError } from '@/lib/api-helpers.js';
import { lireTri } from '@/lib/tri-liste.js';
import { DEFAULT_PAGE_SIZE, parsePage } from '@/lib/pagination.js';
import {
  appliquerPerimetreRevenus,
  lirePerimetreRevenus,
  lireTout,
  LOT_LECTURE,
} from '@/lib/dashboards/revenus-admin.js';
import {
  montantsPrestation,
  STATUTS_REVENUS,
  type PackPrix,
} from '@/lib/montant-prestation.js';

/**
 * GET /api/v1/admin/dashboard/revenus-organisations — Bloc 2 « Revenus par
 * organisation » du Dashboard Admin (§11 §1.1 Bloc 2).
 *
 * Colonnes (§11 §1.1) : nom · type · nb ZD · montant ZD HT · nb AG · montant AG HT.
 *   Décision Val 2026-11-03 : tout vient des collectes, facturées ou non.
 *   - nb ZD / nb AG   ← collectes programmées et réalisées (`STATUTS_REVENUS`),
 *     imputées à `evenements.organisation_id` (org programmatrice,
 *     R_revenus_imputation_organisation), période sur `date_collecte` ;
 *   - montant ZD/AG HT ← montant de la prestation de ces mêmes collectes
 *     (`lib/montant-prestation`).
 *
 * Agrégation server-side par organisation (l'ancien endpoint paginait les LIGNES
 * `factures_collectes` → totaux par org faux dès qu'une org dépassait la fenêtre de
 * 50 lignes ; corrigé ici : on agrège TOUTES les lignes de la période, puis on
 * trie/pagine les ORGANISATIONS). Filtres `lieu_ids` / `organisation_ids` (CSV) :
 * même périmètre que l'histogramme, cf. `lib/dashboards/revenus-admin.ts`
 * (décision Val 2026-10-30). Tri défaut `montant_total` desc (`tri`/`ordre`), pagination 50/page,
 * export CSV (`?format=csv`).
 */

const ORG_TYPE_LABELS: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire de lieux',
  client_organisateur: 'Client organisateur',
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

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

// Défaut de période si non fournie : 12 derniers mois (§11 §8 l.180, aligné
// §06.04/§06.05 ; décision Val 2026-07-18, cf. divergence M3.5 vs §11 Bloc 2 l.38).
// Fallback serveur cohérent avec le défaut UI (le tableau envoie toujours from/to).
function defaultPeriodeRange(): { from: string; to: string } {
  const now = new Date();
  const to = jourParis(now);
  const fromDate = new Date(now);
  fromDate.setUTCMonth(fromDate.getUTCMonth() - 12);
  return { from: jourParis(fromDate), to };
}

interface CollecteAggRow {
  type: string;
  pax: number | null;
  date_collecte: string;
  evenements: {
    organisation_id: string;
    lieu_id: string | null;
    organisations: { raison_sociale: string; type: string } | null;
  } | null;
  // Relation to-one PostgREST → objet (ou tableau) : pack débité.
  packs_antgaspi: PackPrix | PackPrix[] | null;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const sp = new URL(req.url).searchParams;
  const defaults = defaultPeriodeRange();
  const from = sp.get('from') ?? defaults.from;
  const to = sp.get('to') ?? defaults.to;
  const format = sp.get('format');
  // Convention de tri unique des listes (R-UI-4a, E3) : `tri` + `ordre`, lus
  // par `lireTri` (liste blanche, défaut montant_total desc).
  const tri = lireTri(
    sp,
    Object.fromEntries(SORT_KEYS.map((k) => [k, [k]])) as unknown as Record<
      SortKey,
      readonly string[]
    >,
    { tri: 'montant_total', ascendant: false },
  );
  const sortKey = tri.colonnes[0] as SortKey;
  const sortDir = tri.ascendant ? 'asc' : 'desc';
  const page = parsePage(sp);

  const { perimetre, error: errPerimetre } = await lirePerimetreRevenus(
    supabase,
    sp,
  );
  if (errPerimetre)
    return serverError(
      errPerimetre,
      'admin.dashboard.revenus_organisations.filtres',
    );

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

  // ── Collectes de la période : nombre et montant de la prestation ──
  const collectesRes = await lireTout(async (offset) => {
    if (perimetre.vide) return { data: [], error: null };
    const { data, error } = await appliquerPerimetreRevenus(
      supabase
        .from('collectes')
        .select(
          `type, pax, date_collecte,
         evenements!inner(
           organisation_id, lieu_id,
           organisations!organisation_id(raison_sociale, type)
         ),
         packs_antgaspi(prix_unitaire_ht, montant_total_ht, credits_initiaux)`,
        )
        .in('statut', [...STATUTS_REVENUS])
        .gte('date_collecte', from)
        .lte('date_collecte', to),
      perimetre,
      'evenements',
    )
      // Ordre stable : sans lui, la pagination par range peut doubler ou
      // sauter des lignes au-delà de 1000.
      .order('id')
      .range(offset, offset + LOT_LECTURE - 1);
    return { data: data as unknown[] | null, error };
  });
  if (collectesRes.error)
    return serverError(
      collectesRes.error,
      'admin.dashboard.revenus_organisations.collectes',
    );

  const premier = <T>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;
  const lignes = collectesRes.rows as CollecteAggRow[];
  let montants: (number | null)[];
  try {
    montants = await montantsPrestation(
      supabase,
      lignes.map((r) => {
        const evt = premier(r.evenements);
        return {
          type: r.type,
          pax: r.pax,
          date_collecte: r.date_collecte,
          organisation_id: evt?.organisation_id ?? null,
          lieu_id: evt?.lieu_id ?? null,
          pack: premier(r.packs_antgaspi),
        };
      }),
    );
  } catch (e) {
    return serverError(e, 'admin.dashboard.revenus_organisations.montants');
  }

  for (const [i, r] of lignes.entries()) {
    const evt = premier(r.evenements);
    if (!evt) continue;
    const org = premier(evt.organisations);
    const o = ensure(
      evt.organisation_id,
      org?.raison_sociale ?? '—',
      org?.type ?? '',
    );
    const montant = montants[i] ?? 0;
    if (r.type === 'zero_dechet') {
      o.nb_zd += 1;
      o.montant_zd_ht += montant;
    } else if (r.type === 'anti_gaspi') {
      o.nb_ag += 1;
      o.montant_ag_ht += montant;
    }
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
