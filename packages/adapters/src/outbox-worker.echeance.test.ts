// M1.5a — le passage du worker est borné DANS LE CODE (décision Val 2026-10-12).
//
// On appelle les VRAIS runOutboxWorker et runOutboxWorkerPourCollecte. Seules
// frontières simulées : le client Supabase (DB) et la méthode de l'adapter, qui
// joue ici le prestataire lent : elle avance l'horloge, puis tente un appel
// réseau (verifierEcheance, le contrôle que font les clients HTTP — prouvé sur
// les vrais clients dans mts1/client.echeance.test.ts et
// everest/client.echeance.test.ts).
//
// Ce qui est prouvé : chaque ordre a son bail et son échéance, comptés depuis
// AVANT sa réservation ; passé l'échéance aucun appel ne démarre ; passé la
// limite d'écriture, rien n'est écrit sur l'ordre.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSlackSink } from '@savr/shared/src/alerting/slack.js';

import { BAIL_RESERVATION_MS, verifierEcheance } from './echeance-passage.js';
import { LogistiquePermanentError } from './index.js';
import { AdapterMts1 } from './mts1/adapter.js';
import {
  runOutboxWorker,
  runOutboxWorkerPourCollecte,
} from './outbox-worker.js';

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

const COLLECTE_ID = 'c0000000-0000-0000-0000-0000000000c1';
const PRESTA_ID = 'aa000000-0000-0000-0000-0000000000a1';
const T0 = Date.parse('2027-01-20T22:00:00.000Z');
const RESERVATIONS = ['fn_claim_outbox_batch', 'fn_claim_outbox_collecte'];

function ordre(id: string) {
  return {
    id,
    aggregate_type: 'collecte',
    aggregate_id: COLLECTE_ID,
    event_type: 'collecte.creee',
    payload: { collecte_id: COLLECTE_ID },
    consumer: 'adapter_mts1',
    attempts: 1,
    requires_reconciliation: false,
  };
}

type Ordre = ReturnType<typeof ordre>;

/**
 * `file` = ce que rend chaque réservation successive, quelle que soit la
 * fonction appelée (file épuisée → vide). `aLaReservation` = joué pendant la
 * requête de réservation, avec son rang (1 = la première) : une réservation
 * lente avance l'horloge. `erreurDeReservation` = la réservation échoue.
 */
