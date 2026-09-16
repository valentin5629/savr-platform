/**
 * M1.1a — Tests API /admin/organisations
 * Scénarios : liste, création, fiche, modification, désactivation, restriction ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { jourParis } from '@savr/shared/src/temps/index.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  catch: vi.fn().mockResolvedValue(null),
  is: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  // `.in()` = terminal de la requête packs actifs (statut='actif' scopé orgIds).
  // Résolu par défaut à vide → les tests qui ne posent pas de pack ne cassent pas.
  in: vi.fn().mockResolvedValue({ data: [], error: null }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

// Helper pour générer un JWT factice avec claims
function makeJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.sig`;
}

// Mock cookies + createServerClient pour api-auth
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

// ── Helpers ────────────────────────────────────────────────────────────────

function setupAuth(role: string) {
  const token = makeJwt({ user_role: role, organisation_id: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-admin-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
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

// ── Oracle « colonnes réelles » ────────────────────────────────────────────
// Le mock Supabase avale n'importe quel payload : un `.insert()` qui cite une
// colonne INEXISTANTE reste vert en test et renvoie 400 (PGRST204) en vrai.
// C'est ce qui a laissé passer `code_postal`/`ville` sur ce POST (route morte,
// relevé revue #302). L'oracle ne peut donc PAS être écrit à la main à côté de
// la route : il est lu dans `database.types.ts`, généré depuis le schéma réel.
// Le bloc lu est paramétrable : `Insert` pour un POST, `Update` pour un PATCH
// (dans `Update`, toutes les colonnes sont optionnelles → `requises` est vide,
// c'est normal : un UPDATE partiel n'a aucune colonne obligatoire).
function colonnesTable(
  schema: string,
  table: string,
  bloc: 'Insert' | 'Update' = 'Insert',
): {
  toutes: Set<string>;
  requises: Set<string>;
} {
  const src = readFileSync(
    new URL('../../../../shared/src/database.types.ts', import.meta.url),
    'utf8',
  );
  const toutes = new Set<string>();
  const requises = new Set<string>();
  let sCur: string | null = null;
  let tCur: string | null = null;
  let dansBloc = false;
  for (const l of src.split('\n')) {
    const ms = /^ {2}(\w+): \{$/.exec(l);
    if (ms) sCur = ms[1]!;
    const mt = /^ {6}(\w+): \{$/.exec(l);
    if (mt) tCur = mt[1]!;
    if (new RegExp(`^ {8}${bloc}: \\{$`).test(l)) {
      dansBloc = sCur === schema && tCur === table;
      continue;
    }
    if (!dansBloc) continue;
    if (/^ {8}\}$/.test(l)) {
      dansBloc = false;
      continue;
    }
    const mc = /^ {10}(\w+)(\??): /.exec(l);
    if (mc) {
      toutes.add(mc[1]!);
      if (mc[2] === '') requises.add(mc[1]!); // déclarée sans `?` = NOT NULL sans default
    }
  }
  return { toutes, requises };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.1a / Organisations / Authentification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/liste — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(401);
  });

  it('M1.1a/orgas/liste — 403 si rôle traiteur_manager', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(403);
  });
});

describe('M1.1a / Organisations / Liste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/liste — 200 : les compteurs ZD/AG viennent de la RPC (oracle + anti-vacuité)', async () => {
    // Bug pré-existant réparé : la RPC count_collectes_par_org n'existait pas en
    // base → 0 partout. Ce test ne se contente PAS de vérifier le status : il
    // FAKE la RPC en FILTRANT sur `type_collecte` (zd ≠ ag) et asserte le
    // mapping réel des compteurs dans chaque ligne. Sans ces assertions, un
    // retour figé / un swap zd↔ag / une RPC ignorée resteraient verts.
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [
        {
          id: 'org-1',
          raison_sociale: 'Traiteur Un',
          type: 'traiteur',
          siret: '12345678901234',
          actif: true,
          logo_url: null,
          users: [{ count: 3 }],
        },
        {
          id: 'org-2',
          raison_sociale: 'Traiteur Deux',
          type: 'traiteur',
          siret: '43210987654321',
          actif: true,
          logo_url: null,
          users: [{ count: 1 }],
        },
      ],
      error: null,
      count: 2,
    });

    // Fake FILTRANT : renvoie des données DIFFÉRENTES selon `type_collecte`.
    // org-2 est volontairement ABSENTE du jeu ZD → doit retomber à 0 (anti-vacuité).
    // Toute RPC inattendue throw (fail-closed) : une dérive de la route casse fort.
    mockSupabaseChain.rpc.mockImplementation(
      (fn: string, params: { type_collecte: string; depuis: string }) => {
        if (fn !== 'count_collectes_par_org') {
          throw new Error(`RPC inattendue: ${fn}`);
        }
        const parType: Record<
          string,
          { organisation_id: string; nb: number }[]
        > = {
          zd: [{ organisation_id: 'org-1', nb: 12 }],
          ag: [
            { organisation_id: 'org-1', nb: 5 },
            { organisation_id: 'org-2', nb: 7 },
          ],
        };
        return Promise.resolve({
          data: parType[params.type_collecte] ?? [],
          error: null,
        });
      },
    );

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        id: string;
        nb_collectes_zd_12m: number;
        nb_collectes_ag_12m: number;
      }[];
      total: number;
    };
    expect(json.total).toBe(2);

    const byId = Object.fromEntries(json.data.map((r) => [r.id, r]));
    // org-1 : présente dans ZD (12) ET AG (5) → mapping correct, pas de swap.
    expect(byId['org-1']?.nb_collectes_zd_12m).toBe(12);
    expect(byId['org-1']?.nb_collectes_ag_12m).toBe(5);
    // org-2 : ABSENTE du jeu ZD → 0 (défaut `?? 0`) ; présente en AG (7).
    expect(byId['org-2']?.nb_collectes_zd_12m).toBe(0);
    expect(byId['org-2']?.nb_collectes_ag_12m).toBe(7);

    // Contrat d'appel : 1 appel zd + 1 appel ag, `depuis` au format date (12 mois).
    const rpcCalls = mockSupabaseChain.rpc.mock.calls as [
      string,
      { type_collecte: string; depuis: string },
    ][];
    expect(rpcCalls.map((c) => c[1].type_collecte).sort()).toEqual([
      'ag',
      'zd',
    ]);
    for (const [fn, args] of rpcCalls) {
      expect(fn).toBe('count_collectes_par_org');
      expect(args.depuis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Fenêtre glissante : `depuis` ≈ aujourd'hui − 1 an.
    const attendu = new Date();
    attendu.setFullYear(attendu.getFullYear() - 1);
    expect(rpcCalls[0]?.[1].depuis).toBe(jourParis(attendu));
  });

  it('M1.1a/orgas/liste — pack actif par organisation (statut=actif, scopé aux orgs de la page, — si aucun)', async () => {
    // Revue E2E : colonne « Pack actif » de la liste (divergence CDC §06.06 L555
    // assumée par Val, cf. _Divergences/BOA_20260718).
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [
        {
          id: 'org-1',
          raison_sociale: 'Avec pack',
          type: 'traiteur',
          siret: null,
          actif: true,
          logo_url: null,
          users: [{ count: 1 }],
        },
        {
          id: 'org-2',
          raison_sociale: 'Sans pack',
          type: 'traiteur',
          siret: null,
          actif: true,
          logo_url: null,
          users: [{ count: 1 }],
        },
      ],
      error: null,
      count: 2,
    });
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    // Postgres a filtré statut='actif' + scopé aux orgIds → seul org-1 remonte.
    mockSupabaseChain.in.mockResolvedValueOnce({
      data: [
        {
          organisation_id: 'org-1',
          type_pack: 'pack_30',
          credits_initiaux: 30,
          credits_consommes: 27,
        },
      ],
      error: null,
    });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        id: string;
        pack_actif: { type_pack: string; credits_restants: number } | null;
      }[];
    };

    // org-1 : pack mappé, restants = credits_initiaux − credits_consommes = 3.
    expect(json.data.find((o) => o.id === 'org-1')?.pack_actif).toEqual({
      type_pack: 'pack_30',
      credits_restants: 3,
    });
    // org-2 : aucune ligne pack actif → null (anti-vacuité : pas de fuite d'un
    // pack d'une autre org, et pas de pack fantôme).
    expect(json.data.find((o) => o.id === 'org-2')?.pack_actif).toBeNull();

    // Oracle filtrage : la requête packs demande bien statut='actif' ET est
    // scopée EXACTEMENT aux orgs de la page (retirer l'un ou l'autre casse ici).
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith('statut', 'actif');
    expect(mockSupabaseChain.in).toHaveBeenCalledWith('organisation_id', [
      'org-1',
      'org-2',
    ]);
  });

  it('M1.1a/orgas/liste — le select N’embarque PAS `evenements` (FK ambiguë → 300)', async () => {
    // Garde anti-régression : `evenements` a 2 FK vers `organisations`
    // (organisation_id + client_organisateur_organisation_id) → un embed non
    // désambiguïsé renvoie HTTP 300 PGRST201 et vide toute la liste Clients.
    // Les compteurs ZD/AG viennent de la RPC count_collectes_par_org, pas d'un
    // embed. Vérifié réel contre savr-dev (206 + 14 organisations).
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [],
      error: null,
      count: 0,
    });
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    await GET(makeReq('GET', '/api/v1/admin/organisations'));

    const selectArg = mockSupabaseChain.select.mock.calls[0]?.[0] as string;
    expect(selectArg).not.toMatch(/evenements/);
    expect(selectArg).toContain('users:users(count)');
  });
});

describe('M1.1a / Organisations / Création', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/creation — 201 + l’INSERT ne cite QUE des colonnes réelles de plateforme.organisations', async () => {
    // Garde anti-régression de la route morte (#302) : le POST poussait
    // `code_postal` + `ville`, absentes de `plateforme.organisations` (source de
    // vérité de l'adresse postale détaillée = `entites_facturation`) → PGRST204
    // à chaque création par le staff. Aucun test ne regardait le payload, d'où
    // le silence. Oracle indépendant de la route : les colonnes `Insert` lues
    // dans `database.types.ts` (généré depuis le schéma réel).
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-new',
        nom: 'Nouvelle Orga',
        raison_sociale: 'Nouvelle Orga',
        type: 'traiteur',
        actif: true,
      },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', {
        nom: 'Nouvelle Orga',
        raison_sociale: 'Nouvelle Orga SAS',
        type: 'traiteur',
        email_principal: 'contact@nouvelle-orga.fr',
        // (a) Champs qu'un client peut légitimement envoyer : ils ne doivent
        // pas atteindre l'INSERT (ils vivent sur `entites_facturation`).
        code_postal: '75002',
        ville: 'Paris',
        // (b) Colonnes RÉELLES mais système / admin-only : elles ne doivent pas
        // davantage atteindre l'INSERT. C'est la classe de régression #302
        // (volet CRÉATION), et elle est invisible au filtre « colonne fantôme »
        // comme à `check:column-db` — ces colonnes existent, tsc les accepte, et
        // sous service_role le trigger anti-escalade EXEMPTE l'appelant
        // (`f_app_role()` NULL) : l'allowlist applicative est la seule barrière.
        est_shadow: true,
        actif: false,
        notes_internes: 'interne',
        tarif_refacture_pax_zd: 99,
        grille_tarifaire_zd_id: 'grille-x',
        cree_par_organisation_id: 'org-pirate',
        id: 'id-force',
      }),
    );
    expect(res.status).toBe(201);

    const { toutes, requises } = colonnesTable('plateforme', 'organisations');
    // Garde de l'oracle lui-même (fail-closed si le parseur dérive).
    expect(toutes.has('raison_sociale')).toBe(true);
    expect(toutes.has('code_postal')).toBe(false);
    expect([...requises].sort()).toEqual(['nom', 'type']);

    const payload = mockSupabaseChain.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).toBeDefined();

    // 1. Aucune colonne fantôme (le message nomme les coupables).
    const fantomes = Object.keys(payload).filter((k) => !toutes.has(k));
    expect(fantomes).toEqual([]);

    // 1bis. ALLOWLIST FERMÉE — ensemble EXACT, pas une simple inclusion.
    //    Un `...rest` ou une clé recopiée du body ferait entrer une colonne
    //    RÉELLE mais système/admin-only (`est_shadow`, `tarif_refacture_pax_zd`,
    //    `cree_par_organisation_id`…) : invisible au filtre « fantôme » ci-dessus
    //    ET à `check:column-db`. Toute colonne ajoutée ici doit être un choix
    //    délibéré, donc passer par cette liste (relevé reviewer-rls-securite).
    expect(Object.keys(payload).sort()).toEqual(
      [
        'adresse',
        'email_principal',
        'nom',
        'raison_sociale',
        'siret',
        'telephone',
        'type',
      ].sort(),
    );

    // 2. Toutes les colonnes NOT NULL sans default sont fournies et non vides
    //    (sans `nom`, l'INSERT violerait 23502 même après retrait des fantômes).
    for (const c of requises) {
      expect(
        payload[c],
        `colonne requise « ${c} » absente du payload`,
      ).toBeTruthy();
    }
    expect(payload.nom).toBe('Nouvelle Orga');
  });

  it('M1.1a/orgas/creation — nom, raison sociale et email écrits trimés, sans repli nom = raison sociale', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'org-new', actif: true },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', {
        nom: '  Kaspia ',
        raison_sociale: 'KASPIA RECEPTIONS SAS',
        type: 'traiteur',
        email_principal: ' contact@kaspia.fr ',
      }),
    );
    expect(res.status).toBe(201);
    const payload = mockSupabaseChain.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.nom).toBe('Kaspia');
    expect(payload.raison_sociale).toBe('KASPIA RECEPTIONS SAS');
    expect(payload.email_principal).toBe('contact@kaspia.fr');
  });

  // CDC §06.06 bouton « Nouvelle organisation » : nom, raison sociale, type et
  // email principal obligatoires. La route tourne sous service_role → c'est la
  // SEULE barrière pour un appel direct (la modale n'est qu'un confort).
  const BODY_COMPLET = {
    nom: 'Kaspia',
    raison_sociale: 'KASPIA RECEPTIONS SAS',
    type: 'traiteur',
    email_principal: 'contact@kaspia.fr',
  };
  it.each([
    ['nom', undefined],
    ['nom', '   '],
    ['raison_sociale', undefined],
    ['type', undefined],
    ['email_principal', undefined],
    ['email_principal', ''],
    ['email_principal', 42],
  ])(
    'M1.1a/orgas/creation — 422 + champs_invalides=[%s] si absent ou blanc (%j), rien n’est écrit',
    async (champ, valeur) => {
      setupAuth('admin_savr');
      const { POST } =
        await import('@/app/api/v1/admin/organisations/route.js');
      const body: Record<string, unknown> = { ...BODY_COMPLET };
      if (valeur === undefined) delete body[champ];
      else body[champ] = valeur;
      const res = await POST(
        makeReq('POST', '/api/v1/admin/organisations', body),
      );
      expect(res.status).toBe(422);
      const json = (await res.json()) as { champs_invalides: string[] };
      expect(json.champs_invalides).toEqual([champ]);
      expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
    },
  );

  it('M1.1a/orgas/creation — 422 si type invalide', async () => {
    setupAuth('ops_savr');
    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', {
        nom: 'Test',
        raison_sociale: 'Test',
        type: 'type_inconnu',
        email_principal: 'a@b.fr',
      }),
    );
    expect(res.status).toBe(422);
  });

  it('M1.1a/orgas/creation — 422 si raison_sociale manquante', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', { type: 'traiteur' }),
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.1a / Organisations / Modification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/tarif-refacture-admin-only — 403 si ops_savr tente de modifier tarif_refacture_pax_zd', async () => {
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        tarif_refacture_pax_zd: 2.5,
      }),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/orgas/grille-tarifaire-admin-only — 403 si ops_savr tente de modifier grille_tarifaire_zd_id', async () => {
    // Symétrique de tarif_refacture_pax_zd : la grille tarifaire ZD engage le
    // prix facturé, elle est réservée à admin_savr (la garde existait sans test).
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        grille_tarifaire_zd_id: 'grille-x',
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(res.status).toBe(403);
    // Fail-closed : rien ne part en base quand la garde a répondu 403.
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
  });

  it("M1.1a/orgas/modification — l'UPDATE ne cite QUE les colonnes de l'allowlist EDITABLE_FIELDS", async () => {
    // Garde anti-régression de la faille M8 : un `...rest` recopiait n'importe
    // quelle clé du body dans l'UPDATE service_role (RLS bypassée) → un staff
    // ops_savr écrivait des colonnes système (est_shadow,
    // cree_par_organisation_id, id, created_at…). L'allowlist a fermé le trou
    // mais RIEN ne l'épinglait (relevé reviewer-rls-securite, PR #303) : un
    // futur `...rest` repasserait en silence. Rappel du contexte qui rend ce
    // trou sérieux : sous service_role le trigger anti-escalade
    // trg_block_org_staff_cols_insert EXEMPTE l'appelant (`f_app_role()` NULL)
    // → la garde applicative est la SEULE barrière.
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-1',
        raison_sociale: 'Orga',
        type: 'traiteur',
        actif: true,
        tarif_refacture_pax_zd: 1.5,
      },
      error: null,
    });

    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        // (a) Champs métier légitimes = l'allowlist complète.
        nom: 'Kaspia',
        raison_sociale: 'KASPIA RECEPTIONS SAS',
        type: 'traiteur',
        siret: '12345678901234',
        email_principal: 'contact@kaspia.fr',
        telephone: '0102030405',
        adresse: '17 rue de Marignan',
        logo_url: 'https://cdn/logo.png',
        notes_internes: 'interne',
        actif: true,
        mode_facturation_zd: 'par_collecte',
        // (b) Colonnes RÉELLES mais système : elles existent sur
        // plateforme.organisations, tsc les accepte et `check:column-db` les
        // valide — seule l'allowlist les arrête.
        est_shadow: true,
        cree_par_organisation_id: 'org-pirate',
        id: 'id-force',
        created_at: '1970-01-01T00:00:00Z',
        updated_at: '1970-01-01T00:00:00Z',
        // (c) Clés qui n'existent nulle part (typo, champ d'un autre écran).
        code_postal: '75008',
        champ_invente: 'x',
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(res.status).toBe(200);

    const payload = mockSupabaseChain.update.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).toBeDefined();

    // 1. Aucune colonne fantôme (PGRST204 en vrai) — le message nomme les coupables.
    const { toutes } = colonnesTable('plateforme', 'organisations', 'Update');
    expect(toutes.has('raison_sociale')).toBe(true); // garde de l'oracle lui-même
    expect(toutes.has('code_postal')).toBe(false);
    expect(Object.keys(payload).filter((k) => !toutes.has(k))).toEqual([]);

    // 2. Aucune fuite nommée : si un `...rest` revient, l'échec cite la clé.
    const interdits = [
      'est_shadow',
      'cree_par_organisation_id',
      'id',
      'created_at',
      'updated_at',
      'code_postal',
      'champ_invente',
    ];
    const fuites = Object.keys(payload).filter((k) => interdits.includes(k));
    expect(
      fuites,
      `clés interdites recopiées dans l'UPDATE : ${fuites.join(', ')}`,
    ).toEqual([]);

    // 3. ALLOWLIST FERMÉE — ensemble EXACT, pas une inclusion : toute colonne
    //    ajoutée à l'UPDATE doit être un choix délibéré passant par ce test.
    expect(Object.keys(payload).sort()).toEqual(
      [
        'nom',
        'raison_sociale',
        'type',
        'siret',
        'email_principal',
        'telephone',
        'adresse',
        'logo_url',
        'notes_internes',
        'actif',
        'mode_facturation_zd',
      ].sort(),
    );
  });

  it('M1.1a/orgas/modification — admin_savr : les 2 champs admin-only entrent, les colonnes système restent dehors', async () => {
    // Le branchement admin_savr ajoute tarif_refacture_pax_zd et
    // grille_tarifaire_zd_id APRÈS la boucle d'allowlist : il a son propre
    // risque de `...rest`. Ensemble EXACT ici aussi.
    setupAuth('admin_savr');
    // §07/06 : pré-fetch de l'ancien tarif AVANT l'UPDATE (audit_log).
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { tarif_refacture_pax_zd: 1.5 },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-1',
        raison_sociale: 'Orga',
        type: 'traiteur',
        actif: true,
        tarif_refacture_pax_zd: 2.5,
      },
      error: null,
    });

    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        raison_sociale: 'KASPIA RECEPTIONS SAS',
        tarif_refacture_pax_zd: 2.5,
        grille_tarifaire_zd_id: 'grille-x',
        est_shadow: true,
        cree_par_organisation_id: 'org-pirate',
        id: 'id-force',
        created_at: '1970-01-01T00:00:00Z',
        updated_at: '1970-01-01T00:00:00Z',
        champ_invente: 'x',
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(res.status).toBe(200);

    const payload = mockSupabaseChain.update.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(
      [
        'raison_sociale',
        'tarif_refacture_pax_zd',
        'grille_tarifaire_zd_id',
      ].sort(),
    );
    // Non-vacuité : les 2 champs admin-only sont bien passés (valeur arrondie
    // à 2 décimales pour le tarif), donc l'ensemble exact ci-dessus n'est pas
    // vert « par accident » (par ex. si la branche admin sautait).
    expect(payload.tarif_refacture_pax_zd).toBe(2.5);
    expect(payload.grille_tarifaire_zd_id).toBe('grille-x');
  });

  it('M1.1a/orgas/modification — 200 si admin_savr modifie tarif_refacture_pax_zd', async () => {
    setupAuth('admin_savr');
    // R15 (§07/06 tarif_refacture_pax_zd_update) : pré-fetch de l'ancien tarif
    // AVANT l'UPDATE pour figer l'avant/après dans audit_log.
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { tarif_refacture_pax_zd: 1.5 },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-1',
        raison_sociale: 'Orga',
        type: 'traiteur',
        actif: true,
        tarif_refacture_pax_zd: 2.5,
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        tarif_refacture_pax_zd: 2.5,
      }),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(200);
  });

  it('M1.1a/orgas/desactivation — 200 pour admin et ops', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', actif: false },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/organisations/[id]/desactiver/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations/org-1/desactiver'),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { actif: boolean };
    expect(json.actif).toBe(false);
  });
});

describe('M1.1a / Organisations / Fiche (GET [id])', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/fiche — 200 + select sans colonnes/relations fantômes', async () => {
    // Garde anti-régression du crash « écran blanc » (P0) : le select de la
    // fiche ne doit référencer NI `code_postal`/`ville` (colonnes inexistantes,
    // HTTP 400) NI `type_remise` (réel = `activite`) et doit désambiguïser
    // `tarifs_negocie!organisation_id` (2 FK → HTTP 300 sinon). Vérifié réel
    // contre savr-dev (HTTP 200).
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-1',
        raison_sociale: 'Kaspia',
        type: 'traiteur',
        entites_facturation: [],
        organisations_domaines_email: [],
        users: [],
        packs_antgaspi: [],
        tarifs_negocie: [],
      },
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations/org-1'), {
      params: Promise.resolve({ id: 'org-1' }),
    });
    expect(res.status).toBe(200);

    const selectArg = mockSupabaseChain.select.mock.calls[0]?.[0] as string;
    expect(selectArg).not.toMatch(/code_postal|ville|type_remise/);
    expect(selectArg).toContain('tarifs_negocie!organisation_id');
    expect(selectArg).toContain('activite');
  });

  it('M1.1a/orgas/fiche — 404 si organisation introuvable', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'not found' },
    });
    const { GET } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
