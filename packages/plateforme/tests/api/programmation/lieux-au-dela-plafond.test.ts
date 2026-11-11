/**
 * Recherche de lieux quand l'Admin programme une collecte POUR un client
 * (GET /api/v1/programmation/lieux?organisation_id=…), au-delà des plafonds de
 * l'API de données.
 *
 * Une réponse est amputée à 1 000 lignes sans erreur, et un filtre `in.(…)` de
 * plus de quelques centaines d'identifiants fait échouer la lecture (mesures :
 * `src/lib/pdf/selection-par-pages.ts`). La route relisait tous les événements
 * de l'organisation cible, puis passait tous ses lieux dans un seul filtre :
 * passé ce volume, des lieux manquaient dans les propositions, ou la recherche
 * échouait. Elle demande désormais le périmètre à la base, en un appel
 * (`f_lieux_visibles_organisation`), et y pose les filtres de l'écran.
 *
 * CE QUE CE FICHIER PROUVE : ce que fait la ROUTE — un seul appel pour le
 * périmètre, les filtres du chemin client, l'erreur lue, des lectures bornées.
 * La fonction est ici jouée par `lieuxVisibles`, qui lit les tables ENTIÈRES du
 * banc comme le fait la base. Ce que rend la vraie fonction (branches,
 * cloisonnement, égalité avec la RLS, volume, refus pour un compte client) est
 * prouvé sur la base par
 * `supabase/tests/programmation_lieux_visibles_organisation.test.sql`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  creerApiPlafonnee,
  PLAFOND_IDS,
  PLAFOND_LIGNES,
  type Ligne,
} from '@/test-utils/api-donnees-plafonnee';

type Api = ReturnType<typeof creerApiPlafonnee>;
type Client = {
  from: (table: string) => unknown;
  rpc: (nom: string, args?: Ligne) => unknown;
};

/** Lectures sous la session de l'appelant, puis lectures service_role. */
let rls: Api = creerApiPlafonnee();
let service: Api = creerApiPlafonnee();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (table: string) => (rls.client as Client).from(table),
    rpc: (nom: string, args?: Ligne) => (rls.client as Client).rpc(nom, args),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => service.client,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

const FONCTION = 'f_lieux_visibles_organisation';
const ORG_SAVR = '0a000000-0000-4000-8000-0000000000aa';
const CLIENT = '0a000000-0000-4000-8000-000000000001';
const AUTRE = '0a000000-0000-4000-8000-000000000002';

const COLONNES = [
  'id',
  'nom',
  'adresse_acces',
  'code_postal',
  'ville',
  'acces_details',
  'acces_office',
  'stationnement',
  'type_vehicule_max',
  'controle_acces_requis_default',
  'contraintes_horaires',
  'flux_autorises',
];

function connecter(role: string, organisation: string): void {
  const jeton = `h.${Buffer.from(
    JSON.stringify({
      aal: 'aal2',
      user_role: role,
      organisation_id: organisation,
    }),
  ).toString('base64url')}.s`;
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jeton } },
    error: null,
  });
}

const idLieu = (i: number) =>
  `0c000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const suite = <T>(n: number, ligne: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => ligne(i));

function lieu(i: number, nom: string, plus: Ligne = {}): Ligne {
  return {
    id: idLieu(i),
    nom,
    adresse_acces: `${i} rue du Test`,
    code_postal: '75001',
    ville: 'Paris',
    acces_details: null,
    acces_office: null,
    stationnement: null,
    type_vehicule_max: 'fourgon',
    controle_acces_requis_default: false,
    contraintes_horaires: null,
    flux_autorises: null,
    actif: true,
    code_site_viparis: null,
    // Hors de la liste des colonnes proposées : ne doit jamais sortir.
    commentaires_internes: 'interne',
    ...plus,
  };
}

const evenement = (i: number, organisation: string, lieuId: string): Ligne => ({
  id: `0e000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  organisation_id: organisation,
  traiteur_operationnel_organisation_id: organisation,
  lieu_id: lieuId,
});

/**
 * Ce que rend la fonction SQL, joué sur les tables ENTIÈRES du banc (la base ne
 * connaît ni le plafond de lignes ni la longueur d'un filtre) : lieux rattachés,
 * lieux des événements programmés, et lieux des événements opérés pour une
 * organisation de type traiteur.
 *
 * Le code site VIPARIS est retiré des lignes rendues : la route ne le demande
 * pas à la fonction (il est hors de sa liste de colonnes), il ne peut donc lui
 * venir que de sa lecture dédiée, bornée aux lieux proposés.
 */
function lieuxVisibles(tables: Record<string, Ligne[]>, organisation: unknown) {
  const de = (table: string) => tables[table] ?? [];
  const ids = new Set<unknown>();
  for (const r of de('organisations_lieux'))
    if (r.organisation_id === organisation) ids.add(r.lieu_id);
  for (const e of de('evenements'))
    if (e.organisation_id === organisation) ids.add(e.lieu_id);
  const traiteur = de('organisations').some(
    (o) => o.id === organisation && o.type === 'traiteur',
  );
  if (traiteur)
    for (const e of de('evenements'))
      if (e.traiteur_operationnel_organisation_id === organisation)
        ids.add(e.lieu_id);
  return de('lieux')
    .filter((l) => ids.has(l.id))
    .map(({ code_site_viparis: _horsListe, ...ligne }) => ligne);
}