function makeSupabase(opts: {
  file: Ordre[][] | (() => Ordre[]);
  aLaReservation?: (rang: number) => void;
  erreurDeReservation?: string;
  erreurDuReaper?: string;
}) {
  const rpcCalls: RpcCall[] = [];
  let rang = 0;
  const file = Array.isArray(opts.file) ? [...opts.file] : null;
  const suivante = (): Ordre[] =>
    file ? (file.shift() ?? []) : (opts.file as () => Ordre[])();

  const collecteRow = {
    id: COLLECTE_ID,
    type: 'zero_dechet',
    date_collecte: '2027-03-20',
    heure_collecte: '22:00:00',
    nb_camions_demande: 1,
    statut_tms: 'non_envoye',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    prestataire_logistique_id: PRESTA_ID,
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
    if (name === 'fn_reap_outbox_claims') {
      if (opts.erreurDuReaper)
        return { data: null, error: { message: opts.erreurDuReaper } };
      return { data: 0, error: null };
    }
    if (RESERVATIONS.includes(name)) {
      if (opts.erreurDeReservation)
        return { data: null, error: { message: opts.erreurDeReservation } };
      opts.aLaReservation?.(++rang);
      return { data: suivante(), error: null };
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

type Supabase = ReturnType<typeof makeSupabase>;

function appels(supabase: Supabase, nom: string): RpcCall[] {
  return supabase._rpcCalls.filter((c) => c.name === nom);
}

function reservations(supabase: Supabase): RpcCall[] {
  return supabase._rpcCalls.filter((c) => RESERVATIONS.includes(c.name));
}

/** L'adapter « prestataire lent » : chaque appel joue l'étape suivante de `etapes`. */
function prestataire(...etapes: Array<() => void>) {
  let n = 0;
  return vi
    .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
    .mockImplementation(async () => {
      etapes[Math.min(n++, etapes.length - 1)]!();
      return 'adapter_mts1';
    });
}

const avancer = (ms: number) => vi.setSystemTime(Date.now() + ms);
const appelReseau = () => verifierEcheance('MTS-1 POST /v3/tours');

const PASSAGES: Array<[string, (s: Supabase) => Promise<unknown>]> = [
  ['passage planifié', (s) => runOutboxWorker(s)],
  ['envoi immédiat', (s) => runOutboxWorkerPourCollecte(s, COLLECTE_ID)],
];

describe.each(PASSAGES)('M1.5a / passage borné — %s', (_nom, lancerPassage) => {
  let alertes: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    alertes = [];
    setSlackSink(async (payload) => {
      alertes.push(payload);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setSlackSink(async () => {});
  });

  it('M1.5a/passage_borne_bail_explicite — chaque réservation demande le bail sur lequel l’échéance est calculée (120 s)', async () => {
    prestataire(() => {});
    const supabase = makeSupabase({ file: [[ordre('evt-1')]] });

    await lancerPassage(supabase);

    expect(BAIL_RESERVATION_MS).toBe(120_000);
    expect(reservations(supabase).length).toBeGreaterThan(0);
    for (const r of reservations(supabase)) {
      expect(r.args?.['p_lease_duration']).toBe('120 seconds');
    }
  });

  it('M1.5a/passage_borne_echeance_appel — 80 s après la réservation, l’appel au prestataire n’est plus démarré : ordre en reprise par les paliers habituels, sans réconciliation', async () => {
    prestataire(() => {
      avancer(80_000);
      appelReseau();
    });
    const supabase = makeSupabase({ file: [[ordre('evt-1')]] });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 0, failed: 1, dead: 0 });
    const ecrit = appels(supabase, 'fn_result_outbox');
    expect(ecrit).toHaveLength(1);
    expect(ecrit[0]!.args).toMatchObject({
      p_id: 'evt-1',
      p_statut: 'failed',
      p_last_error:
        'LogistiqueTransientError: Échéance du passage atteinte : MTS-1 POST /v3/tours non démarré',
      p_next_retry_at: new Date(T0 + 80_000 + 5 * 60_000).toISOString(),
    });
    // Rien n'est parti et rien n'est en doute : aucune réconciliation demandée.
    expect(ecrit[0]!.args?.['p_requires_reconciliation']).toBeUndefined();
  });

  it('juste avant l’échéance (79,999 s), l’appel part et l’ordre est terminé', async () => {
    prestataire(() => {
      avancer(79_999);
      appelReseau();
    });
    const supabase = makeSupabase({ file: [[ordre('evt-1')]] });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    expect(appels(supabase, 'fn_result_outbox')[0]!.args).toMatchObject({
      p_id: 'evt-1',
      p_statut: 'done',
    });
  });

  it('M1.5a/passage_borne_instant_avant_reservation — l’échéance se compte depuis AVANT la requête de réservation : une réservation lente ne la repousse pas', async () => {
    prestataire(() => {
      avancer(30_000);
      appelReseau();
    });
    // La requête de réservation dure 50 s : 50 + 30 = 80 s depuis son départ.
    const supabase = makeSupabase({
      file: [[ordre('evt-1')]],
      aLaReservation: () => avancer(50_000),
    });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ done: 0, failed: 1 });
    expect(appels(supabase, 'fn_result_outbox')[0]!.args).toMatchObject({
      p_statut: 'failed',
      p_last_error: expect.stringContaining('Échéance du passage atteinte'),
    });
  });

  it('M1.5a/passage_borne_un_bail_par_ordre — le second ordre a sa propre échéance, comptée depuis SA réservation', async () => {
    prestataire(
      () => avancer(39_000),
      () => {
        // 89 s après le début du passage, 50 s après la seconde réservation.
        avancer(50_000);
        appelReseau();
      },
    );
    const supabase = makeSupabase({
      file: [[ordre('evt-1')], [ordre('evt-2')]],
    });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ claimed: 2, done: 2, failed: 0 });
  });

  it('M1.5a/passage_borne_pas_d_ecriture_hors_bail — succès rendu 115 s après la réservation : rien n’est écrit sur l’ordre, il est laissé à la reprise', async () => {
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    prestataire(() => avancer(115_000));
    const supabase = makeSupabase({ file: [[ordre('evt-1')]] });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 0, failed: 0, dead: 0 });
    expect(appels(supabase, 'fn_result_outbox')).toHaveLength(0);
    const lignes = journal.mock.calls.map((c) => String(c[0]));
    const trace = lignes.find((l) => l.includes('outbox.passage_hors_bail'));
    expect(trace).toBeDefined();
    expect(trace).toContain('evt-1');
    // Un succès écarté se lit comme tel : l'ordre a peut-être abouti chez le prestataire.
    expect(trace).toContain('"resultat":"succes"');
  });

  it('succès rendu juste avant la limite d’écriture (114,999 s) : le résultat est écrit', async () => {
    prestataire(() => avancer(114_999));
    const supabase = makeSupabase({ file: [[ordre('evt-1')]] });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 1 });
    expect(appels(supabase, 'fn_result_outbox')).toHaveLength(1);
  });

  it('M1.5a/passage_borne_pas_d_echec_hors_bail — refus du prestataire constaté 115 s après la réservation : ni échec écrit, ni alerte ; le journal garde l’erreur écartée', async () => {
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockImplementation(
      async () => {
        avancer(115_000);
        throw new LogistiquePermanentError(
          `400 INVALID_REQUEST ${'x'.repeat(300)}`,
        );
      },
    );
    const supabase = makeSupabase({ file: [[ordre('evt-1')]] });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 0, failed: 0, dead: 0 });
    expect(appels(supabase, 'fn_result_outbox')).toHaveLength(0);
    expect(alertes).toHaveLength(0);
    const trace = journal.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes('outbox.passage_hors_bail'));
    expect(trace).toContain('"resultat":"erreur"');
    expect(trace).toContain('400 INVALID_REQUEST');
    // Message tronqué à 200 caractères : le journal ne recopie pas une erreur entière.
    expect(trace).toContain('x'.repeat(100));
    expect(trace).not.toContain('x'.repeat(200));
  });

  it('le même refus constaté dans le bail (114,999 s) : échec définitif écrit et alerte envoyée', async () => {
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockImplementation(
      async () => {
        avancer(114_999);
        throw new LogistiquePermanentError('400 INVALID_REQUEST');
      },
    );
    const supabase = makeSupabase({ file: [[ordre('evt-1')]] });

    const result = await lancerPassage(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 0, dead: 1 });
    expect(appels(supabase, 'fn_result_outbox')[0]!.args).toMatchObject({
      p_id: 'evt-1',
      p_statut: 'dead',
    });
    expect(alertes).toHaveLength(1);
  });
});

