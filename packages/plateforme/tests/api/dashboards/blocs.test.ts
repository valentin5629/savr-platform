/**
 * Blocs §11 partagés — API /dashboards/blocs (Bloc 3 AG / 6 / 7 + kg/pax par
 * flux). Endpoint commun traiteur (M3.1) / agence (M3.3) / gestionnaire (M3.2),
 * parité §11 (M3.5). Couvre la logique SERVEUR réelle (agrégation, tri top 5,
 * périmètre par rôle, Bloc 7 retiré agence, résolution des noms), pas un mock à [].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

// Chaîne supabase thenable routée par table, avec une FILE de réponses par table
// (l'endpoint fait UNE requête `collectes` : l'historique clôturé).
type Res = { data: unknown; error: unknown };
let queues: Record<string, Res[]> = {};
let calls: Record<string, unknown[][]> = {};
let current = '';
function rec(n: string, a: unknown[]) {
  (calls[n] ??= []).push(a);
}
const chain: Record<string, unknown> = {};
chain.from = (t: string) => {
  current = t;
  rec('from', [t]);
  return chain;
};
for (const m of [
  'select',
  'eq',
  'in',
  'gte',
  'lte',
  'order',
  'not',
  'maybeSingle',
]) {
  chain[m] = (...a: unknown[]) => {
    rec(m, a);
    return chain;
  };
}
chain.then = (resolve: (r: Res) => unknown) => {
  const q = queues[current];
  const r = q && q.length ? q.shift()! : { data: [], error: null };
  return resolve(r);
};

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (t: string) => (chain.from as (t: string) => unknown)(t),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, orgId = 'org-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: orgId }),
      },
    },
    error: null,
  });
}
function setupNoAuth() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'no auth' },
  });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}
function req(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

interface EvtOpts {
  id: string;
  lieu_id?: string;
  lieu_nom?: string;
  pax?: number;
  created_by?: string | null;
  traiteur?: string | null;
}
function evt(o: EvtOpts) {
  return {
    id: o.id,
    lieu_id: o.lieu_id ?? 'lieu-A',
    pax: o.pax ?? 100,
    organisation_id: 'org-1',
    type_evenement_id: 'te-1',
    traiteur_operationnel_organisation_id: o.traiteur ?? null,
    created_by: o.created_by ?? null,
    lieux: { id: o.lieu_id ?? 'lieu-A', nom: o.lieu_nom ?? 'Lieu A' },
  };
}
function zd(
  id: string,
  e: EvtOpts,
  taux: number | null,
  flux: [string, number][],
) {
  return {
    id,
    type: 'zero_dechet',
    taux_recyclage: taux,
    date_collecte: '2026-06-15',
    evenements: evt(e),
    collecte_flux: flux.map(([code, kg]) => ({
      poids_reel_kg: kg,
      flux_dechets: { code },
    })),
    attributions_antgaspi: null,
  };
}
function ag(
  id: string,
  e: EvtOpts,
  repas: number,
  asso: { id: string; nom: string; ville: string | null },
) {
  return {
    id,
    type: 'anti_gaspi',
    taux_recyclage: null,
    date_collecte: '2026-06-15',
    evenements: evt(e),
    collecte_flux: [],
    // Relation to-one : PostgREST renvoie un OBJET, pas un tableau.
    attributions_antgaspi: {
      volume_repas_realise: repas,
      association_id: asso.id,
      associations: asso,
    },
  };
}

async function loadGET() {
  return (await import('@/app/api/v1/dashboards/blocs/route.js')).GET;
}

interface BlocsJson {
  data: {
    topLieux: Array<Record<string, number | string | null>>;
    topActeurs: Array<Record<string, number | string | null>> | null;
    acteurLabel: string | null;
    topAssociations: Array<Record<string, number | string | null>> | null;
    kgParPaxParFlux: Record<string, number>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queues = {};
  calls = {};
  current = '';
});

describe('dashboards/blocs — auth', () => {
  it('M3.5/blocs_auth_401_sans_jwt', async () => {
    setupNoAuth();
    const GET = await loadGET();
    const res = await GET(req('/api/v1/dashboards/blocs?type=zero_dechet'));
    expect([401, 403]).toContain(res.status);
  });
  it('M3.5/blocs_role_hors_perimetre_403', async () => {
    setupAuth('client_organisateur');
    const GET = await loadGET();
    const res = await GET(req('/api/v1/dashboards/blocs?type=zero_dechet'));
    expect([401, 403]).toContain(res.status);
  });
});

describe('M3.1 / blocs traiteur ZD', () => {
  it('M3.1/blocs_top_lieux_zd_ordre_tonnage', async () => {
    setupAuth('traiteur_manager', 'org-1');
    queues['collectes'] = [
      {
        data: [
          zd('c1', { id: 'e1', lieu_id: 'A', lieu_nom: 'Lieu A' }, 80, [
            ['biodechet', 200],
            ['emballage', 100],
          ]),
          zd('c2', { id: 'e2', lieu_id: 'A', lieu_nom: 'Lieu A' }, 60, [
            ['biodechet', 100],
          ]),
          zd('c3', { id: 'e3', lieu_id: 'B', lieu_nom: 'Lieu B' }, 90, [
            ['carton', 500],
          ]),
        ],
        error: null,
      },
    ];
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/blocs?type=zero_dechet&from=2026-06-01&to=2026-06-30',
      ),
    );
    const j = (await res.json()) as BlocsJson;
    // Ordre tonnage décroissant : Lieu B (500) puis Lieu A (400).
    expect(j.data.topLieux.map((l) => l.lieu_nom)).toEqual([
      'Lieu B',
      'Lieu A',
    ]);
    const a = j.data.topLieux.find((l) => l.lieu_nom === 'Lieu A')!;
    expect(a.tonnage_kg).toBe(400);
    // Taux pondéré Lieu A = (80*300 + 60*100)/400 = 75.
    expect(a.taux_recyclage).toBe(75);
    // kg/pax par flux : pax distinct = e1,e2,e3 = 300 ; biodechet=(200+100)/300=1.
    expect(j.data.kgParPaxParFlux.biodechet).toBeCloseTo(1, 5);
    expect(j.data.kgParPaxParFlux.carton).toBeCloseTo(500 / 300, 5);
  });

  it('M3.1/blocs_top_commerciaux_ordre_nb_et_noms', async () => {
    setupAuth('traiteur_manager', 'org-1');
    queues['collectes'] = [
      {
        data: [
          zd('c1', { id: 'e1', created_by: 'com1' }, 80, [['biodechet', 100]]),
          zd('c2', { id: 'e2', created_by: 'com1' }, 80, [['biodechet', 100]]),
          zd('c3', { id: 'e3', created_by: 'com2' }, 80, [['biodechet', 100]]),
        ],
        error: null,
      },
    ];
    queues['users'] = [
      {
        data: [
          { id: 'com1', prenom: 'Alice', nom: 'Martin' },
          { id: 'com2', prenom: 'Bob', nom: 'Durand' },
        ],
        error: null,
      },
    ];
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/blocs?type=zero_dechet&from=2026-06-01&to=2026-06-30',
      ),
    );
    const j = (await res.json()) as BlocsJson;
    expect(j.data.acteurLabel).toBe('Commercial');
    expect(j.data.topActeurs!.map((a) => a.label)).toEqual([
      'Alice Martin',
      'Bob Durand',
    ]);
    expect(j.data.topActeurs![0]!.nb_collectes).toBe(2);
  });

  it('M3.1/blocs_sans_prochaines_collectes', async () => {
    // Bloc 5 « Prochaines collectes » retiré des dashboards (décision Val
    // 2026-10-01) : l'endpoint ne sert plus la liste et ne lance plus la lecture
    // des collectes à venir — une seule requête `collectes`, l'historique clôturé.
    setupAuth('traiteur_manager', 'org-1');
    queues['collectes'] = [{ data: [], error: null }];
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/blocs?type=zero_dechet&from=2026-06-01&to=2026-06-30',
      ),
    );
    const j = (await res.json()) as { data: Record<string, unknown> };
    expect(j.data).not.toHaveProperty('prochaines');
    expect((calls.from ?? []).filter((a) => a[0] === 'collectes')).toHaveLength(
      1,
    );
    expect((calls.in ?? []).some((a) => a[0] === 'statut')).toBe(false);
  });
});

describe('M3.1 / blocs traiteur AG', () => {
  it('M3.1/blocs_top_associations_ordre_repas', async () => {
    setupAuth('traiteur_manager', 'org-1');
    const asso1 = { id: 'a1', nom: 'Asso Un', ville: 'Paris' };
    const asso2 = { id: 'a2', nom: 'Asso Deux', ville: 'Lyon' };
    queues['collectes'] = [
      {
        data: [
          ag('c1', { id: 'e1', lieu_id: 'A', lieu_nom: 'Lieu A' }, 30, asso1),
          ag('c2', { id: 'e2', lieu_id: 'B', lieu_nom: 'Lieu B' }, 40, asso1),
          ag('c3', { id: 'e3', lieu_id: 'A', lieu_nom: 'Lieu A' }, 100, asso2),
        ],
        error: null,
      },
    ];
    queues['users'] = [{ data: [], error: null }];
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/blocs?type=anti_gaspi&from=2026-06-01&to=2026-06-30',
      ),
    );
    const j = (await res.json()) as BlocsJson;
    // Ordre repas reçus décroissant : Asso Deux (100) puis Asso Un (70).
    expect(j.data.topAssociations!.map((a) => a.nom)).toEqual([
      'Asso Deux',
      'Asso Un',
    ]);
    const un = j.data.topAssociations!.find((a) => a.nom === 'Asso Un')!;
    expect(un.repas_recus).toBe(70);
    expect(un.nb_collectes).toBe(2);
    expect(un.ville).toBe('Paris');
    // Bloc 6 AG : Lieu A (130 repas) devant Lieu B (40).
    expect(j.data.topLieux.map((l) => l.lieu_nom)).toEqual([
      'Lieu A',
      'Lieu B',
    ]);
    const la = j.data.topLieux.find((l) => l.lieu_nom === 'Lieu A')!;
    expect(la.repas_donnes).toBe(130);
    // repas/pax = 130 / (pax distinct e1,e3 = 200) = 0.65.
    expect(la.repas_par_pax).toBeCloseTo(0.65, 5);
  });
});

describe('M3.3 / blocs agence — Bloc 7 retiré', () => {
  it('M3.3/blocs_agence_top_acteurs_null', async () => {
    setupAuth('agence', 'org-1');
    queues['collectes'] = [
      {
        data: [
          zd('c1', { id: 'e1', created_by: 'com1' }, 80, [['biodechet', 100]]),
        ],
        error: null,
      },
    ];
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/blocs?type=zero_dechet&from=2026-06-01&to=2026-06-30',
      ),
    );
    const j = (await res.json()) as BlocsJson;
    // Bloc 7 retiré côté agence (§06.11 diff #8).
    expect(j.data.topActeurs).toBeNull();
    expect(j.data.acteurLabel).toBeNull();
    // Les autres blocs restent servis.
    expect(j.data.topLieux).toHaveLength(1);
    // Aucune requête users (pas de résolution commerciaux côté agence).
    expect((calls.from ?? []).some((a) => a[0] === 'users')).toBe(false);
  });
});

describe('M3.2 / blocs gestionnaire — traiteurs + périmètre parc', () => {
  it('M3.2/blocs_gestionnaire_perimetre_et_top_traiteurs', async () => {
    setupAuth('gestionnaire_lieux', 'org-7');
    queues['organisations_lieux'] = [
      { data: [{ lieu_id: 'A' }, { lieu_id: 'B' }], error: null },
    ];
    queues['collectes'] = [
      {
        data: [
          zd('c1', { id: 'e1', lieu_id: 'A', traiteur: 't1' }, 80, [
            ['biodechet', 100],
          ]),
          zd('c2', { id: 'e2', lieu_id: 'B', traiteur: 't1' }, 80, [
            ['biodechet', 100],
          ]),
          zd('c3', { id: 'e3', lieu_id: 'A', traiteur: 't2' }, 80, [
            ['biodechet', 100],
          ]),
        ],
        error: null,
      },
    ];
    queues['v_referentiel_traiteurs'] = [
      {
        data: [
          { id: 't1', nom: 'Traiteur Un' },
          { id: 't2', nom: 'Traiteur Deux', raison_sociale: 'TD SAS' },
        ],
        error: null,
      },
    ];
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/blocs?type=zero_dechet&from=2026-06-01&to=2026-06-30',
      ),
    );
    const j = (await res.json()) as BlocsJson;
    // Périmètre = organisations_lieux (jamais organisation_id).
    expect((calls.from ?? []).some((a) => a[0] === 'organisations_lieux')).toBe(
      true,
    );
    expect((calls.in ?? []).some((a) => a[0] === 'evenements.lieu_id')).toBe(
      true,
    );
    expect(
      (calls.eq ?? []).some((a) => a[0] === 'evenements.organisation_id'),
    ).toBe(false);
    // Bloc 7 = traiteurs, ordonné par nb (t1=2 devant t2=1), noms résolus.
    expect(j.data.acteurLabel).toBe('Traiteur');
    expect(j.data.topActeurs!.map((a) => a.label)).toEqual([
      'Traiteur Un',
      'Traiteur Deux',
    ]);
  });
});

// §04 « Vue SQL : v_attributions_gestionnaire » (arbitrage Val 2026-09-22, option
// A) : le chargeur branche PAR RÔLE. La vue est vide pour tout autre rôle que le
// gestionnaire (garde de rôle) ; la table lui est refusée sur un traiteur tiers
// (aa_select, C-1). Un rôle envoyé sur le mauvais chemin lit zéro repas sans
// erreur — d'où l'assertion sur le `select` réellement demandé.
describe('blocs AG — attributions lues par rôle (vue gestionnaire / table)', () => {
  const VUE = 'attributions_antgaspi:v_attributions_gestionnaire(';
  const TABLE = /attributions_antgaspi\s*\(/;
  // Le `select` de la requête `collectes` (d'autres tables suivent : noms des
  // traiteurs / commerciaux).
  const selectCollectes = () =>
    (calls.select ?? [])
      .map((a) => String(a[0]))
      .find((x) => x.includes('date_collecte')) ?? '';
  const URL_AG =
    '/api/v1/dashboards/blocs?type=anti_gaspi&from=2026-06-01&to=2026-06-30';

  it('M3.2/blocs_gestionnaire_ag_par_vue — traiteur tiers : top associations et repas par lieu lus par la vue', async () => {
    setupAuth('gestionnaire_lieux', 'org-7');
    queues['organisations_lieux'] = [
      { data: [{ lieu_id: 'A' }, { lieu_id: 'B' }], error: null },
    ];
    // Forme réelle de la vue : association À PLAT, embed to-one en OBJET.
    const parVue = (
      id: string,
      e: EvtOpts,
      repas: number,
      asso: { id: string; nom: string; ville: string | null },
    ) => ({
      ...ag(id, e, repas, asso),
      attributions_antgaspi: {
        volume_repas_realise: repas,
        association_id: asso.id,
        association_nom: asso.nom,
        association_ville: asso.ville,
      },
    });
    const asso1 = { id: 'a1', nom: 'Asso Un', ville: 'Paris' };
    const asso2 = { id: 'a2', nom: 'Asso Deux', ville: null };
    queues['collectes'] = [
      {
        data: [
          parVue('c1', { id: 'e1', lieu_id: 'A', traiteur: 't1' }, 30, asso1),
          parVue('c2', { id: 'e2', lieu_id: 'B', traiteur: 't1' }, 40, asso1),
          parVue('c3', { id: 'e3', lieu_id: 'A', traiteur: 't2' }, 100, asso2),
        ],
        error: null,
      },
    ];
    queues['v_referentiel_traiteurs'] = [{ data: [], error: null }];
    const GET = await loadGET();
    const res = await GET(req(URL_AG));
    const j = (await res.json()) as BlocsJson;

    expect(selectCollectes()).toContain(VUE);
    expect(selectCollectes()).not.toMatch(TABLE);
    // Bloc 3 AG : ordre repas reçus décroissant, nom et ville de la vue.
    expect(j.data.topAssociations).toEqual([
      {
        association_id: 'a2',
        nom: 'Asso Deux',
        ville: null,
        nb_collectes: 1,
        repas_recus: 100,
      },
      {
        association_id: 'a1',
        nom: 'Asso Un',
        ville: 'Paris',
        nb_collectes: 2,
        repas_recus: 70,
      },
    ]);
    // Bloc 6 AG : repas par lieu — Lieu A (130) devant Lieu B (40).
    expect(j.data.topLieux.map((l) => l.repas_donnes)).toEqual([130, 40]);
  });

  it.each([
    ['M3.1/blocs_traiteur_ag_lit_la_table', 'traiteur_manager'],
    ['M3.1/blocs_commercial_ag_lit_la_table', 'traiteur_commercial'],
    ['M3.3/blocs_agence_ag_lit_la_table', 'agence'],
  ])('%s — %s : la table, jamais la vue', async (_id, role) => {
    setupAuth(role, 'org-1');
    const asso = { id: 'a1', nom: 'Asso Un', ville: 'Paris' };
    queues['collectes'] = [
      { data: [ag('c1', { id: 'e1' }, 30, asso)], error: null },
    ];
    queues['users'] = [{ data: [], error: null }];
    const GET = await loadGET();
    const res = await GET(req(URL_AG));
    const j = (await res.json()) as BlocsJson;

    expect(selectCollectes()).toMatch(TABLE);
    expect(selectCollectes()).toContain(
      'associations!association_id(id, nom, ville)',
    );
    expect(selectCollectes()).not.toContain('v_attributions_gestionnaire');
    expect(j.data.topAssociations![0]).toMatchObject({
      nom: 'Asso Un',
      repas_recus: 30,
    });
  });
});
