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

  it('rend toujours 422 (et pas 500) sur une collecte qui n’est pas un objet', async () => {
    setupAuth('traiteur_commercial');

    // La normalisation écrit la valeur sur l'élément : sur une chaîne, en mode
    // strict, l'affectation lèverait un TypeError → 500. Le contrôle de forme
    // doit donc rester AVANT elle.
    const res = await postProgrammation({ collectes: ['2030-01-15'] });

    expect(res.status).toBe(422);
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

  // ── Contre-épreuve des trois cas de refus ci-dessus ─────────────────────────
  //
  // Ils prouvent que la borne REJETTE ; aucun ne prouve que la valeur qui part en
  // base est la valeur NORMALISÉE. Mesuré : neutraliser
  // `Object.assign(updates, texteValide.valeurs)` dans les DEUX routes PATCH à la
  // fois laissait la suite ENTIÈRE verte, sans un seul échec — `updates` repartait
  // avec le corps brut et la normalisation était calculée pour rien. (Pas de compte
  // de tests ici : il se périme à chaque lot et n'est vérifiable par personne.)
  //
  // La base ne rattrape pas ce chemin. Les deux CHECK de la migration
  // 20260915180000 — `chk_evenements_contact_secours_nom_borne` et
  // `chk_evenements_contact_secours_telephone_borne` — ne testent QUE deux
  // choses : `length(col) <= 120|40` et `col !~ '[[:cntrl:]]'`. `'   '` n'est pas
  // NULL, il est donc évalué par ce prédicat interne, qu'il satisfait : 3
  // caractères, et l'espace U+0020 n'est pas un caractère de contrôle. La
  // blancheur n'est regardée nulle part (aucun `btrim`, aucun `<> ''` sur ces
  // colonnes dans TOUTES les migrations, vérifié). Ni le « trimé » ni le
  // `'' → null` ne sont donc tenus en base.
  //
  // Ce que chacune des deux propriétés protège, mesuré sur le code d'émission —
  // et NON « une ligne orpheline dans le canal libre », qui ne peut pas se
  // produire : `lignesCanalLibre` (packages/adapters/src/infos-acces.ts) passe le
  // nom par `nomContact` → `texte()` → `.trim()`, puis filtre
  // `valeur !== ''`, si bien que l'aval rattrape déjà `''` comme `'   '` pour le
  // NOM (motif corrigé en revue sécurité, l'énoncé initial était faux) :
  //   · `contact_secours_telephone: '' → null` est le SEUL rempart contre un
  //     numéro blanc parti verbatim sur le fil. `buildContact`, dans l'adapter
  //     camion de `packages/adapters/`, lit la colonne SANS trim et émet
  //     `...(secoursPhone ? { phoneAlternatives: [secoursPhone] } : {})` — `''`
  //     est falsy et tombe, `'   '` est TRUTHY et part tel quel à MTS-1.
  //   · le `trim()` du NOM protège la donnée stockée et son rendu : la fiche
  //     traiteur teste `evt?.contact_secours_nom &&`, donc `'   '` y affiche un
  //     bloc « contact de secours » sans personne à appeler.
  //
  // Les deux tests portent des noms DISTINCTS l'un de l'autre et de tous leurs
  // voisins : `toHaveBeenCalledWith` est satisfait par n'importe quel appel
  // enregistré, donc une valeur partagée pourrait être fournie par le test d'à
  // côté si le `beforeEach(resetChain)` de ce `describe` venait à disparaître.
  it('PATCH /programmation/evenements/[id] : appelle fn_modifier_evenement avec les valeurs NORMALISÉES, pas le body brut', async () => {
    setupAuth('traiteur_manager');
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: {
          id: 'evt-1',
          organisation_id: 'org-traiteur-1',
          created_by: 'user-1',
        },
        error: null,
      }) // lecture RLS-scopée de l'événement
      .mockResolvedValueOnce({ data: null, error: null }); // collecte représentative (notif)
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala' },
      error: null,
    }); // `before` de l'audit
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null }) // f_collecte_editable
      .mockResolvedValueOnce({ data: { id: 'evt-1' }, error: null }); // fn_modifier_evenement

    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-1', {
        contact_secours_nom: '  Claire Bonnet  ',
        contact_secours_telephone: '   ',
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_modifier_evenement',
      expect.objectContaining({
        p_updates: expect.objectContaining({
          contact_secours_nom: 'Claire Bonnet',
          contact_secours_telephone: null,
        }),
      }),
    );
  });

  it('PATCH /admin/evenements/[id] : appelle fn_modifier_evenement avec les valeurs NORMALISÉES, pas le body brut', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({ data: { id: 'evt-1' }, error: null });

    const { PATCH } =
      await import('@/app/api/v1/admin/evenements/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/evenements/evt-1', {
        contact_secours_nom: '  Hugo Petit  ',
        contact_secours_telephone: '   ',
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_modifier_evenement',
      expect.objectContaining({
        p_updates: expect.objectContaining({
          contact_secours_nom: 'Hugo Petit',
          contact_secours_telephone: null,
        }),
      }),
    );
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