describe('M1.5a / passage borné — le passage planifié réserve un ordre à la fois', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    setSlackSink(async () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('M1.5a/passage_borne_un_ordre_a_la_fois — reprise des réservations expirées, puis (réservation d’UN ordre → résultat) jusqu’à la réservation vide', async () => {
    const dispatch = prestataire(() => {});
    const supabase = makeSupabase({
      file: [[ordre('evt-1')], [ordre('evt-2')], [ordre('evt-3')]],
    });

    const result = await runOutboxWorker(supabase);

    expect(result).toMatchObject({ claimed: 3, done: 3, failed: 0, dead: 0 });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(supabase._rpcCalls.map((c) => c.name)).toEqual([
      'fn_reap_outbox_claims',
      'fn_claim_outbox_batch',
      'fn_result_outbox',
      'fn_claim_outbox_batch',
      'fn_result_outbox',
      'fn_claim_outbox_batch',
      'fn_result_outbox',
      'fn_claim_outbox_batch',
    ]);
    for (const r of appels(supabase, 'fn_claim_outbox_batch')) {
      expect(r.args?.['p_limit']).toBe(1);
    }
    expect(
      appels(supabase, 'fn_result_outbox').map((c) => c.args?.['p_id']),
    ).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });

  it('une réservation qui rendrait plusieurs ordres : seul le premier est traité sous ce bail', async () => {
    const dispatch = prestataire(() => {});
    const supabase = makeSupabase({
      file: [[ordre('evt-1'), ordre('evt-2')]],
    });

    const result = await runOutboxWorker(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(
      appels(supabase, 'fn_result_outbox').map((c) => c.args?.['p_id']),
    ).toEqual(['evt-1']);
  });

  it('plafond : au plus 10 ordres par passage', async () => {
    let n = 0;
    const dispatch = prestataire(() => {});
    const supabase = makeSupabase({ file: () => [ordre(`evt-${++n}`)] });

    const result = await runOutboxWorker(supabase);

    expect(result.claimed).toBe(10);
    expect(dispatch).toHaveBeenCalledTimes(10);
    expect(appels(supabase, 'fn_claim_outbox_batch')).toHaveLength(10);
  });

  it('un ordre rendu une seconde fois dans le même passage n’est pas rejoué : le passage s’arrête', async () => {
    const dispatch = prestataire(() => {});
    const supabase = makeSupabase({ file: () => [ordre('evt-boucle')] });

    const result = await runOutboxWorker(supabase);

    expect(result).toMatchObject({ claimed: 1, done: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(appels(supabase, 'fn_claim_outbox_batch')).toHaveLength(2);
  });

  it('budget de 40 s : passé ce délai, plus aucun ordre n’est réservé', async () => {
    let n = 0;
    const dispatch = prestataire(() => avancer(40_001));
    const supabase = makeSupabase({ file: () => [ordre(`evt-${++n}`)] });

    const result = await runOutboxWorker(supabase);

    expect(result.claimed).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(appels(supabase, 'fn_claim_outbox_batch')).toHaveLength(1);
  });

  it('M1.5a/passage_borne_reservation_en_erreur — réservation refusée par la base : l’erreur remonte à l’appelant, rien n’est envoyé', async () => {
    const dispatch = prestataire(() => {});
    const supabase = makeSupabase({
      file: [[ordre('evt-1')]],
      erreurDeReservation: 'function does not exist',
    });

    await expect(runOutboxWorker(supabase)).rejects.toThrow(
      /fn_claim_outbox_batch : function does not exist/,
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(appels(supabase, 'fn_result_outbox')).toHaveLength(0);
  });

  it('M1.5a/passage_borne_reaper_en_erreur — reprise des réservations expirées refusée par la base : l’erreur remonte, aucun ordre n’est réservé', async () => {
    const dispatch = prestataire(() => {});
    const supabase = makeSupabase({
      file: [[ordre('evt-1')]],
      erreurDuReaper: 'permission denied',
    });

    await expect(runOutboxWorker(supabase)).rejects.toThrow(
      /fn_reap_outbox_claims : permission denied/,
    );
    expect(appels(supabase, 'fn_claim_outbox_batch')).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('M1.5a / passage borné — envoi immédiat, seconde réservation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    setSlackSink(async () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Première réservation vide, attente de 1 s, puis une seconde réservation qui
  // dure 50 s et rend l'ordre : son échéance tombe 80 s après le DÉPART de cette
  // seconde réservation, soit 30 s après son retour.
  async function secondeChance(attentePrestataireMs: number) {
    prestataire(() => {
      avancer(attentePrestataireMs);
      appelReseau();
    });
    const supabase = makeSupabase({
      file: [[], [ordre('evt-1')]],
      aLaReservation: (rang) => {
        if (rang === 2) avancer(50_000);
      },
    });

    const course = runOutboxWorkerPourCollecte(supabase, COLLECTE_ID);
    await vi.advanceTimersByTimeAsync(1_000);
    return { result: await course, supabase };
  }

  it('M1.5a/passage_borne_seconde_reservation — l’échéance se compte depuis le départ de la SECONDE réservation : 30 s après son retour, l’appel est refusé', async () => {
    const { result, supabase } = await secondeChance(30_000);

    expect(result).toMatchObject({ claimed: 1, done: 0, failed: 1 });
    expect(appels(supabase, 'fn_result_outbox')[0]!.args).toMatchObject({
      p_statut: 'failed',
      p_last_error: expect.stringContaining('Échéance du passage atteinte'),
    });
  });

  it('1 ms plus tôt, l’appel part : l’attente d’avant la seconde réservation n’est pas comptée', async () => {
    const { result } = await secondeChance(29_999);

    expect(result).toMatchObject({ claimed: 1, done: 1, failed: 0 });
  });
});
