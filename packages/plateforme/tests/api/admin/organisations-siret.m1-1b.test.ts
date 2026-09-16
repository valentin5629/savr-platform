/**
 * M1.1b — SIRET d'organisation : contrôle de FORMAT seul sur POST /admin/organisations
 * et PATCH /admin/organisations/[id] (CDC §06.06, modale « Nouvelle organisation »,
 * ligne SIRET). 14 chiffres, blancs tolérés puis retirés, vide ⇒ null, aucun
 * appel INSEE sur organisations.siret.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
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

function setupAuth(role: string) {
  const payload = Buffer.from(
    JSON.stringify({ user_role: role, organisation_id: null }),
  ).toString('base64url');
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-staff-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: `header.${payload}.sig` } },
    error: null,
  });
}

function makeReq(method: string, url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function post(siret: unknown) {
  mockSupabaseChain.single.mockResolvedValueOnce({
    data: { id: 'org-new', actif: true },
    error: null,
  });
  const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
  return POST(
    makeReq('POST', '/api/v1/admin/organisations', {
      nom: 'Kaspia',
      raison_sociale: 'Kaspia Réceptions',
      type: 'traiteur',
      email_principal: 'contact@kaspia.fr',
      ...(siret === undefined ? {} : { siret }),
    }),
  );
}

async function patch(body: Record<string, unknown>) {
  mockSupabaseChain.single.mockResolvedValueOnce({
    data: { id: 'org-1', actif: true },
    error: null,
  });
  const { PATCH } =
    await import('@/app/api/v1/admin/organisations/[id]/route.js');
  return PATCH(makeReq('PATCH', '/api/v1/admin/organisations/org-1', body), {
    params: Promise.resolve({ id: 'org-1' }),
  });
}

const insertPayload = () =>
  mockSupabaseChain.insert.mock.calls[0]?.[0] as Record<string, unknown>;
const updatePayload = () =>
  mockSupabaseChain.update.mock.calls[0]?.[0] as Record<string, unknown>;

// Saisies hors format : trop court, trop long, lettre, tiret (seuls les blancs
// sont tolérés), chiffres pleine chasse, nombre JSON (perd les zéros de tête).
const HORS_FORMAT: [string, unknown][] = [
  ['13 chiffres', '1234567890123'],
  ['15 chiffres', '123456789012345'],
  ['lettre', '1234567890123A'],
  ['tirets', '123-456-789-01234'],
  ['chiffres pleine chasse', '１２３４５６７８９０１２３４'],
  ['nombre JSON', 12345678901234],
];

describe('M1.1b / Organisations / SIRET — création (POST)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('ops_savr');
  });

  it('M1.1b/orgas/siret — POST : espaces retirés avant INSERT (14 chiffres)', async () => {
    const res = await post('123 456 789 00012');
    expect(res.status).toBe(201);
    expect(insertPayload().siret).toBe('12345678900012');
  });

  it.each(HORS_FORMAT)(
    'M1.1b/orgas/siret — POST : 422 champs_invalides si hors format (%s)',
    async (_cas, siret) => {
      const res = await post(siret);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ champs_invalides: ['siret'] });
      expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
    },
  );

  it('M1.1b/orgas/siret — POST : facultatif, vide ou blancs ⇒ null', async () => {
    const res = await post('   ');
    expect(res.status).toBe(201);
    expect(insertPayload().siret).toBeNull();
  });

  it('M1.1b/orgas/siret — POST : absent ⇒ non renseigné, sans 422', async () => {
    const res = await post(undefined);
    expect(res.status).toBe(201);
    expect(insertPayload().siret).toBeUndefined();
  });
});

describe('M1.1b / Organisations / SIRET — fiche (PATCH)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('admin_savr');
  });

  it('M1.1b/orgas/siret — PATCH : espaces retirés avant UPDATE (14 chiffres)', async () => {
    const res = await patch({ siret: ' 12345678900012 ' });
    expect(res.status).toBe(200);
    expect(updatePayload().siret).toBe('12345678900012');
  });

  it.each(HORS_FORMAT)(
    'M1.1b/orgas/siret — PATCH : 422 champs_invalides si hors format (%s)',
    async (_cas, siret) => {
      const res = await patch({ siret, raison_sociale: 'Autre' });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ champs_invalides: ['siret'] });
      // Rien n'est écrit, pas même les autres champs du body.
      expect(mockSupabaseChain.update).not.toHaveBeenCalled();
    },
  );

  it('M1.1b/orgas/siret — PATCH : vide ⇒ null (effacement)', async () => {
    const res = await patch({ siret: '' });
    expect(res.status).toBe(200);
    expect(updatePayload()).toEqual({ siret: null });
  });

  it('M1.1b/orgas/siret — PATCH : sans siret dans le body, la colonne n’est pas touchée', async () => {
    const res = await patch({ raison_sociale: 'Autre' });
    expect(res.status).toBe(200);
    expect(updatePayload()).not.toHaveProperty('siret');
  });
});

describe('M1.1b / Organisations / SIRET — null et absence d’INSEE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('admin_savr');
  });

  it('M1.1b/orgas/siret — POST : null ⇒ null', async () => {
    const res = await post(null);
    expect(res.status).toBe(201);
    expect(insertPayload().siret).toBeNull();
  });

  it('M1.1b/orgas/siret — PATCH : null ⇒ null (effacement)', async () => {
    const res = await patch({ siret: null });
    expect(res.status).toBe(200);
    expect(updatePayload()).toEqual({ siret: null });
  });

  it('M1.1b/orgas/siret — aucune des deux routes n’importe la vérification INSEE', () => {
    // Contrôle statique : un mock « jamais appelé » serait vrai d'office tant
    // que la route n'importe pas le module. On lit donc les sources.
    for (const chemin of [
      '../../../src/app/api/v1/admin/organisations/route.ts',
      '../../../src/app/api/v1/admin/organisations/[id]/route.ts',
    ]) {
      const src = readFileSync(new URL(chemin, import.meta.url), 'utf8');
      expect(src, chemin).toContain('normaliserSiretOrganisation');
      expect(src, chemin).not.toMatch(
        /api\/siret|verifySiret|SiretRevalidation/,
      );
    }
  });
});
