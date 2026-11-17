/**
 * GET /api/v1/admin/collectes/[id]/declaration-coursier — ce que le coursier a
 * déclaré à l'enlèvement (décision Val 2026-11-17). La relecture est simulée
 * (testée dans @savr/adapters) : on vérifie ici l'accès et les réponses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const COLLECTE = 'col-1';

const { lire, role, collecteExiste } = vi.hoisted(() => ({
  lire: vi.fn(),
  role: { valeur: 'admin_savr' as string },
  collecteExiste: { valeur: true },
}));

vi.mock('@savr/adapters/src/index.js', () => ({
  lireDeclarationsCoursier: lire,
}));

function table() {
  const c = {
    select: () => c,
    eq: () => c,
    maybeSingle: () =>
      Promise.resolve({
        data: collecteExiste.valeur ? { id: COLLECTE } : null,
        error: null,
      }),
  };
  return c;
}
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: table }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify({ aal: 'aal2', ...claims })).toString('base64url')}.s`;
}
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      getSession: async () => ({
        data: {
          session: { access_token: makeJwt({ user_role: role.valeur }) },
        },
        error: null,
      }),
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

const URL_ROUTE = `http://localhost/api/v1/admin/collectes/${COLLECTE}/declaration-coursier`;
const ctx = { params: Promise.resolve({ id: COLLECTE }) };
const lireRoute = async () =>
  (
    await import('@/app/api/v1/admin/collectes/[id]/declaration-coursier/route.js')
  ).GET(new NextRequest(URL_ROUTE), ctx);

beforeEach(() => {
  lire.mockReset();
  role.valeur = 'admin_savr';
  collecteExiste.valeur = true;
});

describe('GET déclaration du coursier', () => {
  it('rend les déclarations des courses', async () => {
    const courses = [
      {
        course: 1,
        declare_le: '2026-11-17T10:00:00.000Z',
        poids_kg: 12.5,
        champs: [{ nom: 'Poids en Kg obligatoire', valeur: '12,5' }],
      },
    ];
    lire.mockResolvedValue({
      pris_en_charge: true,
      courses,
      courses_sans_declaration: 0,
    });
    const res = await lireRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ courses, courses_sans_declaration: 0 });
    expect(lire).toHaveBeenCalledWith(
      expect.anything(),
      COLLECTE,
      expect.any(String),
    );
  });

  it('transporteur sans déclaration → 409', async () => {
    lire.mockResolvedValue({ pris_en_charge: false });
    expect((await lireRoute()).status).toBe(409);
  });

  it('collecte inconnue → 404, rien n’est relu', async () => {
    collecteExiste.valeur = false;
    expect((await lireRoute()).status).toBe(404);
    expect(lire).not.toHaveBeenCalled();
  });

  it('relecture en échec → 500 générique', async () => {
    lire.mockRejectedValue(new Error('getStatuses 503 : détail interne'));
    const res = await lireRoute();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('détail interne');
  });

  it.each(['traiteur_manager', 'gestionnaire_lieux', 'client_organisateur'])(
    'rôle client %s → refusé, rien n’est relu',
    async (r) => {
      role.valeur = r;
      expect((await lireRoute()).status).toBe(403);
      expect(lire).not.toHaveBeenCalled();
    },
  );
});
