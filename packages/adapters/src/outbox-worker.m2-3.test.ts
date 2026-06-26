// Chaîne C10 (R5 / BL-P0-08) : outbox → worker → adapter.
// Prouve que le worker route une collecte AG dispatchée vers le BON adapter
// selon transporteurs.type_tms (résolu via le pont collecte.prestataire_logistique_id
// → transporteurs.prestataire_logistique_id). Asservi sur l'adapter réellement
// invoqué — pas un mock qui avale tout : si le routage retombe sur adapter_mts1
// en dur, le test pour a_toutes ROUGIT.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOutboxWorker } from './outbox-worker.js';
import { AdapterEverest } from './everest/adapter.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { ProviderManual } from './manual/provider.js';

// ─── Mock Supabase pour le worker ─────────────────────────────────────────────

interface WorkerMockOpts {
  typeTms: 'mts1' | 'a_toutes' | 'autre';
  prestataireLogistiqueId: string | null;
  eventType?: 'collecte.creee' | 'collecte.modifiee' | 'collecte.annulee';
}

const COLLECTE_ID = 'col-ag-dispatch-001';
const PRESTA_ID = 'presta-uuid-ag-001';

function makeWorkerSupabase(opts: WorkerMockOpts) {
  const claimedEvent = {
    id: 'evt-001',
    aggregate_type: 'collecte',
    aggregate_id: COLLECTE_ID,
    event_type: opts.eventType ?? 'collecte.creee',
    payload: { collecte_id: COLLECTE_ID, origine: 'attribution_ag' },
    consumer:
      opts.typeTms === 'a_toutes'
        ? 'adapter_everest'
        : opts.typeTms === 'mts1'
          ? 'adapter_mts1'
          : 'provider_manual',
    attempts: 1,
    requires_reconciliation: false,
  };

  // Contacts + lieu portés par l'événement parent (fetchCollecte les lit via la
  // jointure evenements!inner — fix M1.5a 2026-06-26 ; §06.04 l.375 / §08 l.411).
  const collecteRow = {
    id: COLLECTE_ID,
    type: 'anti_gaspi',
    date_collecte: '2026-07-20',
    heure_collecte: '22:00:00',
    nb_camions_demande: 1,
    statut_tms: 'non_envoye',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    prestataire_logistique_id: opts.prestataireLogistiqueId,
    evenement: [
      {
        contact_principal_nom: 'Alice',
        contact_principal_telephone: '+33600000001',
        contact_secours_nom: null,
        contact_secours_telephone: null,
        lieux: [
          {
            id: 'lieu-001',
            nom: 'Lieu',
            adresse_acces: '1 rue Test',
            code_postal: '75001',
            ville: 'Paris',
            latitude: null,
            longitude: null,
            acces_details: null,
            type_vehicule_max: 'velo_cargo',
            contraintes_horaires: null,
          },
        ],
      },
    ],
  };

  const transporteurRow = {
    id: 'transp-001',
    type_tms: opts.typeTms,
    code_transporteur_mts1: opts.typeTms === 'mts1' ? 'STRIKE-MTS1' : null,
    prestataire_logistique_id: opts.prestataireLogistiqueId,
  };

  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    q['select'] = vi.fn(() => q);
    q['eq'] = vi.fn(() => q);
    q['single'] = vi.fn(async () => {
      if (table === 'collectes') return { data: collecteRow, error: null };
      if (table === 'transporteurs')
        return { data: transporteurRow, error: null };
      return { data: null, error: null };
    });
    q['maybeSingle'] = vi.fn(async () => ({ data: null, error: null }));
    q['update'] = vi.fn(() => q);
    q['insert'] = vi.fn(() => q);
    return q;
  };

  const rpc = vi.fn(async (name: string) => {
    if (name === 'fn_reap_outbox_claims') return { data: 0, error: null };
    if (name === 'fn_claim_outbox_batch')
      return { data: [claimedEvent], error: null };
    if (name === 'fn_result_outbox') return { data: null, error: null };
    return { data: null, error: null };
  });

  const supabase = {
    rpc,
    from: vi.fn((table: string) => makeTableQuery(table)),
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient;
}

// ─── Tests routing par type_tms ───────────────────────────────────────────────

describe('M2.3 / worker outbox — routing dispatch AG par type_tms (C10)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('type_tms=a_toutes → AdapterEverest.dispatchCollecte (pas MTS-1)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
    });
    const result = await runOutboxWorker(supabase);

    expect(everestSpy).toHaveBeenCalledTimes(1);
    expect(mts1Spy).not.toHaveBeenCalled();
    // L'adapter reçoit bien la collecte AG dispatchée (rang 1).
    expect(everestSpy.mock.calls[0]![0]).toMatchObject({
      id: COLLECTE_ID,
      type: 'anti_gaspi',
    });
    expect(everestSpy.mock.calls[0]![1]).toBe(1);
    expect(result.done).toBe(1);
  });

  it('type_tms=mts1 → AdapterMts1.dispatchCollecte (pas Everest)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);

    const supabase = makeWorkerSupabase({
      typeTms: 'mts1',
      prestataireLogistiqueId: PRESTA_ID,
    });
    await runOutboxWorker(supabase);

    expect(mts1Spy).toHaveBeenCalledTimes(1);
    expect(everestSpy).not.toHaveBeenCalled();
  });

  it('type_tms=autre → ProviderManual.dispatchCollecte (no-op, ni MTS-1 ni Everest)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);
    const manualSpy = vi.spyOn(ProviderManual.prototype, 'dispatchCollecte');

    const supabase = makeWorkerSupabase({
      typeTms: 'autre',
      prestataireLogistiqueId: PRESTA_ID,
    });
    await runOutboxWorker(supabase);

    expect(manualSpy).toHaveBeenCalledTimes(1);
    expect(everestSpy).not.toHaveBeenCalled();
    expect(mts1Spy).not.toHaveBeenCalled();
  });

  it('prestataire_logistique_id NULL → no-op (aucun adapter invoqué)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue(undefined);

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: null,
    });
    const result = await runOutboxWorker(supabase);

    expect(everestSpy).not.toHaveBeenCalled();
    expect(mts1Spy).not.toHaveBeenCalled();
    // Event consommé (no-op succès) — pas d'échec.
    expect(result.done).toBe(1);
    expect(result.failed).toBe(0);
  });

  // E2/E3 : les branches collecte.modifiee / collecte.annulee d'une collecte AG
  // (type_tms=a_toutes) doivent aussi router vers AdapterEverest, jamais MTS-1.
  it('E2 collecte.modifiee (a_toutes) → AdapterEverest.updateCollecte (pas MTS-1)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'updateCollecte')
      .mockResolvedValue(undefined);
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'updateCollecte')
      .mockResolvedValue(undefined);

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      eventType: 'collecte.modifiee',
    });
    await runOutboxWorker(supabase);

    expect(everestSpy).toHaveBeenCalledTimes(1);
    expect(mts1Spy).not.toHaveBeenCalled();
  });

  it('E3 collecte.annulee (a_toutes) → AdapterEverest.cancelCollecte (pas MTS-1)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'cancelCollecte')
      .mockResolvedValue(undefined);
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'cancelCollecte')
      .mockResolvedValue(undefined);

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      eventType: 'collecte.annulee',
    });
    await runOutboxWorker(supabase);

    expect(everestSpy).toHaveBeenCalledTimes(1);
    expect(mts1Spy).not.toHaveBeenCalled();
  });
});
