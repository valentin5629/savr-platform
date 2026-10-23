/**
 * M1.1b — PATCH /admin/evenements/[id] : l'édition événement Admin passe désormais
 * par fn_modifier_evenement (émet E2 par collecte dispatchée + recalcul volume) au
 * lieu d'un .update() direct silencieux (fix « trou Admin », décision Val 2026-06-26).
 *
 * Lot B1 (décision Val 2026-10-23) : le type d'événement et les contacts sont
 * portés par chaque collecte ; la route les refuse (422) avant toute écriture, et
 * fn_modifier_evenement n'émet plus d'E2 (aucun champ de l'événement ne part au
 * prestataire). Le titre du premier cas, cité par le manifeste M1.1b, est gardé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
  data: { id: 'e1', pax: 250 },
  error: null,
}));

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ rpc }),
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

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}
function makeReq(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/admin/evenements/e1', {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

beforeEach(() => vi.clearAllMocks());

describe('M1.1b / admin evenements PATCH', () => {
  it('M1.1b/admin_evenement_edit_emet_e2 — PATCH passe par fn_modifier_evenement', async () => {
    setupAuth('admin_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/evenements/[id]/route.js');
    const res = await PATCH(
      makeReq({ reference_affaire: 'AFF-250', nom_evenement: 'Gala 2031' }),
      {
        params: Promise.resolve({ id: 'e1' }),
      },
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'fn_modifier_evenement',
      expect.objectContaining({ p_id: 'e1' }),
    );
    const args = rpc.mock.calls[0]![1] as { p_champs_modifies: string[] };
    // Le pax n'est plus un champ de l'événement (décision Val 2026-10-20), ni le
    // type d'événement et les contacts (lot B1, 2026-10-23).
    expect([...args.p_champs_modifies].sort()).toEqual([
      'nom_evenement',
      'reference_affaire',
    ]);
  });

  // Lot B1 (décision Val 2026-10-23) : refusés plutôt qu'ignorés, et jamais
  // une écriture partielle des autres champs de la même requête.
  it.each([
    'type_evenement_id',
    'contact_principal_nom',
    'contact_principal_telephone',
    'contact_secours_nom',
    'contact_secours_telephone',
  ])(
    'M1.1b/admin_evenement_type_contacts_refuses — %s : 422 champs_verrouilles, fn_modifier_evenement jamais appelée',
    async (champ) => {
      setupAuth('admin_savr');
      const { PATCH } =
        await import('@/app/api/v1/admin/evenements/[id]/route.js');
      const res = await PATCH(
        makeReq({ reference_affaire: 'AFF-251', [champ]: 'valeur' }),
        { params: Promise.resolve({ id: 'e1' }) },
      );
      expect(res.status).toBe(422);
      const json = (await res.json()) as { champs_verrouilles?: string[] };
      expect(json.champs_verrouilles).toEqual([champ]);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('M1.1b/admin_evenement_edit_aucun_champ — 422 si rien à modifier', async () => {
    setupAuth('admin_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/evenements/[id]/route.js');
    const res = await PATCH(makeReq({ co2_net_kg: 9 }), {
      params: Promise.resolve({ id: 'e1' }),
    });
    expect(res.status).toBe(422);
  });
});
