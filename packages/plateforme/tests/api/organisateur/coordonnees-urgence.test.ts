/**
 * Demande urgente des coordonnées du chauffeur depuis la fiche événement du
 * client organisateur (décision Val 2026-11-12 : chauffeur et demande urgente
 * pour tous les utilisateurs). Même logique que les trois autres espaces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeClient } from '../helpers/fiche-client-mock';

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));

const params = { params: Promise.resolve({ id: 'c1' }) };
const poster = async () => {
  const { POST } =
    await import('@/app/api/v1/organisateur/collectes/[id]/coordonnees-urgence/route.js');
  return POST(
    new NextRequest(
      'http://localhost/api/v1/organisateur/collectes/c1/coordonnees-urgence',
      { method: 'POST' },
    ),
    params,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: {
      userId: 'user-o',
      role: 'client_organisateur',
      organisationId: 'org-client',
    },
  });
});

describe('Organisateur / demande urgente des coordonnées', () => {
  it('ORGA/urgence_ok — alerte créée pour une collecte visible, rôle client organisateur seul', async () => {
    rls.results.collectes = {
      data: {
        id: 'c1',
        statut: 'validee',
        date_collecte: '2026-10-28',
        heure_collecte: null,
        evenement: { lieu: { nom: 'Paris Expo' } },
      },
      error: null,
    };
    const res = await poster();
    expect(res.status).toBe(200);
    expect(admin.inserts[0]?.table).toBe('alertes_admin');
    expect(mockRequireUser).toHaveBeenCalledWith(expect.anything(), [
      'client_organisateur',
    ]);
  });

  it('ORGA/urgence_cloisonnement — collecte invisible sous sa RLS : 404, aucune écriture', async () => {
    rls.results.collectes = { data: null, error: null };
    const res = await poster();
    expect(res.status).toBe(404);
    expect(admin.calls).toHaveLength(0);
  });

  it('ORGA/urgence_refus_role — autre rôle : réponse de la garde, aucune lecture', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireUser.mockResolvedValue({
      error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }),
    });
    const res = await poster();
    expect(res.status).toBe(403);
    expect(rls.calls).toHaveLength(0);
  });
});
