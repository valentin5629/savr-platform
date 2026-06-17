/**
 * M3.4 — Tests Vitest API : Espace client organisateur (lecture seule).
 * Couvre : auth guard, liste collectes scopée + sans donnée financière, KPI CO₂ ABC,
 * liste documents (3 types), download rapport (OK / embargo H+24 / cross-org 404 / type inconnu).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __queue: queue,
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'neq',
    'order',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockPresign = vi.fn().mockResolvedValue('https://r2.example/signed');

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (...a: unknown[]) => mockPresign(...a),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId = 'org-a', userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ role, organisation_id: organisationId }),
      },
    },
    error: null,
  });
}
function noAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  mockPresign.mockResolvedValue('https://r2.example/signed');
});

// ── Auth guard ──────────────────────────────────────────────────────────────
describe('M3.4 / auth guard', () => {
  it('M3.4/auth_guard_non_organisateur_403 — traiteur_manager bloqué', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');
    const res = await GET(makeReq('/api/v1/organisateur/collectes'));
    expect(res.status).toBe(403);
  });

  it('M3.4/auth_guard_non_authentifie_401 — pas de session', async () => {
    noAuth();
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');
    const res = await GET(makeReq('/api/v1/organisateur/collectes'));
    expect(res.status).toBe(401);
  });
});

// ── Collectes ─────────────────────────────────────────────────────────────
describe('M3.4 / collectes', () => {
  it('M3.4/collectes_liste_scope_organisateur — eq sur client_organisateur_organisation_id', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: [
        { id: 'c1', type: 'zero_dechet', statut: 'cloturee', co2_evite_kg: 5 },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');
    const res = await GET(makeReq('/api/v1/organisateur/collectes'));
    const json = (await res.json()) as { data: unknown[] };
    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    const eqArgs = rls.__calls.eq ?? [];
    expect(
      eqArgs.some(
        (a) =>
          a[0] === 'evenements.client_organisateur_organisation_id' &&
          a[1] === 'org-a',
      ),
    ).toBe(true);
  });

  it('M3.4/collectes_filtre_type_ag — filtre type=anti_gaspi appliqué', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({ data: [], error: null });
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');
    await GET(makeReq('/api/v1/organisateur/collectes?type=anti_gaspi'));
    const eqArgs = rls.__calls.eq ?? [];
    expect(eqArgs.some((a) => a[0] === 'type' && a[1] === 'anti_gaspi')).toBe(
      true,
    );
  });

  it('M3.4/collectes_ag_traiteur_et_repas — colonnes §11 §7 (traiteur via whitelist, repas via helper)', async () => {
    setupAuth('client_organisateur', 'org-a');
    // 1) collectes AG  2) v_referentiel_traiteurs  3) rpc f_volume_repas_realise
    rls.push({
      data: [
        {
          id: 'c-ag',
          type: 'anti_gaspi',
          statut: 'cloturee',
          evenements: {
            id: 'ev1',
            traiteur_operationnel_organisation_id: 'tr-1',
            nom_evenement: 'Gala',
          },
        },
      ],
      error: null,
    });
    rls.push({
      data: [
        { id: 'tr-1', nom: 'Traiteur T', raison_sociale: 'Traiteur T SAS' },
      ],
      error: null,
    });
    rls.push({ data: 80, error: null });
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');
    const res = await GET(
      makeReq('/api/v1/organisateur/collectes?type=anti_gaspi'),
    );
    const json = (await res.json()) as {
      data: Array<{ traiteur_nom: string | null; repas_donnes: number | null }>;
    };
    expect(json.data[0]?.traiteur_nom).toBe('Traiteur T SAS');
    expect(json.data[0]?.repas_donnes).toBe(80);
    const rpcArgs = rls.__calls.rpc ?? [];
    expect(rpcArgs.some((a) => a[0] === 'f_volume_repas_realise')).toBe(true);
  });

  it('M3.4/collectes_aucune_donnee_financiere — réponse sans marge ni montant', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: [
        { id: 'c1', type: 'zero_dechet', statut: 'cloturee', co2_evite_kg: 5 },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');
    const res = await GET(makeReq('/api/v1/organisateur/collectes'));
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data[0]).not.toHaveProperty('marge_zd_ht');
    expect(json.data[0]).not.toHaveProperty('montant_ht');
    // Le SELECT serveur ne demande aucune colonne financière
    const selectArgs = (rls.__calls.select ?? []).map((a) => String(a[0]));
    expect(selectArgs.some((s) => /marge|montant|facture/.test(s))).toBe(false);
  });
});

// ── Dashboard KPI (route M3.5, colonnes CO₂ ABC ajoutées en M3.4) ───────────
describe('M3.4 / dashboard KPI', () => {
  it('M3.4/dashboard_kpi_co2_abc_expose — co2_induit_kg + energie_primaire dans la réponse', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: [
        {
          mois: '2026-05-01',
          type_collecte: 'zero_dechet',
          co2_evite_kg: 5,
          co2_induit_kg: 10,
          co2_net_kg: -5,
          energie_primaire_evitee_kwh: 120,
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-client-organisateur/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/dashboards/kpi-client-organisateur?from=2026-01-01&to=2026-12-31&type=zero_dechet',
      ),
    );
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(res.status).toBe(200);
    expect(json.data[0]).toHaveProperty('co2_induit_kg', 10);
    expect(json.data[0]).toHaveProperty('energie_primaire_evitee_kwh', 120);
  });
});

// ── Documents ───────────────────────────────────────────────────────────────
describe('M3.4 / documents', () => {
  it('M3.4/documents_liste_rapports_bordereaux_attestations — 3 types fusionnés', async () => {
    setupAuth('client_organisateur', 'org-a');
    // ordre de résolution Promise.all : rapports, bordereaux, attestations
    rls.push({
      data: [
        {
          id: 'r1',
          collecte_id: 'c1',
          disponible_a: '2020-01-01T00:00:00Z',
          genere_at: '2020-01-02T00:00:00Z',
          evenements: { nom_evenement: 'Gala', date_evenement: '2026-05-10' },
        },
      ],
      error: null,
    });
    rls.push({
      data: [
        {
          id: 'b1',
          collecte_id: 'c1',
          genere_at: '2020-01-02T00:00:00Z',
          pdf_fichier_id: 'f1',
          collectes: {
            evenements: { nom_evenement: 'Gala', date_evenement: '2026-05-10' },
          },
        },
      ],
      error: null,
    });
    rls.push({
      data: [
        {
          id: 'a1',
          collecte_id: 'c2',
          genere_at: '2020-01-02T00:00:00Z',
          pdf_url: 'attestations/a.pdf',
          collectes: {
            evenements: {
              nom_evenement: 'Gala AG',
              date_evenement: '2026-05-12',
            },
          },
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/organisateur/documents/route.js');
    const res = await GET(makeReq('/api/v1/organisateur/documents'));
    const json = (await res.json()) as {
      data: Array<{ type: string; disponible: boolean }>;
    };
    expect(res.status).toBe(200);
    const types = json.data.map((d) => d.type).sort();
    expect(types).toEqual(['attestation', 'bordereau', 'rapport']);
    expect(json.data.every((d) => d.disponible)).toBe(true);
  });
});

// ── Download ──────────────────────────────────────────────────────────────
describe('M3.4 / download', () => {
  async function callDownload(type: string, id: string) {
    const { GET } =
      await import('@/app/api/v1/organisateur/documents/[type]/[id]/download/route.js');
    return GET(
      makeReq(`/api/v1/organisateur/documents/${type}/${id}/download`),
      {
        params: Promise.resolve({ type, id }),
      },
    );
  }

  it('M3.4/document_download_rapport_ok — URL pré-signée renvoyée', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: {
        id: 'r1',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    });
    const res = await callDownload('rapport', 'r1');
    const json = (await res.json()) as { url?: string };
    expect(res.status).toBe(200);
    expect(json.url).toBe('https://r2.example/signed');
    expect(mockPresign).toHaveBeenCalledWith('rapports/r1.pdf', 900);
  });

  it('M3.4/document_embargo_h24_refuse — 425 si disponible_a dans le futur', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: {
        id: 'r1',
        disponible_a: '2999-01-01T00:00:00Z',
        genere_at: '2999-01-02T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    });
    const res = await callDownload('rapport', 'r1');
    expect(res.status).toBe(425);
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it('M3.4/document_cross_org_404 — rapport non visible (RLS) → 404', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({ data: null, error: null });
    const res = await callDownload('rapport', 'r-other');
    expect(res.status).toBe(404);
  });

  it('M3.4/document_type_inconnu_400 — type non supporté', async () => {
    setupAuth('client_organisateur', 'org-a');
    const res = await callDownload('facture', 'f1');
    expect(res.status).toBe(400);
  });
});
