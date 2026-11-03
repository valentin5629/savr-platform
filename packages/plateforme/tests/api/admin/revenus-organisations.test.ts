/**
 * M3.5 — /admin/dashboard/revenus-organisations (BL-P2-03, §11 §1.1 Bloc 2).
 * Tableau « Revenus par organisation » à 6 colonnes (nom · type · nb ZD · CA ZD ·
 * nb AG · CA AG). Décision Val 2026-11-03 : une seule source, les collectes
 * programmées et réalisées de la période (date_collecte), au montant de la
 * prestation (lib/montant-prestation), facturées ou non. Aucune facture lue.
 * Imputation = organisation programmatrice (evenements.organisation_id). Tri défaut montant_total desc,
 * agrégation par ORGANISATION (plus de pagination sur les lignes brutes → count faux),
 * export CSV.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number };

// Mock supabase : route le résultat par table (requêtes séquentielles :
// collectes puis référentiel tarifaire).
function makeChain() {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) =>
    (calls[name] ??= []).push(args);
  const results: Record<string, Result> = {};
  let current = '';
  const chain: Record<string, unknown> = {
    __calls: calls,
    setResult(table: string, r: Result) {
      results[table] = r;
      return chain;
    },
  };
  chain.from = (...args: unknown[]) => {
    current = String(args[0]);
    record('from', args);
    return chain;
  };
  for (const m of [
    'select',
    'in',
    'eq',
    'gte',
    'lte',
    'range',
    'not',
    'order',
    'or',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => unknown) =>
    resolve(results[current] ?? { data: [], error: null });
  return chain as Record<string, unknown> & {
    __calls: Record<string, unknown[][]>;
    setResult(table: string, r: Result): unknown;
  };
}

let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

// Helpers de fixtures.
function collecte(
  type: string,
  orgId: string,
  orgName: string,
  orgType = 'traiteur',
  opts: {
    statut?: string;
    prixUnitaireAg?: number;
    montantTotalAg?: number;
    creditsAg?: number;
  } = {},
) {
  // Coût/collecte AG (CA économique) — relation to-one PostgREST rendue en objet.
  // prix_unitaire_ht prioritaire ; sinon fallback montant_total_ht / crédits_initiaux.
  let pack: {
    prix_unitaire_ht: number | null;
    montant_total_ht: number | null;
    credits_initiaux: number | null;
  } | null = null;
  if (opts.prixUnitaireAg != null) {
    pack = {
      prix_unitaire_ht: opts.prixUnitaireAg,
      montant_total_ht: null,
      credits_initiaux: null,
    };
  } else if (opts.montantTotalAg != null && opts.creditsAg != null) {
    pack = {
      prix_unitaire_ht: null,
      montant_total_ht: opts.montantTotalAg,
      credits_initiaux: opts.creditsAg,
    };
  }
  return {
    type,
    statut: opts.statut ?? 'cloturee',
    pax: 100,
    date_collecte: '2026-06-01',
    evenements: {
      organisation_id: orgId,
      organisations: { raison_sociale: orgName, type: orgType },
    },
    packs_antgaspi: pack,
  };
}
// Grille ZD par défaut : 100 € HT pour tout pax.
function grilleZd100() {
  admin.setResult('grilles_tarifaires_zd', {
    data: [
      {
        id: 'g1',
        est_defaut: true,
        valide_du: '2026-01-01',
        valide_jusqu: null,
      },
    ],
    error: null,
  });
  admin.setResult('tarifs_zero_dechet', {
    data: [
      {
        grille_id: 'g1',
        pax_min: 1,
        pax_max: null,
        prix_base_ht: 100,
        prix_par_couvert_ht: null,
      },
    ],
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  admin = makeChain();
});

describe('admin/revenus-organisations', () => {
  it('revenus/aucune_facture_lue — facturé ou non, le montant vient des collectes (Val 2026-11-03)', async () => {
    setupAuth('admin_savr');
    grilleZd100();
    admin.setResult('collectes', {
      data: [collecte('zero_dechet', 'org-1', 'Kardamome SAS')],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    expect(res.status).toBe(200);
    const tables = (admin.__calls.from ?? []).map((a) => String(a[0]));
    expect(tables).not.toContain('factures_collectes');
    expect(tables).not.toContain('factures');
    const json = (await res.json()) as {
      data: Array<{ montant_zd_ht: number }>;
    };
    expect(json.data[0]?.montant_zd_ht).toBe(100);
  });

  it('revenus/statuts_programmees_et_realisees — hors brouillon, annulation demandée, rejetée ; annulée seulement si tardive', async () => {
    setupAuth('admin_savr');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    await GET(makeReq('/api/v1/admin/dashboard/revenus-organisations'));
    expect(admin.__calls.or).toContainEqual([
      'statut.in.(programmee,validee,en_cours,realisee,realisee_sans_collecte,cloturee),and(statut.eq.annulee,annulation_tardive.is.true)',
    ]);
    expect((admin.__calls.in ?? []).some((a) => a[0] === 'statut')).toBe(false);
  });

  it('revenus/6_colonnes_split_zd_ag — nb et montant depuis les mêmes collectes ; ZD au tarif, AG au prix du pack ; tri montant_total desc', async () => {
    setupAuth('ops_savr');
    grilleZd100();
    // org-1 : 2 collectes ZD (100 € chacune) + 1 AG (pack 120 €) ; org-2 : 1 ZD.
    admin.setResult('collectes', {
      data: [
        collecte('zero_dechet', 'org-1', 'A'),
        collecte('zero_dechet', 'org-1', 'A', 'traiteur', {
          statut: 'programmee',
        }),
        collecte('anti_gaspi', 'org-1', 'A', 'traiteur', {
          prixUnitaireAg: 120,
          statut: 'validee',
        }),
        collecte('zero_dechet', 'org-2', 'B', 'agence'),
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    const json = (await res.json()) as {
      data: Array<{
        organisation_id: string;
        type_label: string;
        nb_zd: number;
        montant_zd_ht: number;
        nb_ag: number;
        montant_ag_ht: number;
        montant_total: number;
      }>;
    };
    // org-1 (320) avant org-2 (100) — tri décroissant montant_total.
    expect(json.data[0]?.organisation_id).toBe('org-1');
    expect(json.data[1]?.type_label).toBe('Agence');
    expect(json.data[1]?.montant_total).toBe(100);
    const org1 = json.data[0]!;
    expect(org1.nb_zd).toBe(2);
    expect(org1.montant_zd_ht).toBe(200);
    expect(org1.nb_ag).toBe(1);
    expect(org1.montant_ag_ht).toBe(120);
    expect(org1.montant_total).toBe(320);
  });

  it('revenus/annulation_tardive_montant_plein — AG et ZD annulées tardivement comptées au montant plein (Val 2026-11-03)', async () => {
    setupAuth('admin_savr');
    grilleZd100();
    // La base ne rend que les annulées marquées tardives (filtre `.or()`).
    admin.setResult('collectes', {
      data: [
        collecte('zero_dechet', 'org-1', 'A', 'traiteur', {
          statut: 'annulee',
        }),
        collecte('anti_gaspi', 'org-1', 'A', 'traiteur', {
          prixUnitaireAg: 120,
          statut: 'annulee',
        }),
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    const json = (await res.json()) as {
      data: Array<{
        nb_zd: number;
        montant_zd_ht: number;
        nb_ag: number;
        montant_ag_ht: number;
      }>;
    };
    expect(json.data[0]).toMatchObject({
      nb_zd: 1,
      montant_zd_ht: 100,
      nb_ag: 1,
      montant_ag_ht: 120,
    });
  });

  it('revenus/ca_ag_fallback_montant_sur_credits — coût/collecte = montant_total_ht/crédits si prix_unitaire NULL', async () => {
    setupAuth('admin_savr');
    // Pack sans prix_unitaire_ht mais montant_total_ht=1200 / crédits=10 → coût 120/collecte.
    admin.setResult('collectes', {
      data: [
        collecte('anti_gaspi', 'org-1', 'A', 'traiteur', {
          montantTotalAg: 1200,
          creditsAg: 10,
        }),
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    const json = (await res.json()) as {
      data: Array<{ organisation_id: string; montant_ag_ht: number }>;
    };
    const org1 = json.data.find((r) => r.organisation_id === 'org-1')!;
    expect(org1.montant_ag_ht).toBe(120); // 1200 / 10
  });

  it('revenus/imputation_organisation_programmatrice — agrégé sur evenements.organisation_id (CDC §06.06 P1)', async () => {
    setupAuth('admin_savr');
    admin.setResult('collectes', {
      data: [
        collecte('zero_dechet', 'org-programmatrice', 'Agence Prog', 'agence'),
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    const json = (await res.json()) as {
      data: Array<{ organisation_id: string }>;
    };
    const collecteSelect = (admin.__calls.select ?? [])
      .map((a) => String(a[0]))
      .find((s) => s.includes('organisations!organisation_id'));
    expect(collecteSelect).toContain('evenements!inner');
    expect(collecteSelect).not.toContain(
      'traiteur_operationnel_organisation_id',
    );
    expect(json.data[0]?.organisation_id).toBe('org-programmatrice');
  });

  it('revenus/filtre_par_date_collecte_pas_emission — gte/lte sur date_collecte (CDC P2)', async () => {
    setupAuth('admin_savr');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    await GET(
      makeReq(
        '/api/v1/admin/dashboard/revenus-organisations?from=2026-01-01&to=2026-03-31',
      ),
    );
    const gteArgs = admin.__calls.gte ?? [];
    const lteArgs = admin.__calls.lte ?? [];
    // Période sur la date de COLLECTE (jamais date d'émission).
    expect(gteArgs.some((a) => a[0] === 'date_collecte')).toBe(true);
    expect(lteArgs.some((a) => String(a[0]).includes('date_collecte'))).toBe(
      true,
    );
    expect(gteArgs.some((a) => String(a[0]).includes('emission'))).toBe(false);
  });

  it('revenus/pagination_par_organisation_pas_lignes_brutes — 60 orgs → page 1 = 50, total = 60', async () => {
    setupAuth('admin_savr');
    // Bug historique : la pagination portait sur les lignes brutes (count faux
    // dès qu'une org dépassait la fenêtre). Ici on agrège d'abord par
    // organisation (60 orgs distinctes), PUIS on pagine les organisations.
    const collectes = Array.from({ length: 60 }, (_, i) =>
      collecte('zero_dechet', `org-${i}`, `Org ${i}`),
    );
    admin.setResult('collectes', { data: collectes, error: null });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res1 = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations?page=1'),
    );
    const json1 = (await res1.json()) as {
      data: unknown[];
      total: number;
    };
    expect(json1.total).toBe(60); // count = nombre d'ORGANISATIONS, pas de lignes
    expect(json1.data.length).toBe(50); // page de 50 organisations

    const res2 = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations?page=2'),
    );
    const json2 = (await res2.json()) as { data: unknown[] };
    expect(json2.data.length).toBe(10);
  });

  it('revenus/export_csv — format=csv renvoie un text/csv avec en-tête 6 colonnes', async () => {
    setupAuth('admin_savr');
    admin.setResult('collectes', {
      data: [collecte('zero_dechet', 'org-1', 'Kardamome SAS')],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations?format=csv'),
    );
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('Organisation');
    expect(body).toContain('Nb ZD');
    expect(body).toContain('Kardamome SAS');
  });

  it('revenus/auth_guard_non_staff_403 — rôle client bloqué', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    expect(res.status).toBe(403);
  });
});
