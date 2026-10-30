/**
 * GET /api/v1/mon-organisation/logo — logo de SA propre organisation, affiché en
 * avatar dans l'en-tête de tous les espaces clients (Val 2026-10-30).
 * Couvre : les 5 rôles clients servis, staff et anonyme refusés, lecture bornée à
 * l'organisation du jeton, clé hors format = 404 sans lecture R2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };
const appels: Record<string, unknown[][]> = {};
let resultat: Result = { data: null, error: null };
const chaine: Record<string, unknown> = {};
for (const m of ['from', 'select', 'eq']) {
  chaine[m] = (...args: unknown[]) => {
    (appels[m] ??= []).push(args);
    return chaine;
  };
}
chaine.maybeSingle = () => Promise.resolve(resultat);

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) =>
      (chaine.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
const mockGetObject = vi.fn();
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  getObject: (...a: unknown[]) => mockGetObject(...a),
}));

import { GET } from '@/app/api/v1/mon-organisation/logo/route';

const LOGO_KEY = 'savr-dev/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png';

function connecter(role: string | null, organisationId = 'org-a') {
  mockGetUser.mockResolvedValue({
    data: { user: role ? { id: 'user-1' } : null },
    error: null,
  });
  const payload = Buffer.from(
    JSON.stringify({ user_role: role, organisation_id: organisationId }),
  ).toString('base64url');
  mockGetSession.mockResolvedValue({
    data: { session: role ? { access_token: `h.${payload}.s` } : null },
    error: null,
  });
}
const req = () =>
  new NextRequest('http://localhost/api/v1/mon-organisation/logo');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('R2_BUCKET_NAME', 'savr-dev');
  for (const k of Object.keys(appels)) delete appels[k];
  resultat = { data: { logo_url: LOGO_KEY }, error: null };
  mockGetObject.mockResolvedValue({
    body: new Uint8Array([1, 2, 3]),
    contentType: 'image/png',
  });
});

describe('GET /api/v1/mon-organisation/logo', () => {
  it.each([
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ])('%s : sert le logo de sa propre organisation', async (role) => {
    connecter(role, 'org-a');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(appels.from?.[0]).toEqual(['organisations']);
    expect(appels.eq?.[0]).toEqual(['id', 'org-a']);
    expect(mockGetObject).toHaveBeenCalledWith(
      'logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png',
    );
  });

  it.each(['admin_savr', 'ops_savr'])('%s : refusé', async (role) => {
    connecter(role);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('non connecté : 401', async () => {
    connecter(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('aucun logo : 404', async () => {
    connecter('gestionnaire_lieux');
    resultat = { data: { logo_url: null }, error: null };
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('clé hors format (autre préfixe R2) : 404 sans lecture R2', async () => {
    connecter('traiteur_manager');
    resultat = {
      data: { logo_url: 'savr-dev/bordereaux/x.pdf' },
      error: null,
    };
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });
});
