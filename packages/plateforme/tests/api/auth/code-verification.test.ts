/**
 * Routes du code de vérification de l'équipe Savr (décision Val 2026-11-04) :
 *  - POST /api/auth/code-verification/activation : QR code d'un nouveau code ;
 *  - POST /api/auth/code-verification/verification : saisie du code.
 *
 * Seules routes qui acceptent une session de l'équipe Savr sans code. Points
 * épinglés : réservées à l'équipe Savr, facteur choisi côté serveur (jamais le
 * `factor_id` du client quand un code est actif), défi + vérification dans le
 * même appel, aucun texte de Supabase renvoyé, réponses jamais mises en cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { logger } from '@savr/shared/src/logger/index.js';

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockEnroll = vi.fn();
const mockUnenroll = vi.fn();
const mockChallengeAndVerify = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
      mfa: {
        enroll: mockEnroll,
        unenroll: mockUnenroll,
        challengeAndVerify: mockChallengeAndVerify,
      },
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

type Facteur = { id: string; factor_type: string; status: string };

function connecte(role: string, factors: Facteur[] = [], aal = 'aal1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'u-1', factors } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role, aal }) } },
  });
}

const ACTIF: Facteur = {
  id: 'f-actif',
  factor_type: 'totp',
  status: 'verified',
};
const EN_COURS: Facteur = {
  id: 'f-en-cours',
  factor_type: 'totp',
  status: 'unverified',
};

function post(chemin: string, body?: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/auth/code-verification/${chemin}`,
    {
      method: 'POST',
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUnenroll.mockResolvedValue({ data: {}, error: null });
  mockEnroll.mockResolvedValue({
    data: {
      id: 'f-nouveau',
      type: 'totp',
      totp: {
        qr_code: 'data:image/svg+xml;utf-8,<svg fill="#000"></svg>',
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/Savr:a@gosavr.io?secret=JBSWY3DPEHPK3PXP',
      },
    },
    error: null,
  });
  mockChallengeAndVerify.mockResolvedValue({ data: {}, error: null });
});

async function activation() {
  const { POST } =
    await import('@/app/api/auth/code-verification/activation/route.js');
  return POST(post('activation'));
}

async function verification(body: unknown) {
  const { POST } =
    await import('@/app/api/auth/code-verification/verification/route.js');
  return POST(post('verification', body));
}

describe('activation du code', () => {
  it('sans session → 401, rien créé', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await activation()).status).toBe(401);
    expect(mockEnroll).not.toHaveBeenCalled();
  });

  it.each(['traiteur_manager', 'client_organisateur', 'agence'])(
    'client %s → 403, rien créé (aucun code pour les clients)',
    async (role) => {
      connecte(role);
      expect((await activation()).status).toBe(403);
      expect(mockEnroll).not.toHaveBeenCalled();
    },
  );

  it('code déjà actif → 409, aucun second code (changer de téléphone = réinitialisation par un autre admin)', async () => {
    connecte('admin_savr', [ACTIF]);
    expect((await activation()).status).toBe(409);
    expect(mockEnroll).not.toHaveBeenCalled();
    expect(mockUnenroll).not.toHaveBeenCalled();
  });

  it('admin sans code : activations abandonnées retirées, QR code réencodé, clé rendue, sans cache', async () => {
    connecte('admin_savr', [EN_COURS]);
    const res = await activation();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mockUnenroll).toHaveBeenCalledWith({ factorId: 'f-en-cours' });
    expect(mockEnroll).toHaveBeenCalledWith(
      expect.objectContaining({ factorType: 'totp', issuer: 'Savr' }),
    );
    const corps = (await res.json()) as Record<string, string>;
    expect(corps.factor_id).toBe('f-nouveau');
    expect(corps.secret).toBe('JBSWY3DPEHPK3PXP');
    // `#` réencodé : l'image n'est plus coupée au premier `#` du SVG.
    expect(corps.qr_code).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg fill="#000"></svg>')}`,
    );
  });

  it('ops_savr est aussi soumis au code (équipe Savr)', async () => {
    connecte('ops_savr');
    expect((await activation()).status).toBe(200);
  });

  it('échec Supabase → 502 sans texte tiers', async () => {
    connecte('admin_savr');
    mockEnroll.mockResolvedValue({
      data: null,
      error: { code: 'mfa_totp_enroll_not_enabled', message: 'SENTINELLE' },
    });
    const res = await activation();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('SENTINELLE');
  });
});

describe('saisie du code', () => {
  it.each([['12345'], ['abcdef'], [undefined]])(
    'code %j mal formé → 422 avant tout appel',
    async (code) => {
      connecte('admin_savr', [ACTIF]);
      expect((await verification({ code })).status).toBe(422);
      expect(mockChallengeAndVerify).not.toHaveBeenCalled();
    },
  );

  it('sans session → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await verification({ code: '123456' })).status).toBe(401);
  });

  it('client → 403, aucune vérification', async () => {
    connecte('gestionnaire_lieux', [ACTIF]);
    expect((await verification({ code: '123456' })).status).toBe(403);
    expect(mockChallengeAndVerify).not.toHaveBeenCalled();
  });

  it('code actif : c’est LUI qui est vérifié, le factor_id du client est ignoré', async () => {
    connecte('admin_savr', [ACTIF, EN_COURS]);
    const res = await verification({
      code: '123 456',
      factor_id: 'f-en-cours',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mockChallengeAndVerify).toHaveBeenCalledWith({
      factorId: 'f-actif',
      code: '123456',
    });
  });

  it('activation : le factor_id doit être l’activation en cours de CE compte', async () => {
    connecte('admin_savr', [EN_COURS]);
    expect(
      (await verification({ code: '123456', factor_id: 'f-autre-compte' }))
        .status,
    ).toBe(409);
    expect(mockChallengeAndVerify).not.toHaveBeenCalled();

    expect(
      (await verification({ code: '123456', factor_id: 'f-en-cours' })).status,
    ).toBe(200);
    expect(mockChallengeAndVerify).toHaveBeenCalledWith({
      factorId: 'f-en-cours',
      code: '123456',
    });
  });

  it('mauvais code → 422, message Savr (pas celui de Supabase)', async () => {
    connecte('admin_savr', [ACTIF]);
    mockChallengeAndVerify.mockResolvedValue({
      data: null,
      error: {
        code: 'mfa_verification_failed',
        status: 422,
        message: 'SENTINELLE',
      },
    });
    const res = await verification({ code: '123456' });
    expect(res.status).toBe(422);
    const corps = JSON.stringify(await res.json());
    expect(corps).toContain('Code incorrect');
    expect(corps).not.toContain('SENTINELLE');
  });

  it('trop de tentatives → 429', async () => {
    connecte('admin_savr', [ACTIF]);
    mockChallengeAndVerify.mockResolvedValue({
      data: null,
      error: { code: 'over_request_rate_limit', status: 429, message: 'x' },
    });
    expect((await verification({ code: '123456' })).status).toBe(429);
  });

  it('panne Supabase → 502 sans texte tiers', async () => {
    connecte('admin_savr', [ACTIF]);
    mockChallengeAndVerify.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', status: 500, message: 'SENTINELLE' },
    });
    const res = await verification({ code: '123456' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('SENTINELLE');
  });
});

// §07/01 : événements de journal de la sécurité (surveillance des tentatives).
describe('code de vérification — événements de journal', () => {
  it('activation : auth.code_verification_activation_demandee', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    connecte('admin_savr');
    await activation();
    expect(info).toHaveBeenCalledWith(
      'auth.code_verification_activation_demandee',
      { user_id: 'u-1' },
    );
  });

  it('activation en panne : auth.code_verification_activation_echec', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    connecte('admin_savr');
    mockEnroll.mockResolvedValue({
      data: null,
      error: { code: 'mfa_totp_enroll_not_enabled', message: 'x' },
    });
    await activation();
    expect(error).toHaveBeenCalledWith(
      'auth.code_verification_activation_echec',
      { user_id: 'u-1', code: 'mfa_totp_enroll_not_enabled' },
    );
  });

  it('code accepté : auth.code_verification_ok', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    connecte('admin_savr', [ACTIF]);
    await verification({ code: '123456' });
    expect(info).toHaveBeenCalledWith('auth.code_verification_ok', {
      user_id: 'u-1',
      activation: false,
    });
  });

  it('code refusé : auth.code_verification_echec avec l’IP', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    connecte('admin_savr', [ACTIF]);
    mockChallengeAndVerify.mockResolvedValue({
      data: null,
      error: { code: 'mfa_verification_failed', status: 422, message: 'x' },
    });
    const { POST } =
      await import('@/app/api/auth/code-verification/verification/route.js');
    await POST(
      new NextRequest(
        'http://localhost/api/auth/code-verification/verification',
        {
          method: 'POST',
          body: JSON.stringify({ code: '123456' }),
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.7',
          },
        },
      ),
    );
    expect(warn).toHaveBeenCalledWith('auth.code_verification_echec', {
      user_id: 'u-1',
      ip: '203.0.113.7',
      activation: false,
      code: 'mfa_verification_failed',
    });
  });
});
