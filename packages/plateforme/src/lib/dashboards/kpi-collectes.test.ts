import { describe, it, expect, vi, beforeEach } from 'vitest';

// Lecture service_role des repas du client organisateur : faux client qui
// enregistre les identifiants demandés.
const adminIn = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        in: (col: string, ids: string[]) => {
          adminIn(col, ids);
          return Promise.resolve({
            data: ids.map((id) => ({
              collecte_id: id,
              volume_repas_realise: 40,
            })),
            error: null,
          });
        },
      }),
    }),
  }),
}));

import {
  lignesKpiMensuelles,
  lireFiltresGlobaux,
  loadKpiCollectes,
  FILTRES_GLOBAUX_VIDES,
  type CollecteKpi,
} from './kpi-collectes.js';
import { aggregateKpis } from './cockpit-derive.js';

function c(over: Partial<CollecteKpi> = {}): CollecteKpi {
  return {
    id: 'c1',
    type: 'zero_dechet',
    date_collecte: '2026-03-10',
    pax: 100,
    evenement_id: 'e1',
    taux_recyclage: 80,
    co2_induit_kg: 1,
    co2_evite_kg: 10,
    co2_net_kg: -9,
    energie_primaire_evitee_kwh: 5,
    tonnage_kg: 200,
    repas: 0,
    ...over,
  };
}

describe('lignesKpiMensuelles — règles des vues v_kpi_traiteur / v_kpi_client_organisateur', () => {
  it('regroupe par mois et type, mois décroissants', () => {
    const lignes = lignesKpiMensuelles([
      c({ id: 'a', date_collecte: '2026-03-10' }),
      c({ id: 'b', date_collecte: '2026-03-28', evenement_id: 'e1' }),
      c({ id: 'd', date_collecte: '2026-05-02', evenement_id: 'e2' }),
    ]);
    expect(
      lignes.map((l) => [l.mois, l.nb_collectes, l.nb_evenements]),
    ).toEqual([
      ['2026-05-01', 1, 1],
      ['2026-03-01', 2, 1],
    ]);
  });

  it('ZD : poids, taux pondéré par le poids des collectes à taux connu, CO₂ additionnés', () => {
    const [l] = lignesKpiMensuelles([
      c({ id: 'a', tonnage_kg: 300, taux_recyclage: 90 }),
      c({ id: 'b', tonnage_kg: 100, taux_recyclage: 50 }),
      c({ id: 'd', tonnage_kg: 100, taux_recyclage: null }),
    ]);
    expect(l!.tonnage_kg).toBe(500);
    expect(l!.taux_recyclage_pondere).toBeCloseTo((90 * 300 + 50 * 100) / 400);
    expect(l!.nb_repas_donnes).toBeNull();
    expect(l!.co2_evite_kg).toBe(30);
    expect(l!.marge_zd_ht).toBeNull();
  });

  it('collecte à 0 convive : dans le poids, hors numérateur et dénominateur de kg/pax', () => {
    const lignes = lignesKpiMensuelles([
      c({ id: 'a', pax: 100, tonnage_kg: 50 }),
      c({ id: 'b', pax: 0, tonnage_kg: 500 }),
    ]);
    const agg = aggregateKpis(lignes);
    expect(agg.tonnage).toBe(550);
    expect(agg.pax).toBe(100);
    expect(agg.kgPax).toBeCloseTo(0.5);
  });

  it('AG : repas additionnés, repas/pax sur les collectes à convives connus', () => {
    const lignes = lignesKpiMensuelles([
      c({ id: 'a', type: 'anti_gaspi', pax: 200, repas: 50, tonnage_kg: 0 }),
      c({ id: 'b', type: 'anti_gaspi', pax: 0, repas: 30, tonnage_kg: 0 }),
    ]);
    const agg = aggregateKpis(lignes);
    expect(lignes[0]!.tonnage_kg).toBeNull();
    expect(agg.repas).toBe(80);
    expect(agg.repasPax).toBeCloseTo(50 / 200);
  });

  it('la somme des parts d’un filtre égale le total', () => {
    const tout = [
      c({ id: 'a', tonnage_kg: 120, taux_recyclage: 70 }),
      c({ id: 'b', tonnage_kg: 80, taux_recyclage: 40, pax: 300 }),
    ];
    const total = aggregateKpis(lignesKpiMensuelles(tout));
    const partA = aggregateKpis(lignesKpiMensuelles([tout[0]!]));
    const partB = aggregateKpis(lignesKpiMensuelles([tout[1]!]));
    expect(partA.tonnage + partB.tonnage).toBe(total.tonnage);
    expect(partA.nbCollectes + partB.nbCollectes).toBe(total.nbCollectes);
  });
});

describe('lireFiltresGlobaux', () => {
  it('lit les cinq listes de la barre', () => {
    const sp = new URLSearchParams(
      'lieu_ids[]=L1&traiteur_ids[]=T1&client_noms[]=Dior&client_noms[]=LVMH&type_evenement_ids[]=X&taille_evenements[]=M',
    );
    expect(lireFiltresGlobaux(sp)).toEqual({
      lieuIds: ['L1'],
      traiteurIds: ['T1'],
      clientNoms: ['Dior', 'LVMH'],
      typeEvtIds: ['X'],
      tailleEvts: ['M'],
    });
  });
});

