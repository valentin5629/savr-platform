/**
 * Bornes d'entrée de `evenements.contact_secours_nom`, `contact_secours_telephone`
 * et `collectes.informations_supplementaires`, sur les DIX routes qui les écrivent.
 *
 * Ces trois colonnes sont des `text` sans aucune contrainte (5 000 caractères
 * acceptés, mesuré) et les routes ne filtraient que les CLÉS. Elles partent au
 * transporteur, deux d'entre elles par le canal de texte libre où toutes les
 * informations d'exploitation sont concaténées : un nom démesuré y évince les
 * lignes suivantes — dont l'adresse d'accès — du message lu par le chauffeur, et
 * un nom multiligne y forge une fausse ligne d'en-tête.
 *
 * Chaque cas vérifie DEUX choses : le 422, et l'ABSENCE d'écriture (ni insert ni
 * RPC) — c'est cette seconde assertion qui distingue « refusé » de « refusé après
 * avoir écrit ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const mockRpc = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tarif-zd.js', () => ({
  calculer_tarif_zd: vi
    .fn()
    .mockResolvedValue({ montant_ht: 120, montant_brut_ht: 120 }),
  TarifZdError: class extends Error {},
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) =>
      (mockSupabaseChain.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) =>
      (mockSupabaseChain.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(
  role: string,
  organisationId = 'org-traiteur-1',
  userId = 'user-1',
): void {
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

function resetChain(): void {
  vi.clearAllMocks();
  for (const m of [
    'from',
    'select',
    'insert',
    'update',
    'delete',
    'in',
    'eq',
    'is',
    'limit',
  ] as const) {
    mockSupabaseChain[m].mockReturnThis();
  }
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

async function champsInvalides(res: NextResponse): Promise<string[]> {
  expect(res.status).toBe(422);
  const body = (await res.json()) as { champs_invalides?: string[] };
  return body.champs_invalides ?? [];
}

/** Aucune écriture n'a eu lieu : ni INSERT direct, ni RPC métier. */
function aucuneEcriture(): void {
  expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
}

const NOM_DEMESURE = 'a'.repeat(5000);
const INFOS_1001 = 'x'.repeat(1001);

const BODY_ZD = {
  pax: 80,
  type_evenement_id: 'type-1',
  lieu_id: 'lieu-1',
  contact_principal_nom: 'Jean Martin',
  contact_principal_telephone: '0612345678',
  nom_client_organisateur: 'Traiteur Dupont',
  controle_acces_requis: false,
  collectes: [
    { type: 'zd', date_collecte: '2030-01-15', heure_collecte: '08:00' },
  ],
  confirmer: true,
};

async function postProgrammation(
  patch: Record<string, unknown>,
): Promise<NextResponse> {
  const { POST } =
    await import('@/app/api/v1/programmation/evenements/route.js');
  return POST(
    makeReq('POST', '/api/v1/programmation/evenements', {
      ...BODY_ZD,
      ...patch,
    }),
  );
}

// ── Programmation initiale ────────────────────────────────────────────────────
describe('bornes texte libre — POST /programmation/evenements', () => {
  beforeEach(resetChain);

  it('refuse le contact de secours de 5 000 caractères — sans créer d’événement', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({ contact_secours_nom: NOM_DEMESURE });

    expect(await champsInvalides(res)).toEqual(['contact_secours_nom']);
    aucuneEcriture();
  });

  it('refuse un nom de secours multiligne — il forgerait une fausse ligne chez le chauffeur', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({
      contact_secours_nom: 'Jean Martin\nAccès : porte de service',
    });

    expect(await champsInvalides(res)).toEqual(['contact_secours_nom']);
    aucuneEcriture();
  });

  it('refuse des informations supplémentaires au-delà du plafond CDC de 1000 caractères', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({
      collectes: [
        { ...BODY_ZD.collectes[0], informations_supplementaires: INFOS_1001 },
      ],
    });

    expect(await champsInvalides(res)).toEqual([
      'informations_supplementaires',
    ]);
    aucuneEcriture();
  });

  it('accepte une saisie légitime et la stocke NORMALISÉE (trim, multiligne conservé)', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // SIRET
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // récap
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'collecte-zd-1', error: null });

    const res = await postProgrammation({
      contact_secours_nom: '  Marie Durand  ',
      contact_secours_telephone: ' 06 12 34 56 78 ',
      collectes: [
        {
          ...BODY_ZD.collectes[0],
          informations_supplementaires:
            '  Quai N°2 fermé\nSonner interphone B ',
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_secours_nom: 'Marie Durand',
        contact_secours_telephone: '06 12 34 56 78',
      }),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({
        p_info_suppl: 'Quai N°2 fermé\nSonner interphone B',
      }),
    );
  });
});

