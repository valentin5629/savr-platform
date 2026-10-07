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
  neq: vi.fn().mockReturnThis(),
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

  it('M0.6 — la liste sert tms_reference : l’action « Dispatcher » en dépend (kpi_a_dispatcher_predicat_unique)', async () => {
    await callGet('');
    // `estADispatcher` exige `tms_reference === null` : sans la colonne dans le
    // select, plus aucune ligne n'offrirait « Dispatcher ».
    const colonnes = String(chain.select.mock.calls[0]?.[0]);
    expect(colonnes).toMatch(/\btms_reference\b/);
    expect(colonnes).toMatch(/\bstatut_tms\b/);
  });

  it('M0.6 — filtre statut multi → in(statut, [...])', async () => {
    await callGet('?statuts=cloturee,validee');
    expect(chain.in).toHaveBeenCalledWith('statut', ['validee', 'cloturee']);
  });

  // ── Statut affiché Admin : « Créée » / « Programmée » (décision Val 2026-10-07) ──
  it('M0.6/statut_admin_brouillon_absent — la liste Admin ne sert jamais un brouillon', async () => {
    await callGet('');
    expect(chain.neq).toHaveBeenCalledWith('statut', 'brouillon');
    await callGet('?statuts=programmee,validee,en_cours');
    expect(chain.neq).toHaveBeenCalledTimes(2);
  });

  it('M0.6/statut_admin_creee_avant_envoi — la liste sert les signaux d’envoi (prestataire posé, attribution, référence)', async () => {
    await callGet('');
    const colonnes = String(chain.select.mock.calls[0]?.[0]);
    expect(colonnes).toMatch(/\bprestataire_logistique_id\b/);
    expect(colonnes).toMatch(/\battributions_antgaspi!collecte_id\(/);
  });

  it('M0.6/statut_admin_filtre_creee_programmee — statuts=creee → moitié « non envoyée » du statut programmee', async () => {
    await callGet('?statuts=creee');
    expect(chain.or).toHaveBeenCalledWith(
      'and(statut.eq.programmee,statut_tms.eq.non_envoye,tms_reference.is.null,prestataire_logistique_id.is.null,attributions_antgaspi.is.null)',
    );
    expect(chain.in).not.toHaveBeenCalledWith('statut', expect.anything());
  });

  it('M0.6/statut_admin_filtre_creee_programmee — statuts=programmee,validee → moitié « envoyée » OU validée', async () => {
    await callGet('?statuts=programmee,validee');
    expect(chain.or).toHaveBeenCalledWith(
      'and(statut.eq.programmee,or(statut_tms.neq.non_envoye,tms_reference.not.is.null,prestataire_logistique_id.not.is.null,attributions_antgaspi.not.is.null)),statut.in.(validee)',
    );
  });

  it('M0.6/statut_admin_filtre_creee_programmee — « Créée » et « Programmée » ensemble → in(statut) sur le statut DB, sans or', async () => {
    await callGet('?statuts=creee,programmee,en_cours');
    expect(chain.in).toHaveBeenCalledWith('statut', ['programmee', 'en_cours']);
    expect(chain.or).not.toHaveBeenCalled();
  });

  it('M0.6/statut_admin_brouillon_absent — clés inconnues écartées ; rien de valide demandé → aucune ligne, jamais une liste élargie', async () => {
    await callGet('?statuts=validee,x)%2Cstatut.neq.zz');
    expect(chain.in).toHaveBeenCalledWith('statut', ['validee']);
    expect(chain.or).not.toHaveBeenCalled();

    vi.clearAllMocks();
    setupAuth();
    await callGet('?statuts=brouillon,nimporte');
    expect(chain.in).toHaveBeenCalledWith('statut', []);
    expect(chain.or).not.toHaveBeenCalled();
  });

  it('M0.6 — ancien paramètre mono `statut` lu comme une liste d’un élément', async () => {
    await callGet('?statut=creee');
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining(
        'and(statut.eq.programmee,statut_tms.eq.non_envoye',
      ),
    );
  });

  it('M0.6 — filtre info_incomplete=true → eq(informations_completes,false)', async () => {
    await callGet('?info_incomplete=true');
    expect(chain.eq).toHaveBeenCalledWith('informations_completes', false);
  });

  it('M0.6 — filtre controle_acces=true → miroir du KPI « Infos accès à envoyer » (requis + non envoyé + à venir)', async () => {
    await callGet('?controle_acces=true');
    // Miroir EXACT du compteur chip-counts `controle_acces_a_envoyer`.
    expect(chain.eq).toHaveBeenCalledWith('controle_acces_requis', true);
    expect(chain.is).toHaveBeenCalledWith('infos_acces_email_envoye_at', null);
    expect(chain.gte).toHaveBeenCalledWith('date_collecte', expect.any(String));
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

  it('M0.6 — choix multiple : types / traiteur_operationnel_ids / lieu_ids (CSV) → in(…) prioritaires sur le mono', async () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await callGet(
      `?types=zero_dechet,anti_gaspi&type=zero_dechet&traiteur_operationnel_ids=${a},${b}&lieu_ids=${b}&lieu_id=lieu-1`,
    );
    expect(chain.in).toHaveBeenCalledWith('type', [
      'zero_dechet',
      'anti_gaspi',
    ]);
    expect(chain.in).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      [a, b],
    );
    expect(chain.in).toHaveBeenCalledWith('evenements.lieu_id', [b]);
    // Le mono est ignoré quand la liste est fournie.
    expect(chain.eq).not.toHaveBeenCalledWith('type', 'zero_dechet');
    expect(chain.eq).not.toHaveBeenCalledWith('evenements.lieu_id', 'lieu-1');
  });

  it('M0.6 — pastille (chip) ET filtres de la barre se cumulent côté route (décision Val 2026-09-30, E5)', async () => {
    const t = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await callGet(
      `?chip=non_transmises&types=zero_dechet&traiteur_operationnel_ids=${t}&statuts=validee`,
    );
    // Prédicat de la pastille…
    expect(chain.eq).toHaveBeenCalledWith('statut', 'programmee');
    expect(chain.is).toHaveBeenCalledWith('tms_reference', null);
    // … ET filtres de la barre, appliqués en plus (ET logique).
    expect(chain.in).toHaveBeenCalledWith('type', ['zero_dechet']);
    expect(chain.in).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      [t],
    );
    expect(chain.in).toHaveBeenCalledWith('statut', ['validee']);
  });

  it('M0.6 — choix multiple : valeurs hors liste blanche / non-UUID écartées avant in(…)', async () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await callGet(
      `?types=zero_dechet,autre),x&traiteur_operationnel_ids=${a},pas-un-uuid&lieu_ids=pas-un-uuid`,
    );
    expect(chain.in).toHaveBeenCalledWith('type', ['zero_dechet']);
    expect(chain.in).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      [a],
    );
    // Aucune valeur valide → pas de filtre lieu du tout.
    expect(chain.in.mock.calls.some((c) => c[0] === 'evenements.lieu_id')).toBe(
      false,
    );
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
