/**
 * Bornes d'entrée de `evenements.contact_secours_nom`, `contact_secours_telephone`
 * et `collectes.informations_supplementaires`, sur les DIX routes qui les écrivent.
 *
 * Ces trois colonnes sont des `text` sans aucune contrainte (5 000 caractères
 * acceptés, mesuré) et les routes ne filtraient que les CLÉS. Elles partent au
 * transporteur, deux d'entre elles par le canal de texte libre où toutes les
 * informations d'exploitation sont concaténées.
 *
 * ÉVICTION : fermée pour les DEUX champs, à ne pas revendiquer ici (l'énoncé
 * était faux et a été corrigé deux fois en revue). Le NOM passe par `nomContact`
 * (blancs repliés, puis troncature à 120) ; et depuis #324 la note du traiteur et
 * le bloc composé par Savr se partagent l'enveloppe sans pouvoir s'évincer — le
 * bloc Savr est servi le premier dans la limite de `BUDGET_AGREGAT`, la note
 * prend le reste. Aucun des deux ne peut donc chasser l'adresse d'accès du
 * message lu par le chauffeur.
 *
 * FAUSSE LIGNE D'EN-TÊTE : deux moitiés, une seule est close — ne pas nier le
 * tout (défaut relevé en revue sécurité sur ce fichier même). Par le NOM, c'est
 * impossible : `valeurLigne` replie toute rupture de ligne, y compris NEL et les
 * séparateurs C1, et pas seulement `\s` (mesuré : un nom multiligne ressort en
 * UNE ligne). Par la NOTE, c'est possible et ASSUMÉ : elle est légitimement
 * multiligne (#322 y refuse les caractères de contrôle HORS blancs, les
 * demi-surrogates orphelins et le dépassement de 1000 caractères — mais pas le
 * saut de ligne, c'est un `<textarea>`), et elle ouvre le message : elle peut
 * donc poser un faux `SEPARATEUR_AGREGAT` au-dessus du vrai,
 * que le chauffeur rencontre en premier (mesuré). Val a tranché de NE PAS fermer
 * ce vecteur (2026-09-15), le cas reproduit sous les yeux ; le raisonnement
 * complet est dans le commentaire de `SEPARATEUR_AGREGAT`
 * (packages/adapters/src/infos-acces.ts). Rien ici ne doit laisser croire le
 * contraire.
 *
 * Ce que la borne d'entrée tient, elle, c'est l'INTÉGRITÉ DE LA DONNÉE : la
 * colonne, les exports, le rendu des fiches — plus une propriété qui ne tient
 * qu'ici, `contact_secours_telephone: '' → null` (voir plus bas).
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
  argsRpcCaptures.length = 0;
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

/**
 * Arguments RPC capturés PAR COPIE, à l'instant de l'appel.
 *
 * `toHaveBeenCalledWith` ne suffit pas pour cet oracle-ci : le spy ne retient
 * qu'une RÉFÉRENCE vers l'objet `updates` que les routes PATCH lui passent, et
 * l'assertion est évaluée après le retour du handler. Déplacer
 * `Object.assign(updates, texteValide.valeurs)` APRÈS l'appel — la valeur brute
 * partirait alors réellement sur le fil — laissait le test vert (mesuré, défaut
 * relevé en revue sécurité). La copie fige ce que la route a TRANSMIS, et non ce
 * que l'objet est devenu ensuite.
 */
const argsRpcCaptures: Array<{ nom: string; args: unknown }> = [];

/** Réponse de RPC à file d'ordre, qui capture ses arguments au passage. */
function repondreRpc(valeur: unknown): void {
  mockRpc.mockImplementationOnce((nom: string, args: unknown) => {
    argsRpcCaptures.push({ nom, args: structuredClone(args) });
    return Promise.resolve(valeur);
  });
}

