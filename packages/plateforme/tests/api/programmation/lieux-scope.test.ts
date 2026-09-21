/**
 * GET /api/v1/programmation/lieux — périmètre de l'autocomplétion Lieux.
 *
 * Ce fichier prouve la DÉLÉGATION : que la route laisse la policy
 * `lieux_clients_select` décider, au lieu de la recopier en TypeScript. C'est le
 * maillon qu'un test SQL ne peut pas voir (il testerait une requête que la route
 * n'émet peut-être plus). Le maillon symétrique — « la policy rend bien le lieu au
 * traiteur opérationnel et pas au concurrent » — est prouvé sous `authenticated`
 * par supabase/tests/programmation_lieux_autocompletion.test.sql.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of ['from', 'select', 'eq', 'in', 'not', 'or', 'order', 'limit'])
    chain[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return chain;
    };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockCreateAdmin = vi.fn(() => ({
  from: (...a: unknown[]) => (admin.from as (...x: unknown[]) => unknown)(...a),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockCreateAdmin(),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, organisationId: string) {
  const jwt = `h.${Buffer.from(
    JSON.stringify({ user_role: role, organisation_id: organisationId }),
  ).toString('base64url')}.s`;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jwt } },
  });
}

const req = (url: string) => new NextRequest(`http://localhost${url}`);
const args = (c: ReturnType<typeof makeChain>, m: string) => c.__calls[m] ?? [];
const GET = async () =>
  (await import('@/app/api/v1/programmation/lieux/route.js')).GET;

describe('programmation/lieux — périmètre délégué à la RLS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rls = makeChain();
    admin = makeChain();
  });

  it('lieux_client_lit_sous_rls — la lecture passe par la vue liste blanche, jamais par le service_role', async () => {
    setupAuth('traiteur_manager', 'org-t1');
    rls.push({ data: [{ id: 'lieu-1', nom: 'Lieu tiers' }], error: null });

    const res = await (await GET())(req('/api/v1/programmation/lieux'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'lieu-1', nom: 'Lieu tiers' }]);
    expect(args(rls, 'from')).toEqual([['v_lieux_clients']]);
    // Le service_role bypasse la RLS : s'il reparaît ici, la policy ne borne plus rien.
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('lieux_client_aucun_scope_reimplemente — une seule requête, aucune borne d’ids calculée en TS', async () => {
    setupAuth('traiteur_commercial', 'org-t1');
    rls.push({ data: [], error: null });

    await (
      await GET()
    )(req('/api/v1/programmation/lieux'));

    // Ré-implémenter le périmètre, c'est lire organisations_lieux / evenements puis
    // borner par `.in('id', …)`. Les trois doivent rester absents : c'est ce qui avait
    // fait diverger la route de la policy (branches 1+2 seulement).
    expect(args(rls, 'from').flat()).toEqual(['v_lieux_clients']);
    expect(args(rls, 'in')).toEqual([]);
  });

  it('lieux_client_param_org_cross_ignore — un rôle client ne s’élargit pas via ?organisation_id', async () => {
    setupAuth('agence', 'org-agence');
    rls.push({ data: [], error: null });

    await (
      await GET()
    )(req('/api/v1/programmation/lieux?organisation_id=org-tierce'));

    expect(mockCreateAdmin).not.toHaveBeenCalled();
    // Le param n'est jamais relu : aucun prédicat d'organisation n'est posé côté route,
    // le périmètre vient du seul JWT via la policy.
    expect(
      args(rls, 'eq').filter(([col]) => col === 'organisation_id'),
    ).toEqual([]);
  });

  it('lieux_client_recherche_ilike — le terme de recherche reste appliqué sur la vue', async () => {
    setupAuth('traiteur_manager', 'org-t1');
    rls.push({ data: [], error: null });

    await (
      await GET()
    )(req('/api/v1/programmation/lieux?q=Pavillon'));

    expect(args(rls, 'or')[0]?.[0]).toContain('nom.ilike.%Pavillon%');
    expect(args(rls, 'eq')).toContainEqual(['actif', true]);
  });

  it('lieux_admin_support_miroir_branche_4 — le périmètre simulé inclut les événements OPÉRÉS par la cible', async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: [], error: null }); // organisations_lieux (b1)
    admin.push({ data: [], error: null }); // evenements programmés (b2)
    admin.push({ data: [{ lieu_id: 'lieu-opere' }], error: null }); // evenements opérés (b4)
    admin.push({
      data: [{ id: 'lieu-opere', nom: 'Lieu opéré' }],
      error: null,
    });

    const res = await (
      await GET()
    )(req('/api/v1/programmation/lieux?organisation_id=org-cible'));

    expect(await res.json()).toEqual([{ id: 'lieu-opere', nom: 'Lieu opéré' }]);
    // Sans cette branche, l'admin qui programme POUR un traiteur voyait une liste
    // plus courte que le traiteur lui-même.
    expect(args(admin, 'eq')).toContainEqual([
      'traiteur_operationnel_organisation_id',
      'org-cible',
    ]);
    expect(args(admin, 'in')).toContainEqual(['id', ['lieu-opere']]);
  });

  it('lieux_admin_support_sans_org_cible — 200 [] plutôt que tous les lieux', async () => {
    setupAuth('admin_savr', 'org-savr');

    const res = await (await GET())(req('/api/v1/programmation/lieux'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(args(admin, 'from')).toEqual([]);
  });
});
