/**
 * Modification du pax d'une collecte par l'équipe Savr (décision Val
 * 2026-10-21 ; §06.06 « Actions Admin/Ops », §05 R_pax_collecte) —
 * PATCH /api/v1/admin/collectes/[id].
 *
 * Prouve : le pax passe à fn_modifier_collecte seul ; un motif d'au moins 10
 * caractères est exigé et tracé dans l'audit ; un pax hors bornes est refusé
 * avant toute lecture ; le pax ne se modifie pas avec le statut ; la route reste
 * fermée aux rôles clients ; une modification sans pax reste tracée sans motif.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

const mockEnvoyer = vi.fn();
vi.mock('@/lib/envoi-immediat.js', () => ({
  envoyerOrdresSansAttendre: (...args: unknown[]) => mockEnvoyer(...args),
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

function setupAuth(role: string, userId = 'staff-1'): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function patch(body: unknown): Promise<Response> {
  const { PATCH } = await import('@/app/api/v1/admin/collectes/[id]/route.js');
  return PATCH(
    new NextRequest('http://localhost/api/v1/admin/collectes/col-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'col-1' }) },
  );
}

const AVANT = { id: 'col-1', statut: 'programmee', pax: 400 };
const MOTIF = 'Le traiteur a confirmé 650 convives par téléphone';

function preparerModification(apres: Record<string, unknown>): void {
  mockSupabaseChain.single.mockResolvedValueOnce({ data: AVANT, error: null });
  mockSupabaseChain.rpc.mockResolvedValueOnce({ data: apres, error: null });
}

function auditInsere(): Record<string, unknown> | undefined {
  const appel = mockSupabaseChain.insert.mock.calls.find(
    ([ligne]) => (ligne as { table_name?: string }).table_name === 'collectes',
  );
  return appel?.[0] as Record<string, unknown> | undefined;
}

describe('M0.6-pax-collecte-modification-admin — PATCH /admin/collectes/[id] { pax, motif }', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['admin_savr', 'ops_savr'])(
    '%s modifie le pax avec un motif : seul le pax part à fn_modifier_collecte, le motif est tracé dans l’audit',
    async (role) => {
      setupAuth(role);
      preparerModification({ ...AVANT, pax: 650 });

      const res = await patch({
        pax: 650,
        motif: `  ${MOTIF}  `,
        // Champ hostile hors liste : jamais transmis.
        prestataire_logistique_id: 'presta-x',
      });

      expect(res.status).toBe(200);
      expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
        'fn_modifier_collecte',
        {
          p_id: 'col-1',
          p_updates: { pax: 650 },
          p_champs_modifies: ['pax'],
        },
      );
      expect(auditInsere()).toStrictEqual({
        table_name: 'collectes',
        record_id: 'col-1',
        action: 'UPDATE',
        user_id: 'staff-1',
        motif: MOTIF,
        old_values: AVANT,
        new_values: { ...AVANT, pax: 650 },
      });
      // Une commande existe peut-être : l'ordre de modification part au clic.
      expect(mockEnvoyer).toHaveBeenCalledWith('col-1');
    },
  );

  it.each([
    ['absent', undefined],
    ['vide', ''],
    ['trop court (9 caractères)', '123456789'],
    ['fait de blancs', '              '],
  ])('motif %s → 422, rien n’est lu ni écrit', async (_cas, motif) => {
    setupAuth('admin_savr');
    const res = await patch(
      motif === undefined ? { pax: 650 } : { pax: 650, motif },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Un motif d’au moins 10 caractères est requis pour modifier le nombre de convives',
    );
    expect(mockSupabaseChain.from).not.toHaveBeenCalled();
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 0],
    ['au-delà du plafond (100 001)', 100001],
    ['décimal', 12.5],
    ['en texte', '650'],
    ['null', null],
  ])(
    'pax %s → 422 sur le champ pax, rien n’est lu ni écrit',
    async (_cas, pax) => {
      setupAuth('admin_savr');
      const res = await patch({ pax, motif: MOTIF });
      expect(res.status).toBe(422);
      expect(
        ((await res.json()) as { champs_invalides: string[] }).champs_invalides,
      ).toEqual(['pax']);
      expect(mockSupabaseChain.from).not.toHaveBeenCalled();
      expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
    },
  );

  it('pax 1 et 100 000 (bornes) sont acceptés', async () => {
    for (const pax of [1, 100000]) {
      vi.clearAllMocks();
      setupAuth('admin_savr');
      preparerModification({ ...AVANT, pax });
      const res = await patch({ pax, motif: MOTIF });
      expect(res.status, String(pax)).toBe(200);
    }
  });

  it('pax et statut dans la même requête → 422, rien n’est lu ni écrit', async () => {
    setupAuth('admin_savr');
    const res = await patch({ pax: 650, statut: 'validee', motif: MOTIF });
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.from).not.toHaveBeenCalled();
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it.each([
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ])('%s → 403, rien n’est lu ni écrit', async (role) => {
    setupAuth(role);
    const res = await patch({ pax: 650, motif: MOTIF });
    expect(res.status).toBe(403);
    expect(mockSupabaseChain.from).not.toHaveBeenCalled();
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it('une modification sans pax reste tracée sans motif (inchangé)', async () => {
    setupAuth('admin_savr');
    preparerModification({ ...AVANT, heure_collecte: '21:30:00' });
    const res = await patch({ heure_collecte: '21:30', motif: MOTIF });
    expect(res.status).toBe(200);
    expect(auditInsere()).not.toHaveProperty('motif');
  });
});
