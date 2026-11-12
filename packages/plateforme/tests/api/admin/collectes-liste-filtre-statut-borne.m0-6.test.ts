/**
 * M0.6 — GET /admin/collectes : le filtre « Créée » / « Programmée » porte un
 * nombre borné de collectes à l'envoi abandonné.
 *
 * Leurs identifiants partent dans l'URL du filtre de la liste, triée et paginée :
 * cette liste-là ne se découpe pas en lots. Passé quelques centaines
 * d'identifiants la requête échoue sans dire pourquoi (« fetch failed », mesures
 * en tête de `src/lib/pdf/selection-par-pages.ts`). Le filtre refuse donc au-delà
 * de `MAX_ENVOIS_ABANDONNES_FILTRE`, et la route répond par une erreur dont la
 * cause est journalisée, sans lire la liste. Tant que les identifiants ne
 * partent pas dans l'URL (aucun filtre de statut, ou « Créée » et « Programmée »
 * ensemble), leur nombre ne bloque rien.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_ENVOIS_ABANDONNES_FILTRE as MAX } from '@/lib/statut-collecte-admin.js';

const chain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => chain,
}));

// Les collectes à l'envoi abandonné, telles que la file d'envoi les rendrait.
const lireAbandons = vi.fn();
vi.mock('@/lib/ordre-envoi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ordre-envoi.js')>()),
  lireCollectesEnvoiAbandonne: () => lireAbandons(),
}));

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

const uuids = (n: number): string[] =>
  Array.from(
    { length: n },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  );

function abandons(n: number): void {
  lireAbandons.mockResolvedValue({ data: new Set(uuids(n)), error: null });
}

async function lister(qs: string) {
  const { GET } = await import('@/app/api/v1/admin/collectes/route.js');
  return GET(new NextRequest(`http://localhost/api/v1/admin/collectes${qs}`));
}

/** Identifiants passés à la liste dans l'expression `or=(…)` de son filtre. */
function identifiantsDansLeFiltre(): string[] {
  const expressions = chain.or.mock.calls.map((c) => String(c[0]));
  return expressions.flatMap((e) => {
    const liste = /id\.(?:not\.)?in\.\(([^)]*)\)/.exec(e)?.[1];
    return liste ? liste.split(',') : [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  const jeton = `h.${Buffer.from(
    JSON.stringify({ aal: 'aal2', user_role: 'admin_savr' }),
  ).toString('base64url')}.s`;
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jeton } },
    error: null,
  });
});

describe('M0.6 / liste Collectes Admin — filtre de statut et envois abandonnés en nombre', () => {
  it.each([['creee'], ['programmee'], ['programmee,validee']])(
    `statuts=%s, ${MAX + 1} envois abandonnés : erreur journalisée avec sa cause, la liste n’est pas lue`,
    async (statuts) => {
      abandons(MAX + 1);
      const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
      const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await lister(`?statuts=${statuts}`);

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Erreur serveur' });
        // Ni la liste ni un filtre amputé ne sont partis.
        expect(chain.range).not.toHaveBeenCalled();
        expect(chain.or).not.toHaveBeenCalled();
        const lignes = [...journal.mock.calls, ...erreurs.mock.calls]
          .map((c) => String(c[0]))
          .join('\n');
        expect(lignes).toContain('api_route.error');
        expect(lignes).toContain('admin.collectes.list.filtre_statut');
        expect(lignes).toContain(
          `${MAX + 1} collectes à l'envoi abandonné, ${MAX} au plus`,
        );
      } finally {
        journal.mockRestore();
        erreurs.mockRestore();
      }
    },
  );

  it.each([['creee'], ['programmee']])(
    `statuts=%s, ${MAX} envois abandonnés : la liste est servie, le filtre les porte tous`,
    async (statuts) => {
      abandons(MAX);

      const res = await lister(`?statuts=${statuts}`);

      expect(res.status).toBe(200);
      expect(chain.range).toHaveBeenCalledTimes(1);
      expect(identifiantsDansLeFiltre()).toEqual(uuids(MAX));
    },
  );

  it(`aucun filtre de statut, ${MAX + 1} envois abandonnés : la liste est servie et chaque ligne dit si son envoi est abandonné`, async () => {
    abandons(MAX + 1);
    const [abandonnee] = uuids(1);
    const autre = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    chain.range.mockResolvedValueOnce({
      data: [{ id: abandonnee }, { id: autre }],
      error: null,
      count: 2,
    });

    const res = await lister('');

    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      data: { id: string; envoi_abandonne: boolean }[];
      total: number;
    };
    expect(corps.total).toBe(2);
    expect(corps.data.map((r) => [r.id, r.envoi_abandonne])).toEqual([
      [abandonnee, true],
      [autre, false],
    ]);
    expect(identifiantsDansLeFiltre()).toEqual([]);
  });

  it.each([
    ['creee,programmee', ['programmee']],
    ['creee,programmee,validee', ['programmee', 'validee']],
    ['validee,cloturee', ['validee', 'cloturee']],
  ])(
    `statuts=%s, ${MAX + 1} envois abandonnés : simple liste de statuts, aucun refus`,
    async (statuts, attendus) => {
      abandons(MAX + 1);

      const res = await lister(`?statuts=${statuts}`);

      expect(res.status).toBe(200);
      expect(chain.in).toHaveBeenCalledWith('statut', attendus);
      expect(identifiantsDansLeFiltre()).toEqual([]);
    },
  );
});
