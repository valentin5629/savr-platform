/**
 * M3.2 — Tests Vitest API R19b-P2 (§06.05).
 * Couvre BL-P2-12 :
 *  - endpoint /filtres (options Lieux/Traiteurs/Type du parc de l'organisation) ;
 *  - liste Événements : champs plats (lieu_nom/traiteur_nom) + colonnes
 *    tonnage_zd_kg / dechets_labo_kg / repas_donnes ; filtre Taille honoré ;
 *  - liste Traiteurs : lieux_intervention résolus en { id, nom } ;
 *  - dashboard : filtre Taille (bracket pax) honoré.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'neq',
    'in',
    'gte',
    'lte',
    'order',
    'limit',
    'not',
  ]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = () => Promise.resolve(next());
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & { push(r: Result): unknown };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(
  role = 'gestionnaire_lieux',
  organisationId = 'org-viparis',
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
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
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
});

// ── Endpoint /filtres ─────────────────────────────────────────────────────────
describe('M3.2 / P2 filtres endpoint', () => {
  it("M3.2/P2_filtres_options_parc — lieux + traiteurs + types de l'organisation", async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'l1' }], error: null }); // organisations_lieux
    rls.push({
      data: [{ id: 'l1', nom: 'Palais des Congrès' }],
      error: null,
    }); // v_lieux_clients
    rls.push({
      data: [
        {
          id: 'c1',
          evenements: {
            lieu_id: 'l1',
            traiteur_operationnel_organisation_id: 'tr1',
            organisations: { id: 'tr1', nom: 'Kaspia' },
          },
        },
      ],
      error: null,
    }); // collectes
    rls.push({ data: [{ id: 'ty1', libelle: 'Gala' }], error: null }); // types_evenements

    const { GET } = await import('@/app/api/v1/gestionnaire/filtres/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/filtres'));
    const json = (await res.json()) as {
      data: {
        lieux: { id: string; nom: string }[];
        traiteurs: { id: string; nom: string }[];
        types: { id: string; libelle: string }[];
      };
    };
    expect(json.data.lieux).toEqual([{ id: 'l1', nom: 'Palais des Congrès' }]);
    expect(json.data.traiteurs).toEqual([{ id: 'tr1', nom: 'Kaspia' }]);
    expect(json.data.types).toEqual([{ id: 'ty1', libelle: 'Gala' }]);
  });

  it('M3.2/P2_filtres_vide_si_aucun_perimetre — org sans lieu → listes vides', async () => {
    setupAuth();
    rls.push({ data: [], error: null }); // organisations_lieux vide
    const { GET } = await import('@/app/api/v1/gestionnaire/filtres/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/filtres'));
    const json = (await res.json()) as {
      data: { lieux: unknown[]; traiteurs: unknown[]; types: unknown[] };
    };
    expect(json.data.lieux).toEqual([]);
    expect(json.data.traiteurs).toEqual([]);
    expect(json.data.types).toEqual([]);
  });
});

// ── Liste Événements : colonnes + champs plats ────────────────────────────────
describe('M3.2 / P2 liste événements colonnes', () => {
  it('M3.2/P2_evenements_colonnes_et_champs_plats — tonnage/dechets/repas + lieu_nom/traiteur_nom', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Gala',
          date_evenement: '2026-06-01',
          pax: 600,
          organisation_id: 'org-viparis',
          lieu_id: 'lieu-1',
          lieux: { id: 'lieu-1', nom: 'Palais', ville: 'Paris' },
          traiteur_operationnel_organisation_id: 'tr1',
          organisations: { id: 'tr1', nom: 'Kaspia' },
          type_evenement_id: 'ty1',
          types_evenements: { id: 'ty1', libelle: 'Gala' },
          collectes: [
            {
              id: 'c1',
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-06-01',
              collecte_flux: [{ poids_reel_kg: 300 }],
              attributions_antgaspi: [],
            },
            {
              id: 'c2',
              type: 'anti_gaspi',
              statut: 'cloturee',
              date_collecte: '2026-06-01',
              collecte_flux: [],
              attributions_antgaspi: [{ volume_repas_realise: 40 }],
            },
          ],
        },
      ],
      error: null,
    }); // evenements
    rls.push({ data: 12, error: null }); // f_dechets_labo_estimes rpc (1 event)

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/evenements'));
    const json = (await res.json()) as {
      data: Array<{
        lieu_nom: string | null;
        lieu_ville: string | null;
        traiteur_nom: string | null;
        tonnage_zd_kg: number;
        dechets_labo_kg: number | null;
        repas_donnes: number;
      }>;
    };
    const row = json.data[0]!;
    expect(row.lieu_nom).toBe('Palais');
    expect(row.lieu_ville).toBe('Paris');
    expect(row.traiteur_nom).toBe('Kaspia');
    expect(row.tonnage_zd_kg).toBe(300);
    expect(row.dechets_labo_kg).toBe(12);
    expect(row.repas_donnes).toBe(40);
  });

  it('M3.2/P2_evenements_filtre_taille — bracket pax honoré', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e-s',
          nom_evenement: 'Petit',
          date_evenement: '2026-06-01',
          pax: 300, // bracket S
          organisation_id: 'org-viparis',
          lieu_id: 'lieu-1',
          lieux: { nom: 'A', ville: 'Paris' },
          organisations: { nom: 'Kaspia' },
          types_evenements: { libelle: 'Gala' },
          collectes: [],
        },
        {
          id: 'e-m',
          nom_evenement: 'Grand',
          date_evenement: '2026-06-01',
          pax: 600, // bracket M
          organisation_id: 'org-viparis',
          lieu_id: 'lieu-1',
          lieux: { nom: 'B', ville: 'Paris' },
          organisations: { nom: 'Kaspia' },
          types_evenements: { libelle: 'Gala' },
          collectes: [],
        },
      ],
      error: null,
    }); // evenements
    rls.push({ data: null, error: null }); // dechets rpc (1 event restant après filtre M)

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(
      makeReq('/api/v1/gestionnaire/evenements?taille_evenements[]=M'),
    );
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data).toHaveLength(1);
    expect(json.data[0]?.id).toBe('e-m');
  });
});

// ── Liste Traiteurs : lieux d'intervention ────────────────────────────────────
describe('M3.2 / P2 liste traiteurs', () => {
  it("M3.2/P2_traiteurs_lieux_intervention_noms — { id, nom } résolus depuis l'embed", async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: new Date().toISOString().slice(0, 10),
          taux_recyclage: 0.9,
          evenements: {
            lieu_id: 'lieu-1',
            traiteur_operationnel_organisation_id: 'tr1',
            lieux: { id: 'lieu-1', nom: 'Palais des Congrès' },
            organisations: { id: 'tr1', nom: 'Kaspia', logo_url: null },
          },
          collecte_flux: [{ poids_reel_kg: 200 }],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    }); // collectes

    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/traiteurs'));
    const json = (await res.json()) as {
      data: Array<{
        nom: string;
        lieux_intervention: { id: string; nom: string }[];
      }>;
    };
    expect(json.data[0]?.nom).toBe('Kaspia');
    expect(json.data[0]?.lieux_intervention).toEqual([
      { id: 'lieu-1', nom: 'Palais des Congrès' },
    ]);
  });
});

// ── Dashboard : filtre global honoré ──────────────────────────────────────────
describe('M3.2 / P2 dashboard filtres globaux', () => {
  it('M3.2/P2_dashboard_filtre_taille — seules les collectes du bracket comptent', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c-s',
          type: 'zero_dechet',
          taux_recyclage: 0.8,
          realisee_at: null,
          evenements: { id: 'e-s', lieu_id: 'lieu-1', pax: 300 }, // S
          collecte_flux: [
            { poids_reel_kg: 100, flux_dechets: { code: 'carton' } },
          ],
          attributions_antgaspi: [],
        },
        {
          id: 'c-m',
          type: 'zero_dechet',
          taux_recyclage: 0.8,
          realisee_at: null,
          evenements: { id: 'e-m', lieu_id: 'lieu-1', pax: 600 }, // M
          collecte_flux: [
            { poids_reel_kg: 400, flux_dechets: { code: 'carton' } },
          ],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    }); // collectes
    rls.push({ data: null, error: null }); // packs_antgaspi maybeSingle

    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/gestionnaire/dashboard?type=zero_dechet&taille_evenements[]=M',
      ),
    );
    const json = (await res.json()) as {
      data: { kpis: { nb_collectes: number; tonnage_kg: number } };
    };
    expect(json.data.kpis.nb_collectes).toBe(1);
    expect(json.data.kpis.tonnage_kg).toBe(400);
  });
});

// ── Export CSV : respecte les filtres actifs (§06.05 l.338) ───────────────────
describe('M3.2 / P2 export CSV filtres', () => {
  it('M3.2/P2_export_csv_respecte_filtre_taille — seule la taille filtrée est exportée', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e-s',
          nom_evenement: 'PetitEvt',
          date_evenement: '2026-06-01',
          pax: 300, // S
          traiteur_operationnel_organisation_id: 'tr1',
          lieux: { nom: 'A' },
          types_evenements: { libelle: 'Gala' },
          collectes: [
            {
              id: 'c-s',
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-06-01',
              taux_recyclage: 0.8,
              collecte_flux: [{ poids_reel_kg: 100 }],
            },
          ],
        },
        {
          id: 'e-m',
          nom_evenement: 'GrandEvt',
          date_evenement: '2026-06-02',
          pax: 600, // M
          traiteur_operationnel_organisation_id: 'tr1',
          lieux: { nom: 'B' },
          types_evenements: { libelle: 'Gala' },
          collectes: [
            {
              id: 'c-m',
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-06-02',
              taux_recyclage: 0.8,
              collecte_flux: [{ poids_reel_kg: 400 }],
            },
          ],
        },
      ],
      error: null,
    }); // evenements
    // resolveTraiteurNoms → v_referentiel_traiteurs (pas d'AG → resolveRepas ne requête pas)
    rls.push({
      data: [{ id: 'tr1', nom: 'Kaspia', raison_sociale: 'Kaspia SAS' }],
      error: null,
    });

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/export-csv/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/gestionnaire/evenements/export-csv?taille_evenements[]=M',
      ),
    );
    const csv = await res.text();
    expect(csv).toContain('GrandEvt');
    expect(csv).not.toContain('PetitEvt');
  });
});

// ── Détail Lieu : capacité + photos + collectes (graphique) ───────────────────
describe('M3.2 / P2 détail lieu', () => {
  it('M3.2/P2_lieu_detail_capacite_photos_collectes — champs rendus retournés', async () => {
    setupAuth();
    rls.push({
      data: {
        id: 'lieu-1',
        nom: 'Palais',
        adresse_acces: '2 place',
        code_postal: '75017',
        ville: 'Paris',
        region: 'ile_de_france',
        type_vehicule_max: 'poids_lourd',
        capacite_maximum: 3500,
        acces_office: true,
        stationnement: 'facile',
        photos_urls: ['https://r2/p1.jpg'],
        flux_autorises: ['biodechet'],
      },
      error: null,
    }); // v_lieux_clients maybeSingle
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: '2026-06-01',
          taux_recyclage: 0.9,
          evenements: {
            lieu_id: 'lieu-1',
            organisations: { id: 'tr1', nom: 'Kaspia' },
          },
          collecte_flux: [{ poids_reel_kg: 250 }],
        },
      ],
      error: null,
    }); // collectes

    const { GET } =
      await import('@/app/api/v1/gestionnaire/lieux/[id]/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/lieux/lieu-1'), {
      params: Promise.resolve({ id: 'lieu-1' }),
    });
    const json = (await res.json()) as {
      data: {
        capacite_maximum: number;
        photos_urls: string[];
        collectes: { collecte_flux: { poids_reel_kg: number }[] }[];
      };
    };
    expect(json.data.capacite_maximum).toBe(3500);
    expect(json.data.photos_urls).toEqual(['https://r2/p1.jpg']);
    expect(json.data.collectes).toHaveLength(1);
    expect(json.data.collectes[0]?.collecte_flux[0]?.poids_reel_kg).toBe(250);
  });
});

// ── Détail Traiteur : historique collectes (§06.05 l.439) ─────────────────────
describe('M3.2 / P2 détail traiteur', () => {
  it('M3.2/P2_traiteur_detail_historique — historique_collectes avec lieu_nom + statut', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: {
        id: 'tr1',
        nom: 'Kaspia',
        logo_url: null,
        ville: 'Paris',
        description_activite: null,
      },
      error: null,
    }); // orga maybeSingle
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: '2026-06-01',
          taux_recyclage: 0.9,
          evenements: {
            lieu_id: 'lieu-1',
            traiteur_operationnel_organisation_id: 'tr1',
            lieux: { nom: 'Palais des Congrès' },
          },
          collecte_flux: [{ poids_reel_kg: 200 }],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    }); // collectes

    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/[id]/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/traiteurs/tr1'), {
      params: Promise.resolve({ id: 'tr1' }),
    });
    const json = (await res.json()) as {
      data: {
        historique_collectes: {
          lieu_nom: string | null;
          statut: string;
          type: string;
        }[];
      };
    };
    expect(json.data.historique_collectes).toHaveLength(1);
    expect(json.data.historique_collectes[0]?.lieu_nom).toBe(
      'Palais des Congrès',
    );
    expect(json.data.historique_collectes[0]?.statut).toBe('cloturee');
  });
});