function baseDeService(tables: Record<string, Ligne[]>): Api {
  const api = creerApiPlafonnee(tables);
  api.rpcs[FONCTION] = (args) =>
    lieuxVisibles(api.tables, args.p_organisation_id);
  return api;
}

type LieuPropose = Record<string, unknown> & { id: string; nom: string };

async function chercher(parametres: Record<string, string>) {
  const { GET } = await import('@/app/api/v1/programmation/lieux/route.js');
  const res = await GET(
    new NextRequest(
      `http://localhost/api/v1/programmation/lieux?${new URLSearchParams(parametres)}`,
    ),
  );
  const corps = (await res.json()) as LieuPropose[] | { error: string };
  return {
    statut: res.status,
    corps,
    lieux: Array.isArray(corps) ? corps : [],
    noms: Array.isArray(corps) ? corps.map((l) => l.nom) : [],
  };
}

const nomRange = (i: number) => `Lieu ${String(i).padStart(4, '0')}`;

beforeEach(() => {
  vi.clearAllMocks();
  rls = creerApiPlafonnee();
  service = creerApiPlafonnee();
  connecter('admin_savr', ORG_SAVR);
});

describe('M1.2 / Lieux — recherche de l’Admin pour un client au-delà des plafonds', () => {
  it(`au-delà de ${PLAFOND_LIGNES} événements : le lieu du seul dernier événement est proposé`, async () => {
    // 1 100 événements sur 50 lieux. Les 1 099 premiers tournent sur 49 lieux ;
    // le dernier est le SEUL à se tenir au 50e, dont le nom vient en tête.
    const lieux = [
      ...suite(49, (i) => lieu(i, nomRange(i))),
      lieu(49, 'AAA Lieu du dernier événement'),
    ];
    service = baseDeService({
      organisations: [{ id: CLIENT, type: 'traiteur' }],
      organisations_lieux: [],
      evenements: suite(PLAFOND_LIGNES + 100, (i) =>
        evenement(
          i,
          CLIENT,
          i === PLAFOND_LIGNES + 99 ? idLieu(49) : idLieu(i % 49),
        ),
      ),
      lieux,
    });

    const r = await chercher({ organisation_id: CLIENT });

    expect(r.statut).toBe(200);
    expect(r.noms).toHaveLength(20);
    expect(r.noms[0]).toBe('AAA Lieu du dernier événement');
  });

  it(`au-delà de ${PLAFOND_IDS} lieux distincts : la recherche répond`, async () => {
    // 450 événements, chacun sur son lieu : 450 identifiants.
    service = baseDeService({
      organisations: [{ id: CLIENT, type: 'traiteur' }],
      organisations_lieux: [],
      evenements: suite(PLAFOND_IDS + 60, (i) =>
        evenement(i, CLIENT, idLieu(i)),
      ),
      lieux: suite(PLAFOND_IDS + 60, (i) => lieu(i, nomRange(i))),
    });

    const r = await chercher({ organisation_id: CLIENT });

    expect(r.statut).toBe(200);
    expect(r.noms).toEqual(suite(20, nomRange));
  });

  it('le périmètre est demandé à la base en un appel, avec les filtres de l’écran', async () => {
    service = baseDeService({
      organisations: [
        { id: CLIENT, type: 'traiteur' },
        { id: AUTRE, type: 'traiteur' },
      ],
      organisations_lieux: [],
      evenements: [
        evenement(0, CLIENT, idLieu(0)),
        evenement(1, CLIENT, idLieu(1)),
        evenement(2, AUTRE, idLieu(2)),
      ],
      lieux: [
        lieu(0, 'Pavillon B'),
        lieu(1, 'Pavillon A'),
        lieu(2, 'Pavillon du concurrent'),
      ],
    });

    const r = await chercher({ organisation_id: CLIENT, q: 'Pavillon' });

    // Les lieux du client seulement, rangés par nom.
    expect(r.noms).toEqual(['Pavillon A', 'Pavillon B']);
    expect(service.appelsRpc).toEqual([
      { nom: FONCTION, args: { p_organisation_id: CLIENT } },
    ]);

    const [lecture, ...autres] = service.lecturesDe(`rpc.${FONCTION}`);
    expect(autres).toEqual([]);
    expect(lecture!.colonnes.split(',').map((c) => c.trim())).toEqual(COLONNES);
    expect(lecture!.filtres).toEqual([
      ['eq', 'actif', true],
      [
        'or',
        '',
        'nom.ilike.%Pavillon%,adresse_acces.ilike.%Pavillon%,ville.ilike.%Pavillon%',
      ],
    ]);
    expect(lecture!.tris).toEqual(['nom']);
    expect(lecture!.limite).toBe(20);

    // Plus aucune relecture de l'historique : ni événements, ni rattachements,
    // ni type d'organisation. Reste la lecture des codes site VIPARIS, bornée
    // aux lieux proposés.
    expect(service.lectures.map((l) => l.table)).toEqual([
      `rpc.${FONCTION}`,
      'lieux',
    ]);
    expect(service.lecturesDe('lieux')[0]!.filtres[0]).toEqual([
      'in',
      'id',
      [idLieu(1), idLieu(0)],
    ]);
    // Rien n'est lu sous la session de l'Admin.
    expect(rls.lectures).toEqual([]);
  });

  it('une erreur de la base est rendue comme une erreur, pas comme une liste vide', async () => {
    service = baseDeService({
      organisations: [{ id: CLIENT, type: 'traiteur' }],
      evenements: [evenement(0, CLIENT, idLieu(0))],
      lieux: [lieu(0, 'Pavillon')],
    });
    service.pannes[`rpc.${FONCTION}`] = {
      message: 'canceling statement due to statement timeout',
      code: '57014',
    };

    const r = await chercher({ organisation_id: CLIENT });

    expect(r.statut).toBe(500);
    // Message neutre : le détail de la base n'est pas renvoyé au navigateur.
    expect(r.corps).toEqual({ error: 'Erreur serveur' });
  });

  it('un lieu désactivé n’est pas proposé, et aucune colonne interne n’est demandée à la base', async () => {
    service = baseDeService({
      organisations: [{ id: CLIENT, type: 'traiteur' }],
      evenements: [
        evenement(0, CLIENT, idLieu(0)),
        evenement(1, CLIENT, idLieu(1)),
      ],
      lieux: [
        lieu(0, 'AAA Lieu désactivé', { actif: false }),
        lieu(1, 'Pavillon', { code_site_viparis: 'PCP' }),
      ],
    });

    const r = await chercher({ organisation_id: CLIENT });

    expect(r.noms).toEqual(['Pavillon']);
    // Le code site VIPARIS est rendu avec le lieu, comme sur le chemin client.
    expect(r.lieux[0]!.code_site_viparis).toBe('PCP');
    // La projection demandée à la base ne porte aucune colonne interne.
    const { colonnes } = service.lecturesDe(`rpc.${FONCTION}`)[0]!;
    expect(colonnes).not.toContain('commentaires_internes');
    expect(colonnes).not.toContain('actif');
  });

  it('le terme saisi est nettoyé avant d’entrer dans le filtre de recherche', async () => {
    service = baseDeService({
      organisations: [{ id: CLIENT, type: 'traiteur' }],
      evenements: [evenement(0, CLIENT, idLieu(0))],
      lieux: [lieu(0, 'Pavillon')],
    });

    // Une virgule ou une parenthèse ajouterait une condition au filtre.
    await chercher({ organisation_id: CLIENT, q: 'Pav,actif.is.null)' });

    const filtreOr = service
      .lecturesDe(`rpc.${FONCTION}`)[0]!
      .filtres.find(([operateur]) => operateur === 'or');
    expect(filtreOr).toEqual([
      'or',
      '',
      'nom.ilike.%Pav actif.is.null%,adresse_acces.ilike.%Pav actif.is.null%,ville.ilike.%Pav actif.is.null%',
    ]);
  });

  it('sans organisation cible, ou avec un identifiant mal formé : aucune proposition, aucun appel', async () => {
    service = baseDeService({
      organisations: [{ id: CLIENT, type: 'traiteur' }],
      evenements: [evenement(0, CLIENT, idLieu(0))],
      lieux: [lieu(0, 'Pavillon')],
    });

    for (const parametres of [
      {},
      { organisation_id: '' },
      { organisation_id: 'pas-un-uuid' },
      { organisation_id: `${CLIENT}) or (1=1` },
    ] as Array<Record<string, string>>) {
      const r = await chercher(parametres);
      expect(r.statut).toBe(200);
      expect(r.corps).toEqual([]);
    }
    expect(service.appelsRpc).toEqual([]);
    expect(service.lectures).toEqual([]);
  });

  it('un compte client ne déclenche jamais la fonction, même en visant une autre organisation', async () => {
    connecter('traiteur_manager', CLIENT);
    service = baseDeService({
      organisations: [{ id: AUTRE, type: 'traiteur' }],
      evenements: [evenement(0, AUTRE, idLieu(0))],
      lieux: [lieu(0, 'Lieu du concurrent')],
    });
    // Ce que la RLS rend au demandeur : son propre lieu.
    rls = creerApiPlafonnee({
      v_lieux_clients: [lieu(5, 'Mon lieu')],
    });

    const r = await chercher({ organisation_id: AUTRE });

    expect(r.statut).toBe(200);
    expect(r.noms).toEqual(['Mon lieu']);
    expect(service.appelsRpc).toEqual([]);
    expect(rls.appelsRpc).toEqual([]);
    expect(rls.lectures.map((l) => l.table)).toEqual(['v_lieux_clients']);
  });
});
