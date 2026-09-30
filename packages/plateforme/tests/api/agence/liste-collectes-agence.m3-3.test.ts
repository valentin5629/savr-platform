/**
 * M3.3 — GET /api/v1/agence/collectes et /filtres : parité §06.04 §3 de la liste
 * agence (§06.11 « Liste Collectes », revue écran E2E 2026-09-30).
 *  - mêmes champs calculés que la liste traiteur (résultats de la collecte
 *    réalisée, rapport réservé), embeds bruts non renvoyés ;
 *  - mêmes filtres (client organisateur, info incomplète) ;
 *  - options de filtres dérivées des seules collectes listées, sans lecture
 *    service-role, sans « Programmée par ».
 *
 * Mock du query-builder Supabase chaînable, keyé par table (résout via `.then`),
 * qui journalise les filtres appliqués.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  const filtres: [string, string, unknown][] = [];
  const selects: string[] = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: [], error: null };
    const note =
      (op: string) =>
      (col: string, val: unknown): Record<string, unknown> => {
        filtres.push([op, col, val]);
        return c;
      };
    const c: Record<string, unknown> = {
      select: (cols: string) => {
        selects.push(cols);
        return c;
      },
      eq: note('eq'),
      in: note('in'),
      gte: note('gte'),
      lte: note('lte'),
      order: () => c,
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  return { from: (table: string) => chain(table), results, filtres, selects };
}

let rls = makeClient();
const mockRequireUser = vi.fn();
const mockAdminClient = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockAdminClient(),
}));

async function callListe(qs: string) {
  const { GET } = await import('@/app/api/v1/agence/collectes/route.js');
  return GET(new NextRequest(`http://localhost/api/v1/agence/collectes?${qs}`));
}
async function callFiltres() {
  const { GET } =
    await import('@/app/api/v1/agence/collectes/filtres/route.js');
  return GET(
    new NextRequest('http://localhost/api/v1/agence/collectes/filtres'),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'u-agence', role: 'agence', organisationId: 'org-agence' },
  });
});

describe('M3.3 / liste agence — route liste', () => {
  it('M3.3/liste_agence_resultats — résultats agrégés comme le traiteur, embeds masqués', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c-zd',
          type: 'zero_dechet',
          statut: 'cloturee',
          taux_recyclage: 73.8,
          co2_evite_kg: 48.9,
          collecte_flux: [{ poids_reel_kg: 60 }, { poids_reel_kg: 40 }],
          attributions_antgaspi: [],
          evenements: {
            organisation_id: 'org-agence',
            traiteur_operationnel_organisation_id: 'org-traiteur',
          },
        },
        {
          id: 'c-ag',
          type: 'anti_gaspi',
          statut: 'cloturee',
          taux_recyclage: null,
          co2_evite_kg: 70,
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 28 },
          evenements: {
            organisation_id: 'org-agence',
            traiteur_operationnel_organisation_id: 'org-traiteur',
          },
        },
      ],
      error: null,
    };
    const res = await callListe('type=zero_dechet&statut=cloturee');
    expect(res.status).toBe(200);
    // Les résultats ne sont calculables que si la route DEMANDE les embeds
    // (le mock rend les données quel que soit le select).
    const select = rls.selects.join(' ').replace(/\s+/g, '');
    expect(select).toContain('co2_evite_kg');
    expect(select).toContain('collecte_flux(poids_reel_kg)');
    expect(select).toContain('attributions_antgaspi(volume_repas_realise)');
    const { data } = (await res.json()) as { data: Record<string, unknown>[] };
    const [zd, ag] = data;
    expect(zd!.poids_total_kg).toBe(100);
    expect(zd!.taux_recyclage).toBe(73.8);
    expect(ag!.nb_repas_donnes).toBe(28);
    expect(ag!.co2_evite_kg).toBe(70);
    for (const row of data) {
      expect('collecte_flux' in row).toBe(false);
      expect('attributions_antgaspi' in row).toBe(false);
      // L'agence programme ses collectes : jamais « programmée par un tiers »,
      // jamais de rapport réservé (elle EST le donneur d'ordre, D12).
      expect(row.programmee_par_tiers).toBe(false);
      expect(row.rapport_reserve_donneur_ordre).toBe(false);
    }
  });

  it('M3.3/liste_agence_filtres_client_info — client organisateur et info incomplète appliqués', async () => {
    await callListe(
      'type=anti_gaspi&statut=programmee,validee&client=Viparis&info_incomplete=oui&lieu_id=l1',
    );
    expect(rls.filtres).toEqual(
      expect.arrayContaining([
        ['eq', 'type', 'anti_gaspi'],
        ['in', 'statut', ['programmee', 'validee']],
        ['eq', 'evenements.lieu_id', 'l1'],
        ['eq', 'evenements.nom_client_organisateur', 'Viparis'],
        // « Info incomplète : oui » = informations_completes à false.
        ['eq', 'informations_completes', false],
      ]),
    );
  });

  it('M3.3/liste_agence_role — la route reste réservée au rôle agence', async () => {
    const refus = new Response(null, { status: 403 });
    mockRequireUser.mockResolvedValueOnce({ error: refus });
    const res = await callListe('type=zero_dechet');
    expect(res.status).toBe(403);
    expect(mockRequireUser.mock.calls[0]![1]).toEqual(['agence']);
  });
});

describe('M3.3 / liste agence — options de filtres', () => {
  it('M3.3/liste_agence_options_filtres — lieux et clients dérivés, triés, dédoublonnés, sans programmateurs', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c1',
          evenements: {
            nom_client_organisateur: ' Viparis ',
            lieux: { id: 'l2', nom: 'Palais des Congrès de Paris' },
          },
        },
        {
          id: 'c2',
          evenements: {
            nom_client_organisateur: 'Accor',
            lieux: [{ id: 'l1', nom: 'Paris Expo Porte de Versailles' }],
          },
        },
        {
          id: 'c3',
          evenements: {
            nom_client_organisateur: 'Viparis',
            lieux: { id: 'l2', nom: 'Palais des Congrès de Paris' },
          },
        },
      ],
      error: null,
    };
    const res = await callFiltres();
    const { data } = (await res.json()) as {
      data: {
        lieux: { id: string; nom: string }[];
        clients: string[];
        programmateurs: unknown[];
      };
    };
    expect(data.lieux).toEqual([
      { id: 'l2', nom: 'Palais des Congrès de Paris' },
      { id: 'l1', nom: 'Paris Expo Porte de Versailles' },
    ]);
    expect(data.clients).toEqual(['Accor', 'Viparis']);
    expect(data.programmateurs).toEqual([]);
    // Lecture sous l'identité de l'agence uniquement.
    expect(mockAdminClient).not.toHaveBeenCalled();
    expect(mockRequireUser.mock.calls[0]![1]).toEqual(['agence']);
  });
});
