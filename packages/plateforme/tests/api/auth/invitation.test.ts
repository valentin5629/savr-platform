/**
 * POST /api/auth/invitation — choix du mot de passe depuis le lien d'invitation
 * (lien Savr valable 7 jours, à usage unique ; décision Val 2026-10-28).
 *
 * Ce que ces tests garantissent : le mot de passe n'est posé que pour le compte
 * désigné par un jeton valide, non expiré, dont le nonce est encore celui du
 * compte (lien ni déjà utilisé ni remplacé), sur un compte actif, avec la
 * politique de mot de passe ; après usage, le nonce est effacé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUserById = vi.fn();
const mockUpdateUserById = vi.fn();
const mockProfil = vi.fn();

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    auth: {
      admin: {
        getUserById: (...a: unknown[]) => mockGetUserById(...a),
        updateUserById: (...a: unknown[]) => mockUpdateUserById(...a),
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => mockProfil() }),
      }),
    }),
  }),
}));

const MDP = 'MotDePasse1!x';

async function jeton(options: { nonce?: string; expireA?: number } = {}) {
  const { creerJetonInvitation, DUREE_INVITATION_MS } =
    await import('@/lib/auth/jeton-invitation.js');
  return creerJetonInvitation({
    userId: 'u-1',
    nonce: options.nonce ?? 'nonce-1',
    expireA: options.expireA ?? Date.now() + DUREE_INVITATION_MS,
  });
}

async function poster(body: unknown) {
  const { POST } = await import('@/app/api/auth/invitation/route.js');
  return POST(
    new NextRequest('http://localhost/api/auth/invitation', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'cle-de-service-de-test');
  mockGetUserById.mockResolvedValue({
    data: {
      user: {
        id: 'u-1',
        email: 'jeanne@exemple.fr',
        app_metadata: { invitation_nonce: 'nonce-1' },
      },
    },
    error: null,
  });
  mockProfil.mockResolvedValue({
    data: { prenom: 'Jeanne', actif: true },
    error: null,
  });
  mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
});

describe('POST /api/auth/invitation', () => {
  it('lien valide : pose le mot de passe et efface le nonce (usage unique)', async () => {
    const res = await poster({ jeton: await jeton(), mot_de_passe: MDP });
    expect(res.status).toBe(200);
    expect(mockGetUserById).toHaveBeenCalledWith('u-1');
    expect(mockUpdateUserById).toHaveBeenCalledWith('u-1', {
      password: MDP,
      app_metadata: { invitation_nonce: null },
    });
  });

  it('lien expiré : 410, rien n’est écrit', async () => {
    const res = await poster({
      jeton: await jeton({ expireA: Date.now() - 1 }),
      mot_de_passe: MDP,
    });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ motif: 'expire' });
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('lien déjà utilisé ou remplacé (nonce différent) : 410, rien n’est écrit', async () => {
    const res = await poster({
      jeton: await jeton({ nonce: 'ancien-nonce' }),
      mot_de_passe: MDP,
    });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ motif: 'utilise' });
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('nonce effacé (mot de passe déjà choisi) : 410', async () => {
    mockGetUserById.mockResolvedValue({
      data: { user: { id: 'u-1', app_metadata: {} } },
      error: null,
    });
    const res = await poster({ jeton: await jeton(), mot_de_passe: MDP });
    expect(res.status).toBe(410);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('compte désactivé depuis l’invitation : 410 inactif', async () => {
    mockProfil.mockResolvedValue({
      data: { prenom: 'Jeanne', actif: false },
      error: null,
    });
    const res = await poster({ jeton: await jeton(), mot_de_passe: MDP });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ motif: 'inactif' });
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('jeton falsifié ou absent : 400, aucun compte lu', async () => {
    for (const j of ['faux.jeton', '', undefined]) {
      const res = await poster({ jeton: j, mot_de_passe: MDP });
      expect(res.status).toBe(400);
    }
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('mot de passe trop faible : 422, rien n’est écrit', async () => {
    const res = await poster({ jeton: await jeton(), mot_de_passe: 'court' });
    expect(res.status).toBe(422);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('mot de passe non textuel : 422', async () => {
    const res = await poster({ jeton: await jeton(), mot_de_passe: 12345 });
    expect(res.status).toBe(422);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });
});
