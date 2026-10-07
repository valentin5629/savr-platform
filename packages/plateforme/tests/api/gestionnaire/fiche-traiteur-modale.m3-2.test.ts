/**
 * M3.2 — Fiche traiteur du gestionnaire en pop-up (§06.05 §5, arbitrage Val
 * 2026-10-07) : routes serveur.
 *  - GET /api/v1/gestionnaire/traiteurs/[id] : nom, logo et lieux
 *    d'intervention (collectes clôturées sur les lieux de l'organisation,
 *    24 derniers mois, avec leur nombre) — plus de statistiques ni d'historique ;
 *  - GET /api/v1/gestionnaire/dashboard et GET /api/v1/dashboards/evolution :
 *    les routes des cartes KPI et du graphique du dashboard, que l'onglet
 *    Activité de la fiche appelle filtrées sur le traiteur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { decalerMois } from '@/lib/periodes-raccourcis';

type Result = { data: unknown; error: unknown };
type Appel = { methode: string; args: unknown[] };

// Client Supabase simulé : chaque requête consomme la réponse suivante de la
// file ; tous les appels sont enregistrés dans l'ordre (table lue, filtres)
// pour vérifier ce que la route demande réellement.
function makeChain() {
  const queue: Result[] = [];
  const appels: Appel[] = [];
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    appels,
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
    'order',
    'range',
  ]) {
    chain[m] = (...args: unknown[]) => {
      appels.push({ methode: m, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    appels: Appel[];
  };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

const TRAITEUR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PORTE_VERSAILLES = {
  id: '11111111-1111-4111-8111-111111111111',
  nom: 'Paris Expo Porte de Versailles',
};
const CHAMPERRET = {
  id: '22222222-2222-4222-8222-222222222222',
  nom: 'Espace Champerret',
};
const CONGRES = {
  id: '33333333-3333-4333-8333-333333333333',
  nom: 'Palais des Congrès de Paris',
};

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role = 'gestionnaire_lieux') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: 'org-viparis',
        }),
      },
    },
    error: null,
  });
}

const tables = (c: { appels: Appel[] }) =>
  c.appels.filter((a) => a.methode === 'from').map((a) => a.args[0]);
const appelsDe = (c: { appels: Appel[] }, methode: string) =>
  c.appels.filter((a) => a.methode === methode);

// Collecte clôturée du traiteur telle que la route la demande : identifiant et
// lieu de l'événement.
function collecte(id: string, lieu: { id: string; nom: string }) {
  return {
    id,
    evenements: {
      lieu_id: lieu.id,
      traiteur_operationnel_organisation_id: TRAITEUR,
      lieux: { nom: lieu.nom },
    },
  };
}

// Réponses des deux premières lectures de la fiche : le parc de l'organisation
// (organisations_lieux) puis le traiteur (v_traiteurs_gestionnaire).
function traiteurDuPerimetre(
  parc = [PORTE_VERSAILLES, CHAMPERRET, CONGRES],
  traiteur: object | null = {
    id: TRAITEUR,
    nom: 'Fleurdemets',
    logo_url: null,
  },
) {
  rls.push({ data: parc.map((l) => ({ lieu_id: l.id })), error: null });
  rls.push({ data: traiteur, error: null });
}

async function getFiche(id = TRAITEUR) {
  const { GET } =
    await import('@/app/api/v1/gestionnaire/traiteurs/[id]/route.js');
  return GET(
    new NextRequest(`http://localhost/api/v1/gestionnaire/traiteurs/${id}`),
    { params: Promise.resolve({ id }) },
  );
}

interface Fiche {
  id: string;
  nom: string;
  logo_url: string | null;
  lieux_intervention: { id: string; nom: string; nb_collectes: number }[];
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  setupAuth();
});

describe('M3.2 / fiche traiteur — lecture', () => {
  it('M3.2/fiche_traiteur_lieux_clotures_24_mois_tries — lieux d’intervention avec leur nombre de collectes clôturées sur 24 mois, sans statistiques ni historique', async () => {
    traiteurDuPerimetre();
    rls.push({
      data: [
        // Congrès lu AVANT Champerret, à égalité de collectes : seul le
        // départage par nom rend « Espace Champerret » en premier.
        collecte('c1', CONGRES),
        collecte('c2', PORTE_VERSAILLES),
        collecte('c3', PORTE_VERSAILLES),
        collecte('c4', CHAMPERRET),
        collecte('c5', PORTE_VERSAILLES),
      ],
      error: null,
    });
    const res = await getFiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Fiche };
    // Réponse entière : nom, logo, lieux — ni `stats_12m` ni
    // `historique_collectes` (l'onglet Activité lit les routes du dashboard).
    // Tri : nombre de collectes décroissant, puis nom.
    expect(data).toEqual({
      id: TRAITEUR,
      nom: 'Fleurdemets',
      logo_url: null,
      lieux_intervention: [
        { ...PORTE_VERSAILLES, nb_collectes: 3 },
        { ...CHAMPERRET, nb_collectes: 1 },
        { ...CONGRES, nb_collectes: 1 },
      ],
    });

    // Même règle que la colonne « Lieux d'intervention » de la liste : collectes
    // clôturées, de ce traiteur, sur les lieux du parc, depuis 24 mois.
    expect(appelsDe(rls, 'eq').map((a) => a.args)).toEqual([
      ['id', TRAITEUR],
      ['statut', 'cloturee'],
      ['evenements.traiteur_operationnel_organisation_id', TRAITEUR],
      // Seconde tranche (vide) : mêmes filtres.
      ['statut', 'cloturee'],
      ['evenements.traiteur_operationnel_organisation_id', TRAITEUR],
    ]);
    expect(appelsDe(rls, 'in')[0]?.args).toEqual([
      'evenements.lieu_id',
      [PORTE_VERSAILLES.id, CHAMPERRET.id, CONGRES.id],
    ]);
    expect(appelsDe(rls, 'gte')[0]?.args).toEqual([
      'date_collecte',
      decalerMois(jourParis(new Date()), -24),
    ]);
    // Le traiteur est lu par la vue restreinte, jamais par la table.
    expect([...new Set(tables(rls))]).toEqual([
      'organisations_lieux',
      'v_traiteurs_gestionnaire',
      'collectes',
    ]);
    // La lecture ne demande ni pesées, ni repas, ni taux : rien de plus que ce
    // que la fiche affiche.
    const select = appelsDe(rls, 'select')
      .map((a) => String(a.args[0]))
      .find((x) => x.includes('evenements!inner'));
    expect(select).not.toMatch(
      /collecte_flux|attributions_antgaspi|taux_recyclage|date_collecte/,
    );
  });

  it('M3.2/fiche_traiteur_lieux_plafond_inferieur — un plafond de réponse plus bas que la tranche ne tronque aucun décompte', async () => {
    // Projet dont `max_rows` vaut 100 : chaque réponse est plafonnée, la
    // lecture avance du nombre de lignes REÇUES jusqu'à une tranche vide.
    traiteurDuPerimetre();
    for (const [prefixe, n, lieu] of [
      ['a', 100, PORTE_VERSAILLES],
      ['b', 100, PORTE_VERSAILLES],
      ['c', 40, CHAMPERRET],
    ] as const) {
      rls.push({
        data: Array.from({ length: n }, (_, i) =>
          collecte(`${prefixe}-${i}`, lieu),
        ),
        error: null,
      });
    }
    const { data } = (await (await getFiche()).json()) as { data: Fiche };
    expect(data.lieux_intervention).toEqual([
      { ...PORTE_VERSAILLES, nb_collectes: 200 },
      { ...CHAMPERRET, nb_collectes: 40 },
    ]);
    expect(appelsDe(rls, 'range').map((a) => a.args[0])).toEqual([
      0, 100, 200, 240,
    ]);
    // Tri par identifiant : pagination stable d'une tranche à l'autre.
    expect(new Set(appelsDe(rls, 'order').map((a) => a.args[0]))).toEqual(
      new Set(['id']),
    );
  });

  it('M3.2/fiche_traiteur_sans_collecte_cloturee — traiteur du périmètre sans collecte clôturée sur 24 mois : fiche servie, liste vide', async () => {
    traiteurDuPerimetre();
    rls.push({ data: [], error: null });
    const res = await getFiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Fiche };
    expect(data.nom).toBe('Fleurdemets');
    expect(data.lieux_intervention).toEqual([]);
  });

  it('M3.2/fiche_traiteur_identifiant_mal_forme_404 — un identifiant mal formé n’atteint pas la base', async () => {
    const res = await getFiche('pas-un-uuid');
    expect(res.status).toBe(404);
    expect(tables(rls)).toEqual([]);
  });

  it('M3.2/fiche_traiteur_hors_perimetre_404 — traiteur que la vue ne rend pas : 404, aucune collecte lue', async () => {
    traiteurDuPerimetre(undefined, null);
    const res = await getFiche();
    expect(res.status).toBe(404);
    expect(tables(rls)).toEqual([
      'organisations_lieux',
      'v_traiteurs_gestionnaire',
    ]);
  });

  it('M3.2/fiche_traiteur_organisation_sans_lieu_404 — organisation sans lieu rattaché : 404, rien d’autre n’est lu', async () => {
    rls.push({ data: [], error: null });
    const res = await getFiche();
    expect(res.status).toBe(404);
    expect(tables(rls)).toEqual(['organisations_lieux']);
  });

  it('M3.2/fiche_traiteur_erreur_seconde_tranche_500 — une tranche en échec ne rend pas un décompte partiel', async () => {
    traiteurDuPerimetre();
    rls.push({ data: [collecte('c1', CHAMPERRET)], error: null });
    rls.push({ data: null, error: { code: '57014', message: 'timeout' } });
    const res = await getFiche();
    expect(res.status).toBe(500);
  });

  it('M3.2/fiche_traiteur_role_non_gestionnaire_403 — réservée au gestionnaire de lieux', async () => {
    setupAuth('traiteur_manager');
    const res = await getFiche();
    expect(res.status).toBe(403);
    expect(tables(rls)).toEqual([]);
  });
});

describe('M3.2 / fiche traiteur — routes du dashboard appelées par l’onglet Activité', () => {
  // L'onglet Activité appelle la route du dashboard avec `traiteur_ids[]` : sans
  // ce filtre, la fiche afficherait les chiffres de tout le parc sous le nom
  // d'un seul traiteur.
  it('M3.2/dashboard_kpi_filtre_traiteur_applique — `traiteur_ids[]` borne les KPI au traiteur, collectes clôturées de la période', async () => {
    rls.push({
      data: [{ lieu_id: PORTE_VERSAILLES.id }, { lieu_id: CHAMPERRET.id }],
      error: null,
    }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          taux_recyclage: 40,
          evenements: { id: 'e1', lieu_id: PORTE_VERSAILLES.id, pax: 1000 },
          collecte_flux: [
            { poids_reel_kg: 300, flux_dechets: { code: 'biodechet' } },
          ],
        },
        {
          id: 'c2',
          type: 'zero_dechet',
          taux_recyclage: 20,
          evenements: { id: 'e2', lieu_id: CHAMPERRET.id, pax: 500 },
          collecte_flux: [
            { poids_reel_kg: 100, flux_dechets: { code: 'verre' } },
          ],
        },
      ],
      error: null,
    }); // collectes
    rls.push({ data: null, error: null }); // pack actif

    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const qs = new URLSearchParams({
      type: 'zero_dechet',
      from: '2025-10-07',
      to: '2026-10-07',
    });
    qs.append('traiteur_ids[]', TRAITEUR);
    const res = await GET(
      new NextRequest(`http://localhost/api/v1/gestionnaire/dashboard?${qs}`),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { kpis: Record<string, number | null> };
    };
    expect(data.kpis).toMatchObject({ nb_collectes: 2, tonnage_kg: 400 });
    // Taux pondéré par tonnage : (40 × 300 + 20 × 100) / 400.
    expect(data.kpis.taux_recyclage_pondere).toBeCloseTo(35, 5);
    expect(data.kpis.kg_par_pax).toBeCloseTo(400 / 1500, 5);

    expect(appelsDe(rls, 'in').map((a) => a.args)).toEqual([
      ['evenements.lieu_id', [PORTE_VERSAILLES.id, CHAMPERRET.id]],
      ['evenements.traiteur_operationnel_organisation_id', [TRAITEUR]],
    ]);
    expect(appelsDe(rls, 'eq').map((a) => a.args)).toContainEqual([
      'statut',
      'cloturee',
    ]);
    expect(appelsDe(rls, 'gte')[0]?.args).toEqual([
      'date_collecte',
      '2025-10-07',
    ]);
    expect(appelsDe(rls, 'lte')[0]?.args).toEqual([
      'date_collecte',
      '2026-10-07',
    ]);
  });

  // Même enjeu pour le graphique : sans ce filtre, l'histogramme de tout le parc
  // s'afficherait à côté de cartes justes.
  it('M3.2/evolution_filtre_traiteur_applique — `traiteur_ids[]` borne la série d’évolution au traiteur, collectes clôturées de la période', async () => {
    rls.push({
      data: [{ lieu_id: PORTE_VERSAILLES.id }, { lieu_id: CHAMPERRET.id }],
      error: null,
    }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          taux_recyclage: 40,
          date_collecte: '2026-09-12',
          evenements: { id: 'e1', lieu_id: PORTE_VERSAILLES.id, pax: 1000 },
          collecte_flux: [
            { poids_reel_kg: 300, flux_dechets: { code: 'biodechet' } },
          ],
        },
      ],
      error: null,
    }); // collectes

    const { GET } = await import('@/app/api/v1/dashboards/evolution/route.js');
    const qs = new URLSearchParams({
      type: 'zero_dechet',
      from: '2025-10-07',
      to: '2026-10-07',
    });
    qs.append('traiteur_ids[]', TRAITEUR);
    const res = await GET(
      new NextRequest(`http://localhost/api/v1/dashboards/evolution?${qs}`),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        granularite: string;
        series: { tonnage_total: number; biodechet: number }[];
      };
    };
    expect(data.granularite).toBe('mois');
    expect(data.series.reduce((t, p) => t + p.tonnage_total, 0)).toBe(300);
    expect(data.series.reduce((t, p) => t + p.biodechet, 0)).toBe(300);

    expect(appelsDe(rls, 'in').map((a) => a.args)).toEqual([
      ['evenements.lieu_id', [PORTE_VERSAILLES.id, CHAMPERRET.id]],
      ['evenements.traiteur_operationnel_organisation_id', [TRAITEUR]],
    ]);
    expect(appelsDe(rls, 'eq').map((a) => a.args)).toEqual([
      ['statut', 'cloturee'],
      ['type', 'zero_dechet'],
    ]);
    expect(appelsDe(rls, 'gte')[0]?.args).toEqual([
      'date_collecte',
      '2025-10-07',
    ]);
    expect(appelsDe(rls, 'lte')[0]?.args).toEqual([
      'date_collecte',
      '2026-10-07',
    ]);
  });
});
