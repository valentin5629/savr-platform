/**
 * Options de la barre de filtres globale des dashboards (2026-10-30) :
 *  - GET /api/v1/dashboards/filtres (traiteur, agence, client organisateur) ;
 *  - GET /api/v1/admin/dashboard-client/filtres (équipe Savr).
 * Vérifie le périmètre de chaque rôle et qu'aucune option ne vient d'ailleurs que
 * des collectes que le rôle voit déjà.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const parTable: Record<string, Result[]> = {};
  const calls: { table: string; m: string; args: unknown[] }[] = [];
  let table = '';
  const chain: Record<string, unknown> = {
    pousser(t: string, r: Result) {
      (parTable[t] ??= []).push(r);
    },
    calls,
  };
  for (const m of [
    'select',
    'eq',
    'in',
    'gte',
    'gt',
    'not',
    'or',
    'order',
    'limit',
  ])
    chain[m] = (...args: unknown[]) => {
      calls.push({ table, m, args });
      return chain;
    };
  chain.from = (t: string) => {
    table = t;
    calls.push({ table, m: 'from', args: [t] });
    return chain;
  };
  chain.then = (ok: (r: Result) => unknown) =>
    ok(parTable[table]?.shift() ?? { data: [], error: null });
  return chain as Record<string, unknown> & {
    pousser(t: string, r: Result): void;
    calls: { table: string; m: string; args: unknown[] }[];
  };
}

let rls = makeChain();
let admin = makeChain();
let jwt = '';
const makeJwt = (c: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(c)).toString('base64url')}.s`;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'u1' } }, error: null }),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: jwt } },
          error: null,
        }),
    },
    from: (t: string) => (rls.from as (t: string) => unknown)(t),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (t: string) => (admin.from as (t: string) => unknown)(t),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

const role = (user_role: string, organisation_id = 'org-1') => {
  jwt = makeJwt({ user_role, organisation_id });
};
const req = (url: string) =>
  new NextRequest(`http://localhost${url}`, { method: 'GET' });

const collecte = (
  id: string,
  lieu: { id: string; nom: string },
  client: string | null,
  traiteur: string | null,
) => ({
  id,
  evenements: {
    nom_client_organisateur: client,
    traiteur_operationnel_organisation_id: traiteur,
    lieux: lieu,
  },
});

beforeEach(() => {
  rls = makeChain();
  admin = makeChain();
});

describe('GET /api/v1/dashboards/filtres', () => {
  it('traiteur : lieux et clients de ses événements, pas de liste Traiteurs', async () => {
    role('traiteur_manager');
    rls.pousser('collectes', {
      data: [
        collecte('a', { id: 'L2', nom: 'Pavillon' }, 'LVMH', 'org-1'),
        collecte('b', { id: 'L1', nom: 'Grand Palais' }, ' Dior ', 'org-1'),
        collecte('c', { id: 'L1', nom: 'Grand Palais' }, null, 'org-1'),
      ],
      error: null,
    });
    rls.pousser('types_evenements', {
      data: [{ id: 't1', libelle: 'Gala' }],
      error: null,
    });
    const { GET } = await import('@/app/api/v1/dashboards/filtres/route.js');
    const res = await GET(req('/api/v1/dashboards/filtres'));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lieux).toEqual([
      { id: 'L1', nom: 'Grand Palais' },
      { id: 'L2', nom: 'Pavillon' },
    ]);
    // Identifiant = nom tel que saisi (filtre à égalité exacte), libellé nettoyé.
    expect(data.clients).toEqual([
      { id: ' Dior ', nom: 'Dior' },
      { id: 'LVMH', nom: 'LVMH' },
    ]);
    // Brouillons et annulées écartés des options.
    expect(rls.calls).toContainEqual({
      table: 'collectes',
      m: 'not',
      args: ['statut', 'in', '(brouillon,annulee)'],
    });
    expect(data).not.toHaveProperty('traiteurs');
    expect(data.types).toEqual([{ id: 't1', libelle: 'Gala' }]);
    expect(rls.calls).toContainEqual({
      table: 'collectes',
      m: 'eq',
      args: ['evenements.organisation_id', 'org-1'],
    });
  });

  it('client organisateur : traiteurs nommés par la vue liste blanche, sans service_role', async () => {
    role('client_organisateur', 'org-co');
    rls.pousser('collectes', {
      data: [collecte('a', { id: 'L1', nom: 'Grand Palais' }, 'X', 'T1')],
      error: null,
    });
    rls.pousser('v_referentiel_traiteurs', {
      data: [{ id: 'T1', nom: 'Kaspia' }],
      error: null,
    });
    const { GET } = await import('@/app/api/v1/dashboards/filtres/route.js');
    const res = await GET(req('/api/v1/dashboards/filtres'));
    const { data } = await res.json();
    expect(data.traiteurs).toEqual([{ id: 'T1', nom: 'Kaspia' }]);
    expect(data).not.toHaveProperty('clients');
    expect(rls.calls).toContainEqual({
      table: 'collectes',
      m: 'eq',
      args: ['evenements.client_organisateur_organisation_id', 'org-co'],
    });
    expect(rls.calls).toContainEqual({
      table: 'v_referentiel_traiteurs',
      m: 'in',
      args: ['id', ['T1']],
    });
    expect(admin.calls).toEqual([]);
  });

  it('lecture en échec : 500, jamais des listes vides', async () => {
    role('agence');
    rls.pousser('collectes', { data: null, error: { message: 'boom' } });
    const { GET } = await import('@/app/api/v1/dashboards/filtres/route.js');
    const res = await GET(req('/api/v1/dashboards/filtres'));
    expect(res.status).toBe(500);
  });

  it('gestionnaire de lieux : refusé (il a sa propre route)', async () => {
    role('gestionnaire_lieux');
    const { GET } = await import('@/app/api/v1/dashboards/filtres/route.js');
    const res = await GET(req('/api/v1/dashboards/filtres'));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/admin/dashboard-client/filtres', () => {
  it('rôle client : refusé', async () => {
    role('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/filtres/route.js');
    const res = await GET(req('/api/v1/admin/dashboard-client/filtres'));
    expect(res.status).toBe(403);
  });

  it('Admin : options bornées aux organisations choisies', async () => {
    role('admin_savr', 'org-savr');
    const ORG = '11111111-1111-4111-8111-111111111111';
    admin.pousser('collectes', {
      data: [collecte('a', { id: 'L1', nom: 'Grand Palais' }, null, 'T1')],
      error: null,
    });
    admin.pousser('organisations', {
      data: [{ id: 'T1', nom: 'Kaspia' }],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/filtres/route.js');
    const res = await GET(
      req(
        `/api/v1/admin/dashboard-client/filtres?organisation_ids[]=${ORG}&organisation_ids[]=pas-un-uuid`,
      ),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lieux).toEqual([{ id: 'L1', nom: 'Grand Palais' }]);
    expect(data.traiteurs).toEqual([{ id: 'T1', nom: 'Kaspia' }]);
    expect(admin.calls).toContainEqual({
      table: 'collectes',
      m: 'or',
      args: [
        `organisation_id.in.(${ORG}),traiteur_operationnel_organisation_id.in.(${ORG})`,
        { referencedTable: 'evenements' },
      ],
    });
  });
});
