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
    'gt',
    'lte',
    'neq',
    'order',
    'limit',
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
// Rapport de recyclage ZD fabriqué au clic (décision Val 2026-10-16).
const mockPayload = vi.fn();
const mockPdf = vi.fn();
vi.mock('@/lib/pdf/payload-rapport.js', () => ({
  construirePayloadRapport: (...a: unknown[]) => mockPayload(...a),
}));
vi.mock('@/lib/pdf/railway-client.js', () => ({
  generatePdf: (...a: unknown[]) => mockPdf(...a),
}));
// Marque « consulté » (service-role) : écritures relevées.
const majsAdmin: { table: string; valeurs: unknown }[] = [];
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      const c: Record<string, unknown> = {
        update: (valeurs: unknown) => {
          majsAdmin.push({ table, valeurs });
          return c;
        },
        eq: () => c,
        is: () => Promise.resolve({ data: null, error: null }),
      };
      return c;
    },
  }),
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
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
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
  majsAdmin.length = 0;
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
        // v_referentiel_traiteurs rend UN libellé (20260922080000).
        { id: 'tr-1', nom: 'Traiteur T' },
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
    expect(json.data[0]?.traiteur_nom).toBe('Traiteur T');
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
          id: 'c1',
          type: 'zero_dechet',
          date_collecte: '2026-05-12',
          pax: 100,
          evenement_id: 'e1',
          taux_recyclage: 70,
          co2_evite_kg: 5,
          co2_induit_kg: 10,
          co2_net_kg: -5,
          energie_primaire_evitee_kwh: 120,
          collecte_flux: [{ poids_reel_kg: 30 }],
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
    expect(json.data[0]).toHaveProperty('nb_evenements', 1);
    // Périmètre : événements dont l'organisation est le client rattaché.
    expect(rls.__calls.eq).toContainEqual([
      'evenements.client_organisateur_organisation_id',
      'org-a',
    ]);
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
          collectes: { type: 'zero_dechet', statut: 'cloturee' },
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

  it('M3.4/documents_collecte_ag_un_seul_rapport_de_don — AG : un document par collecte, nommé « Rapport de don » avec ou sans excédents', async () => {
    setupAuth('client_organisateur', 'org-a');
    const evt = { nom_evenement: 'Gala', date_evenement: '2026-05-10' };
    const rapport = (
      id: string,
      collecte_id: string,
      type: string,
      statut: string,
      genere_at: string | null,
    ) => ({
      id,
      collecte_id,
      disponible_a: '2020-01-01T00:00:00Z',
      genere_at,
      collectes: { type, statut },
      evenements: evt,
    });
    // rapports — une ZD, une AG sans excédents (vrai PDF), et une AG avec
    // excédents dont la ligne de rapport, jamais rendue, n'est pas un document.
    rls.push({
      data: [
        rapport('r-zd', 'c-zd', 'zero_dechet', 'cloturee', '2020-01-02'),
        rapport(
          'r-sans',
          'c-sans',
          'anti_gaspi',
          'realisee_sans_collecte',
          '2020-01-02',
        ),
        rapport('r-fantome', 'c-don', 'anti_gaspi', 'cloturee', null),
      ],
      error: null,
    });
    rls.push({ data: [], error: null }); // bordereaux
    rls.push({
      data: [
        {
          id: 'a-don',
          collecte_id: 'c-don',
          genere_at: '2020-01-02T00:00:00Z',
          pdf_url: 'attestations/a.pdf',
          collectes: { evenements: evt },
        },
      ],
      error: null,
    });

    const { GET } =
      await import('@/app/api/v1/organisateur/documents/route.js');
    const res = await GET(makeReq('/api/v1/organisateur/documents'));
    const json = (await res.json()) as {
      data: Array<{ id: string; type: string; nom: string }>;
    };

    expect(res.status).toBe(200);
    expect(json.data.map((d) => [d.id, d.type, d.nom]).sort()).toEqual([
      ['a-don', 'attestation', 'Rapport de don'],
      ['r-sans', 'rapport', 'Rapport de don'],
      ['r-zd', 'rapport', 'Rapport RSE'],
    ]);
    // Une seule ligne par collecte AG.
    const parCollecteAg = json.data.filter((d) => d.nom === 'Rapport de don');
    expect(parCollecteAg).toHaveLength(2);
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

  it('M3.4/document_download_rapport_ok — rapport de recyclage ZD fabriqué au clic, sans radar (pas de fiche où le choisir), rendu en PDF', async () => {
    setupAuth('client_organisateur', 'org-a');
    mockPayload.mockResolvedValueOnce({
      ok: true,
      payload: {
        options: { benchmark: false },
        bordereau: { date_collecte: '28/09/2026' },
      },
      dateCollecte: '28/09/2026',
    });
    mockPdf.mockResolvedValueOnce({ pdfBuffer: Buffer.from('%PDF orga') });
    rls.push({
      data: {
        id: 'r1',
        collecte_id: 'c-zd',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: null,
        pdf_url: null,
      },
      error: null,
    });
    // Type de la collecte, lu sous la RLS du client organisateur.
    rls.push({ data: { type: 'zero_dechet' }, error: null });
    const res = await callDownload('rapport', 'r1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(mockPdf.mock.calls[0]![0]).toBe('rapport-recyclage-zd');
    expect((mockPdf.mock.calls[0]![1] as { options: unknown }).options).toEqual(
      { benchmark: false },
    );
    // Bordereau de la page 2 testé sous la RLS du client organisateur (§12 §1.7),
    // jamais avec le client service-role.
    const [, lecteur, collecteId] = mockPayload.mock.calls[0]! as [
      unknown,
      { auth?: { getUser?: unknown } },
      string,
    ];
    expect(collecteId).toBe('c-zd');
    // Le client SSR de la requête (session du demandeur), pas le service-role.
    expect(lecteur.auth?.getUser).toBe(mockGetUser);
    // Aucun fichier stocké servi.
    expect(mockPresign).not.toHaveBeenCalled();
    // Premier téléchargement par le client organisateur : « Rapport consulté ».
    expect(majsAdmin.map((m) => m.table)).toEqual(['rapports_rse']);
    expect(majsAdmin[0]!.valeurs).toHaveProperty('consulte_par_user_at');
  });

  it('M3.4/document_download_rapport_de_don_sans_excedent — fichier nommé « rapport-de-don », date et événement', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: {
        id: 'r2',
        collecte_id: 'c-sans',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/r2.pdf',
      },
      error: null,
    });
    // Type de la collecte (rapport de don : fichier stocké), puis lecture du nom.
    rls.push({ data: { type: 'anti_gaspi' }, error: null });
    rls.push({
      data: {
        type: 'anti_gaspi',
        statut: 'realisee_sans_collecte',
        evenements: {
          nom_evenement: 'Dîner d’été — Château',
          date_evenement: '2026-07-01',
        },
      },
      error: null,
    });
    const res = await callDownload('rapport', 'r2');
    expect(res.status).toBe(200);
    expect(rls.__calls.eq).toContainEqual(['id', 'c-sans']);
    expect(mockPresign).toHaveBeenCalledWith(
      'rapports/r2.pdf',
      900,
      'rapport-de-don-2026-07-01-diner-d-ete-chateau.pdf',
    );
  });

  it('M3.4/document_download_rapport_de_don_nom_illisible — la collecte ne se lit pas : téléchargement servi, sans nom imposé', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: {
        id: 'r2',
        collecte_id: 'c-sans',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/r2.pdf',
      },
      error: null,
    });
    // Ni le type ni le nom ne se lisent : le fichier stocké est servi.
    rls.push({ data: null, error: { message: 'boom' } });
    rls.push({ data: null, error: { message: 'boom' } });
    const res = await callDownload('rapport', 'r2');
    expect(res.status).toBe(200);
    expect(mockPresign).toHaveBeenCalledWith('rapports/r2.pdf', 900, undefined);
  });

  it('M3.4/document_download_rapport_de_don_attestation — fichier nommé par le numéro de l’attestation', async () => {
    setupAuth('client_organisateur', 'org-a');
    rls.push({
      data: {
        id: 'a1',
        numero: 'ATT-DON-2026-00003',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'attestations/a1.pdf',
      },
      error: null,
    });
    const res = await callDownload('attestation', 'a1');
    expect(res.status).toBe(200);
    expect(rls.__calls.select).toContainEqual([
      'id, numero, genere_at, pdf_url',
    ]);
    expect(mockPresign).toHaveBeenCalledWith(
      'attestations/a1.pdf',
      900,
      'rapport-de-don-ATT-DON-2026-00003.pdf',
    );
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
