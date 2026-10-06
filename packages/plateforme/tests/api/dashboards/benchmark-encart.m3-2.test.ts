/**
 * M3.2 — Encart « Filtres benchmark » (§06.05 Bloc 3, BL-P1-GEST-04).
 * Couvre : endpoint /benchmark/filtres (listes rattachées du gestionnaire, listes
 * parc et garde des rôles traiteur) + forward des 7 params de la route benchmark
 * vers la RPC f_benchmark_kg_pax_zd + relais du refus de périmètre (403).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { periodeBenchmark } from '@/lib/dashboards/periode-benchmark.js';
import { ERREUR_FILTRE_HORS_PERIMETRE } from '@/lib/dashboards/loaders.js';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockRpc = vi.fn();
const mockOrder = vi.fn();

const mockClientChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: mockOrder,
};

// Tables lues sous la session du gestionnaire (organisations_lieux,
// v_lieux_clients, collectes) : chaîne « thenable » qui rend les lignes posées.
// Toute autre table (types_evenements) garde la chaîne d'origine.
const tables: Record<string, unknown[]> = {};
function lecture(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'order']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(ok, ko);
  return q;
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (table: string) => {
      const lignes = tables[table];
      return lignes ? lecture(lignes) : mockClientChain;
    },
    rpc: mockRpc,
  }),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, orgId = 'org-1'): void {
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

function makeReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const t of Object.keys(tables)) delete tables[t];
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'f_benchmark_lieux_parc')
      return Promise.resolve({
        data: [{ id: 'l1', nom: 'Lieu 1' }],
        error: null,
      });
    if (fn === 'f_benchmark_traiteurs_parc')
      return Promise.resolve({
        data: [{ id: 't1', nom: 'Traiteur 1' }],
        error: null,
      });
    return Promise.resolve({ data: [], error: null });
  });
  mockOrder.mockResolvedValue({
    data: [{ id: 'ty1', libelle: 'Gala' }],
    error: null,
  });
});

describe('M3.2 / encart filtres benchmark', () => {
  it('M3.2/GEST04_filtres_gestionnaire_listes_rattachees — ses lieux, ses traiteurs intervenus, aucune liste du parc', async () => {
    setupAuth('gestionnaire_lieux');
    tables.organisations_lieux = [{ lieu_id: 'l-viparis' }];
    tables.v_lieux_clients = [{ id: 'l-viparis', nom: 'Palais des Congrès' }];
    tables.collectes = [
      {
        id: 'c1',
        evenements: {
          lieu_id: 'l-viparis',
          traiteur_operationnel_organisation_id: 't-kaspia',
          organisations: { id: 't-kaspia', nom: 'Kaspia' },
        },
      },
    ];
    const { GET } =
      await import('@/app/api/v1/dashboards/benchmark/filtres/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark/filtres'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    // Ni « Lieu 1 » ni « Traiteur 1 » (listes du parc mockées plus haut).
    expect(body.data).toEqual({
      lieux: [{ id: 'l-viparis', nom: 'Palais des Congrès' }],
      traiteurs: [{ id: 't-kaspia', nom: 'Kaspia' }],
      types: [{ id: 'ty1', libelle: 'Gala' }],
      perimetre: 'rattache',
    });
    // Les deux fonctions « parc » lui sont fermées en base : jamais appelées.
    expect(mockRpc).not.toHaveBeenCalledWith('f_benchmark_lieux_parc');
    expect(mockRpc).not.toHaveBeenCalledWith('f_benchmark_traiteurs_parc');
  });

  it('M3.2/GEST04_filtres_traiteur_sans_liste_traiteurs — préservation compétitive', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/dashboards/benchmark/filtres/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark/filtres'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lieux: unknown[]; traiteurs: unknown[]; perimetre: string };
    };
    expect(body.data.traiteurs.length).toBe(0);
    // Rôle traiteur : la liste des lieux reste celle du parc.
    expect(body.data.lieux).toEqual([{ id: 'l1', nom: 'Lieu 1' }]);
    expect(body.data.perimetre).toBe('parc');
    // La RPC traiteurs n'est PAS appelée pour un rôle traiteur.
    expect(mockRpc).not.toHaveBeenCalledWith('f_benchmark_traiteurs_parc');
  });

  it('M3.2/GEST04_route_forward_7_params — encart → RPC f_benchmark_kg_pax_zd', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/dashboards/benchmark?flux_code=biodechet&taille_evenement_codes=M,L&type_evenement_ids=ty1&lieu_ids=l1&periode_debut=2026-01-01&periode_fin=2026-06-30',
      ),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'f_benchmark_kg_pax_zd',
      expect.objectContaining({
        p_taille_evenement_codes: ['M', 'L'],
        p_type_evenement_ids: ['ty1'],
        p_lieu_ids: ['l1'],
        // Période fixe : celle de l'URL est ignorée (24 mois glissants imposés).
        p_periode_debut: periodeBenchmark().debut,
        p_periode_fin: periodeBenchmark().fin,
      }),
    );
  });

  it('BENCH-24M — sans période fournie, la RPC reçoit 24 mois glissants (jamais tout l’historique)', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark'));
    expect(res.status).toBe(200);
    const { debut, fin } = periodeBenchmark();
    expect(mockRpc).toHaveBeenCalledWith(
      'f_benchmark_kg_pax_zd',
      expect.objectContaining({ p_periode_debut: debut, p_periode_fin: fin }),
    );
  });

  it('M3.2/GEST04_route_gestionnaire_hors_perimetre_403 — lieu non rattaché refusé par la fonction, relayé en 403', async () => {
    setupAuth('gestionnaire_lieux');
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'Filtre lieu_ids hors des lieux rattaches au gestionnaire',
      },
    });
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/benchmark?lieu_ids=lieu-d-un-tiers'),
    );
    expect(res.status).toBe(403);
    // Libellé fixe de l'application, pas le message Postgres.
    expect(await res.json()).toEqual({ error: ERREUR_FILTRE_HORS_PERIMETRE });
  });

  it('M3.2/GEST04_route_traiteur_lieu_filter_403 — traiteur + traiteur_ids interdit', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/benchmark?traiteur_ids=t1'),
    );
    expect(res.status).toBe(403);
  });
});
