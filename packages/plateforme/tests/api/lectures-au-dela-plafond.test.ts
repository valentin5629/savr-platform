/**
 * Listes et écrans clients au-delà des plafonds de l'API de données.
 *
 * Une réponse est amputée à 1 000 lignes sans erreur, et un filtre `in.(…)` de
 * plus de quelques centaines d'identifiants fait échouer la lecture (mesures :
 * `src/lib/pdf/selection-par-pages.ts`). Les routes ci-dessous lisaient leurs
 * collectes en une requête : passé ce volume (historique Bubble), les listes
 * perdaient leurs lignes les plus anciennes et les cumuls étaient faux, sans
 * message. Chaque cas échoue sur une lecture unique ou une liste entière.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { jourParis } from '@savr/shared/src/temps/index.js';
import {
  creerApiPlafonnee,
  PLAFOND_IDS,
  PLAFOND_LIGNES,
  type Ligne,
} from '@/test-utils/api-donnees-plafonnee';
import { TAILLE_PAGE } from '@/lib/pdf/selection-par-pages.js';

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

const ORG = '0a000000-0000-4000-8000-000000000001';
const TRAITEUR = '0b000000-0000-4000-8000-000000000001';
const LIEU = '0c000000-0000-4000-8000-000000000001';
const AUJOURDHUI = jourParis(new Date());

function connecter(role: string): void {
  const jeton = `h.${Buffer.from(
    JSON.stringify({ aal: 'aal2', user_role: role, organisation_id: ORG }),
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

const requete = (chemin: string) =>
  new NextRequest(`http://localhost${chemin}`, { method: 'GET' });

const id = (prefixe: string, i: number) =>
  `${prefixe}-${String(i).padStart(5, '0')}`;
const suite = <T>(n: number, ligne: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => ligne(i));

/** Collecte telle que les routes la lisent, embeds compris. */
function collecte(
  i: number,
  type: 'zero_dechet' | 'anti_gaspi',
  plus: Ligne = {},
): Ligne {
  return {
    id: id('col', i),
    type,
    statut: 'cloturee',
    statut_tms: null,
    // Un jour sur trois, pour que le tri par date se voie.
    date_collecte: `2026-03-${String(10 + (i % 3)).padStart(2, '0')}`,
    heure_collecte: '23:00:00',
    pax: 100,
    informations_completes: true,
    taux_recyclage: type === 'zero_dechet' ? 80 : null,
    co2_evite_kg: 2,
    realisee_at: '2026-03-10T22:00:00Z',
    collecte_flux:
      type === 'zero_dechet'
        ? [{ poids_reel_kg: 10, flux_dechets: { code: 'biodechets' } }]
        : [],
    attributions_antgaspi:
      type === 'anti_gaspi' ? { volume_repas_realise: 3 } : null,
    evenements: {
      id: id('evt', i),
      organisation_id: ORG,
      client_organisateur_organisation_id: ORG,
      traiteur_operationnel_organisation_id: TRAITEUR,
      created_by: 'user-1',
      lieu_id: LIEU,
      nom_evenement: `Événement ${i}`,
      nom_client_organisateur: 'Client',
      lieux: {
        id: LIEU,
        nom: 'Pavillon',
        code_postal: '75001',
        ville: 'Paris',
      },
      organisations: { id: TRAITEUR, nom: 'Maison Test', logo_url: null },
    },
    ...plus,
  };
}

/** Chaque lecture de collectes est une page triée par id et bornée. */
function attendrePages(api: Api, total: number): void {
  const pages = api.lecturesDe('collectes');
  expect(pages.every((p) => p.tris.at(-1) === 'id')).toBe(true);
  expect(pages.every((p) => p.limite === TAILLE_PAGE)).toBe(true);
  expect(pages.reduce((s, p) => s + p.rendues, 0)).toBe(total);
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = creerApiPlafonnee();
  service = creerApiPlafonnee();
});

// ── Espace gestionnaire de lieux ─────────────────────────────────────────────

