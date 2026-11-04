/**
 * M3.5 — Filtres Lieux / Traiteur / Agence / Gestionnaire de lieux de la section
 * Revenus du Dashboard Admin (décisions Val 2026-10-30) :
 *   - traiteur ou agence : collectes programmées OU opérées (règle R24c) ;
 *   - gestionnaire de lieux : collectes tenues sur les lieux de son parc ;
 *   - organisations additionnées, filtre Lieux en plus (ET) ;
 *   - histogramme `revenus-mensuels` : collectes programmées et réalisées, au
 *     montant de la prestation, facturées ou non (Val 2026-11-03).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

// Mock supabase : une chaîne par appel à `from`, résultat choisi par table.
function makeClient() {
  const results: Record<string, Result> = {};
  const appels: { table: string; methode: string; args: unknown[] }[] = [];
  const client = {
    appels,
    setResult(table: string, r: Result) {
      results[table] = r;
    },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of [
        'select',
        'order',
        'in',
        'eq',
        'gte',
        'lte',
        'range',
        'not',
        'or',
      ]) {
        chain[m] = (...args: unknown[]) => {
          appels.push({ table, methode: m, args });
          return chain;
        };
      }
      chain.then = (resolve: (r: Result) => unknown) =>
        resolve(results[table] ?? { data: [], error: null });
      return chain;
    },
  };
  return client;
}

let admin = makeClient();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify({ aal: 'aal2', ...claims })).toString('base64url')}.s`;
}
function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

const T1 = '11111111-1111-4111-8111-111111111111';
const G1 = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333';
const L2 = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  admin = makeClient();
});

describe('M3.5 / revenus Admin — périmètre des filtres', () => {
  it('M3.5/revenus_filtres_perimetre — traiteur = programmé OU opéré, gestionnaire = lieux de son parc, lieux en plus', async () => {
    admin.setResult('organisations', {
      data: [
        { id: T1, type: 'traiteur' },
        { id: G1, type: 'gestionnaire_lieux' },
      ],
      error: null,
    });
    admin.setResult('organisations_lieux', {
      data: [{ lieu_id: L1 }, { lieu_id: L1 }],
      error: null,
    });
    const { lirePerimetreRevenus } =
      await import('@/lib/dashboards/revenus-admin.js');
    const { perimetre } = await lirePerimetreRevenus(
      admin as never,
      new URLSearchParams({
        organisation_ids: `${T1},${G1},pas-un-uuid`,
        lieu_ids: L2,
      }),
    );
    expect(perimetre.vide).toBe(false);
    expect(perimetre.lieuIds).toEqual([L2]);
    expect(perimetre.orEvenement).toBe(
      `organisation_id.in.(${T1}),traiteur_operationnel_organisation_id.in.(${T1}),lieu_id.in.(${L1})`,
    );
    // L'identifiant malformé n'atteint jamais la base.
    const lu = admin.appels.find(
      (a) => a.table === 'organisations' && a.methode === 'in',
    );
    expect(lu?.args[1]).toEqual([T1, G1]);
  });

  it('M3.5/revenus_filtres_gestionnaire_sans_lieu — sélection vide = aucune donnée', async () => {
    setupAuth('admin_savr');
    admin.setResult('organisations', {
      data: [{ id: G1, type: 'gestionnaire_lieux' }],
      error: null,
    });
    admin.setResult('organisations_lieux', { data: [], error: null });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-mensuels/route.js');
    const res = await GET(
      makeReq(
        `/api/v1/admin/dashboard/revenus-mensuels?organisation_ids=${G1}`,
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).kpi).toEqual([]);
    expect(admin.appels.some((a) => a.table === 'collectes')).toBe(false);
  });

  it('M3.5/revenus_filtres_tableau — le tableau pose le périmètre sur l’événement des collectes', async () => {
    setupAuth('admin_savr');
    admin.setResult('organisations', {
      data: [{ id: T1, type: 'traiteur' }],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq(
        `/api/v1/admin/dashboard/revenus-organisations?organisation_ids=${T1}&lieu_ids=${L1}`,
      ),
    );
    expect(res.status).toBe(200);
    // Le périmètre se pose sur l'événement ; l'autre `.or()` porte les statuts.
    const ors = admin.appels.filter((a) => a.methode === 'or' && a.args[1]);
    expect(ors.map((a) => [a.table, a.args[1]])).toEqual([
      ['collectes', { referencedTable: 'evenements' }],
    ]);
    const lieux = admin.appels.filter(
      (a) => a.methode === 'in' && String(a.args[0]).endsWith('lieu_id'),
    );
    expect(lieux.map((a) => a.args)).toEqual([['evenements.lieu_id', [L1]]]);
    // Facturé ou non : aucune lecture des factures (Val 2026-11-03).
    expect(admin.appels.some((a) => a.table === 'factures_collectes')).toBe(
      false,
    );
  });
});

describe('M3.5 / revenus Admin — périmètre des deux routes', () => {
  it('M3.5/revenus_filtres_histogramme — l’histogramme pose le périmètre sur les collectes', async () => {
    setupAuth('admin_savr');
    admin.setResult('organisations', {
      data: [{ id: T1, type: 'traiteur' }],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-mensuels/route.js');
    const res = await GET(
      makeReq(
        `/api/v1/admin/dashboard/revenus-mensuels?organisation_ids=${T1}&lieu_ids=${L1}`,
      ),
    );
    expect(res.status).toBe(200);
    // Le périmètre se pose sur l'événement ; l'autre `.or()` porte les statuts.
    const ors = admin.appels.filter((a) => a.methode === 'or' && a.args[1]);
    expect(ors.map((a) => [a.table, a.args[1]])).toEqual([
      ['collectes', { referencedTable: 'evenements' }],
    ]);
    const lieux = admin.appels.filter(
      (a) => a.methode === 'in' && String(a.args[0]).endsWith('lieu_id'),
    );
    expect(lieux.map((a) => a.args)).toEqual([['evenements.lieu_id', [L1]]]);
    // Facturé ou non : aucune lecture des factures (Val 2026-11-03).
    expect(admin.appels.some((a) => a.table === 'factures_collectes')).toBe(
      false,
    );
  });

  it('M3.5/revenus_filtres_tableau_gestionnaire_sans_lieu — tableau vide, aucune lecture de collectes ni de factures', async () => {
    setupAuth('admin_savr');
    admin.setResult('organisations', {
      data: [{ id: G1, type: 'gestionnaire_lieux' }],
      error: null,
    });
    admin.setResult('organisations_lieux', { data: [], error: null });
    admin.setResult('collectes', {
      data: [
        {
          type: 'zero_dechet',
          statut: 'cloturee',
          evenements: {
            organisation_id: T1,
            organisations: { raison_sociale: 'Kaspia SAS', type: 'traiteur' },
          },
          packs_antgaspi: null,
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq(
        `/api/v1/admin/dashboard/revenus-organisations?organisation_ids=${G1}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(
      admin.appels.some(
        (a) => a.table === 'collectes' || a.table === 'factures_collectes',
      ),
    ).toBe(false);
  });
});

describe('M3.5 / revenus Admin — histogramme mensuel', () => {
  it('M3.5/revenus_mensuels_montants — collectes programmées et réalisées au montant de la prestation, au mois de la collecte', async () => {
    setupAuth('ops_savr');
    admin.setResult('collectes', {
      data: [
        {
          type: 'zero_dechet',
          pax: 100,
          date_collecte: '2026-09-12',
          evenements: { organisation_id: T1, lieu_id: L1 },
          packs_antgaspi: null,
        },
        {
          type: 'anti_gaspi',
          pax: 80,
          date_collecte: '2026-09-20',
          evenements: { organisation_id: T1, lieu_id: L1 },
          packs_antgaspi: {
            prix_unitaire_ht: null,
            montant_total_ht: 1000,
            credits_initiaux: 10,
          },
        },
        {
          type: 'anti_gaspi',
          pax: 80,
          date_collecte: '2026-10-02',
          evenements: { organisation_id: T1, lieu_id: L1 },
          packs_antgaspi: {
            prix_unitaire_ht: 80,
            montant_total_ht: null,
            credits_initiaux: null,
          },
        },
      ],
      error: null,
    });
    admin.setResult('grilles_tarifaires_zd', {
      data: [
        {
          id: 'g1',
          est_defaut: true,
          valide_du: '2026-01-01',
          valide_jusqu: null,
        },
      ],
      error: null,
    });
    admin.setResult('tarifs_zero_dechet', {
      data: [
        {
          grille_id: 'g1',
          pax_min: 1,
          pax_max: null,
          prix_base_ht: 300,
          prix_par_couvert_ht: null,
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-mensuels/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/admin/dashboard/revenus-mensuels?from=2026-09-01&to=2026-10-30',
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).kpi).toEqual([
      {
        mois: '2026-09-01',
        type_collecte: 'anti_gaspi',
        nb_collectes: 1,
        montant_ht: 100,
      },
      {
        mois: '2026-09-01',
        type_collecte: 'zero_dechet',
        nb_collectes: 1,
        montant_ht: 300,
      },
      {
        mois: '2026-10-01',
        type_collecte: 'anti_gaspi',
        nb_collectes: 1,
        montant_ht: 80,
      },
    ]);
    // Statuts comptés : programmées et réalisées, plus les annulations
    // tardives (Val 2026-11-03) ; aucune facture lue.
    const filtres = admin.appels
      .filter((a) => a.table === 'collectes')
      .map((a) => [a.methode, ...a.args]);
    expect(filtres).toContainEqual([
      'or',
      'statut.in.(programmee,validee,en_cours,realisee,realisee_sans_collecte,cloturee),and(statut.eq.annulee,annulation_tardive.is.true)',
    ]);
    expect(admin.appels.some((a) => a.table === 'factures_collectes')).toBe(
      false,
    );
  });

  it('M3.5/revenus_periode_sans_fin — sans `to`, aucune borne de fin : les collectes programmées à venir comptent (Val 2026-11-03)', async () => {
    setupAuth('admin_savr');
    const mensuels =
      await import('@/app/api/v1/admin/dashboard/revenus-mensuels/route.js');
    await mensuels.GET(
      makeReq('/api/v1/admin/dashboard/revenus-mensuels?from=2026-01-01'),
    );
    const organisations =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    await organisations.GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations?from=2026-01-01'),
    );
    const bornes = admin.appels.filter(
      (a) => a.table === 'collectes' && a.methode === 'lte',
    );
    expect(bornes).toEqual([]);
    // Avec `to`, la borne est posée.
    await mensuels.GET(
      makeReq(
        '/api/v1/admin/dashboard/revenus-mensuels?from=2026-01-01&to=2026-12-31',
      ),
    );
    expect(
      admin.appels.filter(
        (a) => a.table === 'collectes' && a.methode === 'lte',
      ),
    ).toEqual([
      {
        table: 'collectes',
        methode: 'lte',
        args: ['date_collecte', '2026-12-31'],
      },
    ]);
  });

  it('M3.5/revenus_annulation_tardive_montant_plein — une collecte annulée tardivement compte au montant plein de la prestation', async () => {
    setupAuth('admin_savr');
    // La base ne rend que les collectes du filtre : ici une ZD annulée
    // tardivement (annulation_tardive = true) et une ZD programmée.
    const zd = (statut: string, annulation_tardive: boolean | null) => ({
      type: 'zero_dechet',
      statut,
      annulation_tardive,
      pax: 100,
      date_collecte: '2026-09-12',
      evenements: { organisation_id: T1, lieu_id: L1 },
      packs_antgaspi: null,
    });
    admin.setResult('collectes', {
      data: [zd('annulee', true), zd('programmee', null)],
      error: null,
    });
    admin.setResult('grilles_tarifaires_zd', {
      data: [
        {
          id: 'g1',
          est_defaut: true,
          valide_du: '2026-01-01',
          valide_jusqu: null,
        },
      ],
      error: null,
    });
    admin.setResult('tarifs_zero_dechet', {
      data: [
        {
          grille_id: 'g1',
          pax_min: 1,
          pax_max: null,
          prix_base_ht: 300,
          prix_par_couvert_ht: null,
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-mensuels/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/admin/dashboard/revenus-mensuels?from=2026-09-01&to=2026-09-30',
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).kpi).toEqual([
      {
        mois: '2026-09-01',
        type_collecte: 'zero_dechet',
        nb_collectes: 2,
        montant_ht: 600,
      },
    ]);
    const statuts = admin.appels.find(
      (a) => a.table === 'collectes' && a.methode === 'or' && !a.args[1],
    );
    expect(String(statuts?.args[0])).toContain(
      'and(statut.eq.annulee,annulation_tardive.is.true)',
    );
  });

  it('M3.5/revenus_mensuels_role — 403 hors équipe Savr', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-mensuels/route.js');
    const res = await GET(makeReq('/api/v1/admin/dashboard/revenus-mensuels'));
    expect(res.status).toBe(403);
  });
});
