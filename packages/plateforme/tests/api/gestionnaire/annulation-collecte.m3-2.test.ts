/**
 * M3.2 — Annulation d'une collecte par le gestionnaire de lieux (décision Val
 * 2026-10-26) : ses propres programmations seulement, avec les règles de
 * l'agence (annulation directe en brouillon ou programmée, demande en validée,
 * refus sur un statut terminal). Jamais la collecte qu'un traiteur a
 * programmée sur l'un de ses lieux, que la RLS lui laisse pourtant lire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __queue: queue,
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit', 'update']) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
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
const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId = 'org-gest') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}
const URL = '/api/v1/gestionnaire/collectes/c1/annulation';
function appeler(corps: unknown = { motif: 'x' }) {
  return import('@/app/api/v1/gestionnaire/collectes/[id]/annulation/route.js').then(
    ({ POST }) =>
      POST(
        new NextRequest(`http://localhost${URL}`, {
          method: 'POST',
          body: JSON.stringify(corps),
          headers: { 'content-type': 'application/json' },
        }),
        { params: Promise.resolve({ id: 'c1' }) },
      ),
  );
}
function lire(statut: string, evenement: unknown) {
  rls.push({
    data: {
      id: 'c1',
      statut,
      statut_tms: 'non_envoye',
      date_collecte: '2030-01-01',
      heure_collecte: '08:00:00',
      evenement,
    },
    error: null,
  });
}

// Refus : rien n'est lu ni écrit par le client de service, aucun email ne part.
function rienNEstParti() {
  expect(admin.__calls.from ?? []).toEqual([]);
  expect(admin.__calls.rpc ?? []).toEqual([]);
  expect(mockSendEmail).not.toHaveBeenCalled();
}

const SIENNE = {
  created_by: 'u-prog',
  organisation_id: 'org-gest',
  organisation: { nom: 'Lieux Martin' },
  lieu: { nom: 'Salle Wagram' },
};
// Compte lu après l'écriture : le programmateur (annulation directe) ou le
// demandeur (demande d'annulation).
const COMPTE = {
  data: { email: 'prog@savr-test.local', prenom: 'Paul', nom: 'Martin' },
  error: null,
};
// Collecte qu'un traiteur a programmée sur un lieu du gestionnaire.
const TRAITEUR = {
  organisation_id: 'org-traiteur',
  organisation: { nom: 'Traiteur Dupont' },
};

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
});

describe('M3.2 / annulation par le gestionnaire de lieux', () => {
  it.each([
    ['programmée, événement en objet', 'programmee', SIENNE],
    ['programmée, événement en tableau', 'programmee', [SIENNE]],
    ['brouillon', 'brouillon', SIENNE],
  ])(
    'M3.2/gestionnaire_annulation_directe — sa propre programmation (%s) → annulee',
    async (_cas, statut, evenement) => {
      setupAuth('gestionnaire_lieux');
      lire(statut, evenement);
      admin.push({ data: { id: 'c1' }, error: null });
      admin.push(COMPTE);

      const res = await appeler();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { statut: 'annulee' } });
      expect(admin.__calls.rpc?.[0]).toEqual([
        'fn_modifier_collecte',
        {
          p_id: 'c1',
          p_updates: { statut: 'annulee', annulee_cote_savr_motif: 'x' },
          p_champs_modifies: ['statut'],
        },
      ]);
      // Template 5 : la confirmation part au programmateur, avec la date et le
      // lieu que le gabarit exige (l'équipe Savr reçoit le template 22).
      expect(mockSendEmail).toHaveBeenCalledWith(
        'annulation_collecte',
        'prog@savr-test.local',
        {
          prenom: 'Paul',
          date_collecte: '01/01/2030',
          heure_collecte: '08:00',
          lieu_nom: 'Salle Wagram',
          nom_evenement: '',
          motif: 'x',
          info_facturation: '',
        },
      );
      expect(admin.__calls.eq).toContainEqual(['id', 'u-prog']);
    },
  );

  it('M3.2/gestionnaire_annulation_demande — sa propre programmation validée → annulation_demandee', async () => {
    setupAuth('gestionnaire_lieux');
    lire('validee', SIENNE);
    admin.push({ data: { id: 'c1' }, error: null });
    admin.push(COMPTE);

    const res = await appeler({ motif: 'doublon <b>urgent</b>' });

    expect(await res.json()).toEqual({
      data: { statut: 'annulation_demandee' },
    });
    expect(admin.__calls.rpc?.[0]).toEqual([
      'fn_modifier_collecte',
      {
        p_id: 'c1',
        p_updates: {
          statut: 'annulation_demandee',
          annulee_cote_savr_motif: 'doublon <b>urgent</b>',
        },
        p_champs_modifies: ['statut'],
      },
    ]);
    expect(mockSendEmail).toHaveBeenCalledWith(
      'admin_demande_annulation',
      'contact@gosavr.io',
      expect.objectContaining({
        organisation_nom: 'Lieux Martin',
        demandeur_nom: 'Paul Martin',
        motif: 'doublon &lt;b&gt;urgent&lt;/b&gt;',
      }),
    );
  });

  it.each([
    ['programmée, collecte d’un traiteur sur son lieu', 'programmee', TRAITEUR],
    ['validée, collecte d’un traiteur sur son lieu', 'validee', TRAITEUR],
    ['brouillon, collecte d’un traiteur sur son lieu', 'brouillon', TRAITEUR],
    ['programmée, événement en tableau', 'programmee', [TRAITEUR]],
    ['programmée, événement non rendu par la lecture', 'programmee', null],
    ['programmée, événement en tableau vide', 'programmee', []],
  ])(
    'M3.2/gestionnaire_annulation_hors_programmations_403 — collecte lisible, pas la sienne (%s)',
    async (_cas, statut, evenement) => {
      setupAuth('gestionnaire_lieux');
      lire(statut, evenement);
      admin.push({ data: { id: 'c1' }, error: null });

      const res = await appeler();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Annulation non autorisée' });
      rienNEstParti();
    },
  );

  it.each([
    'en_cours',
    'realisee',
    'cloturee',
    'annulee',
    'annulation_demandee',
  ])(
    'M3.2/gestionnaire_annulation_statut_terminal_422 — %s : refus, rien n’est écrit',
    async (statut) => {
      setupAuth('gestionnaire_lieux');
      lire(statut, SIENNE);

      const res = await appeler();

      expect(res.status).toBe(422);
      rienNEstParti();
    },
  );

  it('M3.2/gestionnaire_annulation_collecte_introuvable_404 — hors de sa lecture', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: null, error: null });

    const res = await appeler();

    expect(res.status).toBe(404);
    rienNEstParti();
  });

  it.each(['traiteur_manager', 'agence', 'client_organisateur'])(
    'M3.2/gestionnaire_annulation_role_403 — %s refusé par la garde de rôle',
    async (role) => {
      setupAuth(role);
      lire('programmee', SIENNE);

      const res = await appeler();

      expect(res.status).toBe(403);
      rienNEstParti();
    },
  );
});