describe('M3.2 / gestionnaire au-delà du plafond', () => {
  it('dashboard : KPI sur les 1 300 collectes ZD du parc', async () => {
    connecter('gestionnaire_lieux');
    rls = creerApiPlafonnee({
      organisations_lieux: [{ lieu_id: LIEU }],
      collectes: suite(1300, (i) => collecte(i, 'zero_dechet')),
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');

    const res = await GET(
      requete('/api/v1/gestionnaire/dashboard?type=zero_dechet'),
    );

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { kpis: { nb_collectes: number; tonnage_kg: number } };
    };
    expect(data.kpis).toMatchObject({ nb_collectes: 1300, tonnage_kg: 13000 });
    attendrePages(rls, 1300);
  });

  it('traiteurs : cumuls 12 mois sur les 1 200 collectes du parc', async () => {
    connecter('gestionnaire_lieux');
    rls = creerApiPlafonnee({
      organisations_lieux: [{ lieu_id: LIEU }],
      collectes: suite(1200, (i) =>
        collecte(i, 'zero_dechet', { date_collecte: AUJOURDHUI }),
      ),
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/route.js');

    const res = await GET(requete('/api/v1/gestionnaire/traiteurs'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { id: string; nb_collectes_12m: number; tonnage_12m_kg: number }[];
    };
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: TRAITEUR,
      nb_collectes_12m: 1200,
      tonnage_12m_kg: 12000,
    });
    attendrePages(rls, 1200);
  });

  it('lieux : indicateurs 12 mois sur les 1 100 collectes du lieu', async () => {
    connecter('gestionnaire_lieux');
    rls = creerApiPlafonnee({
      v_lieux_clients: [{ id: LIEU, nom: 'Pavillon', actif: true }],
      collectes: suite(1100, (i) =>
        collecte(i, 'zero_dechet', { date_collecte: AUJOURDHUI }),
      ),
    });
    const { GET } = await import('@/app/api/v1/gestionnaire/lieux/route.js');

    const res = await GET(requete('/api/v1/gestionnaire/lieux'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { nb_collectes_12m: number; tonnage_12m_kg: number }[];
    };
    expect(data[0]).toMatchObject({
      nb_collectes_12m: 1100,
      tonnage_12m_kg: 11000,
    });
    attendrePages(rls, 1100);
  });

  it('lieux : une lecture des collectes en échec rend une erreur, pas des indicateurs à 0', async () => {
    connecter('gestionnaire_lieux');
    rls = creerApiPlafonnee({
      v_lieux_clients: [{ id: LIEU, nom: 'Pavillon', actif: true }],
    });
    rls.pannes['collectes'] = { message: 'panne', code: 'XX000' };
    const { GET } = await import('@/app/api/v1/gestionnaire/lieux/route.js');

    const res = await GET(requete('/api/v1/gestionnaire/lieux'));

    expect(res.status).toBe(500);
  });
});

// ── Listes Collectes des espaces clients ─────────────────────────────────────

describe('M3.1 / M3.3 / M3.4 — listes Collectes au-delà du plafond', () => {
  /** Dates puis identifiants décroissants, comme la liste les présente. */
  function attendreListeComplete(
    data: { id: string; date_collecte: string }[],
    total: number,
  ): void {
    expect(data).toHaveLength(total);
    expect(new Set(data.map((l) => l.id)).size).toBe(total);
    const cle = (l: { id: string; date_collecte: string }) =>
      `${l.date_collecte}|${l.id}`;
    expect(data.map(cle)).toEqual(data.map(cle).sort().reverse());
  }

  it('traiteur : les 1 300 collectes sont listées, date décroissante', async () => {
    connecter('traiteur_manager');
    rls = creerApiPlafonnee({
      collectes: suite(1300, (i) => collecte(i, 'zero_dechet')),
    });
    const { GET } = await import('@/app/api/v1/traiteur/collectes/route.js');

    const res = await GET(requete('/api/v1/traiteur/collectes'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { id: string; date_collecte: string; poids_total_kg: number }[];
    };
    attendreListeComplete(data, 1300);
    expect(data.every((l) => l.poids_total_kg === 10)).toBe(true);
    attendrePages(rls, 1300);
  });

  it('agence : les 1 300 collectes sont listées, date décroissante', async () => {
    connecter('agence');
    rls = creerApiPlafonnee({
      collectes: suite(1300, (i) => collecte(i, 'anti_gaspi')),
    });
    const { GET } = await import('@/app/api/v1/agence/collectes/route.js');

    const res = await GET(requete('/api/v1/agence/collectes'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { id: string; date_collecte: string; nb_repas_donnes: number }[];
    };
    attendreListeComplete(data, 1300);
    expect(data.every((l) => l.nb_repas_donnes === 3)).toBe(true);
    attendrePages(rls, 1300);
  });

  it('client organisateur : les 1 300 collectes sont listées, repas lus par vagues', async () => {
    connecter('client_organisateur');
    // 450 collectes AG (plus qu'il n'en part d'un seul coup), puis 850 ZD.
    rls = creerApiPlafonnee({
      collectes: suite(1300, (i) =>
        collecte(i, i < 450 ? 'anti_gaspi' : 'zero_dechet'),
      ),
      v_referentiel_traiteurs: [{ id: TRAITEUR, nom: 'Maison Test' }],
    });
    rls.rpcs['f_volume_repas_realise'] = () => 7;
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');

    const res = await GET(requete('/api/v1/organisateur/collectes'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        id: string;
        date_collecte: string;
        type: string;
        repas_donnes: number | null;
        traiteur_nom: string | null;
      }[];
    };
    attendreListeComplete(data, 1300);
    const ag = data.filter((l) => l.type === 'anti_gaspi');
    expect(ag).toHaveLength(450);
    expect(ag.every((l) => l.repas_donnes === 7)).toBe(true);
    expect(data.every((l) => l.traiteur_nom === 'Maison Test')).toBe(true);
    expect(rls.rpcSimultanesMax).toBeLessThanOrEqual(20);
    attendrePages(rls, 1300);
  });

  it('client organisateur : un appel des repas en échec rend une erreur, pas des repas absents', async () => {
    connecter('client_organisateur');
    rls = creerApiPlafonnee({
      collectes: suite(3, (i) => collecte(i, 'anti_gaspi')),
      v_referentiel_traiteurs: [],
    });
    rls.pannes['rpc.f_volume_repas_realise'] = { message: 'panne' };
    const { GET } =
      await import('@/app/api/v1/organisateur/collectes/route.js');

    const res = await GET(requete('/api/v1/organisateur/collectes'));

    expect(res.status).toBe(500);
  });

  // L'heure du filtre « à venir / passées » est prise une fois par requête.
  // Reprise à chaque page, une collecte dont le créneau passe pendant la lecture
  // pourrait être listée deux fois, ou pas du tout.
  for (const { liste, role, chemin, charger } of [
    {
      liste: 'traiteur',
      role: 'traiteur_manager',
      chemin: '/api/v1/traiteur/collectes',
      charger: () => import('@/app/api/v1/traiteur/collectes/route.js'),
    },
    {
      liste: 'agence',
      role: 'agence',
      chemin: '/api/v1/agence/collectes',
      charger: () => import('@/app/api/v1/agence/collectes/route.js'),
    },
    {
      liste: 'client organisateur',
      role: 'client_organisateur',
      chemin: '/api/v1/organisateur/collectes',
      charger: () => import('@/app/api/v1/organisateur/collectes/route.js'),
    },
  ]) {
    it(`${liste} : le filtre de vue garde la même heure sur toutes les pages`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-03-12T10:00:00Z'));
        connecter(role);
        rls = creerApiPlafonnee({
          collectes: suite(TAILLE_PAGE * 2 + 50, (i) =>
            collecte(i, 'zero_dechet'),
          ),
          v_referentiel_traiteurs: [],
        });
        // L'horloge avance d'une minute à chaque lecture.
        const client = rls.client as Client;
        rls.client = {
          ...client,
          from: (table: string) => {
            vi.setSystemTime(Date.now() + 60_000);
            return client.from(table);
          },
        };
        const { GET } = await charger();

        const res = await GET(requete(`${chemin}?vue=passees`));

        expect(res.status).toBe(200);
        const vues = rls
          .lecturesDe('collectes')
          .map((l) => l.filtres.find(([operateur]) => operateur === 'or')?.[2]);
        expect(vues).toHaveLength(3);
        expect(vues[0]).toContain('heure_collecte.lt.');
        expect(new Set(vues).size).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  }
});

// ── Mon pack Anti-Gaspi ──────────────────────────────────────────────────────

describe('M3.2 / Mon pack Anti-Gaspi au-delà des plafonds', () => {
  const pack = {
    id: 'pack-1',
    organisation_id: ORG,
    type_pack: 'pack_50',
    statut: 'actif',
    credits_initiaux: 2000,
    credits_consommes: 1750,
    credits_restants: 250,
    date_achat: '2026-01-05',
    date_expiration: null,
    created_at: '2026-01-05T10:00:00Z',
  };
  const rattachee = (i: number, statut: string) =>
    collecte(i, 'anti_gaspi', {
      statut,
      packs_antgaspi: { id: 'pack-1' },
    });

  it('1 300 collectes rattachées et 450 annulations tardives : toutes dans le pack', async () => {
    connecter('traiteur_manager');
    const annulees = suite(450, (i) => rattachee(2000 + i, 'annulee'));
    service = creerApiPlafonnee({
      packs_antgaspi: [pack],
      collectes: [...suite(1300, (i) => rattachee(i, 'cloturee')), ...annulees],
      // Chaque annulation tardive est tracée au journal : 450 identifiants,
      // plus qu'un filtre `in` n'en tolère.
      audit_log: annulees.map((c) => ({
        table_name: 'collectes',
        action: 'pack_rattache_collecte',
        record_id: c.id,
      })),
    });
    const { GET } = await import('@/app/api/v1/mon-pack-ag/route.js');

    const res = await GET(requete('/api/v1/mon-pack-ag'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        collectes: { collecte_id: string; annulee_tardivement: boolean }[];
      };
    };
    expect(data.collectes).toHaveLength(1300 + 450);
    expect(data.collectes.filter((c) => c.annulee_tardivement)).toHaveLength(
      450,
    );
    attendrePages(service, 1300 + 450);
    const listes = service
      .lecturesDe('audit_log')
      .flatMap((l) => l.filtres)
      .filter(([operateur]) => operateur === 'in')
      .map(([, , valeurs]) => (valeurs as unknown[]).length);
    expect(Math.max(...listes)).toBeLessThanOrEqual(PLAFOND_IDS);
  });
});

// ── Filtres de la synthèse PDF ───────────────────────────────────────────────

describe('M3.1 / filtres de la synthèse au-delà du plafond', () => {
  it('un commercial dont les événements sont lus après le 1 000ᵉ est proposé', async () => {
    connecter('traiteur_manager');
    rls = creerApiPlafonnee({
      evenements: suite(PLAFOND_LIGNES + 200, (i) => ({
        id: id('evt', i),
        traiteur_operationnel_organisation_id: ORG,
        client_organisateur_organisation_id: null,
        nom_client_organisateur: null,
        created_by: i < PLAFOND_LIGNES ? 'user-a' : 'user-b',
      })),
      users: [
        { id: 'user-a', prenom: 'Ada', nom: 'Martin' },
        { id: 'user-b', prenom: 'Bob', nom: 'Durand' },
      ],
    });
    const { GET } =
      await import('@/app/api/v1/dashboards/synthese-pdf/filtres/route.js');

    const res = await GET(requete('/api/v1/dashboards/synthese-pdf/filtres'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { commerciaux: { id: string; nom: string }[] };
    };
    expect(data.commerciaux).toEqual([
      { id: 'user-a', nom: 'Ada Martin' },
      { id: 'user-b', nom: 'Bob Durand' },
    ]);
  });

  it('un client organisateur rattaché à un événement lu après le 1 000ᵉ est proposé', async () => {
    connecter('agence');
    rls = creerApiPlafonnee({
      evenements: suite(PLAFOND_LIGNES + 200, (i) => ({
        id: id('evt', i),
        organisation_id: ORG,
        client_organisateur_organisation_id:
          i < PLAFOND_LIGNES ? 'client-a' : 'client-b',
        nom_client_organisateur: i < PLAFOND_LIGNES ? 'Alpha' : 'Bêta',
        created_by: null,
      })),
    });
    const { GET } =
      await import('@/app/api/v1/dashboards/synthese-pdf/filtres/route.js');

    const res = await GET(requete('/api/v1/dashboards/synthese-pdf/filtres'));

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { clients: { id: string; nom: string }[] };
    };
    expect(data.clients).toEqual([
      { id: 'client-a', nom: 'Alpha' },
      { id: 'client-b', nom: 'Bêta' },
    ]);
  });
});
