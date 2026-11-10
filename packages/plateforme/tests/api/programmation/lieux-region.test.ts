/**
 * Lieu créé depuis le formulaire de programmation : sa région est déduite du
 * code postal (choix C1, Val 2026-11-03). Sans elle, l'algorithme
 * d'attribution AG ne proposait ni association ni transporteur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/geocoding.js', () => ({
  geocodeAdresse: vi.fn().mockResolvedValue(null),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: 'traiteur_commercial',
          organisation_id: 'org-traiteur-1',
        }),
      },
    },
    error: null,
  });
  mockSupabaseChain.single.mockResolvedValue({
    data: { id: 'lieu-new', nom: 'Bureau', code_postal: '92400' },
    error: null,
  });
});

async function creerLieu(code_postal: string) {
  const { POST } = await import('@/app/api/v1/programmation/lieux/route.js');
  return POST(
    new NextRequest('http://localhost/api/v1/programmation/lieux', {
      method: 'POST',
      body: JSON.stringify({
        nom: 'Bureau',
        adresse_acces: '1 rue de Bezons',
        code_postal,
        ville: 'Courbevoie',
      }),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('Programmation / Lieu créé — région déduite du code postal', () => {
  it('92400 → idf', async () => {
    const res = await creerLieu('92400');
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'idf', actif: false }),
    );
  });

  it('69000 → province', async () => {
    const res = await creerLieu('69000');
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'province' }),
    );
  });
});

describe('Programmation / Lieu créé — véhicule max limité aux gabarits (Val 2026-11-10)', () => {
  it('un gabarit du seul véhicule souhaité → 422, aucun lieu créé', async () => {
    const { POST } = await import('@/app/api/v1/programmation/lieux/route.js');
    const res = await POST(
      new NextRequest('http://localhost/api/v1/programmation/lieux', {
        method: 'POST',
        body: JSON.stringify({
          nom: 'Bureau',
          adresse_acces: '1 rue de Bezons',
          code_postal: '92400',
          ville: 'Courbevoie',
          type_vehicule_max: 'camion_16m3_double',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  });
});