/** Arguments du premier appel capturé portant ce nom de RPC. */
function argsRpc(nom: string): unknown {
  const appel = argsRpcCaptures.find((a) => a.nom === nom);
  expect(appel, `RPC ${nom} jamais appelée`).toBeDefined();
  return appel?.args;
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

  // Motif corrigé : un nom multiligne ne forge AUCUNE ligne chez le chauffeur —
  // `valeurLigne` replie les ruptures avant l'agrégat (mesuré). Ce que le 422
  // tient ici, c'est la PARITÉ avec le CHECK : `\n` est un `[[:cntrl:]]`, donc
  // sans ce refus la valeur buterait sur `chk_evenements_contact_secours_nom_borne`
  // et ressortirait en 500 (23514) au lieu du 422 dû.
  it('refuse un nom de secours multiligne — sans lui, le CHECK le rendrait en 500', async () => {
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
  // NOM (motif corrigé en revue sécurité, l'énoncé initial était faux — relu sur
  // le code post-#324, ce filtre est inchangé) :
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
    mockRpc.mockResolvedValueOnce({ data: true, error: null }); // f_collecte_editable
    repondreRpc({ data: { id: 'evt-1' }, error: null }); // fn_modifier_evenement

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
    expect(argsRpc('fn_modifier_evenement')).toEqual(
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
    repondreRpc({ data: { id: 'evt-1' }, error: null });

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
    expect(argsRpc('fn_modifier_evenement')).toEqual(
      expect.objectContaining({
        p_updates: expect.objectContaining({
          contact_secours_nom: 'Hugo Petit',
          contact_secours_telephone: null,
        }),
      }),
    );
  });

  it('POST /admin/evenements : insère les valeurs NORMALISÉES, pas le corps de requête', async () => {
    setupAuth('admin_savr');
    mockSingle.mockResolvedValueOnce({ data: { id: 'evt-neuf' }, error: null });

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
        contact_secours_nom: '  Sonia Reyes  ',
        contact_secours_telephone: '   ',
      }),
    );

    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_secours_nom: 'Sonia Reyes',
        contact_secours_telephone: null,
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

  // ── Contre-épreuves : la valeur écrite est la valeur NORMALISÉE ──────────────
  //
  // Les cas ci-dessus prouvent que la borne REJETTE ; aucun ne prouve que ce qui
  // part en base est la valeur normalisée. Sur les QUATRE routes PATCH, la
  // consommation tient à une instruction isolée, `Object.assign(updates,
  // texteValide.valeurs)`, supprimable sans rien casser d'autre : `updates`
  // repartirait avec le corps brut et la normalisation serait calculée pour rien.
  // Mesuré sur `/admin/collectes/[id]` avant ce lot — la neutraliser laissait la
  // suite ENTIÈRE verte.
  //
  // La base ne rattrape pas ce chemin. Le seul CHECK posé sur
  // `informations_supplementaires` (migration 20260915180000) teste
  // `length(col) <= 1000` et l'absence de caractère de contrôle hors blancs :
  // `'  Quai 7  '` comme `'   '` satisfont ce prédicat. Aucun `btrim`, aucun
  // `<> ''` sur cette colonne dans TOUTES les migrations (vérifié).
  //
  // Ce que le `trim()` protège ici, relevé sur le code d'émission et NON déduit :
  // l'aval rattrape déjà le cas BLANC pour ce champ — `composerInformations-
  // Supplementaires` (packages/adapters/src/infos-acces.ts) le passe par
  // `texte()` → `.trim()` et ne garde la note que si elle est non vide (`if
  // (!base) return assemblerAgregat('', lignes, …)`, formulation post-#324), si
  // bien que `'   '` n'ouvre aucune ligne chez le chauffeur. Ce que le `trim()`
  // tient, ce sont la donnée STOCKÉE, les exports et le rendu — pas le fil.
  // (La propriété qui, elle, ne tient qu'ici est celle de
  // `contact_secours_telephone`, contre-éprouvée sur les routes événement.)
  //
  // Chaque cas porte une valeur DISTINCTE de toutes les autres du fichier :
  // `toHaveBeenCalledWith` est satisfait par n'importe quel appel enregistré sur
  // le spy, donc une valeur partagée pourrait être fournie par le test voisin si
  // le `beforeEach(resetChain)` de ce `describe` venait à disparaître.

  it('PATCH /admin/collectes/[id] : appelle fn_modifier_collecte avec la valeur NORMALISÉE, pas le body brut', async () => {
    setupAuth('admin_savr');
    mockSingle.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'programmee' },
      error: null,
    }); // `before` de l'audit
    repondreRpc({
      data: { id: 'col-1', statut: 'programmee' },
      error: null,
    }); // fn_modifier_collecte

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        informations_supplementaires: '  Quai 7, badge 4512  ',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(200);
    expect(argsRpc('fn_modifier_collecte')).toEqual(
      expect.objectContaining({
        p_updates: expect.objectContaining({
          informations_supplementaires: 'Quai 7, badge 4512',
        }),
      }),
    );
  });

  it('PATCH /traiteur/collectes/[id] : appelle fn_modifier_collecte avec la valeur NORMALISÉE, pas le body brut', async () => {
    setupAuth('traiteur_manager', 'org-traiteur-1', 'user-1');
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2030-01-15',
        heure_collecte: '08:00:00',
        evenement: {
          created_by: 'user-1',
          organisation_id: 'org-traiteur-1',
          organisation: { nom: 'Traiteur Dupont' },
        },
      },
      error: null,
    }); // lecture RLS-scopée (gate statut + autorisation acteur)
    mockSingle.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'programmee' },
      error: null,
    }); // `before` de l'audit
    repondreRpc({ data: { id: 'col-1' }, error: null }); // fn_modifier_collecte

    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/col-1', {
        informations_supplementaires: '  Portail arrière, code 8834  ',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(200);
    expect(argsRpc('fn_modifier_collecte')).toEqual(
      expect.objectContaining({
        p_updates: expect.objectContaining({
          informations_supplementaires: 'Portail arrière, code 8834',
        }),
      }),
    );
  });

  it('PATCH /gestionnaire/collectes/[id] : appelle fn_modifier_collecte avec la valeur NORMALISÉE, pas le body brut', async () => {
    setupAuth('gestionnaire_lieux', 'org-gestionnaire-1', 'user-gest-1');
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'validee',
        statut_tms: 'non_envoye',
        date_collecte: '2030-01-15',
        heure_collecte: '08:00:00',
        // Périmètre d'écriture gestionnaire : l'org de l'événement DOIT être la
        // sienne, sinon la route rend 403 avant la RPC.
        evenement: { organisation_id: 'org-gestionnaire-1' },
      },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'validee' },
      error: null,
    }); // `before` de l'audit
    repondreRpc({ data: { id: 'col-1' }, error: null }); // fn_modifier_collecte

    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/gestionnaire/collectes/col-1', {
        informations_supplementaires: '  Monte-charge nord hors service  ',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(200);
    expect(argsRpc('fn_modifier_collecte')).toEqual(
      expect.objectContaining({
        p_updates: expect.objectContaining({
          informations_supplementaires: 'Monte-charge nord hors service',
        }),
      }),
    );
  });

  it('PATCH /agence/collectes/[id] : appelle fn_modifier_collecte avec la valeur NORMALISÉE, pas le body brut', async () => {
    setupAuth('agence', 'org-agence-1', 'user-agence-1');
    // Cette route n'a pas de relecture `before` : la lecture RLS-scopée est son
    // seul SELECT avant la RPC.
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2030-01-15',
        heure_collecte: '08:00:00',
        evenement: { organisation_id: 'org-agence-1' },
      },
      error: null,
    });
    repondreRpc({ data: { id: 'col-1' }, error: null }); // fn_modifier_collecte

    const { PATCH } =
      await import('@/app/api/v1/agence/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/collectes/col-1', {
        informations_supplementaires: '  Entrée par le 12 rue Lenoir  ',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(200);
    expect(argsRpc('fn_modifier_collecte')).toEqual(
      expect.objectContaining({
        p_updates: expect.objectContaining({
          informations_supplementaires: 'Entrée par le 12 rue Lenoir',
        }),
      }),
    );
  });

  // Les deux POST ci-dessous consomment par LECTURE DIRECTE
  // (`texteValide.valeurs.informations_supplementaires ?? null`) : la valeur
  // normalisée y est structurellement la seule qui puisse partir, on ne peut pas
  // « oublier de la consommer », seulement réécrire la ligne pour relire le brut.
  // Le risque de régression est donc plus faible que sur les PATCH — pas nul, et
  // l'oracle manquait.
  it('POST /admin/collectes : passe à fn_creer_collecte la valeur NORMALISÉE', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({ data: 'col-neuve', error: null }); // fn_creer_collecte
    mockSingle.mockResolvedValueOnce({
      data: { id: 'col-neuve' },
      error: null,
    }); // relecture de la collecte créée

    const { POST } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes', {
        evenement_id: 'evt-1',
        type: 'zero_dechet',
        date_collecte: '2030-01-15',
        heure_collecte: '08:00',
        informations_supplementaires: '  Cuisine au sous-sol, ascenseur B  ',
      }),
    );

    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({
        p_info_suppl: 'Cuisine au sous-sol, ascenseur B',
      }),
    );
  });

  it('POST /programmation/evenements/[id]/collectes : passe à fn_ajouter_collecte_evenement la valeur NORMALISÉE', async () => {
    setupAuth('traiteur_manager');
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'evt-1',
        organisation_id: 'org-traiteur-1',
        nom_evenement: 'Gala',
        pax: 80,
      },
      error: null,
    }); // vérification propriété/éditabilité de l'événement
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null }) // f_collecte_editable
      .mockResolvedValueOnce({ data: 'col-neuve', error: null }); // fn_ajouter_collecte_evenement

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'zd',
        date_collecte: '2030-01-15',
        heure_collecte: '08:00',
        informations_supplementaires: '  Sonner au 3e, porte droite  ',
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );

    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_ajouter_collecte_evenement',
      expect.objectContaining({
        p_info_suppl: 'Sonner au 3e, porte droite',
      }),
    );
  });
});
