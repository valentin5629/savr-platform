/**
 * M3.5 — /admin/dashboard/revenus-organisations (BL-P2-03, §11 §1.1 Bloc 2).
 * Recâblé R20a : tableau « Revenus par organisation » à 6 colonnes (nom · type ·
 * nb ZD · CA ZD · nb AG · CA AG). Deux sources distinctes (comme l'histogramme) :
 *   - nb ZD/AG        ← `collectes` (hors annulee/brouillon), période sur date_collecte ;
 *   - montant ZD/AG HT ← `factures_collectes` × `factures!inner(statut)` emise/payee.
 * Imputation = organisation programmatrice (evenements.organisation_id). Le statut
 * est porté par `factures` (jamais factures_collectes). Tri défaut montant_total desc,
 * agrégation par ORGANISATION (plus de pagination sur les lignes brutes → count faux),
 * export CSV.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number };

// Mock supabase : route le résultat par table (2 requêtes séquentielles :
// collectes puis factures_collectes). `.not` ajouté (query 1 l'utilise).
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
  for (const m of ['select', 'in', 'eq', 'gte', 'lte', 'range', 'not']) {
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
    evenements: {
      organisation_id: orgId,
      organisations: { raison_sociale: orgName, type: orgType },
    },
    packs_antgaspi: pack,
  };
}
function facture(montant_ht: number, type: string, orgId: string) {
  return {
    montant_ht,
    collectes: { type, evenements: { organisation_id: orgId } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  admin = makeChain();
});

describe('admin/revenus-organisations', () => {
  it('revenus/statut_filtre_sur_factures_pas_factures_collectes — jointure factures!inner(statut)', async () => {
    setupAuth('admin_savr');
    admin.setResult('collectes', {
      data: [collecte('zero_dechet', 'org-1', 'Kardamome SAS')],
      error: null,
    });
    admin.setResult('factures_collectes', {
      data: [facture(150, 'zero_dechet', 'org-1')],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    expect(res.status).toBe(200);

    // Le SELECT de la requête montant joint factures!inner(statut).
    const selects = (admin.__calls.select ?? []).map((a) => String(a[0]));
    const factureSelect = selects.find((s) => s.includes('factures!inner'));
    expect(factureSelect).toBeDefined();
    expect(factureSelect).toContain('factures!inner(statut)');
    // Le filtre statut porte sur factures.statut, jamais sur statut nu.
    const inArgs = admin.__calls.in ?? [];
    expect(inArgs.some((a) => a[0] === 'factures.statut')).toBe(true);
    expect(inArgs.some((a) => a[0] === 'statut')).toBe(false);
  });

  it('revenus/statuts_revenu_emise_payee — jamais brouillon/annulee', async () => {
    setupAuth('admin_savr');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    await GET(makeReq('/api/v1/admin/dashboard/revenus-organisations'));
    const statutFilter = (admin.__calls.in ?? []).find(
      (a) => a[0] === 'factures.statut',
    )?.[1] as string[] | undefined;
    expect(statutFilter).toEqual(['emise', 'payee']);
    // Les collectes excluent annulee/brouillon (source « nb »).
    const notArgs = admin.__calls.not ?? [];
    expect(
      notArgs.some(
        (a) => a[0] === 'statut' && String(a[2]).includes('annulee'),
      ),
    ).toBe(true);
  });

  it('revenus/6_colonnes_split_zd_ag — nb depuis collectes ; ZD depuis factures ; AG = coût/collecte pack (CA économique) ; tri montant_total desc', async () => {
    setupAuth('ops_savr');
    // org-1 : 2 collectes ZD + 1 AG (pack 120€/collecte, cloturee) ; org-2 : 1 collecte ZD.
    admin.setResult('collectes', {
      data: [
        collecte('zero_dechet', 'org-1', 'A'),
        collecte('zero_dechet', 'org-1', 'A'),
        collecte('anti_gaspi', 'org-1', 'A', 'traiteur', {
          prixUnitaireAg: 120,
        }),
        collecte('zero_dechet', 'org-2', 'B', 'agence'),
      ],
      error: null,
    });
    // ZD montant depuis factures. La facture AG (40€) est IGNORÉE (AG = coût/collecte pack).
    admin.setResult('factures_collectes', {
      data: [
        facture(100, 'zero_dechet', 'org-1'),
        facture(50, 'zero_dechet', 'org-1'),
        facture(40, 'anti_gaspi', 'org-1'), // ne doit PAS compter dans montant_ag
        facture(300, 'zero_dechet', 'org-2'),
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
    // org-2 (300) avant org-1 (270) — tri décroissant montant_total.
    expect(json.data[0]?.organisation_id).toBe('org-2');
    expect(json.data[0]?.montant_total).toBe(300);
    expect(json.data[0]?.type_label).toBe('Agence');
    const org1 = json.data.find((r) => r.organisation_id === 'org-1')!;
    expect(org1.nb_zd).toBe(2);
    expect(org1.montant_zd_ht).toBe(150);
    expect(org1.nb_ag).toBe(1);
    // AG = coût/collecte pack (120€), PAS la facture AG (40€).
    expect(org1.montant_ag_ht).toBe(120);
    expect(org1.montant_total).toBe(270); // 150 ZD + 120 AG
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
    admin.setResult('factures_collectes', { data: [], error: null });
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
    // Les deux requêtes filtrent par date de COLLECTE (jamais date d'émission).
    expect(gteArgs.some((a) => a[0] === 'date_collecte')).toBe(true);
    expect(gteArgs.some((a) => a[0] === 'collectes.date_collecte')).toBe(true);
    expect(lteArgs.some((a) => String(a[0]).includes('date_collecte'))).toBe(
      true,
    );
    expect(gteArgs.some((a) => String(a[0]).includes('emission'))).toBe(false);
  });

  it('revenus/pagination_par_organisation_pas_lignes_brutes — 60 orgs → page 1 = 50, total = 60', async () => {
    setupAuth('admin_savr');
    // Bug historique : la pagination portait sur les LIGNES factures_collectes
    // (count faux dès qu'une org dépassait la fenêtre). Ici on agrège d'abord par
    // organisation (60 orgs distinctes), PUIS on pagine les organisations.
    const collectes = Array.from({ length: 60 }, (_, i) =>
      collecte('zero_dechet', `org-${i}`, `Org ${i}`),
    );
    const factures = Array.from({ length: 60 }, (_, i) =>
      facture(i + 1, 'zero_dechet', `org-${i}`),
    );
    admin.setResult('collectes', { data: collectes, error: null });
    admin.setResult('factures_collectes', { data: factures, error: null });
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
    admin.setResult('factures_collectes', {
      data: [facture(150, 'zero_dechet', 'org-1')],
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
