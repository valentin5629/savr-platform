/**
 * Rattacher après coup une collecte Anti-Gaspi au pack actif de son organisation
 * (décision Val 2026-10-16).
 *
 * - POST /api/v1/admin/collectes/[id]/rattacher-pack : admin_savr seul (la RPC
 *   retire une ligne de facture, refusé à ops_savr par la matrice §09), appel de
 *   rpc_rattacher_collecte_pack au nom de l'Admin, erreurs métier conservées.
 * - GET /api/v1/admin/collectes/[id] : `rattachement_pack` dit si la collecte est
 *   rattachable (même fonction que la RPC) et quel pack serait débité.
 *
 * La logique de rattachement elle-même (débit, brouillon retiré, alertes) est
 * épinglée en pgTAP : supabase/tests/rattacher_collecte_pack.test.sql.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Reponse = { data: unknown; error: unknown };

const reponses = new Map<string, Reponse>();
const appels: { cible: string; filtres: [string, unknown][] }[] = [];
const mockRpc = vi.fn();

function chaine(cible: string) {
  const appel = { cible, filtres: [] as [string, unknown][] };
  appels.push(appel);
  const fin = (): Promise<Reponse> =>
    Promise.resolve(reponses.get(cible) ?? { data: null, error: null });
  const c = {
    select: () => c,
    eq: (colonne: string, valeur: unknown) => {
      appel.filtres.push([colonne, valeur]);
      return c;
    },
    single: fin,
    maybeSingle: fin,
    then: <T>(suite: (r: Reponse) => T) => fin().then(suite),
  };
  return c;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => chaine(`plateforme.${table}`),
    schema: (schema: string) => ({
      from: (table: string) => chaine(`${schema}.${table}`),
    }),
    rpc: mockRpc,
  }),
}));

vi.mock('@savr/shared/src/email/index.js', () => ({ sendEmail: vi.fn() }));

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

function setupAuth(role: string): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'admin-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function rattacher(): Promise<Response> {
  const { POST } =
    await import('@/app/api/v1/admin/collectes/[id]/rattacher-pack/route.js');
  return POST(
    new NextRequest(
      'http://localhost/api/v1/admin/collectes/col-1/rattacher-pack',
      { method: 'POST' },
    ),
    { params: Promise.resolve({ id: 'col-1' }) },
  );
}

async function getDetail(): Promise<Response> {
  const { GET } = await import('@/app/api/v1/admin/collectes/[id]/route.js');
  return GET(new NextRequest('http://localhost/api/v1/admin/collectes/col-1'), {
    params: Promise.resolve({ id: 'col-1' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  reponses.clear();
  appels.length = 0;
});

describe('M2.1 / rattacher-pack — POST admin/collectes/[id]/rattacher-pack', () => {
  it('admin_savr : la RPC est appelée au nom de l’Admin et son résultat rendu tel quel', async () => {
    setupAuth('admin_savr');
    const resultat = {
      ok: true,
      pack_antgaspi_id: 'pack-1',
      statut_pack: 'actif',
      brouillons_retires: 0,
      facture_envoyee: true,
    };
    mockRpc.mockResolvedValueOnce({ data: resultat, error: null });

    const res = await rattacher();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultat);
    expect(mockRpc).toHaveBeenCalledWith('rpc_rattacher_collecte_pack', {
      p_collecte_id: 'col-1',
      p_user_id: 'admin-1',
    });
  });

  it.each(['ops_savr', 'traiteur_manager'])(
    '%s : 403, la RPC n’est jamais appelée',
    async (role) => {
      setupAuth(role);

      const res = await rattacher();

      expect(res.status).toBe(403);
      expect(mockRpc).not.toHaveBeenCalled();
    },
  );

  it('collecte inconnue (P0002) → 404', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'Collecte non trouvée' },
    });

    const res = await rattacher();

    expect(res.status).toBe(404);
  });

  it.each([
    [
      'P0003',
      "Collecte non rattachable : seule une collecte Anti-Gaspi sans pack, réalisée, clôturée ou annulée tardivement peut l'être",
    ],
    ['P0006', 'Aucun pack Anti-Gaspi actif pour cette organisation'],
  ])(
    'refus métier %s → 409, message de la RPC conservé',
    async (code, message) => {
      setupAuth('admin_savr');
      mockRpc.mockResolvedValueOnce({ data: null, error: { code, message } });

      const res = await rattacher();

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: message });
    },
  );

  it('erreur inattendue → 500 sans le message de la base', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42P01', message: 'relation plateforme.x does not exist' },
    });

    const res = await rattacher();

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('plateforme.x');
  });
});

describe('M2.1 / rattacher-pack — GET admin/collectes/[id] : rattachement_pack', () => {
  const collecteAgSansPack = {
    id: 'col-1',
    type: 'anti_gaspi',
    pack_antgaspi_id: null,
    prestataire_logistique_id: null,
    evenements: { organisation_id: 'org-1' },
  };

  it('AG sans pack rattachable, pack actif : le pack que le rattachement débiterait', async () => {
    setupAuth('admin_savr');
    reponses.set('plateforme.collectes', {
      data: collecteAgSansPack,
      error: null,
    });
    const pack = {
      id: 'pack-1',
      type_pack: 'pack_10',
      credits_initiaux: 10,
      credits_restants: 3,
    };
    reponses.set('plateforme.packs_antgaspi', { data: pack, error: null });
    mockRpc.mockResolvedValueOnce({ data: true, error: null });

    const res = await getDetail();

    expect(res.status).toBe(200);
    expect((await res.json()).rattachement_pack).toEqual({ pack_actif: pack });
    expect(mockRpc).toHaveBeenCalledWith('f_collecte_rattachable_pack', {
      p_collecte_id: 'col-1',
    });
    // Le pack lu est celui de l'organisation programmatrice, et seulement l'actif.
    expect(
      appels.find((a) => a.cible === 'plateforme.packs_antgaspi')!.filtres,
    ).toEqual([
      ['organisation_id', 'org-1'],
      ['statut', 'actif'],
    ]);
  });

  it('AG sans pack rattachable, aucun pack actif : pack_actif null', async () => {
    setupAuth('admin_savr');
    reponses.set('plateforme.collectes', {
      data: collecteAgSansPack,
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: true, error: null });

    const res = await getDetail();

    expect((await res.json()).rattachement_pack).toEqual({ pack_actif: null });
  });

  it('AG sans pack non rattachable (ex. annulée à temps) : null, aucun pack lu', async () => {
    setupAuth('admin_savr');
    reponses.set('plateforme.collectes', {
      data: collecteAgSansPack,
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    const res = await getDetail();

    expect((await res.json()).rattachement_pack).toBeNull();
    expect(
      appels.filter((a) => a.cible === 'plateforme.packs_antgaspi'),
    ).toHaveLength(0);
  });

  it.each([
    ['AG déjà rattachée', { type: 'anti_gaspi', pack_antgaspi_id: 'pack-1' }],
    ['ZD', { type: 'zero_dechet', pack_antgaspi_id: null }],
  ])('%s : null, la fonction n’est pas appelée', async (_cas, champs) => {
    setupAuth('admin_savr');
    reponses.set('plateforme.collectes', {
      data: { ...collecteAgSansPack, ...champs },
      error: null,
    });

    const res = await getDetail();

    expect((await res.json()).rattachement_pack).toBeNull();
    expect(mockRpc).not.toHaveBeenCalledWith(
      'f_collecte_rattachable_pack',
      expect.anything(),
    );
  });
});
