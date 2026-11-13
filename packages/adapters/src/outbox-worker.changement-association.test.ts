// Changement d'association d'une collecte AG (décisions Val 2026-11-13) :
// fn_changer_association_ag réinitialise les tournées MTS-1 et met en file un
// `collecte.creee` qui porte les anciennes commandes (`commandes_a_annuler`).
// Le worker les fait annuler AVANT de recréer. Et la collecte transmise à
// l'adapter porte son statut, qui décide si une modification renvoie la
// marchandise (adapter.e2-marchandise.test.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOutboxWorker } from './outbox-worker.js';
import { AdapterEverest } from './everest/adapter.js';
import { AdapterMts1 } from './mts1/adapter.js';

const COLLECTE_ID = 'col-ag-asso-001';
const PRESTA_ID = 'presta-uuid-asso-001';

function makeWorkerSupabase(opts: {
  typeTms: 'mts1' | 'a_toutes';
  eventType: 'collecte.creee' | 'collecte.modifiee';
  payload?: Record<string, unknown>;
  statut?: string;
}) {
  const claimedEvent = {
    id: 'evt-asso-001',
    aggregate_type: 'collecte',
    aggregate_id: COLLECTE_ID,
    event_type: opts.eventType,
    payload: { collecte_id: COLLECTE_ID, ...(opts.payload ?? {}) },
    consumer: opts.typeTms === 'mts1' ? 'adapter_mts1' : 'adapter_everest',
    attempts: 1,
    requires_reconciliation: false,
  };
  const collecteRow = {
    id: COLLECTE_ID,
    type: 'anti_gaspi',
    statut: opts.statut ?? 'programmee',
    date_collecte: '2026-11-13',
    heure_collecte: '20:45:00',
    nb_camions_demande: 1,
    pax: 600,
    statut_tms: 'non_envoye',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    prestataire_logistique_id: PRESTA_ID,
    lieu_overrides: null,
    contacts: {
      contact_principal_nom: 'Alice',
      contact_principal_telephone: '+33600000001',
      contact_secours_nom: null,
      contact_secours_telephone: null,
    },
    evenement: [
      {
        pax: 600,
        traiteur: [{ nom: 'Traiteur Essai' }],
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
            type_vehicule_max: null,
            contraintes_horaires: null,
            stationnement: null,
            acces_office: null,
            flux_autorises: null,
          },
        ],
      },
    ],
  };
  const transporteurRow = {
    id: 'transp-001',
    type_tms: opts.typeTms,
    code_transporteur_mts1: opts.typeTms === 'mts1' ? 'MARATHON' : null,
    prestataire_logistique_id: PRESTA_ID,
  };
  const selects: Record<string, string[]> = {};
  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    q['select'] = vi.fn((fields?: string) => {
      (selects[table] ??= []).push(fields ?? '');
      return q;
    });
    q['eq'] = vi.fn(() => q);
    q['single'] = vi.fn(async () => {
      if (table === 'collectes') return { data: collecteRow, error: null };
      if (table === 'transporteurs')
        return { data: transporteurRow, error: null };
      return { data: null, error: null };
    });
    q['maybeSingle'] = vi.fn(async () => {
      if (table === 'collectes')
        return { data: { type_vehicule_souhaite: null }, error: null };
      if (table === 'attributions_antgaspi')
        return {
          data: {
            associations: {
              id_point_collecte_mts1: null,
              adresse: '14 Rue Royale',
              ville: 'Paris',
              contact_nom: 'Nadia Benali',
              contact_telephone: '+33699990001',
              instructions_acces: null,
            },
          },
          error: null,
        };
      return { data: null, error: null };
    });
    q['update'] = vi.fn(() => q);
    q['insert'] = vi.fn(() => q);
    return q;
  };
  const rpc = vi.fn(async (name: string) => {
    if (name === 'fn_claim_outbox_batch')
      return { data: [claimedEvent], error: null };
    return { data: name === 'fn_reap_outbox_claims' ? 0 : null, error: null };
  });
  return {
    rpc,
    from: vi.fn((table: string) => makeTableQuery(table)),
    _selects: selects,
  } as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _selects: Record<string, string[]>;
    rpc: typeof rpc;
  };
}

describe('Worker — changement d’association d’une collecte AG', () => {
  afterEach(() => vi.restoreAllMocks());

  it('MTS-1 : les anciennes commandes sont annulées AVANT la recréation', async () => {
    const appels: string[] = [];
    const annuler = vi
      .spyOn(AdapterMts1.prototype, 'annulerCommandes')
      .mockImplementation(async () => {
        appels.push('annuler');
      });
    const dispatch = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockImplementation(async () => {
        appels.push('dispatch');
        return 'adapter_mts1';
      });

    const result = await runOutboxWorker(
      makeWorkerSupabase({
        typeTms: 'mts1',
        eventType: 'collecte.creee',
        payload: {
          origine: 'changement_association',
          commandes_a_annuler: ['MTS1-OLD-1'],
        },
      }),
    );

    expect(annuler).toHaveBeenCalledWith(['MTS1-OLD-1']);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(appels).toEqual(['annuler', 'dispatch']);
    expect(result.done).toBe(1);
  });

  it('création ordinaire (sans anciennes commandes) : rien n’est annulé', async () => {
    const annuler = vi.spyOn(AdapterMts1.prototype, 'annulerCommandes');
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockResolvedValue(
      'adapter_mts1',
    );

    await runOutboxWorker(
      makeWorkerSupabase({ typeTms: 'mts1', eventType: 'collecte.creee' }),
    );

    expect(annuler).not.toHaveBeenCalled();
  });

  it('transporteur changé depuis (plus MTS-1) : échec définitif, aucune création chez le nouveau', async () => {
    const everest = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      eventType: 'collecte.creee',
      payload: { commandes_a_annuler: ['MTS1-OLD-1'] },
    });
    const result = await runOutboxWorker(supabase);

    expect(everest).not.toHaveBeenCalled();
    expect(result.dead).toBe(1);
    const resultat = supabase.rpc.mock.calls.find(
      (c) => c[0] === 'fn_result_outbox',
    ) as unknown[] | undefined;
    expect(
      String((resultat?.[1] as { p_last_error: string }).p_last_error),
    ).toMatch(/MTS1-OLD-1.*à annuler à la main/);
  });

  it('la collecte transmise à l’adapter porte son statut, demandé à PostgREST', async () => {
    const update = vi
      .spyOn(AdapterMts1.prototype, 'updateCollecte')
      .mockResolvedValue('adapter_mts1');

    const supabase = makeWorkerSupabase({
      typeTms: 'mts1',
      eventType: 'collecte.modifiee',
      statut: 'validee',
    });
    await runOutboxWorker(supabase);

    expect(update.mock.calls[0]![0]).toMatchObject({ statut: 'validee' });
    expect(supabase._selects['collectes']?.[0]).toMatch(/\bstatut,/);
  });
});
