/**
 * M0.6 — GET /api/v1/admin/collectes/[id]/documents : champ `attente`.
 * §06.06 Bloc 3 « Documents » : tant qu'un document n'existe pas, la fiche dit
 * quand il est attendu. L'état est calculé par la route à partir du statut et de
 * `realisee_at` de la collecte, jamais par l'écran.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

let collecte: Record<string, unknown> | null = null;
const colonnesLues: string[] = [];

function requete(table: string) {
  const c = {
    select: (colonnes: string) => {
      if (table === 'collectes') colonnesLues.push(colonnes);
      return c;
    },
    eq: () => c,
    is: () => c,
    like: () => c,
    limit: () => c,
    order: () => c,
    maybeSingle: () =>
      Promise.resolve({
        data: table === 'collectes' ? collecte : null,
        error: null,
      }),
    then: (ok: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok),
  };
  return c;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => requete(table),
    schema: () => ({ from: (table: string) => requete(table) }),
  }),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: async () => 'https://r2.test/x',
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

// Un rôle client porte `organisation_id` : sans lui, le 403 viendrait de
// « Organisation manquante » et non de la garde de rôle de la route.
function connecter(claims: Record<string, unknown>): void {
  const jeton = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jeton } },
    error: null,
  });
}

async function lireDocuments(): Promise<Response> {
  const { GET } =
    await import('@/app/api/v1/admin/collectes/[id]/documents/route.js');
  return GET(
    new NextRequest('http://localhost/api/v1/admin/collectes/col-1/documents'),
    { params: Promise.resolve({ id: 'col-1' }) },
  );
}

describe('M0.6 — GET admin/collectes/[id]/documents : attente des documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    colonnesLues.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    connecter({ user_role: 'admin_savr' });
  });
  afterEach(() => vi.useRealTimers());

  it('M0.6 — collecte réalisée dont le traitement de nuit est passé : attente « en_retard » datée', async () => {
    collecte = { statut: 'realisee', realisee_at: '2026-09-30T23:00:00Z' };

    const res = await lireDocuments();

    expect(res.status).toBe(200);
    const corps = (await res.json()) as Record<string, unknown>;
    expect(corps.attente).toEqual({ etat: 'en_retard', jour: '2026-10-02' });
    expect(corps).toMatchObject({
      rapport: null,
      bordereau: null,
      attestation: null,
    });
    expect(colonnesLues).toEqual(['statut, realisee_at']);
  });

  it('M0.6 — collecte pas encore réalisée : attente « apres_collecte »', async () => {
    collecte = { statut: 'validee', realisee_at: null };
    const corps = (await (await lireDocuments()).json()) as {
      attente: unknown;
    };
    expect(corps.attente).toEqual({ etat: 'apres_collecte' });
  });

  it('M0.6 — collecte introuvable ou hors parcours : attente null', async () => {
    collecte = null;
    expect(
      ((await (await lireDocuments()).json()) as { attente: unknown }).attente,
    ).toBeNull();

    collecte = { statut: 'annulee', realisee_at: null };
    expect(
      ((await (await lireDocuments()).json()) as { attente: unknown }).attente,
    ).toBeNull();
  });

  it('M0.6 — rôle client : 403, rien n’est lu', async () => {
    connecter({ user_role: 'traiteur_manager', organisation_id: 'org-1' });
    collecte = { statut: 'realisee', realisee_at: '2026-09-30T23:00:00Z' };

    const res = await lireDocuments();

    expect(res.status).toBe(403);
    expect(colonnesLues).toEqual([]);
  });
});
