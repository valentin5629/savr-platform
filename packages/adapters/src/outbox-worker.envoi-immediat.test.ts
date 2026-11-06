// M1.5a — envoi immédiat des ordres d'UNE collecte (décision Val 2026-10-12).
//
// On appelle le VRAI runOutboxWorkerPourCollecte : ni processEvent, ni
// handleError, ni getNextRetryAt ne sont mockés. Seules frontières mockées : le
// client Supabase (DB) et l'appel HTTP de l'adapter (spyOn). La réservation SQL
// elle-même (ciblage, head-of-line, palier de reprise) est prouvée en pgTAP
// (supabase/tests/outbox_claim_collecte.test.sql) ; ici, ce que le passage en
// FAIT : un ordre à la fois, dans l'ordre, jusqu'à la réservation vide ; bornes ;
// jamais de reaper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSlackSink } from '@savr/shared/src/alerting/slack.js';

import { LogistiqueTransientError } from './index.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { runOutboxWorkerPourCollecte } from './outbox-worker.js';

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

const COLLECTE_ID = 'c0000000-0000-0000-0000-0000000000c1';
const PRESTA_ID = 'aa000000-0000-0000-0000-0000000000a1';

function ordre(
  id: string,
  eventType = 'collecte.creee',
  requiresReconciliation = false,
) {
  return {
    id,
    aggregate_type: 'collecte',
    aggregate_id: COLLECTE_ID,
    event_type: eventType,
    payload: { collecte_id: COLLECTE_ID },
    consumer: 'adapter_mts1',
    attempts: 1,
    requires_reconciliation: requiresReconciliation,
  };
}

type Reservation = ReturnType<typeof ordre>[] | { erreur: string };

/**
 * `reservations` = ce que rend chaque appel successif à fn_claim_outbox_collecte
 * (file épuisée → réservation vide). `toujours` = rend le même ordre à chaque appel.
 */
function makeSupabase(opts: {
  reservations?: Reservation[];
  toujours?: ReturnType<typeof ordre>;
  reapedCount?: number;
}) {
  const rpcCalls: RpcCall[] = [];
  const file = [...(opts.reservations ?? [])];

  const collecteRow = {
    id: COLLECTE_ID,
    type: 'zero_dechet',
    date_collecte: '2027-01-20',
    heure_collecte: '22:00:00',
    nb_camions_demande: 1,
    statut_tms: 'non_envoye',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    prestataire_logistique_id: PRESTA_ID,
    contacts: {
      contact_principal_nom: 'Alice',
      contact_principal_telephone: '+33600000001',
      contact_secours_nom: null,
      contact_secours_telephone: null,
    },
    evenement: [
      {
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
            type_vehicule_max: 'fourgon',
            contraintes_horaires: null,
          },
        ],
      },
    ],
  };

  const transporteurRow = {
    id: 'transp-001',
    type_tms: 'mts1',
    code_transporteur_mts1: 'STRIKE',
    prestataire_logistique_id: PRESTA_ID,
  };

  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    q['select'] = vi.fn(() => q);
    q['eq'] = vi.fn(() => q);
    q['limit'] = vi.fn(() => q);
    q['single'] = vi.fn(async () => {
      if (table === 'collectes') return { data: collecteRow, error: null };
      if (table === 'transporteurs')
        return { data: transporteurRow, error: null };
      return { data: null, error: null };
    });
    q['maybeSingle'] = vi.fn(async () => {
      if (table === 'collectes')
        return {
          data: { date_collecte: collecteRow.date_collecte },
          error: null,
        };
      return { data: null, error: null };
    });
    return q;
  };

  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'fn_reap_outbox_claims')
      return { data: opts.reapedCount ?? 0, error: null };
    if (name === 'fn_claim_outbox_collecte') {
      if (opts.toujours) return { data: [opts.toujours], error: null };
      const suivante = file.shift() ?? [];
      if (!Array.isArray(suivante))
        return { data: null, error: { message: suivante.erreur } };
      return { data: suivante, error: null };
    }
    return { data: null, error: null };
  });

  const supabase = {
    rpc,
    from: vi.fn((table: string) => makeTableQuery(table)),
    _rpcCalls: rpcCalls,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _rpcCalls: RpcCall[];
  };
}

function appels(supabase: { _rpcCalls: RpcCall[] }, nom: string): RpcCall[] {
  return supabase._rpcCalls.filter((c) => c.name === nom);
}

