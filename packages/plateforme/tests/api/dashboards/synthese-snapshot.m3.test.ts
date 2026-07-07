/**
 * M3.5 / M3.1 / M3.2 / M3.3 — Snapshot du rapport de synthèse agrégé (§12 §1.6,
 * BL-P1-PARITE-02). Couvre la logique SERVEUR (agrégation par type, prédicat
 * d'inclusion embargo H+24, périmètre par rôle = 0 fuite inter-organisation),
 * indépendamment du rendu PDF (testé côté renderer) et de la route (testée à part).
 */
import { describe, it, expect } from 'vitest';
import {
  buildSyntheseSnapshot,
  type SyntheseParams,
  type SyntheseRole,
} from '../../../src/lib/dashboards/synthese-snapshot.js';

// ── Mock Supabase chaînable, routé par table + thenable (résout results[table]) ──
type Res = { data: unknown; error: unknown };
function makeSupabase(results: Record<string, Res>) {
  const calls: Record<string, unknown[][]> = {};
  const rec = (n: string, a: unknown[]) => (calls[n] ??= []).push(a);
  let current = '';
  const chain: Record<string, unknown> = {};
  chain.from = (t: string) => {
    current = t;
    rec('from', [t]);
    return chain;
  };
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) {
    chain[m] = (...a: unknown[]) => {
      rec(m, a);
      return chain;
    };
  }
  chain.maybeSingle = () =>
    Promise.resolve(results[current] ?? { data: null, error: null });
  chain.then = (resolve: (r: Res) => unknown) =>
    resolve(results[current] ?? { data: [], error: null });
  return {
    client: chain as unknown as Parameters<typeof buildSyntheseSnapshot>[0],
    calls,
  };
}

const CLOCK = {
  nowIso: '2026-07-07T09:00:00.000Z',
  cutoffIso: '2026-07-06T09:00:00.000Z',
  dateGenerationLabel: '07/07/2026 09:00',
};

function baseParams(over: Partial<SyntheseParams> = {}): SyntheseParams {
  return {
    from: '2026-01-01',
    to: '2026-06-30',
    types: [],
    lieuIds: [],
    traiteurIds: [],
    clientOrgaIds: [],
    commercialIds: [],
    typeEvtIds: [],
    tailleEvts: [],
    ...over,
  };
}

function evt(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    nom_evenement: 'Gala',
    date_evenement: '2026-02-14',
    lieu_id: 'l1',
    pax: 200,
    organisation_id: 'org-1',
    client_organisateur_organisation_id: null,
    type_evenement_id: 'te1',
    traiteur_operationnel_organisation_id: 'org-1',
    created_by: 'u1',
    lieux: { id: 'l1', nom: 'Pavillon' },
    ...over,
  };
}

const ZD_COLLECTE = {
  id: 'c1',
  type: 'zero_dechet',
  taux_recyclage: 80,
  date_collecte: '2026-02-15',
  co2_evite_kg: 100,
  co2_induit_kg: 20,
  co2_net_kg: -80,
  energie_primaire_evitee_kwh: 300,
  co2_facteurs_snapshot: {
    version: 'ADEME-2025',
    equivalences: { km_voiture_kgco2: 0.2 },
  },
  evenements: evt(),
  collecte_flux: [
    { poids_reel_kg: 120, flux_dechets: { code: 'biodechet' } },
    { poids_reel_kg: 60, flux_dechets: { code: 'emballage' } },
  ],
  attributions_antgaspi: [],
};

const AG_COLLECTE = {
  id: 'c2',
  type: 'anti_gaspi',
  taux_recyclage: null,
  date_collecte: '2026-02-10',
  co2_evite_kg: null,
  co2_induit_kg: null,
  co2_net_kg: null,
  energie_primaire_evitee_kwh: null,
  co2_facteurs_snapshot: null,
  evenements: evt({
    id: 'e2',
    nom_evenement: 'Congrès',
    date_evenement: '2026-02-09',
    lieu_id: 'l2',
    lieux: { id: 'l2', nom: 'Carrousel' },
  }),
  collecte_flux: [{ poids_reel_kg: 80, flux_dechets: { code: 'biodechet' } }],
  attributions_antgaspi: [
    {
      volume_repas_realise: 150,
      association_id: 'a1',
      associations: { id: 'a1', nom: 'Restos du Cœur', ville: 'Paris' },
    },
  ],
};

