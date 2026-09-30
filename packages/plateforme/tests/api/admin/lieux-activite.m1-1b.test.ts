/**
 * M1.1b — GET /api/v1/admin/lieux/[id]/activite (onglet « Activité » de la fiche
 * lieu, décision Val 2026-09-30 C3) : traiteurs opérant (§06.06 §7, « alimentée
 * auto via collectes ») + historique des écritures (audit_log table_name='lieux').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Résultat renvoyé par table ; chaque builder garde ses appels pour les assertions.
const resultats: Record<string, { data: unknown; error: unknown }> = {};
const builders: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
    b[m] = vi.fn(() => b);
  }
  b.then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) =>
    Promise.resolve(resultats[table] ?? { data: [], error: null }).then(
      resolve,
      reject,
    );
  builders[table] = b as Record<string, ReturnType<typeof vi.fn>>;
  return b;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: (t: string) => builder(t) }),
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

async function appeler(id = 'lieu-1') {
  const { GET } =
    await import('@/app/api/v1/admin/lieux/[id]/activite/route.js');
  return GET(
    new NextRequest(`http://localhost/api/v1/admin/lieux/${id}/activite`),
    { params: Promise.resolve({ id }) },
  );
}

describe('M1.1b / Lieux / Activité', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(resultats)) delete resultats[k];
    for (const k of Object.keys(builders)) delete builders[k];
  });

  it('M1.1b/lieux/activite — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await appeler();
    expect(res.status).toBe(401);
  });

  it('M1.1b/lieux/activite — 403 si rôle traiteur_manager', async () => {
    setupAuth('traiteur_manager');
    const res = await appeler();
    expect(res.status).toBe(403);
  });

  it('M1.1b/lieux/activite — traiteurs opérant agrégés par traiteur opérationnel, triés par nombre de collectes', async () => {
    setupAuth('ops_savr');
    resultats.evenements = {
      data: [
        {
          traiteur_operationnel_organisation_id: 'org-p',
          collectes: [{ count: 1 }],
        },
        {
          traiteur_operationnel_organisation_id: 'org-k',
          collectes: [{ count: 3 }],
        },
        {
          traiteur_operationnel_organisation_id: 'org-k',
          collectes: [{ count: 2 }],
        },
        // Événement sans collecte : n'en fait pas un traiteur opérant.
        {
          traiteur_operationnel_organisation_id: 'org-z',
          collectes: [{ count: 0 }],
        },
      ],
      error: null,
    };
    resultats.organisations = {
      data: [
        { id: 'org-k', nom: 'kaspia', raison_sociale: 'Kaspia' },
        { id: 'org-p', nom: 'Potel', raison_sociale: null },
      ],
      error: null,
    };

    const res = await appeler('lieu-7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      traiteurs: { id: string; nom: string; nb_collectes: number }[];
    };
    expect(body.traiteurs).toEqual([
      { id: 'org-k', nom: 'Kaspia', nb_collectes: 5 },
      { id: 'org-p', nom: 'Potel', nb_collectes: 1 },
    ]);
    expect(builders.evenements!.eq).toHaveBeenCalledWith('lieu_id', 'lieu-7');
    expect(builders.organisations!.in).toHaveBeenCalledWith('id', [
      'org-p',
      'org-k',
    ]);
  });

  it('M1.1b/lieux/activite — historique : audit_log du lieu, champs réellement modifiés et auteur', async () => {
    setupAuth('admin_savr');
    resultats.audit_log = {
      data: [
        {
          id: 'a3',
          created_at: '2026-09-25T08:00:00Z',
          user_id: 'u-trait',
          action: 'lieu_override_programmation',
          old_values: null,
          new_values: {
            evenement_id: 'e1',
            lieu_overrides: { acces_details: 'Code 1234' },
          },
          impersonator_id: null,
        },
        {
          id: 'a2',
          created_at: '2026-09-20T08:00:00Z',
          user_id: 'u-admin',
          action: 'UPDATE',
          old_values: {
            nom: 'Ancien',
            ville: 'Lyon',
            latitude: 1,
            updated_at: 'x',
            flux_autorises: ['zd'],
          },
          new_values: {
            nom: 'Nouveau',
            ville: 'Lyon',
            latitude: 2,
            updated_at: 'y',
            flux_autorises: ['zd'],
          },
          impersonator_id: 'u-imp',
        },
        {
          id: 'a1',
          created_at: '2026-09-01T08:00:00Z',
          user_id: 'u-inconnu',
          action: 'INSERT',
          old_values: null,
          new_values: { nom: 'Ancien' },
          impersonator_id: null,
        },
      ],
      error: null,
    };
    resultats.users = {
      data: [
        { id: 'u-admin', prenom: 'Val', nom: 'Leblan', email: 'v@x.io' },
        { id: 'u-trait', prenom: null, nom: null, email: 'chef@kaspia.fr' },
      ],
      error: null,
    };

    const res = await appeler('lieu-9');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      traiteurs: unknown[];
      historique_tronque: boolean;
      historique: {
        id: string;
        action: string;
        auteur: string | null;
        champs: string[];
        impersonation: boolean;
      }[];
    };
    expect(body.traiteurs).toEqual([]);
    expect(body.historique).toEqual([
      expect.objectContaining({
        id: 'a3',
        action: 'lieu_override_programmation',
        auteur: 'chef@kaspia.fr',
        champs: ['acces_details'],
        impersonation: false,
      }),
      // Colonnes techniques (latitude, updated_at) et valeurs inchangées écartées.
      expect.objectContaining({
        id: 'a2',
        action: 'UPDATE',
        auteur: 'Val Leblan',
        champs: ['nom'],
        impersonation: true,
      }),
      expect.objectContaining({
        id: 'a1',
        action: 'INSERT',
        auteur: null,
        champs: [],
      }),
    ]);
    expect(body.historique_tronque).toBe(false);
    expect(builders.audit_log!.eq).toHaveBeenCalledWith('table_name', 'lieux');
    expect(builders.audit_log!.eq).toHaveBeenCalledWith('record_id', 'lieu-9');
  });

  it('M1.1b/lieux/activite — historique tronqué signalé quand la limite de 200 écritures est atteinte', async () => {
    setupAuth('admin_savr');
    resultats.audit_log = {
      data: Array.from({ length: 200 }, (_, i) => ({
        id: `a${i}`,
        created_at: '2026-09-20T08:00:00Z',
        user_id: null,
        action: 'NORMALISE',
        old_values: null,
        new_values: { actif: true },
        impersonator_id: null,
      })),
      error: null,
    };

    const res = await appeler('lieu-9');
    const body = (await res.json()) as {
      historique: unknown[];
      historique_tronque: boolean;
    };
    expect(body.historique).toHaveLength(200);
    expect(body.historique_tronque).toBe(true);
    expect(builders.audit_log!.limit).toHaveBeenCalledWith(200);
  });
});
