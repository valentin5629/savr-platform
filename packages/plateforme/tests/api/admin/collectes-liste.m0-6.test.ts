/**
 * M0.6 — API GET /admin/collectes : prédicats de filtrage (BL-P1-BOA-05).
 * Verrouille le prédicat corrigé du chip « Non transmises TMS » (§06.06 §3 l.195 :
 * statut=programmee ET tms_reference IS NULL) + les filtres serveur ajoutés
 * (statut multi, info incomplète, organisation/lieu, rapport non consulté).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const chain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => chain,
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

function setupAuth(role = 'admin_savr') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function callGet(qs: string) {
  const { GET } = await import('@/app/api/v1/admin/collectes/route.js');
  return GET(new NextRequest(`http://localhost/api/v1/admin/collectes${qs}`));
}

describe('M0.6 — API GET collectes filtres (BL-P1-BOA-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it('M0.6 — chip « Non transmises TMS » : statut=programmee ET tms_reference IS NULL', async () => {
    await callGet('?chip=non_transmises');
    expect(chain.eq).toHaveBeenCalledWith('statut', 'programmee');
    expect(chain.is).toHaveBeenCalledWith('tms_reference', null);
    // Prédicat réaligné : plus de garde statut_tms='non_envoye' ni in(statut,[...])
    expect(chain.eq).not.toHaveBeenCalledWith('statut_tms', 'non_envoye');
    expect(chain.in).not.toHaveBeenCalled();
  });

  it('M0.6 — filtre statut multi → in(statut, [...])', async () => {
    await callGet('?statuts=cloturee,validee');
    expect(chain.in).toHaveBeenCalledWith('statut', ['cloturee', 'validee']);
  });

  it('M0.6 — filtre info_incomplete=true → eq(informations_completes,false)', async () => {
    await callGet('?info_incomplete=true');
    expect(chain.eq).toHaveBeenCalledWith('informations_completes', false);
  });

  it('M0.6 — filtres organisation_id / lieu_id sur la jointure événement', async () => {
    await callGet('?organisation_id=org-1&lieu_id=lieu-1');
    expect(chain.eq).toHaveBeenCalledWith(
      'evenements.organisation_id',
      'org-1',
    );
    expect(chain.eq).toHaveBeenCalledWith('evenements.lieu_id', 'lieu-1');
  });

  it('R24c — filtre « Traiteur » = traiteur_operationnel_id → eq(evenements.traiteur_operationnel_organisation_id)', async () => {
    await callGet('?traiteur_operationnel_id=trait-1');
    expect(chain.eq).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      'trait-1',
    );
  });

  it('R24c — périmètre drill-down perimetre_org_ids[] (UUID) → .or(programmateur OU opérateur) sur evenements', async () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await callGet(`?perimetre_org_ids[]=${a}&perimetre_org_ids[]=${b}`);
    const orCall = chain.or.mock.calls.find((c) =>
      String(c[0]).includes(`organisation_id.in.(${a},${b})`),
    );
    expect(orCall).toBeDefined();
    expect(String(orCall?.[0])).toContain(
      `traiteur_operationnel_organisation_id.in.(${a},${b})`,
    );
    expect(orCall?.[1]).toEqual({ referencedTable: 'evenements' });
  });

  it('R24c — périmètre ignore les ids non-UUID (défense en profondeur → pas de .or)', async () => {
    await callGet('?perimetre_org_ids[]=not-a-uuid');
    expect(
      chain.or.mock.calls.some((c) =>
        String(c[0]).includes('organisation_id.in.'),
      ),
    ).toBe(false);
  });

  it('M0.6 — filtre rapport_non_consulte=true → is(rapports_rse.consulte_par_user_at, null)', async () => {
    await callGet('?rapport_non_consulte=true');
    expect(chain.is).toHaveBeenCalledWith(
      'rapports_rse.consulte_par_user_at',
      null,
    );
  });
});
