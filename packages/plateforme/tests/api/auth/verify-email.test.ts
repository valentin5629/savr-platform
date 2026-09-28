/**
 * GET /api/auth/verify-email — clic sur le lien d'activation.
 *
 * Ce que ces tests garantissent, au-delà de l'envoi du mail de bienvenue :
 * le clic sur le lien est le SEUL moment du parcours qui prouve que quelqu'un
 * possède réellement une adresse à un domaine donné. C'est donc ici que
 * `organisations_domaines_email.verifie_at` est posé — et c'est cette marque que
 * le signup exige désormais avant de rattacher un nouvel inscrit à une
 * organisation existante.
 *
 * Sans elle, une revendication de domaine faite sans aucune preuve (POST
 * /api/v1/traiteur/mon-organisation/domaines-email, ouvert à tout
 * traiteur_manager) suffisait à capturer les inscriptions suivantes de ce
 * domaine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Resp = { data?: unknown; error?: unknown };

let lastTable = '';
let updateCalls: Array<{ table: string; payload: Record<string, unknown> }> =
  [];
let eqCalls: Array<{ table: string; args: unknown[] }> = [];
let isCalls: Array<{ table: string; args: unknown[] }> = [];
const maybeSingleQueue: Record<string, Resp[]> = {};

const chain: Record<string, unknown> = {
  select: () => chain,
  eq: (...args: unknown[]) => {
    eqCalls.push({ table: lastTable, args });
    return chain;
  },
  is: (...args: unknown[]) => {
    isCalls.push({ table: lastTable, args });
    return chain;
  },
  update: vi.fn((payload: Record<string, unknown>) => {
    updateCalls.push({ table: lastTable, payload });
    return chain;
  }),
  maybeSingle: () =>
    Promise.resolve(
      maybeSingleQueue[lastTable]?.shift() ?? { data: null, error: null },
    ),
  then: (resolve: (v: Resp) => void) => resolve({ data: null, error: null }),
};

const mockAdmin = {
  from: vi.fn((table: string) => {
    lastTable = table;
    return chain;
  }),
};

const mockVerifyOtp = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { verifyOtp: mockVerifyOtp } }),
}));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ getAll: () => [] }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockAdmin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

function makeReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/auth/verify-email${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  lastTable = '';
  updateCalls = [];
  eqCalls = [];
  isCalls = [];
  for (const k of Object.keys(maybeSingleQueue)) delete maybeSingleQueue[k];
  mockVerifyOtp.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'marie@dalloyau.fr' } },
    error: null,
  });
  maybeSingleQueue['users'] = [
    { data: { prenom: 'Marie', organisation_id: 'org-1' }, error: null },
  ];
});

describe('M0.4 — verify-email : le clic prouve le domaine', () => {
  it('pose verifie_at sur le domaine de l’utilisateur, dans SON organisation seulement', async () => {
    const { GET } = await import('@/app/api/auth/verify-email/route.js');
    await GET(makeReq('?token_hash=tok&type=signup'));

    const maj = updateCalls.find(
      (c) => c.table === 'organisations_domaines_email',
    );
    expect(maj, 'verifie_at n’a pas été posé').toBeDefined();
    expect(typeof maj!.payload.verifie_at).toBe('string');

    // La marque confirme un rattachement EXISTANT : elle est bornée au domaine
    // de l'adresse vérifiée ET à l'organisation de l'utilisateur. Sans ces deux
    // filtres, vérifier son mail marquerait le domaine d'autrui comme prouvé.
    const filtres = eqCalls.filter(
      (c) => c.table === 'organisations_domaines_email',
    );
    expect(filtres).toEqual([
      {
        table: 'organisations_domaines_email',
        args: ['domaine', 'dalloyau.fr'],
      },
      {
        table: 'organisations_domaines_email',
        args: ['organisation_id', 'org-1'],
      },
    ]);
    // …et ne réécrit jamais une marque déjà posée.
    expect(
      isCalls.filter((c) => c.table === 'organisations_domaines_email'),
    ).toEqual([
      { table: 'organisations_domaines_email', args: ['verifie_at', null] },
    ]);
  });

  it('un lien invalide ne pose aucune marque et renvoie vers /login', async () => {
    const res = await (
      await import('@/app/api/auth/verify-email/route.js')
    ).GET(makeReq('?type=signup'));

    expect(res.headers.get('location')).toContain('/login?error=lien_invalide');
    expect(updateCalls).toHaveLength(0);
  });

  it('un token refusé ne pose aucune marque', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {},
      error: { message: 'expired' },
    });
    const res = await (
      await import('@/app/api/auth/verify-email/route.js')
    ).GET(makeReq('?token_hash=tok&type=signup'));

    expect(res.headers.get('location')).toContain('verification_echouee');
    expect(updateCalls).toHaveLength(0);
  });
});