// Faux client PostgREST qui enregistre chaque filtre posé.
function fauxClient(lignes: unknown[]) {
  const appels: [string, string, unknown][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'gt', 'order', 'limit'])
    q[m] = (col: unknown, val: unknown) => {
      appels.push([m, String(col), val]);
      return q;
    };
  q.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve({ data: lignes, error: null }).then(ok);
  return { client: { from: () => q }, appels };
}

const UUID = '11111111-1111-4111-8111-111111111111';
const LIEU = '22222222-2222-4222-8222-222222222222';
const TRAITEUR = '33333333-3333-4333-8333-333333333333';
const ligne = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'anti_gaspi',
  date_collecte: '2026-03-10',
  pax: 600,
  evenement_id: 'e1',
  taux_recyclage: null,
  co2_induit_kg: null,
  co2_evite_kg: '25',
  co2_net_kg: null,
  energie_primaire_evitee_kwh: null,
  collecte_flux: [],
  attributions_antgaspi: [{ volume_repas_realise: 12 }],
  ...over,
});

describe('loadKpiCollectes — périmètre et filtres', () => {
  beforeEach(() => adminIn.mockClear());

  it('traiteur : événements programmés par son organisation, filtres Lieux / Client / Type', async () => {
    const { client, appels } = fauxClient([ligne()]);
    const res = await loadKpiCollectes(
      client,
      { role: 'traiteur_manager', organisationId: 'org-1' },
      {
        from: '2026-01-01',
        to: '2026-12-31',
        type: 'anti_gaspi',
        filtres: {
          ...FILTRES_GLOBAUX_VIDES,
          lieuIds: [LIEU],
          clientNoms: ['Dior'],
          typeEvtIds: [UUID],
          traiteurIds: ['ignoré'],
        },
      },
    );
    expect(appels).toContainEqual([
      'eq',
      'evenements.organisation_id',
      'org-1',
    ]);
    expect(appels).toContainEqual(['eq', 'statut', 'cloturee']);
    expect(appels).toContainEqual(['in', 'evenements.lieu_id', [LIEU]]);
    expect(appels).toContainEqual([
      'in',
      'evenements.nom_client_organisateur',
      ['Dior'],
    ]);
    expect(appels).toContainEqual(['in', 'type_evenement_id', [UUID]]);
    // Pas de filtre Traiteurs pour le traiteur (§06.04).
    expect(
      appels.some(
        (a) => a[1] === 'evenements.traiteur_operationnel_organisation_id',
      ),
    ).toBe(false);
    expect(res.data[0]!.nb_repas_donnes).toBe(12);
    expect(res.data[0]!.co2_evite_kg).toBe(25);
    expect(adminIn).not.toHaveBeenCalled();
  });

  it('client organisateur : événements dont il est le client rattaché, filtre Traiteurs, repas bornés à ses collectes', async () => {
    const { client, appels } = fauxClient([
      ligne({ id: 'c1' }),
      ligne({ id: 'c2', type: 'zero_dechet' }),
    ]);
    const res = await loadKpiCollectes(
      client,
      { role: 'client_organisateur', organisationId: 'org-co' },
      {
        from: null,
        to: null,
        type: null,
        filtres: { ...FILTRES_GLOBAUX_VIDES, traiteurIds: [TRAITEUR] },
      },
    );
    expect(appels).toContainEqual([
      'eq',
      'evenements.client_organisateur_organisation_id',
      'org-co',
    ]);
    expect(appels).toContainEqual([
      'in',
      'evenements.traiteur_operationnel_organisation_id',
      [TRAITEUR],
    ]);
    // Seule la collecte AG lue sous RLS est demandée en service_role.
    expect(adminIn).toHaveBeenCalledWith('collecte_id', ['c1']);
    const ag = res.data.find((l) => l.type_collecte === 'anti_gaspi');
    expect(ag!.nb_repas_donnes).toBe(40);
  });

  it('filtre Taille appliqué sur le pax de la collecte', async () => {
    const { client } = fauxClient([
      ligne({ id: 'a', pax: 100 }),
      ligne({ id: 'b', pax: 600 }),
    ]);
    const res = await loadKpiCollectes(
      client,
      { role: 'agence', organisationId: 'org-1' },
      {
        from: null,
        to: null,
        type: 'anti_gaspi',
        filtres: { ...FILTRES_GLOBAUX_VIDES, tailleEvts: ['M'] },
      },
    );
    expect(res.data[0]!.nb_collectes).toBe(1);
    expect(res.data[0]!.pax_total).toBe(600);
  });

  it('filtre Type illisible : aucune collecte, sans requête', async () => {
    const { client, appels } = fauxClient([ligne()]);
    const res = await loadKpiCollectes(
      client,
      { role: 'agence', organisationId: 'org-1' },
      {
        from: '2026-01-01',
        to: '2026-06-30',
        type: 'zero_dechet',
        compare: 'n1',
        filtres: { ...FILTRES_GLOBAUX_VIDES, typeEvtIds: ['pas-un-uuid'] },
      },
    );
    expect(res).toEqual({ data: [], previous: [] });
    expect(appels).toEqual([]);
  });
});