const ctxTraiteur = {
  role: 'traiteur_manager' as SyntheseRole,
  organisationId: 'org-1',
  organisationNom: 'Traiteur SA',
};

describe('M3.5 / synthèse PDF — snapshot §12 §1.6', () => {
  it('export ZD : sections ZD (flux, CO₂, évolution), PAS de section Anti-Gaspi (Q2)', async () => {
    const { client } = makeSupabase({
      collectes: { data: [ZD_COLLECTE], error: null },
    });
    const snap = await buildSyntheseSnapshot(
      client,
      ctxTraiteur,
      baseParams({ types: ['zero_dechet'] }),
      CLOCK,
    );
    expect(snap.inclut_zd).toBe(true);
    expect(snap.inclut_ag).toBe(false);
    expect(snap.nb_collectes).toBe(1);
    expect(snap.tonnage_zd_kg).toBe(180);
    expect(snap.taux_recyclage_moyen_pondere).toBe(80);
    expect(snap.flux_zd).toEqual([
      { nom: 'Biodéchets', poids_kg: 120 },
      { nom: 'Emballages', poids_kg: 60 },
    ]);
    expect(snap.co2?.evite_kg).toBe(100);
    expect(snap.co2?.net_kg).toBe(-80);
    expect(snap.co2?.equiv_km_voiture).toBe(500); // 100 / 0.2
    expect(snap.evolution?.length).toBe(1);
    // Q2 : type figé ZD → pas d'assos AG.
    expect(snap.associations_ag).toBeNull();
  });

  it('export AG : ventilation Anti-Gaspi + repas, PAS de flux/CO₂/évolution ZD (Q2)', async () => {
    const { client } = makeSupabase({
      collectes: { data: [AG_COLLECTE], error: null },
    });
    const snap = await buildSyntheseSnapshot(
      client,
      ctxTraiteur,
      baseParams({ types: ['anti_gaspi'] }),
      CLOCK,
    );
    expect(snap.inclut_ag).toBe(true);
    expect(snap.inclut_zd).toBe(false);
    expect(snap.nb_repas_donnes).toBe(150);
    expect(snap.associations_ag).toEqual([
      {
        association_nom: 'Restos du Cœur',
        nb_collectes: 1,
        repas_donnes: 150,
        poids_kg: 80,
      },
    ]);
    expect(snap.flux_zd).toBeNull();
    expect(snap.co2).toBeNull();
    expect(snap.evolution).toBeNull();
  });

  it('prédicat d’inclusion : statut=cloturee ET realisee_at <= now-24h (embargo H+24)', async () => {
    const { client, calls } = makeSupabase({
      collectes: { data: [ZD_COLLECTE], error: null },
    });
    await buildSyntheseSnapshot(
      client,
      ctxTraiteur,
      baseParams({ types: ['zero_dechet'] }),
      CLOCK,
    );
    const eqCols = (calls['eq'] ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(eqCols).toContain('statut=cloturee');
    expect(eqCols).toContain('type=zero_dechet');
    const lteCols = (calls['lte'] ?? []).map((a) => `${a[0]}`);
    expect(lteCols).toContain('realisee_at');
    // Vérifie la borne exacte de l'embargo.
    const realiseeLte = (calls['lte'] ?? []).find(
      (a) => a[0] === 'realisee_at',
    );
    expect(realiseeLte?.[1]).toBe(CLOCK.cutoffIso);
  });

  it('détail : grain 1 ligne par événement, tri antéchronologique sur date_evenement', async () => {
    const { client } = makeSupabase({
      collectes: { data: [ZD_COLLECTE, AG_COLLECTE], error: null },
    });
    const snap = await buildSyntheseSnapshot(
      client,
      ctxTraiteur,
      baseParams(),
      CLOCK,
    );
    expect(snap.detail).toHaveLength(2);
    // Antéchronologique : 14/02 (Gala) avant 09/02 (Congrès).
    expect(snap.detail[0]?.evenement).toBe('Gala');
    expect(snap.detail[1]?.evenement).toBe('Congrès');
    expect(snap.detail[0]?.type).toBe('ZD');
    expect(snap.detail[1]?.type).toBe('AG');
  });

  it('agrégat vide : snapshot valide, nb_collectes 0, detail vide', async () => {
    const { client } = makeSupabase({ collectes: { data: [], error: null } });
    const snap = await buildSyntheseSnapshot(
      client,
      ctxTraiteur,
      baseParams(),
      CLOCK,
    );
    expect(snap.nb_collectes).toBe(0);
    expect(snap.detail).toEqual([]);
  });
});

describe('M3.1 / synthèse traiteur — périmètre opérationnel (0 fuite inter-org)', () => {
  it('scope sur traiteur_operationnel_organisation_id (§1.6 l.246), pas organisation_id', async () => {
    const { client, calls } = makeSupabase({
      collectes: { data: [ZD_COLLECTE], error: null },
    });
    await buildSyntheseSnapshot(client, ctxTraiteur, baseParams(), CLOCK);
    const eqCols = (calls['eq'] ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(eqCols).toContain(
      'evenements.traiteur_operationnel_organisation_id=org-1',
    );
    expect(eqCols).not.toContain('evenements.organisation_id=org-1');
  });
});

describe('M3.3 / synthèse agence — périmètre programmateur (0 fuite inter-org)', () => {
  it('scope sur evenements.organisation_id (§1.6 l.249)', async () => {
    const { client, calls } = makeSupabase({
      collectes: { data: [ZD_COLLECTE], error: null },
    });
    await buildSyntheseSnapshot(
      client,
      {
        role: 'agence',
        organisationId: 'org-9',
        organisationNom: 'Agence X',
      },
      baseParams(),
      CLOCK,
    );
    const eqCols = (calls['eq'] ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(eqCols).toContain('evenements.organisation_id=org-9');
    expect(eqCols).not.toContain(
      'evenements.traiteur_operationnel_organisation_id=org-9',
    );
  });
});

describe('M3.2 / synthèse gestionnaire — lieux du parc + programmées + section traiteurs', () => {
  it('union lieu ∈ parc OR organisation_id = org, et ventilation par traiteur résolue', async () => {
    const { client, calls } = makeSupabase({
      organisations_lieux: {
        data: [{ lieu_id: 'l1' }, { lieu_id: 'l2' }],
        error: null,
      },
      collectes: { data: [ZD_COLLECTE], error: null },
      v_referentiel_traiteurs: {
        data: [{ id: 'org-1', nom: 'Traiteur SA', raison_sociale: null }],
        error: null,
      },
    });
    const snap = await buildSyntheseSnapshot(
      client,
      {
        role: 'gestionnaire_lieux',
        organisationId: 'gest-1',
        organisationNom: 'Palais',
      },
      baseParams({ types: ['zero_dechet'] }),
      CLOCK,
    );
    const inCols = (calls['in'] ?? []).map((a) => `${a[0]}`);
    const eqCols = (calls['eq'] ?? []).map((a) => `${a[0]}=${a[1]}`);
    // (A) collectes sur ses lieux + (B) collectes qu'il a programmées.
    expect(inCols).toContain('evenements.lieu_id');
    expect(eqCols).toContain('evenements.organisation_id=gest-1');
    // Section « Ventilation par traiteur » propre au gestionnaire (§06.05 §4 l.418).
    expect(snap.traiteurs).toEqual([
      { traiteur_nom: 'Traiteur SA', nb_collectes: 1, tonnage_kg: 180 },
    ]);
  });
});
