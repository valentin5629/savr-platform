/**
 * M3.1 / M3.3 / M3.2 — Options des filtres modale-natifs de l'export synthèse
 * (§12 §1.6 étape 2 : Client organisateur traiteur/agence + Commercial manager).
 * Décision Val 2026-07-07 : filtres construits dans la modale. Couvre le scoping
 * par rôle (0 fuite inter-org) + le fait que gestionnaire ne les expose pas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

type Res = { data: unknown; error: unknown };
let results: Record<string, Res> = {};
let calls: Record<string, unknown[][]> = {};
let current = '';
function rec(n: string, a: unknown[]) {
  (calls[n] ??= []).push(a);
}
const chain: Record<string, unknown> = {};
chain.from = (t: string) => {
  current = t;
  rec('from', [t]);
  return chain;
};
for (const m of ['select', 'eq', 'in', 'not', 'order']) {
  chain[m] = (...a: unknown[]) => {
    rec(m, a);
    return chain;
  };
}
chain.then = (resolve: (r: Res) => unknown) =>
  resolve(results[current] ?? { data: [], error: null });

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (t: string) => (chain.from as (t: string) => unknown)(t),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, orgId = 'org-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: orgId }),
      },
    },
    error: null,
  });
}

async function callGet() {
  const { GET } =
    await import('@/app/api/v1/dashboards/synthese-pdf/filtres/route.js');
  return GET(
    new NextRequest('http://localhost/api/v1/dashboards/synthese-pdf/filtres', {
      method: 'GET',
    }),
  );
}

const EVENTS = [
  {
    client_organisateur_organisation_id: 'cli-1',
    nom_client_organisateur: 'ACME',
    created_by: 'com-1',
  },
  {
    client_organisateur_organisation_id: 'cli-2',
    nom_client_organisateur: 'Globex',
    created_by: 'com-2',
  },
  {
    client_organisateur_organisation_id: 'cli-1',
    nom_client_organisateur: 'ACME',
    created_by: 'com-1',
  },
];
const USERS = [
  { id: 'com-1', prenom: 'Alice', nom: 'Martin' },
  { id: 'com-2', prenom: 'Bob', nom: 'Durand' },
];

beforeEach(() => {
  vi.clearAllMocks();
  results = {};
  calls = {};
  current = '';
});

describe('M3.1 / synthèse — options filtres modale (client organisateur + commercial)', () => {
  it('manager traiteur : clients distincts (scope opérationnel) + commerciaux résolus', async () => {
    setupAuth('traiteur_manager');
    results = {
      evenements: { data: EVENTS, error: null },
      users: { data: USERS, error: null },
    };
    const res = await callGet();
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      data: { clients: { id: string }[]; commerciaux: { id: string }[] };
    };
    expect(j.data.clients.map((c) => c.id).sort()).toEqual(['cli-1', 'cli-2']);
    expect(j.data.commerciaux.map((c) => c.id).sort()).toEqual([
      'com-1',
      'com-2',
    ]);
    // 0 fuite : scope sur traiteur_operationnel_organisation_id = org courante.
    const eqCols = (calls['eq'] ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(eqCols).toContain('traiteur_operationnel_organisation_id=org-1');
  });

  it('commercial traiteur : clients présents, commerciaux VIDES (manager only §1.6 l.268)', async () => {
    setupAuth('traiteur_commercial');
    results = { evenements: { data: EVENTS, error: null } };
    const res = await callGet();
    const j = (await res.json()) as {
      data: { clients: unknown[]; commerciaux: unknown[] };
    };
    expect(j.data.clients.length).toBe(2);
    expect(j.data.commerciaux).toEqual([]);
  });
});

describe('M3.3 / synthèse agence — clients scope programmateur, pas de commerciaux', () => {
  it('agence : scope organisation_id, commerciaux vides', async () => {
    setupAuth('agence', 'ag-1');
    results = { evenements: { data: EVENTS, error: null } };
    const res = await callGet();
    const j = (await res.json()) as {
      data: { clients: unknown[]; commerciaux: unknown[] };
    };
    expect(j.data.clients.length).toBe(2);
    expect(j.data.commerciaux).toEqual([]);
    const eqCols = (calls['eq'] ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(eqCols).toContain('organisation_id=ag-1');
  });
});

describe('M3.2 / synthèse gestionnaire — Client organisateur/Commercial non applicables', () => {
  it('gestionnaire : clients ET commerciaux vides (§1.6 l.264-268)', async () => {
    setupAuth('gestionnaire_lieux', 'gest-1');
    const res = await callGet();
    const j = (await res.json()) as {
      data: { clients: unknown[]; commerciaux: unknown[] };
    };
    expect(j.data.clients).toEqual([]);
    expect(j.data.commerciaux).toEqual([]);
  });
});
