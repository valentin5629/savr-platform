/**
 * Annulation par un client : fenêtre de concurrence avec la relève MTS-1.
 *
 * La route lit la collecte « programmée » (ou validée, ou brouillon), puis la
 * relève la fait passer en cours avant l'écriture. La RPC
 * fn_annuler_collecte_client relit le statut sous le verrou et refuse
 * (ANNULATION_CLIENT_STATUT, prouvé en base par
 * supabase/tests/annulation_client_garde_statut.test.sql). La route répond 409 :
 * aucun ordre n'est envoyé au prestataire, aucun email ne part.
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
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit', 'insert']) {
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
const mockEnvoyer = vi.fn();
const mockNotifierAdmin = vi.fn().mockResolvedValue(undefined);

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
vi.mock('@/lib/envoi-immediat.js', () => ({
  envoyerOrdresSansAttendre: (...a: unknown[]) => mockEnvoyer(...a),
  envoyerOrdresEvenementSansAttendre: (...a: unknown[]) => mockEnvoyer(...a),
}));
vi.mock('@/lib/notifications/traiteur-operationnel.js', () => ({
  notifierAdminAnnulation: (...a: unknown[]) => mockNotifierAdmin(...a),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: 'org-1' }),
      },
    },
    error: null,
  });
}

const ROUTES = [
  ['traiteur', 'traiteur_manager'],
  ['agence', 'agence'],
  ['gestionnaire', 'gestionnaire_lieux'],
] as const;

const MODULES = {
  traiteur: () =>
    import('@/app/api/v1/traiteur/collectes/[id]/annulation/route.js'),
  agence: () =>
    import('@/app/api/v1/agence/collectes/[id]/annulation/route.js'),
  gestionnaire: () =>
    import('@/app/api/v1/gestionnaire/collectes/[id]/annulation/route.js'),
};

async function annuler(espace: keyof typeof MODULES) {
  const { POST } = await MODULES[espace]();
  return POST(
    new NextRequest(
      `http://localhost/api/v1/${espace}/collectes/c1/annulation`,
      {
        method: 'POST',
        body: JSON.stringify({ motif: 'x' }),
        headers: { 'content-type': 'application/json' },
      },
    ),
    { params: Promise.resolve({ id: 'c1' }) },
  );
}

// Ce que la route lit, avant que la relève ne change le statut.
function lireAvantLaReleve(statut: string) {
  rls.push({
    data: {
      id: 'c1',
      type: 'anti_gaspi',
      statut,
      statut_tms: 'acceptee',
      date_collecte: '2030-01-01',
      heure_collecte: '08:00:00',
      evenement: {
        created_by: 'u-prog',
        organisation_id: 'org-1',
        nom_evenement: 'Gala',
        organisation: { nom: 'Org' },
        lieu: { nom: 'Salle' },
      },
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
});

describe('annulation cliente — collecte passée en cours après la lecture', () => {
  it.each(
    ROUTES.flatMap(([espace, role]) =>
      ['brouillon', 'programmee', 'validee'].map(
        (statut) => [espace, role, statut] as const,
      ),
    ),
  )(
    '%s (%s), lue %s puis passée en_cours : 409, ni E3 envoyé ni email',
    async (espace, role, statut) => {
      setupAuth(role);
      lireAvantLaReleve(statut);
      // Sous le verrou, la RPC voit la collecte en cours et refuse.
      admin.push({
        data: null,
        error: {
          code: 'P0001',
          message:
            'ANNULATION_CLIENT_STATUT: une collecte au statut en_cours ne peut plus être annulée par le client',
        },
      });

      const res = await annuler(espace);

      expect(res.status).toBe(409);
      expect(admin.__calls.rpc).toEqual([
        ['fn_annuler_collecte_client', { p_id: 'c1', p_motif: 'x' }],
      ]);
      // Rien ne part : ni ordre au prestataire, ni confirmation, ni alerte Admin.
      expect(mockEnvoyer).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(mockNotifierAdmin).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES)(
    '%s (%s) : toute autre erreur de la RPC reste une erreur serveur (500), sans envoi',
    async (espace, role) => {
      setupAuth(role);
      lireAvantLaReleve('programmee');
      admin.push({ data: null, error: { code: 'XX000', message: 'boom' } });

      const res = await annuler(espace);

      expect(res.status).toBe(500);
      expect(mockEnvoyer).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES)(
    '%s (%s) : statut inchangé, annulation aboutie et ordre envoyé',
    async (espace, role) => {
      setupAuth(role);
      lireAvantLaReleve('programmee');
      admin.push({ data: { id: 'c1' }, error: null });

      const res = await annuler(espace);

      expect(res.status).toBe(200);
      expect(mockEnvoyer).toHaveBeenCalledWith('c1');
    },
  );
});
