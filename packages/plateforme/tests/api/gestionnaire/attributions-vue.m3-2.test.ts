/**
 * M3.2 — Données Anti-Gaspi du gestionnaire de lieux lues par la vue
 * `v_attributions_gestionnaire` (§04, arbitrage Val 2026-09-21 option b).
 *
 * Constat d'origine (savr-dev, 2026-10-04, Viparis) : 127 collectes AG clôturées
 * sur ses lieux, 10 425 repas en base, 0 attribution lisible — `aa_select` (C-1)
 * refuse la table au gestionnaire dès que l'événement vient d'un traiteur tiers.
 * « Repas donnés » restait à 0 sur le dashboard, la liste et la fiche Traiteurs,
 * et Mon pack AG.
 *
 * Ce que ces tests tiennent : chaque route DEMANDE la vue (sous l'alias
 * `attributions_antgaspi`), jamais la table — un mock ne verrait pas la
 * différence, la RLS de production si.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { jourParis } from '@savr/shared/src/temps/index.js';

type Result = { data: unknown; error: unknown };

// Mock Supabase keyé par TABLE : enregistre les `select` demandés, rend
// `results[table]` quelle que soit la suite de filtres.
function makeClient() {
  const results: Record<string, Result> = {};
  const selects: Record<string, string[]> = {};
  const api = {
    results,
    selects,
    from(table: string) {
      const res = (): Result => results[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: (s: unknown) => {
          (selects[table] ??= []).push(String(s));
          return chain;
        },
        maybeSingle: () => Promise.resolve(res()),
        single: () => Promise.resolve(res()),
        then: (resolve: (v: Result) => unknown) => resolve(res()),
      };
      for (const m of [
        'eq',
        'neq',
        'in',
        'gte',
        'lte',
        'not',
        'order',
        'limit',
      ])
        chain[m] = () => chain;
      return chain;
    },
  };
  return api;
}

let rls = makeClient();
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
// Mon pack AG interroge le journal d'audit par le client de service dès qu'une
// collecte annulée porte un pack : ici le mock par table rend les mêmes lignes
// aux deux lectures de collectes, d'où un appel, sans trace de débit en retour.
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => rls,
}));

function req(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

const VUE_REPAS =
  'attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)';
// La table en embed direct : `attributions_antgaspi(`, sans alias de vue.
const TABLE = /attributions_antgaspi\s*\(/;

// Collecte AG clôturée d'un traiteur TIERS sur un lieu du gestionnaire, telle
// que PostgREST la rend : l'embed de la vue est un OBJET (to-one, mesuré).
function collecteAg(id: string, repas: number | null, evt: object) {
  return {
    id,
    type: 'anti_gaspi',
    statut: 'cloturee',
    date_collecte: jourParis(new Date()),
    taux_recyclage: null,
    realisee_at: null,
    evenements: evt,
    collecte_flux: [],
    attributions_antgaspi:
      repas == null ? null : { volume_repas_realise: repas },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: {
      userId: 'user-g',
      role: 'gestionnaire_lieux',
      organisationId: 'org-gest',
    },
  });
  rls.results.organisations_lieux = {
    data: [{ lieu_id: 'lieu-1' }],
    error: null,
  };
});

describe('M3.2 / dashboard gestionnaire — KPI Anti-Gaspi par la vue', () => {
  it('M3.2/dashboard_ag_repas_par_vue — repas donnés et repas/pax sur des événements de traiteurs tiers', async () => {
    rls.results.collectes = {
      data: [
        collecteAg('c1', 120, { id: 'e1', lieu_id: 'lieu-1', pax: 1000 }),
        collecteAg('c2', 80, { id: 'e2', lieu_id: 'lieu-1', pax: 1000 }),
        // Collecte sans attribution rendue par la vue : compte, sans repas.
        collecteAg('c3', null, { id: 'e3', lieu_id: 'lieu-1', pax: 500 }),
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      req('/api/v1/gestionnaire/dashboard?type=anti_gaspi'),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { kpis: Record<string, number | null> };
    };
    expect(data.kpis).toMatchObject({
      nb_collectes: 3,
      nb_repas_donnes: 200,
      pax_total: 2500,
    });
    expect(data.kpis.repas_par_pax).toBeCloseTo(0.08, 5);

    const select = rls.selects.collectes?.[0] ?? '';
    expect(select).toContain(VUE_REPAS);
    expect(select).not.toMatch(TABLE);
  });
});

describe('M3.2 / traiteurs gestionnaire — repas donnés par la vue', () => {
  const evt = {
    lieu_id: 'lieu-1',
    traiteur_operationnel_organisation_id: 'tr1',
    lieux: { id: 'lieu-1', nom: 'Palais' },
    organisations: { id: 'tr1', nom: 'Kaspia', logo_url: null },
  };

  it('M3.2/traiteurs_liste_repas_par_vue — « Repas donnés 12 mois » d’un traiteur tiers', async () => {
    rls.results.collectes = {
      data: [collecteAg('c1', 150, evt), collecteAg('c2', 60, evt)],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/route.js');
    const res = await GET(req('/api/v1/gestionnaire/traiteurs'));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ nom: string; repas_donnes_12m: number }>;
    };
    expect(data[0]).toMatchObject({ nom: 'Kaspia', repas_donnes_12m: 210 });

    const select = rls.selects.collectes?.[0] ?? '';
    expect(select).toContain(VUE_REPAS);
    expect(select).not.toMatch(TABLE);
  });

  it('M3.2/traiteur_detail_repas_par_vue — fiche traiteur : repas des 12 derniers mois', async () => {
    rls.results.v_traiteurs_gestionnaire = {
      data: { id: 'tr1', nom: 'Kaspia', logo_url: null },
      error: null,
    };
    rls.results.collectes = {
      data: [collecteAg('c1', 150, evt), collecteAg('c2', null, evt)],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/[id]/route.js');
    const res = await GET(req('/api/v1/gestionnaire/traiteurs/tr1'), {
      params: Promise.resolve({ id: 'tr1' }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { stats_12m: { nb_collectes_ag: number; repas_donnes: number } };
    };
    expect(data.stats_12m).toMatchObject({
      nb_collectes_ag: 2,
      repas_donnes: 150,
    });

    const select = rls.selects.collectes?.[0] ?? '';
    expect(select).toContain(VUE_REPAS);
    expect(select).not.toMatch(TABLE);
  });
});

describe('M3.2 / Mon pack AG — historique de consommation par la vue', () => {
  it('M3.2/pack_ag_consommation_par_vue — repas et association lus par la vue, nom à plat', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c-ag',
          date_collecte: '2026-06-01',
          statut: 'cloturee',
          packs_antgaspi: { id: 'pack-org' },
          evenements: {
            nom_evenement: 'Gala',
            date_evenement: '2026-06-01',
            lieux: { nom: 'Palais' },
          },
          attributions_antgaspi: {
            volume_repas_realise: 55,
            association_nom: 'Les Restos',
          },
        },
      ],
      error: null,
    };
    const { GET } = await import('@/app/api/v1/gestionnaire/pack-ag/route.js');
    const res = await GET(req('/api/v1/gestionnaire/pack-ag'));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        historique_consommation: Array<{
          repas_donnes: number;
          associations: Array<{ nom: string | null; repas: number }>;
        }>;
      };
    };
    expect(data.historique_consommation[0]).toMatchObject({
      repas_donnes: 55,
      associations: [{ nom: 'Les Restos', repas: 55 }],
    });

    const select = rls.selects.collectes?.[0] ?? '';
    expect(select).toContain(
      'attributions_antgaspi:v_attributions_gestionnaire(',
    );
    expect(select).toContain('association_nom');
    expect(select).not.toMatch(TABLE);
  });
});
