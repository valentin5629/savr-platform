/**
 * M4.2 — Tests Vitest : registre réglementaire ZD (§06.03).
 * Couvre (couche api) : auth (401 / agence 403), liste, export CSV tracé +
 * format FR, export ZIP bordereaux (50 ok / 51 refus 422 / 0 refus 422),
 * téléchargement bordereau (200 + URL pré-signée / hors périmètre 404),
 * export CSV 0 ligne (en-têtes seules). Génération R2 mockée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; count?: number; error?: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result =>
    queue.shift() ?? { data: null, count: 0, error: null };
  const chain: Record<string, unknown> = {
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
    'overlaps',
    'or',
    'range',
    'schema',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.insert = (...args: unknown[]) => {
    record('insert', args);
    return chain;
  };
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

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    schema: (...a: unknown[]) =>
      (rls.schema as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: vi.fn(async () => Buffer.from('%PDF-1.4 fake pdf bytes')),
  getPresignedUrl: vi.fn(async () => 'https://r2.example/signed-url'),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId: string | null = 'org-a') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt(
          organisationId
            ? { user_role: role, organisation_id: organisationId }
            : { user_role: role },
        ),
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
async function callList(query = '') {
  const { GET } = await import('@/app/api/v1/registre/route.js');
  return GET(makeReq(`/api/v1/registre${query}`));
}
async function callCsv(query = '') {
  const { GET } = await import('@/app/api/v1/registre/export-csv/route.js');
  return GET(makeReq(`/api/v1/registre/export-csv${query}`));
}
async function callZip(query = '') {
  const { GET } = await import('@/app/api/v1/registre/export-zip/route.js');
  return GET(makeReq(`/api/v1/registre/export-zip${query}`));
}
async function callDownload(id: string) {
  const { GET } =
    await import('@/app/api/v1/registre/bordereaux/[id]/download/route.js');
  return GET(makeReq(`/api/v1/registre/bordereaux/${id}/download`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
});

// ── Auth ────────────────────────────────────────────────────────────────────
describe('M4.2 / garde', () => {
  it('M4.2/acces_registre_non_authentifie_401', async () => {
    noAuth();
    expect((await callList()).status).toBe(401);
  });

  it('M4.2/registre_agence_denied — agence refusée (403)', async () => {
    setupAuth('agence', 'org-a');
    expect((await callList()).status).toBe(403);
  });

  it('M4.2/liste_registre_200 — manager voit ses lignes', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: [{ collecte_id: 'c1' }], count: 1, error: null });
    const res = await callList('?page=1&pageSize=25');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; rows: unknown[] };
    expect(body.total).toBe(1);
    expect(body.rows).toHaveLength(1);
  });
});

// ── Export CSV (P1 export_csv_registre_filtre_trace) ─────────────────────────
describe('M4.2 / export_csv_registre_filtre_trace', () => {
  it('CSV 200 + format FR + trace exports_registre', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({
      data: [
        {
          collecte_id: 'c1',
          date_evenement: '2026-05-12',
          lieu_nom: 'Pavillon Cambon',
          traiteur_raison_sociale: 'Kaspia SARL',
          flux_codes: ['biodechet', 'verre'],
          poids_total_kg: 66,
          exutoire_nom: 'Veolia Saint-Denis',
          bordereau_numero: 'BSAV-2026-00001',
          bordereau_statut: 'emis',
        },
      ],
      count: 1,
      error: null,
    });
    rls.push({
      data: [
        {
          collecte_id: 'c1',
          poids_reel_kg: 36,
          flux_dechets: {
            code: 'biodechet',
            filiere_valorisation: 'compostage',
          },
        },
        {
          collecte_id: 'c1',
          poids_reel_kg: 30,
          flux_dechets: { code: 'verre', filiere_valorisation: 'recyclage' },
        },
      ],
      error: null,
    });
    rls.push({ error: null }); // trace insert

    const res = await callCsv('?from=2026-05-01&to=2026-05-31&flux=biodechet');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toMatch(
      /registre-savr-\d{8}\.csv/,
    );

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM
    const text = new TextDecoder().decode(buf);
    const [header, line1] = text.split('\r\n');
    expect(header).toContain('Date événement');
    expect(header).toContain('Poids total (kg)');
    expect(header).toContain('Exutoire');
    expect(header).toContain('Biodéchets (kg)'); // poids par flux détaillé
    expect(header).toContain('Verre (kg)');
    expect(header).toContain('Filières');
    expect(line1).toContain('Veolia Saint-Denis');
    expect(line1).toContain('66'); // poids total
    expect(line1).toContain('36'); // biodéchets détaillé
    expect(line1).toContain('12/05/2026'); // date FR

    // Trace exports_registre : type registre_dechets, format csv, nb_lignes=1.
    const insertArgs = (rls.__calls.insert ?? [])[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertArgs?.type_export).toBe('registre_dechets');
    expect(insertArgs?.format).toBe('csv');
    expect(insertArgs?.nb_lignes).toBe(1);
    expect(insertArgs?.user_id).toBe('user-1');
    expect(insertArgs?.organisation_id).toBe('org-a');
  });

  it('M4.2/export_csv_zero_ligne_entetes_seules', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: [], count: 0, error: null }); // 0 ligne (fetchFluxDetail court-circuité)
    rls.push({ error: null }); // trace insert
    const res = await callCsv('?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(200);
    const text = new TextDecoder().decode(
      new Uint8Array(await res.arrayBuffer()),
    );
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(1); // en-têtes seules
    const insertArgs = (rls.__calls.insert ?? [])[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertArgs?.nb_lignes).toBe(0);
  });
});

// ── Export ZIP (P1 export_zip_bordereaux_periode + cas limites) ──────────────
describe('M4.2 / export_zip_bordereaux_periode', () => {
  function pushRows() {
    rls.push({
      data: [{ collecte_id: 'c1', date_evenement: '2026-04-10' }],
      count: 1,
      error: null,
    });
  }
  function bords(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      numero: `BSAV-2026-${String(i).padStart(5, '0')}`,
      fichiers: { url: `bordereaux/b${i}.pdf` },
    }));
  }

  it('zip_exactement_50_bordereaux_ok + trace bordereaux_batch', async () => {
    setupAuth('traiteur_manager', 'org-a');
    pushRows();
    rls.push({ data: bords(50), error: null });
    rls.push({ error: null }); // trace
    const res = await callZip('?from=2026-04-01&to=2026-05-31');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    const insertArgs = (rls.__calls.insert ?? [])[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertArgs?.type_export).toBe('bordereaux_batch');
    expect(insertArgs?.format).toBe('zip');
    expect(insertArgs?.nb_lignes).toBe(50);
  });

  it('M4.2/zip_51_bordereaux_refuse — 422 + aucune trace', async () => {
    setupAuth('traiteur_manager', 'org-a');
    pushRows();
    rls.push({ data: bords(51), error: null });
    const res = await callZip('?from=2026-04-01&to=2026-05-31');
    expect(res.status).toBe(422);
    expect(rls.__calls.insert).toBeUndefined();
  });

  it('M4.2/zip_zero_bordereau_refuse_message — 422', async () => {
    setupAuth('traiteur_manager', 'org-a');
    pushRows();
    rls.push({ data: [], error: null });
    const res = await callZip('?from=2026-04-01&to=2026-05-31');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Aucun bordereau');
  });
});

// ── Téléchargement bordereau ─────────────────────────────────────────────────
describe('M4.2 / telechargement_pdf_bordereau_depuis_liste', () => {
  it('200 + URL pré-signée', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({
      data: {
        id: 'b1',
        statut: 'emis',
        fichiers: { url: 'bordereaux/b1.pdf' },
      },
      error: null,
    });
    const res = await callDownload('b1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expires_in: number };
    expect(body.url).toBe('https://r2.example/signed-url');
    expect(body.expires_in).toBe(900);
  });

  it('M4.2/url_directe_bordereau_hors_perimetre_deny — 404 (RLS → null)', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: null, error: null });
    const res = await callDownload('b-autre-org');
    expect(res.status).toBe(404);
  });
});
