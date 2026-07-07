/**
 * Blocs §11 partagés — API /dashboards/blocs (Bloc 3 AG / 5 / 6 / 7 + kg/pax par
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
// (l'endpoint fait DEUX requêtes `collectes` : historique clôturé puis prochaines).
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
    prochaines: Array<Record<string, unknown>>;
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
      { data: [], error: null }, // prochaines
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
      { data: [], error: null },
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

  it('M3.1/blocs_prochaines_fenetre_statuts', async () => {
    setupAuth('traiteur_manager', 'org-1');
    queues['collectes'] = [
      { data: [], error: null }, // historique
      {
        data: [
          {
            id: 'p1',
            date_collecte: '2026-07-10',
            heure_collecte: '14:30:00',
            statut: 'programmee',
            evenements: {
              id: 'e9',
              nom_evenement: 'Gala',
              pax: 100,
              traiteur_operationnel_organisation_id: null,
              lieux: { nom: 'Lieu Z' },
            },
          },
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
    expect(j.data.prochaines).toHaveLength(1);
    expect(j.data.prochaines[0]!.evenement_nom).toBe('Gala');
    expect(j.data.prochaines[0]!.lieu_nom).toBe('Lieu Z');
    // Fenêtre à venir : statuts non terminaux uniquement.
    const inStatut = (calls.in ?? []).find((a) => a[0] === 'statut');
    expect(inStatut?.[1]).toEqual(['programmee', 'validee', 'en_cours']);
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
      { data: [], error: null },
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
      { data: [], error: null },
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
      {
        data: [
          {
            id: 'p1',
            date_collecte: '2026-07-10',
            heure_collecte: null,
            statut: 'validee',
            evenements: {
              id: 'e9',
              nom_evenement: 'Salon',
              pax: 100,
              traiteur_operationnel_organisation_id: 't1',
              lieux: { nom: 'Lieu A' },
            },
          },
        ],
        error: null,
      },
    ];
    queues['v_referentiel_traiteurs'] = [
      {
        data: [
          { id: 't1', nom: 'Traiteur Un', raison_sociale: 'TU SAS' },
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
    // Bloc 5 : colonne Traiteur résolue sur les prochaines.
    expect(j.data.prochaines[0]!.traiteur_nom).toBe('Traiteur Un');
  });
});