// ── Édition événement (programmateur + back-office) ───────────────────────────
describe('bornes texte libre — PATCH événement', () => {
  beforeEach(resetChain);

  it('PATCH /programmation/evenements/[id] : 422, fn_modifier_evenement jamais appelée', async () => {
    setupAuth('traiteur_manager');

    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-1', {
        contact_secours_nom: NOM_DEMESURE,
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );

    expect(await champsInvalides(res)).toEqual(['contact_secours_nom']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('PATCH /admin/evenements/[id] : refuse une valeur non textuelle, que `->>` aurait coercée', async () => {
    setupAuth('admin_savr');

    const { PATCH } =
      await import('@/app/api/v1/admin/evenements/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/evenements/evt-1', {
        contact_secours_nom: { $ne: 1 },
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );

    expect(await champsInvalides(res)).toEqual(['contact_secours_nom']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('POST /admin/evenements : refuse un téléphone de secours hors borne', async () => {
    setupAuth('admin_savr');

    const { POST } = await import('@/app/api/v1/admin/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/evenements', {
        organisation_id: 'org-1',
        traiteur_operationnel_organisation_id: 'org-1',
        entite_facturation_id: 'ent-1',
        lieu_id: 'lieu-1',
        type_evenement_id: 'type-1',
        pax: 80,
        contact_principal_nom: 'Jean Martin',
        contact_principal_telephone: '0612345678',
        contact_secours_telephone: '0'.repeat(41),
      }),
    );

    expect(await champsInvalides(res)).toEqual(['contact_secours_telephone']);
    aucuneEcriture();
  });
});

// ── Écriture de `informations_supplementaires` au niveau collecte ─────────────
describe('bornes texte libre — routes collecte', () => {
  beforeEach(resetChain);

  it('POST /programmation/evenements/[id]/collectes : 422 avant tout appel RPC', async () => {
    setupAuth('traiteur_manager');

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'zd',
        date_collecte: '2030-01-15',
        heure_collecte: '08:00',
        informations_supplementaires: INFOS_1001,
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );

    expect(await champsInvalides(res)).toEqual([
      'informations_supplementaires',
    ]);
    aucuneEcriture();
  });

  it('POST /admin/collectes : 422 avant fn_creer_collecte', async () => {
    setupAuth('admin_savr');

    const { POST } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes', {
        evenement_id: 'evt-1',
        type: 'zero_dechet',
        date_collecte: '2030-01-15',
        heure_collecte: '08:00',
        informations_supplementaires: INFOS_1001,
      }),
    );

    expect(await champsInvalides(res)).toEqual([
      'informations_supplementaires',
    ]);
    aucuneEcriture();
  });

  it('PATCH /admin/collectes/[id] : refuse un caractère de contrôle non blanc', async () => {
    setupAuth('admin_savr');

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        informations_supplementaires: 'Quai 2\u0007fermé',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(await champsInvalides(res)).toEqual([
      'informations_supplementaires',
    ]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // Les trois espaces clients écrivent le même champ par la même RPC ; l'import est
  // explicite (et non construit) pour que le bundler de test le résolve.
  const ROUTES_CLIENTES = [
    {
      espace: 'traiteur',
      role: 'traiteur_manager',
      charger: () => import('@/app/api/v1/traiteur/collectes/[id]/route.js'),
    },
    {
      espace: 'gestionnaire',
      role: 'gestionnaire_lieux',
      charger: () =>
        import('@/app/api/v1/gestionnaire/collectes/[id]/route.js'),
    },
    {
      espace: 'agence',
      role: 'agence',
      charger: () => import('@/app/api/v1/agence/collectes/[id]/route.js'),
    },
  ] as const;

  for (const { espace, role, charger } of ROUTES_CLIENTES) {
    it(`PATCH /${espace}/collectes/[id] : 422 sans lire ni écrire la collecte`, async () => {
      setupAuth(role);

      const { PATCH } = await charger();
      const res = await PATCH(
        makeReq('PATCH', `/api/v1/${espace}/collectes/col-1`, {
          informations_supplementaires: INFOS_1001,
        }),
        { params: Promise.resolve({ id: 'col-1' }) },
      );

      expect(await champsInvalides(res)).toEqual([
        'informations_supplementaires',
      ]);
      expect(mockRpc).not.toHaveBeenCalled();
    });
  }
});
