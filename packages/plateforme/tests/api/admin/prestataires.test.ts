/**
 * GET /api/v1/admin/prestataires — référentiel pour le choix du lien dans la
 * fiche transporteur. Chaque prestataire porte le transporteur auquel il est
 * déjà rattaché (un seul admis, #323) : c'est ce qui permet à l'écran de griser
 * le choix au lieu de laisser l'enregistrement échouer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const lectures: Record<string, { data: unknown; error: unknown }> = {};

// Une chaîne par table, résolue à l'`await` — le client réel est « thenable ».
function chaine(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'not', 'eq']) {
    c[m] = vi.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown) => resolve(lectures[table]);
  return c;
}

const mockClient = {
  from: vi.fn((table: string) => chaine(table)),
  schema: vi.fn(() => ({ from: (table: string) => chaine(`shared.${table}`) })),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockClient,
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
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

const req = () => new NextRequest('http://localhost/api/v1/admin/prestataires');

describe('GET /api/v1/admin/prestataires', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lectures['shared.prestataires'] = {
      data: [
        { id: 'p-atoutes', nom: 'A Toutes!', code: 'ATOUTES', statut: 'actif' },
        { id: 'p-strike', nom: 'Strike', code: 'STRIKE', statut: 'actif' },
      ],
      error: null,
    };
    lectures['transporteurs'] = {
      data: [
        {
          id: 't-strike',
          nom: 'Strike Paris',
          prestataire_logistique_id: 'p-strike',
        },
      ],
      error: null,
    };
  });

  it('403 pour un rôle client', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/prestataires/route.js');
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockClient.schema).not.toHaveBeenCalled();
  });

  it('porte le transporteur déjà rattaché, et null pour un prestataire libre', async () => {
    setupAuth('ops_savr');
    const { GET } = await import('@/app/api/v1/admin/prestataires/route.js');
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        transporteur_id: string | null;
        transporteur_nom: string | null;
      }>;
    };
    const parId = new Map(body.data.map((p) => [p.id, p]));
    expect(parId.get('p-strike')).toMatchObject({
      transporteur_id: 't-strike',
      transporteur_nom: 'Strike Paris',
    });
    expect(parId.get('p-atoutes')).toMatchObject({
      transporteur_id: null,
      transporteur_nom: null,
    });
  });

  it('erreur de lecture → 500 générique, sans message Postgres', async () => {
    setupAuth('admin_savr');
    lectures['transporteurs'] = {
      data: null,
      error: {
        code: '42P01',
        message: 'relation "plateforme.transporteurs" does not exist',
      },
    };
    const { GET } = await import('@/app/api/v1/admin/prestataires/route.js');
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(
      'plateforme.transporteurs',
    );
  });
});
