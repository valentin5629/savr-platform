/**
 * M3.5 — Dashboard Admin / Bloc 1 KPIs (route /admin/dashboard/kpi)
 * BL-P0-05 (cluster C3 « enum zd/ag ») : les 6 compteurs des cartes-actions Bloc 1
 * filtrent `collectes.type` sur l'enum RÉEL `collecte_type_enum('zero_dechet','anti_gaspi')`.
 * Les littéraux `'zd'/'ag'` provoquent une erreur enum Postgres (avalée → carte = 0).
 *
 * Oracle BL-P0-05 : le mock RÉSOUT le count à partir du filtre `type` réellement passé.
 * Un littéral `'zd'/'ag'` → aucun match → count 0 → l'assertion `=== N` ROUGIT.
 * (pas de mock qui avale n'importe quelle valeur — cf. ticket R4.)
 * ref_cdc : 01 - Cahier des charges App/11 - Dashboards.md §Bloc 1 (5 cartes, split ZD/AG → 6 compteurs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Compteurs distincts par flux → permettent de prouver que le bon filtre route le bon count.
const COUNT_ZD = 7;
const COUNT_AG = 3;
const COUNT_BOTH = 11;

// Tous les arguments passés à `.eq('type', …)` / `.in('type', …)` sur collectes,
// capturés à travers les 6 requêtes parallèles (le guard anti-littéral s'appuie dessus).
let capturedTypeArgs: unknown[] = [];

/**
 * Chaîne Supabase mock RECORDING + thenable : retient le filtre `type` réellement
 * appliqué puis résout `{ count }` en fonction. Une nouvelle instance par `.from()`
 * → chaque requête du Promise.all enregistre indépendamment.
 */
function makeRecordingChain() {
  const chain: Record<string, unknown> & {
    _typeFilter?: string | string[];
  } = {};
  const recordType = (col: string, val: unknown) => {
    if (col === 'type') {
      chain._typeFilter = val as string | string[];
      capturedTypeArgs.push(val);
    }
    return chain;
  };
  const countForType = () => {
    const t = chain._typeFilter;
    if (t === 'zero_dechet') return COUNT_ZD;
    if (t === 'anti_gaspi') return COUNT_AG;
    if (Array.isArray(t)) {
      const set = new Set(t);
      return set.has('zero_dechet') && set.has('anti_gaspi') ? COUNT_BOTH : 0;
    }
    return 0;
  };
  Object.assign(chain, {
    select: () => chain,
    order: () => chain,
    eq: (col: string, val: unknown) => recordType(col, val),
    in: (col: string, val: unknown) => recordType(col, val),
    is: () => chain,
    not: () => chain,
    gte: () => chain,
    lte: () => chain,
    // Terminal liste collectes (`/admin/collectes` GET) → { data, error, count }.
    range: () =>
      Promise.resolve({ data: [], error: null, count: countForType() }),
    // Terminal cartes KPI (`/admin/dashboard/kpi`) : chaque requête est awaitée
    // directement (head+count) → thenable résolvant { count, error }.
    then: (
      onF: (v: { count: number; error: null }) => unknown,
      onR?: (e: unknown) => unknown,
    ) => Promise.resolve({ count: countForType(), error: null }).then(onF, onR),
  });
  return chain;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: () => makeRecordingChain() }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/v1/admin/dashboard/kpi', {
    method: 'GET',
  });
}

describe('M3.5 / dashboard-kpi Bloc 1 / enum réel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedTypeArgs = [];
  });

  it('M3.5 / Bloc 1 — N collectes zero_dechet → carte ZD = N (oracle BL-P0-05, pas 0)', async () => {
    setupAuth('admin_savr');
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;

    // Cartes ZD/AG « non transmises » + « 48h » → .eq('type','zero_dechet'|'anti_gaspi')
    expect(body.non_transmises_zd).toBe(COUNT_ZD);
    expect(body.non_transmises_ag).toBe(COUNT_AG);
    expect(body.zd_48h).toBe(COUNT_ZD);
    expect(body.ag_48h).toBe(COUNT_AG);
    // Cartes « attente prestataire » + « dirty TMS » → .in('type',['zero_dechet','anti_gaspi'])
    expect(body.attente_prestataire).toBe(COUNT_BOTH);
    expect(body.dirty_tms).toBe(COUNT_BOTH);
  });

  it('M3.5 / Bloc 1 — filtres type sur enum réel uniquement (littéraux zd/ag interdits)', async () => {
    setupAuth('admin_savr');
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    await GET(makeReq());

    // Aplatir (les .in passent un tableau) et vérifier l'appel RÉEL.
    const flat = capturedTypeArgs.flat();
    expect(flat.length).toBeGreaterThan(0);
    for (const v of flat) {
      expect(['zero_dechet', 'anti_gaspi']).toContain(v);
    }
    expect(flat).not.toContain('zd');
    expect(flat).not.toContain('ag');
  });

  it('M3.5 / Bloc 1 — 401 sans JWT', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('M3.5 / Bloc 1 — 403 si rôle traiteur', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });
});

// ── Chips liste collectes (cibles de clic des cartes Bloc 1) ──────────────────
// BL-P0-05 « + chips renvoient 0 » : les chips prédéfinis filtrant `type` doivent
// passer l'enum réel. /admin/dashboard/kpi/page → clic carte → /admin/collectes?chip=…
describe('M3.5 / chips collectes / enum réel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedTypeArgs = [];
    setupAuth('admin_savr');
  });

  function makeChipReq(chip: string): NextRequest {
    return new NextRequest(
      `http://localhost/api/v1/admin/collectes?chip=${chip}`,
      { method: 'GET' },
    );
  }

  it.each([
    ['zd_48h', 'zero_dechet', COUNT_ZD],
    ['ag_48h', 'anti_gaspi', COUNT_AG],
    ['ag_attente_attribution', 'anti_gaspi', COUNT_AG],
  ])(
    'M3.5 / chip %s → filtre type=%s (count %i, pas 0)',
    async (chip, expectedType, expectedCount) => {
      const { GET } = await import('@/app/api/v1/admin/collectes/route.js');
      const res = await GET(makeChipReq(chip));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { total: number };
      // Le mock route le count via le filtre type RÉEL → un littéral 'zd'/'ag' donnerait 0.
      expect(body.total).toBe(expectedCount);
      expect(capturedTypeArgs).toContain(expectedType);
      expect(capturedTypeArgs).not.toContain('zd');
      expect(capturedTypeArgs).not.toContain('ag');
    },
  );
});