describe("M1.5a / envoi immédiat — passage ciblé sur les ordres d'une collecte", () => {
  beforeEach(() => {
    setSlackSink(async () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setSlackSink(async () => {});
  });

  it("réserve par collecte, traite les ordres un à un dans l'ordre, sans jamais passer par le lot planifié", async () => {
    const dispatch = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');
    // Le reaper rendrait 2 s'il était appelé : `reaped` doit rester à 0.
    const supabase = makeSupabase({
      reservations: [[ordre('evt-1')], [ordre('evt-2')]],
      reapedCount: 2,
    });

    const result = await runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);

    expect(result).toEqual({
      reaped: 0,
      claimed: 2,
      done: 2,
      failed: 0,
      dead: 0,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    // Séquence exacte : (réservation → résultat) par ordre, puis la réservation
    // vide qui clôt la boucle. Aucun reaper : un clic ne libère jamais la
    // réservation d'un autre passage (invariant A3 du worker).
    expect(supabase._rpcCalls.map((c) => c.name)).toEqual([
      'fn_claim_outbox_collecte',
      'fn_result_outbox',
      'fn_claim_outbox_collecte',
      'fn_result_outbox',
      'fn_claim_outbox_collecte',
    ]);
    expect(
      appels(supabase, 'fn_claim_outbox_collecte').map(
        (c) => c.args?.['p_collecte_id'],
      ),
    ).toEqual([COLLECTE_ID, COLLECTE_ID, COLLECTE_ID]);
    expect(
      appels(supabase, 'fn_result_outbox').map((c) => [
        c.args?.['p_id'],
        c.args?.['p_statut'],
      ]),
    ).toEqual([
      ['evt-1', 'done'],
      ['evt-2', 'done'],
    ]);
    expect(appels(supabase, 'fn_claim_outbox_batch')).toHaveLength(0);
  });

  it("M1.5a/envoi_immediat_reconciliation — création, modification, annulation : chaque ordre va à sa méthode de l'adapter, avec le drapeau « à réconcilier » tel que la réservation le rend", async () => {
    const dispatch = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');
    const update = vi
      .spyOn(AdapterMts1.prototype, 'updateCollecte')
      .mockResolvedValue('adapter_mts1');
    const cancel = vi
      .spyOn(AdapterMts1.prototype, 'cancelCollecte')
      .mockResolvedValue('adapter_mts1');
    const supabase = makeSupabase({
      reservations: [
        [ordre('evt-1', 'collecte.creee', true)],
        [ordre('evt-2', 'collecte.modifiee', true)],
        [ordre('evt-3', 'collecte.annulee', true)],
        [ordre('evt-4', 'collecte.creee', false)],
      ],
    });

    const result = await runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);

    expect(result).toMatchObject({ claimed: 4, done: 4, failed: 0, dead: 0 });
    // Un ordre repris après un passage mort : l'adapter DOIT le savoir, pour
    // réconcilier avant tout nouvel appel non idempotent au prestataire.
    expect(dispatch.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [1, { requiresReconciliation: true }],
      [1, { requiresReconciliation: false }],
    ]);
    expect(update.mock.calls.map((c) => c[1])).toEqual([
      { requiresReconciliation: true },
    ]);
    expect(cancel.mock.calls.map((c) => c[1])).toEqual([
      { requiresReconciliation: true },
    ]);
  });

  it('ordre en échec : marqué failed avec son palier de reprise, puis la réservation suivante est demandée et clôt la boucle', async () => {
    const dispatch = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockRejectedValue(new LogistiqueTransientError('503'));
    // Le passage ne décide pas lui-même de s'arrêter après un échec : il
    // redemande une réservation. C'est le SQL qui la rend vide tant que l'ordre
    // en échec n'est pas 'done' (prouvé en pgTAP, paires E et D) — ici la file
    // simulée est épuisée.
    const supabase = makeSupabase({ reservations: [[ordre('evt-1')]] });

    const result = await runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);

    expect(result).toMatchObject({ claimed: 1, done: 0, failed: 1, dead: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(appels(supabase, 'fn_claim_outbox_collecte')).toHaveLength(2);
    const resultat = appels(supabase, 'fn_result_outbox');
    expect(resultat).toHaveLength(1);
    expect(resultat[0]!.args?.['p_statut']).toBe('failed');
    expect(resultat[0]!.args?.['p_next_retry_at']).toEqual(expect.any(String));
  });

  it('première réservation vide : une seule seconde tentative après 1 s, qui envoie', async () => {
    vi.useFakeTimers();
    const dispatch = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');
    const supabase = makeSupabase({ reservations: [[], [ordre('evt-1')]] });

    const course = runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);
    await vi.advanceTimersByTimeAsync(999);
    expect(appels(supabase, 'fn_claim_outbox_collecte')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await course;

    expect(result).toMatchObject({ claimed: 1, done: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("rien à envoyer : deux réservations vides, aucun appel au prestataire, pas d'attente répétée", async () => {
    vi.useFakeTimers();
    const dispatch = vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte');
    const supabase = makeSupabase({ reservations: [] });

    const course = runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await course;

    expect(result).toMatchObject({ claimed: 0, done: 0, failed: 0, dead: 0 });
    expect(appels(supabase, 'fn_claim_outbox_collecte')).toHaveLength(2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('plafond : au plus 5 ordres par appel, même si la réservation en rend toujours un', async () => {
    const dispatch = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');
    const supabase = makeSupabase({ toujours: ordre('evt-boucle') });

    const result = await runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);

    expect(result.claimed).toBe(5);
    expect(dispatch).toHaveBeenCalledTimes(5);
    expect(appels(supabase, 'fn_claim_outbox_collecte')).toHaveLength(5);
  });

  it("budget de 40 s : passé ce délai, plus aucun ordre n'est réservé", async () => {
    vi.useFakeTimers();
    // Le premier ordre « dure » 41 s : l'horloge avance pendant l'appel au prestataire.
    const dispatch = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 41_000);
        return 'adapter_mts1';
      });
    const supabase = makeSupabase({ toujours: ordre('evt-lent') });

    const result = await runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);

    expect(result.claimed).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(appels(supabase, 'fn_claim_outbox_collecte')).toHaveLength(1);
  });

  it("réservation en erreur (fonction absente, base injoignable) : l'erreur remonte à l'appelant, rien n'est envoyé", async () => {
    const dispatch = vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte');
    const supabase = makeSupabase({
      reservations: [{ erreur: 'function does not exist' }],
    });

    await expect(
      runOutboxWorkerPourCollecte(supabase, COLLECTE_ID),
    ).rejects.toThrow(/fn_claim_outbox_collecte : function does not exist/);
    expect(dispatch).not.toHaveBeenCalled();
    expect(appels(supabase, 'fn_result_outbox')).toHaveLength(0);
  });
});
