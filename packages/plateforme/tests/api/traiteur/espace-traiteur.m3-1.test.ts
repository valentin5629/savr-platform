/**
 * M3.1 — Tests Vitest API : Espace client traiteur.
 * Couvre : édition collecte (gate statut, champs verrouillés, push E2, autorisation),
 * annulation directe/demandée, invitation collaborateur, renouvellement pack,
 * badge "en attente de facturation" (F3), factures lecture seule, benchmark
 * traiteur_ids rejeté côté serveur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock thenable chain (résout une file de résultats) ──────────────────────
type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __queue: queue,
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'neq',
    'order',
    'ilike',
    'update',
    'insert',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
  };
  // thenable : `await chain` résout le prochain résultat de la file
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockSendEmail = vi.fn().mockResolvedValue(undefined);
const mockCreateUser = vi.fn();
const mockGenerateLink = vi.fn();
const mockUpdateUserById = vi.fn();
const mockDeleteUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (...a: unknown[]) =>
      (admin.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (admin.rpc as (...x: unknown[]) => unknown)(...a),
    auth: {
      admin: {
        createUser: mockCreateUser,
        generateLink: mockGenerateLink,
        deleteUser: mockDeleteUser,
        updateUserById: (...a: unknown[]) => mockUpdateUserById(...a),
      },
    },
  }),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId = 'org-1', userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}
function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'cle-de-service-de-test');
  mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
  mockCreateUser.mockResolvedValue({
    data: { user: { id: 'new-commercial-id' } },
    error: null,
  });
  mockGenerateLink.mockResolvedValue({
    data: {
      properties: { action_link: 'https://app.gosavr.io/activation#token' },
    },
    error: null,
  });
  mockDeleteUser.mockResolvedValue({ data: null, error: null });
});

// ── Badge "en attente de facturation" (F3) ──────────────────────────────────

// Lien d'invitation Savr (7 jours, usage unique) : il pointe vers /invitation, son
// jeton est signé et porte le nonce posé dans l'app_metadata du compte.
async function verifierLienInvitation(
  lien: string | undefined,
  updateUserById: { mock: { calls: unknown[][] } },
  userId: string,
): Promise<void> {
  const { lireJetonInvitation, DUREE_INVITATION_MS } =
    await import('@/lib/auth/jeton-invitation.js');
  expect(lien).toMatch(/\/invitation\?jeton=/);
  const jeton = decodeURIComponent(String(lien).split('jeton=')[1] ?? '');
  const lecture = lireJetonInvitation(jeton);
  expect(lecture.ok).toBe(true);
  if (!lecture.ok) return;
  expect(lecture.userId).toBe(userId);
  const restant = lecture.expireA - Date.now();
  expect(restant).toBeGreaterThan(DUREE_INVITATION_MS - 60_000);
  expect(restant).toBeLessThanOrEqual(DUREE_INVITATION_MS);
  expect(updateUserById.mock.calls).toContainEqual([
    userId,
    { app_metadata: { invitation_nonce: lecture.nonce } },
  ]);
}

describe('M3.1 / marge-attente-facturation', () => {
  it('M3.1/marge_badge_attente_facturation_partielle — 2 sur 5 sans facture emise', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        { id: 'c1', factures_collectes: [{ factures: { statut: 'emise' } }] },
        { id: 'c2', factures_collectes: [{ factures: { statut: 'emise' } }] },
        { id: 'c3', factures_collectes: [{ factures: { statut: 'payee' } }] },
        { id: 'c4', factures_collectes: [] },
        {
          id: 'c5',
          factures_collectes: [{ factures: { statut: 'brouillon' } }],
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/traiteur/marge-attente-facturation/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/traiteur/marge-attente-facturation'),
    );
    const json = (await res.json()) as { data: { nb_en_attente: number } };
    expect(json.data.nb_en_attente).toBe(2);
  });

  it('M3.1/marge_badge_zero_quand_tout_facture — badge masqué', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        { id: 'c1', factures_collectes: [{ factures: { statut: 'emise' } }] },
        { id: 'c2', factures_collectes: [{ factures: { statut: 'payee' } }] },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/traiteur/marge-attente-facturation/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/traiteur/marge-attente-facturation'),
    );
    const json = (await res.json()) as { data: { nb_en_attente: number } };
    expect(json.data.nb_en_attente).toBe(0);
  });
});

// ── Liste collectes ─────────────────────────────────────────────────────────
describe('M3.1 / collectes liste', () => {
  it('M3.1/liste_collectes_filtre_type_et_tiers — eq type + flag programmee_par_tiers', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          evenements: {
            organisation_id: 'org-wpm',
            traiteur_operationnel_organisation_id: 'org-kaspia',
          },
        },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/v1/traiteur/collectes/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/traiteur/collectes?type=zero_dechet'),
    );
    const json = (await res.json()) as {
      data: Array<{ programmee_par_tiers: boolean }>;
    };
    expect(json.data[0]?.programmee_par_tiers).toBe(true);
    const eqCalls = rls.__calls.eq ?? [];
    expect(
      eqCalls.some(([col, val]) => col === 'type' && val === 'zero_dechet'),
    ).toBe(true);
  });

  it('M3.1/liste_collectes_filtre_statut_onglet — .in(statut, [...]) pour les statuts demandés', async () => {
    setupAuth('traiteur_manager', 'org-1');
    rls.push({ data: [], error: null });
    const { GET } = await import('@/app/api/v1/traiteur/collectes/route.js');
    await GET(
      makeReq(
        'GET',
        '/api/v1/traiteur/collectes?type=zero_dechet&statut=brouillon,programmee,validee,en_cours',
      ),
    );
    const inCalls = rls.__calls.in ?? [];
    const statutCall = inCalls.find(([col]) => col === 'statut');
    expect(statutCall).toBeTruthy();
    expect(statutCall![1]).toEqual([
      'brouillon',
      'programmee',
      'validee',
      'en_cours',
    ]);
  });
});

// ── Édition collecte ────────────────────────────────────────────────────────
// Contacts sur place de la collecte avant l'écriture (`collecte_contacts`, lot
// B1, décision Val 2026-10-23) : la route les lit à chaque modification.
const CONTACTS_AVANT = {
  contact_principal_nom: 'Paul Il',
  contact_principal_telephone: '0611111111',
  contact_secours_nom: null,
  contact_secours_telephone: null,
};

describe('M3.1 / édition collecte', () => {
  it('M3.1/champs_verrouilles_type_lieu_traiteur — 422 sur type/lieu_id', async () => {
    setupAuth('traiteur_commercial');
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', { lieu_id: 'autre' }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { champs_verrouilles: string[] };
    expect(json.champs_verrouilles).toContain('lieu_id');
  });

  it('M3.1/edition_refusee_statut_en_cours — 422 hors programmee/validee', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'en_cours',
        statut_tms: 'acceptee',
        date_collecte: '2097-01-01',
        heure_collecte: '10:00:00',
        evenement: { created_by: 'user-1', organisation_id: 'org-1' },
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', {
        informations_supplementaires: 'x',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M3.1/edition_champ_non_impactant_push_silencieux — 200 + fn_modifier_collecte (E2)', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2097-12-31',
        heure_collecte: '10:00:00',
        evenement: { created_by: 'user-1', organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null }); // before select
    admin.push({ data: CONTACTS_AVANT, error: null }); // contacts de la collecte (avant)
    admin.push({
      data: { id: 'c1', informations_supplementaires: 'x' },
      error: null,
    }); // rpc fn_modifier
    admin.push({ data: null, error: null }); // audit insert
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', {
        informations_supplementaires: 'x',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(200);
    const rpcCalls = admin.__calls.rpc ?? [];
    expect(rpcCalls.some(([fn]) => fn === 'fn_modifier_collecte')).toBe(true);
    const json = (await res.json()) as { flags: { priorite_urgence: boolean } };
    expect(json.flags.priorite_urgence).toBe(false);
  });

  // Val 2026-10-30 : le commercial écrit sur toute son organisation ; seule une
  // collecte d'une autre organisation lui est refusée.
  it('M3.1/edition_commercial_autre_organisation_deny — 403 hors de son organisation', async () => {
    setupAuth('traiteur_commercial', 'org-2', 'paul');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2097-12-31',
        heure_collecte: '10:00:00',
        evenement: { created_by: 'marie', organisation_id: 'org-1' },
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', {
        informations_supplementaires: 'x',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(403);
  });

  // BL-P1-TRAIT-04 — email à l'équipe Savr (§06.02 n°19, §05 « Modification
  // d'une collecte à venir »). `auditEvenement` : ligne du journal d'audit lue
  // quand la requête signale que l'événement vient d'être modifié.
  function queueEditOk(
    dateCollecte = '2097-12-31',
    auditEvenement?: Record<string, unknown>,
    // Date de la collecte relue APRÈS l'écriture (par défaut : inchangée).
    dateApres = dateCollecte,
  ) {
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: dateCollecte,
        heure_collecte: '10:00:00',
        evenement: { created_by: 'user-1', organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({
      data: {
        id: 'c1',
        evenement_id: 'e1',
        date_collecte: dateCollecte,
        heure_collecte: '10:00:00',
        // Pax porté par la collecte (décision Val 2026-10-20).
        pax: 120,
        informations_supplementaires: null,
      },
      error: null,
    }); // before
    admin.push({ data: CONTACTS_AVANT, error: null }); // contacts de la collecte (avant)
    admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // audit insert
    admin.push({
      data: {
        id: 'c1',
        evenement_id: 'e1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        prestataire_logistique_id: null,
        date_collecte: dateApres,
        heure_collecte: '10:00:00',
        pax: 120,
        attributions_antgaspi: null,
        evenement: {
          created_by: 'user-1',
          organisation: { nom: 'Traiteur Test' },
        },
      },
      error: null,
    }); // email : collecte après écriture
    if (auditEvenement) admin.push({ data: [auditEvenement], error: null }); // email : audit relu
    admin.push({
      data: { prenom: 'Julie', nom: 'Martin', telephone: '0601020304' },
      error: null,
    }); // email : programmateur
  }

  async function patchCollecte(body: Record<string, unknown>) {
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    return PATCH(makeReq('PATCH', '/api/v1/traiteur/collectes/c1', body), {
      params: Promise.resolve({ id: 'c1' }),
    });
  }

  function emailEquipe(): Record<string, string> | undefined {
    const call = mockSendEmail.mock.calls.find(
      ([code]) => code === 'admin_modification_collecte_traiteur',
    );
    expect(call?.[1]).toBe('contact@gosavr.io');
    return call?.[2] as Record<string, string> | undefined;
  }

  it('M3.1/edition_alerte_ops_priorite_normale — email à l’équipe sans ligne ATTENTION (>= 12h)', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    queueEditOk('2097-12-31');
    const res = await patchCollecte({ informations_supplementaires: 'x' });
    expect(res.status).toBe(200);
    expect(emailEquipe()).toEqual({
      organisation_nom: 'Traiteur Test',
      date_initiale: '31/12/2097',
      pax_initial: '120',
      liste_modifications:
        '<ul><li>Informations supplémentaires : avant non renseigné. Maintenant x</li></ul>',
      programmateur: 'Julie Martin, joignable au 0601020304',
      statut_collecte: 'Créée',
      priorite_urgence: 'false',
      lien_fiche: expect.stringMatching(/\/admin\/collectes\/c1$/),
    });
  });

  it('M3.1/email_modification_urgence_12h — collecte lointaine rapprochée à moins de 12h : drapeau, audit et email urgents', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    // Créneau d'origine lointain ; le nouveau est déjà passé → moins de 12h.
    queueEditOk('2097-12-31', undefined, '2020-01-01');
    const res = await patchCollecte({ date_collecte: '2020-01-01' });
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      flags: { priorite_urgence: boolean };
    };
    expect(corps.flags.priorite_urgence).toBe(true);
    const audit = (admin.__calls.insert ?? [])
      .map(
        ([ligne]) => ligne as { new_values?: { priorite_urgence?: boolean } },
      )
      .find((ligne) => ligne.new_values?.priorite_urgence !== undefined);
    expect(audit?.new_values?.priorite_urgence).toBe(true);
    expect(emailEquipe()?.priorite_urgence).toBe('true');
  });

  it('M3.1/email_modification_urgence_12h — heure seule avancée à moins de 12h : drapeau urgent', async () => {
    // 21h00 à Paris la veille : la collecte de 10h00 est dans 13 h ; avancée à
    // 08h00, elle est dans 11 h. Seule l'horloge est figée.
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2097-12-30T20:00:00Z'),
    });
    try {
      setupAuth('traiteur_commercial', 'org-1', 'user-1');
      queueEditOk('2097-12-31');
      const res = await patchCollecte({ heure_collecte: '08:00:00' });
      expect(res.status).toBe(200);
      const corps = (await res.json()) as {
        flags: { priorite_urgence: boolean };
      };
      expect(corps.flags.priorite_urgence).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('M3.1/email_modification_urgence_12h — collecte imminente repoussée au loin : drapeau, audit et email urgents', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    // Créneau d'origine déjà passé → moins de 12h ; le nouveau est lointain.
    queueEditOk('2020-01-01', undefined, '2097-12-31');
    const res = await patchCollecte({ date_collecte: '2097-12-31' });
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      flags: { priorite_urgence: boolean };
    };
    expect(corps.flags.priorite_urgence).toBe(true);
    const audit = (admin.__calls.insert ?? [])
      .map(
        ([ligne]) => ligne as { new_values?: { priorite_urgence?: boolean } },
      )
      .find((ligne) => ligne.new_values?.priorite_urgence !== undefined);
    expect(audit?.new_values?.priorite_urgence).toBe(true);
    expect(emailEquipe()?.priorite_urgence).toBe('true');
  });

  it('M3.1/email_modification_urgence_12h — ancien et nouveau créneaux lointains : rien d’urgent', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    queueEditOk('2097-12-31', undefined, '2097-12-30');
    const res = await patchCollecte({ date_collecte: '2097-12-30' });
    const corps = (await res.json()) as {
      flags: { priorite_urgence: boolean };
    };
    expect(corps.flags.priorite_urgence).toBe(false);
    expect(emailEquipe()?.priorite_urgence).toBe('false');
  });

  it('M3.1/edition_alerte_ops_priorite_haute — ligne ATTENTION à moins de 12h du créneau', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    // Créneau déjà passé → délai < 12h.
    queueEditOk('2020-01-01');
    const res = await patchCollecte({ informations_supplementaires: 'x' });
    expect(res.status).toBe(200);
    expect(emailEquipe()?.priorite_urgence).toBe('true');
  });

  // Depuis le lot B1 (décision Val 2026-10-23), le contact est un champ de la
  // collecte : son « avant » est lu dans `collecte_contacts`, et l'événement
  // n'apporte plus au même enregistrement que ses propres champs (référence).
  it('M3.1/email_modification_un_seul_email — pax et contact de la collecte, référence de l’événement du même enregistrement : un seul email, tous les champs', async () => {
    // Un manager (user-2) modifie la collecte programmée par un collègue
    // (user-1) : session et créateur de l'événement sont deux personnes.
    setupAuth('traiteur_manager', 'org-1', 'user-2');
    queueEditOk('2097-12-31', {
      old_values: { reference_affaire: 'AFF-2000' },
      new_values: { updates: { reference_affaire: 'AFF-1500' } },
    });
    const res = await patchCollecte({
      date_collecte: '2097-12-30',
      pax: 1500,
      contact_principal_nom: 'Arthus',
      contact_principal_telephone: '0699990002',
      evenement_modifie: true,
    });
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const variables = emailEquipe();
    expect(variables?.liste_modifications).toBe(
      "<ul><li>Date de collecte : du 31/12/2097 au 30/12/2097</li><li>Nombre de pax : de 120 à 1500</li><li>Contact : avant Paul Il (0611111111). Maintenant Arthus (0699990002)</li><li>Référence d'affaire : avant AFF-2000. Maintenant AFF-1500</li></ul>",
    );
    expect(variables?.pax_initial).toBe('120');
    // Le signalement n'est pas un champ de la collecte : il n'atteint pas la RPC.
    const rpc = (admin.__calls.rpc ?? []).find(
      ([fn]) => fn === 'fn_modifier_collecte',
    );
    expect((rpc![1] as { p_updates: unknown }).p_updates).toEqual({
      date_collecte: '2097-12-30',
      pax: 1500,
      contact_principal_nom: 'Arthus',
      contact_principal_telephone: '0699990002',
    });
    // Les contacts « avant » sont ceux de CETTE collecte, lus en service-role.
    expect(admin.__calls.from).toContainEqual(['collecte_contacts']);
    expect(admin.__calls.eq).toContainEqual(['collecte_id', 'c1']);
    // La modification d'événement relue est celle de l'utilisateur de la
    // session, jamais celle du créateur de l'événement.
    expect(admin.__calls.eq).toContainEqual(['user_id', 'user-2']);
    expect(admin.__calls.eq).not.toContainEqual(['user_id', 'user-1']);
  });

  it('M3.1/edition_contacts_avant_illisibles_500 — lecture des contacts de la collecte en échec : 500, rien n’est écrit ni envoyé', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2097-12-31',
        heure_collecte: '10:00:00',
        evenement: { created_by: 'user-1', organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({
      data: { id: 'c1', date_collecte: '2097-12-31' },
      error: null,
    }); // before
    admin.push({ data: null, error: { message: 'boom' } }); // contacts : échec
    const res = await patchCollecte({ contact_principal_nom: 'Arthus' });
    expect(res.status).toBe(500);
    expect(admin.__calls.rpc).toBeUndefined();
    expect(admin.__calls.insert).toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('M3.1/email_modification_un_seul_email — sans signalement, le journal d’audit n’est pas relu', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    queueEditOk('2097-12-31');
    const res = await patchCollecte({ date_collecte: '2097-12-30' });
    expect(res.status).toBe(200);
    expect(emailEquipe()?.liste_modifications).toBe(
      '<ul><li>Date de collecte : du 31/12/2097 au 30/12/2097</li></ul>',
    );
    expect(admin.__calls.eq).not.toEqual(
      expect.arrayContaining([['table_name', 'evenements']]),
    );
  });
});

// ── Annulation ──────────────────────────────────────────────────────────────
describe('M3.1 / annulation', () => {
  it('M3.1/annulation_directe_collecte_programmee — statut annulee', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'attribuee_en_attente_acceptation',
        date_collecte: '2097-12-31',
        tms_reference: 'TMS-1',
        evenement: {
          created_by: 'user-1',
          organisation_id: 'org-1',
          nom_evenement: 'Gala',
          organisation: { nom: 'Kaspia' },
          lieu: [{ nom: 'Salle Wagram' }],
        },
      },
      error: null,
    });
    admin.push({ data: null, error: null }); // rpc fn_modifier (statut annulee)
    admin.push({
      data: { email: 'prog@savr-test.local', prenom: 'Paul', nom: null },
      error: null,
    }); // users (programmateur)
    const { POST } =
      await import('@/app/api/v1/traiteur/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/collectes/c1/annulation', {
        motif: '',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    const json = (await res.json()) as { data: { statut: string } };
    expect(json.data.statut).toBe('annulee');
    // Template 5 : au programmateur, plus jamais à l'adresse de l'équipe Savr
    // sans date ni lieu (l'envoi était refusé faute de variables).
    expect(mockSendEmail).toHaveBeenCalledWith(
      'annulation_collecte',
      'prog@savr-test.local',
      {
        prenom: 'Paul',
        date_collecte: '31/12/2097',
        heure_collecte: '',
        lieu_nom: 'Salle Wagram',
        nom_evenement: 'Gala',
        motif: '',
      },
    );
    expect(mockSendEmail).not.toHaveBeenCalledWith(
      'annulation_collecte',
      'contact@gosavr.io',
      expect.anything(),
    );
  });

  it('M3.1/demande_annulation_collecte_validee — statut annulation_demandee', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c2',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2097-12-31',
        tms_reference: 'TMS-2',
        evenement: {
          created_by: 'user-9',
          organisation_id: 'org-1',
          nom_evenement: 'Gala',
          organisation: { nom: 'Kaspia' },
        },
      },
      error: null,
    });
    admin.push({ data: null, error: null });
    admin.push({
      data: { email: 'claire@savr-test.local', prenom: null, nom: null },
      error: null,
    }); // users (demandeur, sans prénom ni nom)
    const { POST } =
      await import('@/app/api/v1/traiteur/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/collectes/c2/annulation', {
        motif: 'doublon <b>urgent</b>',
      }),
      { params: Promise.resolve({ id: 'c2' }) },
    );
    const json = (await res.json()) as { data: { statut: string } };
    expect(json.data.statut).toBe('annulation_demandee');
    // Sans prénom ni nom, le demandeur est désigné par son email.
    expect(mockSendEmail).toHaveBeenCalledWith(
      'admin_demande_annulation',
      'contact@gosavr.io',
      expect.objectContaining({
        demandeur_nom: 'claire@savr-test.local',
        motif: 'doublon &lt;b&gt;urgent&lt;/b&gt;',
      }),
    );
  });

  it('M3.1/annulation_depuis_cloturee_impossible — 422', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c3',
        statut: 'cloturee',
        statut_tms: 'cloturee',
        date_collecte: '2097-12-31',
        tms_reference: 'TMS-3',
        evenement: {
          created_by: 'user-1',
          organisation_id: 'org-1',
          nom_evenement: 'Gala',
          organisation: { nom: 'Kaspia' },
        },
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/traiteur/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/collectes/c3/annulation', {}),
      { params: Promise.resolve({ id: 'c3' }) },
    );
    expect(res.status).toBe(422);
  });
});

// ── Invitation collaborateur ────────────────────────────────────────────────
describe('M3.1 / invitation collaborateur', () => {
  it('M3.1/invitation_collaborateur_texte_echappe — prénom et organisation neutralisés dans l’email', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: null, error: null }); // users lookup → pas de doublon
    admin.push({ data: { nom: 'Kaspia & <b>Co</b>' }, error: null }); // org
    admin.push({ data: null, error: null }); // insert profil users (await)
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'jeanne@exemple-perso.fr',
        prenom: '<a href="https://piege.example">Jeanne</a>',
        nom: 'Martin',
      }),
    );
    expect(res.status).toBe(201);
    // Le corps de l'email est du HTML interpolé tel quel : sans échappement, le
    // prénom saisi par l'invitant deviendrait un lien dans un email signé Savr.
    expect(mockSendEmail).toHaveBeenCalledWith(
      'invitation_utilisateur',
      'jeanne@exemple-perso.fr',
      expect.objectContaining({
        prenom:
          '&lt;a href=&quot;https://piege.example&quot;&gt;Jeanne&lt;/a&gt;',
        organisation_nom: 'Kaspia &amp; &lt;b&gt;Co&lt;/b&gt;',
      }),
      expect.any(Object),
    );
  });

  it('M3.1/invitation_collaborateur_flux_complet — 201 email envoyé', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: null, error: null }); // users lookup → pas de doublon
    admin.push({ data: { nom: 'Kaspia' }, error: null }); // org
    admin.push({ data: null, error: null }); // insert profil users (await)
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'jeanne@exemple-perso.fr',
        prenom: 'Jeanne',
        nom: 'Martin',
      }),
    );
    expect(res.status).toBe(201);
    // Compte provisionné directement (pas d'email natif Supabase).
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jeanne@exemple-perso.fr',
        email_confirm: true,
      }),
    );
    // Rattachement AUTOMATIQUE à l'org de l'invitant + rôle commercial
    // (décision Val 2026-07-01, CDC §06.04 ligne 719).
    const insertArgs = admin.__calls.insert?.[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertArgs).toMatchObject({
      organisation_id: 'org-kaspia',
      role: 'traiteur_commercial',
      email: 'jeanne@exemple-perso.fr',
    });
    // Email brandé template §06.02 n°17 avec la variable REQUISE lien_invitation
    // (sans elle, sendEmail refuse l'envoi et trace MISSING_VARIABLE).
    expect(mockSendEmail).toHaveBeenCalledWith(
      'invitation_utilisateur',
      'jeanne@exemple-perso.fr',
      expect.objectContaining({ lien_invitation: expect.any(String) }),
      expect.any(Object),
    );
    const emailVars = mockSendEmail.mock.calls[0]?.[2] as {
      lien_invitation?: string;
    };
    expect(emailVars.lien_invitation).toBeTruthy();
    // Lien Savr valable 7 jours (plus de lien Supabase de récupération).
    expect(mockGenerateLink).not.toHaveBeenCalled();
    await verifierLienInvitation(
      emailVars.lien_invitation,
      mockUpdateUserById,
      'new-commercial-id',
    );
  });

  it('M3.1/invitation_email_deja_membre_refusee — 409', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: { id: 'u-existant' }, error: null }); // doublon
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'paul@kaspia.fr',
        prenom: 'Paul',
        nom: 'Durand',
      }),
    );
    expect(res.status).toBe(409);
  });

  it('M3.1/invitation_commercial_autorisee — le commercial passe la garde de rôle (Val 2026-10-30)', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'x@y.fr',
      }),
    );
    // Arrêté par la validation (prénom/nom manquants), plus par le rôle.
    expect(res.status).toBe(422);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('M3.1/invitation_prenom_nom_requis — 422 sans prenom/nom (provisioning direct)', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'sansnom@kaspia.fr',
      }),
    );
    expect(res.status).toBe(422);
    // Aucun compte créé si le payload est incomplet.
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('M3.1/invitation_rollback_auth_si_insert_echoue — deleteUser + 422 (pas de user orphelin)', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: null, error: null }); // users lookup → pas de doublon
    admin.push({ data: { nom: 'Kaspia' }, error: null }); // org
    admin.push({ data: null, error: { message: 'insert boom' } }); // INSERT users échoue
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'jeanne@exemple-perso.fr',
        prenom: 'Jeanne',
        nom: 'Martin',
      }),
    );
    expect(res.status).toBe(422);
    // Le compte Auth créé est rollbacké pour ne pas laisser un user orphelin.
    expect(mockDeleteUser).toHaveBeenCalledWith('new-commercial-id');
    // Pas d'email envoyé si le provisioning a échoué.
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

// ── Renouvellement pack ─────────────────────────────────────────────────────
describe('M3.1 / renouvellement pack', () => {
  it('M3.1/demande_renouvellement_pack — 201 email admin', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    admin.push({ data: { nom: 'Kaspia' }, error: null });
    admin.push({
      data: { email: 'paul@savr-test.local', prenom: 'Paul', nom: 'Martin' },
      error: null,
    }); // users (demandeur)
    const { POST } =
      await import('@/app/api/v1/traiteur/pack-ag/renouvellement/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/pack-ag/renouvellement', {
        pack_souhaite: 'Pack <20>',
      }),
    );
    expect(res.status).toBe(201);
    // Le demandeur est nommé avec son email (plus d'identifiant technique ni
    // d'email vide) ; le texte saisi est échappé.
    expect(mockSendEmail).toHaveBeenCalledWith(
      'admin_demande_renouvellement_pack',
      'contact@gosavr.io',
      {
        organisation_nom: 'Kaspia',
        demandeur_nom: 'Paul Martin',
        demandeur_email: 'paul@savr-test.local',
        pack_souhaite: 'Pack &lt;20&gt;',
        message: '',
        // Pas de pack actif dans ce jeu : ligne absente de l'email.
        credits_restants: '',
        lien_fiche_org: 'http://localhost/admin/organisations/org-kaspia',
      },
    );
  });
});

// ── Benchmark : filtre traiteur_ids rejeté côté serveur ─────────────────────
describe('M3.1 / benchmark garde traiteur_ids', () => {
  it('M3.1/benchmark_filtre_traiteur_ids_rejete_cote_serveur — 403 rôle traiteur', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq(
        'GET',
        '/api/v1/dashboards/benchmark?bracket=M&traiteur_ids=org-x',
      ),
    );
    expect(res.status).toBe(403);
  });
});

// ── Factures lecture seule ──────────────────────────────────────────────────
describe('M3.1 / factures lecture seule', () => {
  it('M3.1/factures_commercial_lecture_seule — exclut brouillon', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    rls.push({ data: [{ id: 'f1', statut: 'emise' }], error: null });
    const { GET } = await import('@/app/api/v1/traiteur/factures/route.js');
    const res = await GET(makeReq('GET', '/api/v1/traiteur/factures'));
    expect(res.status).toBe(200);
    const neqCalls = rls.__calls.neq ?? [];
    expect(
      neqCalls.some(([col, val]) => col === 'statut' && val === 'brouillon'),
    ).toBe(true);
  });
});
