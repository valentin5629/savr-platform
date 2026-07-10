/**
 * Garde anti-régression — schéma `plateforme` sur les routes dashboard client.
 *
 * Les 4 routes de dashboard client recréent leur propre client Supabase en ligne
 * (`createServerClient` de @supabase/ssr) au lieu de passer par le helper
 * `createSupabaseServerClient` (api-auth.ts). Si l'option `db: { schema:
 * 'plateforme' }` est oubliée, supabase-js envoie `Accept-Profile: public` et
 * cible `public.v_kpi_*` → PGRST205 « table not found » → 500 → dashboard vide.
 *
 * Ce bug était INVISIBLE aux tests existants : leur mock de `@supabase/ssr`
 * remplace entièrement `createServerClient` et ignore les options. Ici on mocke
 * `createServerClient` en `vi.fn` et on vérifie que CHAQUE appel (le helper
 * requireUser ET le client inline de la route) reçoit bien le schéma `plateforme`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Client Supabase factice : auth + chaîne thenable `from()` + `rpc()`.
function makeStubClient() {
  const result = { data: [] as unknown[], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'gte', 'lte', 'order']) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (r: unknown) => unknown) => resolve(result);
  chain.rpc = () => Promise.resolve(result);
  // BL-P3-02 : kpi-traiteur lit organisations.tarif_refacture_pax_zd (maybeSingle).
  chain.maybeSingle = () =>
    Promise.resolve({ data: { tarif_refacture_pax_zd: 1.5 }, error: null });
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: currentJwt } },
          error: null,
        }),
    },
    from: (...a: unknown[]) =>
      (chain.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (chain.rpc as (...x: unknown[]) => unknown)(...a),
  };
}

let currentJwt = '';
function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const createServerClientMock = vi.fn((..._args: unknown[]) => makeStubClient());

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...a: unknown[]) => createServerClientMock(...a),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const ROUTES = [
  {
    nom: 'kpi-traiteur',
    chemin: '@/app/api/v1/dashboards/kpi-traiteur/route.js',
    role: 'traiteur_manager',
    url: '/api/v1/dashboards/kpi-traiteur?from=2025-10-31&to=2026-06-17&type=zero_dechet',
  },
  {
    nom: 'kpi-lieu',
    chemin: '@/app/api/v1/dashboards/kpi-lieu/route.js',
    role: 'gestionnaire_lieux',
    url: '/api/v1/dashboards/kpi-lieu?from=2025-10-31&to=2026-06-17',
  },
  {
    nom: 'kpi-client-organisateur',
    chemin: '@/app/api/v1/dashboards/kpi-client-organisateur/route.js',
    role: 'client_organisateur',
    url: '/api/v1/dashboards/kpi-client-organisateur?from=2025-10-31&to=2026-06-17',
  },
  {
    nom: 'benchmark',
    chemin: '@/app/api/v1/dashboards/benchmark/route.js',
    role: 'traiteur_manager',
    url: '/api/v1/dashboards/benchmark?bracket=M',
  },
] as const;

describe('dashboards — garde schéma plateforme', () => {
  for (const r of ROUTES) {
    it(`dashboards_schema_${r.nom} — createServerClient cible le schéma plateforme`, async () => {
      currentJwt = makeJwt({
        user_role: r.role,
        organisation_id: 'org-1',
      });
      const { GET } = (await import(r.chemin)) as {
        GET: (req: NextRequest) => Promise<Response>;
      };

      const res = await GET(makeReq(r.url));

      // La route ne 500 pas (auth OK, requête exécutée jusqu'au bout).
      expect(res.status).toBe(200);

      // Au moins 2 clients créés : helper requireUser + client inline de la route.
      expect(createServerClientMock.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      );

      // CHAQUE client doit cibler explicitement le schéma `plateforme`.
      for (const call of createServerClientMock.mock.calls) {
        const options = call[2] as { db?: { schema?: string } } | undefined;
        expect(options?.db?.schema).toBe('plateforme');
      }
    });
  }
});
