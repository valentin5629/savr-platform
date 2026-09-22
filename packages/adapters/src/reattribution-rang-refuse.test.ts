// Réattribution d'un rang refusé vers le même type de transporteur : la commande
// repart sur la tournée réinitialisée en place.
//
// Contexte (arbitrage Val 2026-09-17). À la réattribution d'une collecte rejetée,
// `fn_dispatcher_collecte` réinitialise chaque tournée dont la commande est morte
// (tournée `annulee`, mission `failed`/`cancelled_externally`) : référence de
// commande, tour, plaque… effacés, statut `planifiee`, et `reference_interne`
// suffixée de la tentative `-r{n}` (pgTAP
// supabase/tests/reattribution_meme_type_tms.test.sql). Le prédicat d'émission
// renvoie alors E1.
//
// Ce fichier verrouille la reprise côté adapter. Avant correctif :
//   • MTS-1 recommandait avec la clé `{collecte}-{rang}` de la commande annulée,
//     et l'upsert par `TMS-{collecte}-{rang}` créait une seconde tournée en
//     détachant la tournée réinitialisée ;
//   • E2 ne recommandait pas un rang refusé d'une collecte multi-camions (il ne
//     dispatchait que les rangs « sans tournée ») ;
//   • Everest cherchait la tournée par `EVR-{collecte}-{rang}`, en créait une
//     seconde et son rattachement au rang déjà pris échouait.
// Le mock trace chaque écriture par table : une assertion sur le seul appel API
// ne verrait pas une seconde tournée créée en base.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Collecte, Lieu, Transporteur } from './index.js';
import {
  PRESTA_EVEREST,
  PRESTA_MTS1,
  PRESTA_MTS1_BIS,
  builderTransporteurs,
} from './mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { _setMts1Handlers } from './mts1/mock.js';
import type { Mts1CustomerOrder } from './mts1/mock.js';
import { AdapterEverest } from './everest/adapter.js';
import { _setEverestHandlers, setupEverestMock } from './everest/mock.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LIEU: Lieu = {
  id: 'lieu-reatt-001',
  nom: 'Pavillon Gabriel',
  adresse_acces: '5 Avenue Gabriel',
  code_postal: '75008',
  ville: 'Paris',
  latitude: 48.87,
  longitude: 2.3,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

function collecte(over: Partial<Collecte> = {}): Collecte {
  return {
    id: 'col-reatt',
    type: 'zero_dechet',
    date_collecte: '2026-07-15',
    heure_collecte: '22:00:00',
    nb_camions_demande: 1,
    statut_tms: 'non_envoye',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    contact_principal_nom: 'Alice',
    contact_principal_telephone: '+33600000001',
    contact_secours_nom: null,
    contact_secours_telephone: null,
    lieu: LIEU,
    ...over,
  };
}

// Le worker instancie l'adapter avec « n'importe quel » transporteur du type :
// ici Marathon, alors que la tournée refusée était chez Strike.
const TRANSPORTEUR_MARATHON: Transporteur = {
  id: 'transporteur-marathon',
  type_tms: 'mts1',
  code_transporteur_mts1: 'MARATHON-IDF',
  prestataire_logistique_id: PRESTA_MTS1_BIS,
};

const TRANSPORTEUR_EVEREST: Transporteur = {
  id: 'transporteur-atoutes',
  type_tms: 'a_toutes',
  code_transporteur_mts1: null,
  prestataire_logistique_id: PRESTA_EVEREST,
};

interface TourneeFixture {
  id: string;
  rang: number;
  reference_interne: string;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
  prestataire_logistique_id: string | null;
}

/** Tournée MTS-1 refusée puis réinitialisée par fn_dispatcher_collecte. */
function tourneeMts1Reinit(over: Partial<TourneeFixture> = {}): TourneeFixture {
  return {
    id: 'T-reinit',
    rang: 1,
    reference_interne: 'TMS-col-reatt-1-r2',
    external_ref_commande: null,
    tms_reference: null,
    statut: 'planifiee',
    prestataire_logistique_id: PRESTA_MTS1,
    ...over,
  };
}

// ─── Mock supabase traçant les écritures ──────────────────────────────────────

interface Ecriture {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
  payload: unknown;
  eqs: Array<[string, unknown]>;
  onConflict?: string;
}

function makeSupabase(opts: {
  tournees: TourneeFixture[];
  mission?: {
    id: string;
    statut_everest: string;
    everest_mission_id: string | null;
  } | null;
}) {
  const ecritures: Ecriture[] = [];
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  const builder = (table: string): Record<string, unknown> => {
    let ecriture: Ecriture | null = null;
    const self: Record<string, unknown> = {};
    const chain = () => self;
    const ecrire =
      (op: Ecriture['op']) =>
      (payload?: unknown, o?: { onConflict?: string }) => {
        ecriture = { table, op, payload, eqs: [], onConflict: o?.onConflict };
        ecritures.push(ecriture);
        return self;
      };

    const ligneTournee = () => {
      const p = (ecriture?.payload ?? {}) as Record<string, unknown>;
      const existante = opts.tournees.find((t) =>
        ecriture?.eqs.some(([c, v]) => c === 'id' && v === t.id),
      );
      return existante
        ? { ...existante, ...p }
        : {
            id: 'T-neuve',
            reference_interne: p['reference_interne'],
            external_ref_commande: p['external_ref_commande'] ?? null,
            tms_reference: null,
            statut: 'planifiee',
          };
    };

    Object.assign(self, {
      select: vi.fn(chain),
      eq: vi.fn((col: string, val: unknown) => {
        ecriture?.eqs.push([col, val]);
        return self;
      }),
      in: vi.fn(chain),
      insert: vi.fn(ecrire('insert')),
      update: vi.fn(ecrire('update')),
      upsert: vi.fn(ecrire('upsert')),
      delete: vi.fn(ecrire('delete')),
      single: vi.fn(async () =>
        table === 'tournees'
          ? { data: ligneTournee(), error: null }
          : { data: null, error: null },
      ),
      maybeSingle: vi.fn(async () => {
        if (table === 'everest_missions')
          return { data: opts.mission ?? null, error: null };
        if (table === 'attributions_antgaspi')
          return {
            data: { branche_attribution: 'ag_velo_programme' },
            error: null,
          };
        return { data: null, error: null };
      }),
      then: (resolve: (v: unknown) => void) => {
        if (table === 'collecte_tournees' && !ecriture) {
          // FK sortante `collecte_tournees.tournee_id` → embed OBJET.
          return resolve({
            data: opts.tournees.map((t) => ({ rang: t.rang, tournees: t })),
            error: null,
          });
        }
        return resolve({ data: null, error: null });
      },
    });
    return self;
  };

  const supabase = {
    from: vi.fn((table: string) =>
      table === 'transporteurs' ? builderTransporteurs() : builder(table),
    ),
    rpc,
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return { supabase, ecritures };
}

function stubMts1(scan: Mts1CustomerOrder[] = []) {
  let n = 0;
  const postOrder = vi.fn(async (payload: Record<string, unknown>) => {
    n++;
    return {
      ok: true as const,
      id: `MTS1-ORDER-NEUVE-${n}`,
      externalReference: String(payload['orderNumber']),
      status: 'DRAFT' as const,
      createdAt: '2026-07-14T10:00:00Z',
    };
  });
  const createTour = vi.fn(async (payload: Record<string, unknown>) => ({
    tourId: `MTS1-TOUR-NEUF-${n}`,
    externalReference: String(payload['orderNumber']),
    status: 'DRAFT',
    createdAt: '2026-07-14T10:00:00Z',
    customerOrderId: `MTS1-ORDER-NEUVE-${n}`,
  }));
  const handlers = {
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder,
    createTour,
    addCustomerOrder: vi.fn().mockResolvedValue(undefined),
    dispatchTour: vi.fn().mockResolvedValue(undefined),
    validateTour: vi.fn().mockResolvedValue(undefined),
    updateOrder: vi.fn().mockResolvedValue(undefined),
    deleteOrder: vi.fn().mockResolvedValue(undefined),
    scanOrdersByDateRange: vi.fn().mockResolvedValue(scan),
  };
  _setMts1Handlers(handlers);
  return handlers;
}

// ─── MTS-1 ────────────────────────────────────────────────────────────────────

describe('MTS-1 — rang refusé puis réattribué', () => {
  afterEach(() => _setMts1Handlers(null));

  it('E1 : nouvelle commande sous la clé de la tentative, committée sur la tournée réinitialisée', async () => {
    const h = stubMts1();
    const { supabase, ecritures } = makeSupabase({
      tournees: [tourneeMts1Reinit()],
    });

    await new AdapterMts1(TRANSPORTEUR_MARATHON, supabase).dispatchCollecte(
      collecte(),
      1,
    );

    // Jamais la clé `col-reatt-1` de la commande annulée.
    expect(h.postOrder).toHaveBeenCalledOnce();
    expect(h.postOrder.mock.calls[0]![0]).toMatchObject({
      orderNumber: 'col-reatt-1-r2',
    });
    expect(h.createTour.mock.calls[0]![0]).toMatchObject({
      orderNumber: 'col-reatt-1-r2',
    });

    // La commande est committée sur LA tournée existante, par id…
    const commit = ecritures.find(
      (e) =>
        e.table === 'tournees' &&
        (e.payload as Record<string, unknown>)?.['external_ref_commande'] ===
          'MTS1-ORDER-NEUVE-1',
    );
    expect(commit).toMatchObject({ op: 'update', eqs: [['id', 'T-reinit']] });
    // … sans seconde tournée ni rattachement qui détacherait la première.
    expect(ecritures.filter((e) => e.op === 'upsert')).toEqual([]);
    expect(ecritures.filter((e) => e.table === 'collecte_tournees')).toEqual(
      [],
    );
  });

  it('E1 sur reprise après timeout : la commande annulée n’est jamais reprise, celle de la tentative l’est', async () => {
    const annulee: Mts1CustomerOrder = {
      id: 'MTS1-ORDER-ANNULEE',
      externalReference: 'col-reatt-1',
      status: 'CANCELED',
    };
    const tentative: Mts1CustomerOrder = {
      id: 'MTS1-ORDER-TENTATIVE-2',
      externalReference: 'col-reatt-1-r2',
      status: 'DRAFT',
    };

    // Le POST précédent n'avait pas abouti : seule la commande annulée existe.
    const h1 = stubMts1([annulee]);
    const s1 = makeSupabase({ tournees: [tourneeMts1Reinit()] });
    await new AdapterMts1(TRANSPORTEUR_MARATHON, s1.supabase).dispatchCollecte(
      collecte(),
      1,
      { requiresReconciliation: true },
    );
    expect(h1.postOrder).toHaveBeenCalledOnce();
    expect(h1.addCustomerOrder.mock.calls[0]).not.toContain(
      'MTS1-ORDER-ANNULEE',
    );

    // Le POST précédent avait abouti : sa commande est reprise, pas de doublon.
    const h2 = stubMts1([annulee, tentative]);
    const s2 = makeSupabase({ tournees: [tourneeMts1Reinit()] });
    await new AdapterMts1(TRANSPORTEUR_MARATHON, s2.supabase).dispatchCollecte(
      collecte(),
      1,
      { requiresReconciliation: true },
    );
    expect(h2.postOrder).not.toHaveBeenCalled();
    expect(h2.addCustomerOrder.mock.calls[0]).toContain(
      'MTS1-ORDER-TENTATIVE-2',
    );
  });

  it('E2 multi-camions : le rang refusé est recommandé, le rang vivant seulement modifié', async () => {
    const h = stubMts1();
    const { supabase } = makeSupabase({
      tournees: [
        tourneeMts1Reinit(),
        {
          id: 'T-rang2',
          rang: 2,
          reference_interne: 'TMS-col-reatt-2',
          external_ref_commande: 'MTS1-ORDER-RANG2',
          tms_reference: 'MTS1-TOUR-RANG2',
          statut: 'en_cours',
          prestataire_logistique_id: PRESTA_MTS1,
        },
      ],
    });

    const consumer = await new AdapterMts1(
      TRANSPORTEUR_MARATHON,
      supabase,
    ).updateCollecte(collecte({ nb_camions_demande: 2 }));

    expect(consumer).toBe('adapter_mts1');
    expect(h.updateOrder.mock.calls.map((c) => c[0])).toEqual([
      'MTS1-ORDER-RANG2',
    ]);
    expect(h.postOrder).toHaveBeenCalledOnce();
    expect(h.postOrder.mock.calls[0]![0]).toMatchObject({
      orderNumber: 'col-reatt-1-r2',
    });
  });

  it('premier dispatch (aucune tournée) : clé et tournée inchangées', async () => {
    const h = stubMts1();
    const { supabase, ecritures } = makeSupabase({ tournees: [] });

    await new AdapterMts1(TRANSPORTEUR_MARATHON, supabase).dispatchCollecte(
      collecte(),
      1,
    );

    expect(h.postOrder.mock.calls[0]![0]).toMatchObject({
      orderNumber: 'col-reatt-1',
    });
    expect(
      ecritures.find((e) => e.table === 'tournees' && e.op === 'upsert'),
    ).toMatchObject({
      onConflict: 'reference_interne',
      payload: { reference_interne: 'TMS-col-reatt-1' },
    });
  });
});

// ─── Everest ──────────────────────────────────────────────────────────────────

describe('A Toutes! — mission refusée puis réattribuée', () => {
  afterEach(() => _setEverestHandlers(null));

  it('E1 : nouvelle mission sur la tournée réinitialisée, aucune seconde tournée', async () => {
    const { missions } = setupEverestMock();
    const { supabase, ecritures } = makeSupabase({
      tournees: [
        {
          id: 'T-evr-reinit',
          rang: 1,
          reference_interne: 'EVR-col-reatt-1-r2',
          external_ref_commande: null,
          tms_reference: null,
          statut: 'planifiee',
          prestataire_logistique_id: PRESTA_EVEREST,
        },
      ],
      mission: {
        id: 'em-refusee',
        statut_everest: 'failed',
        everest_mission_id: 'EVR-MISSION-REFUSEE',
      },
    });

    await new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
      collecte({ type: 'anti_gaspi' }),
      1,
    );

    // client_ref = id de la tournée réinitialisée.
    expect([...missions.keys()]).toEqual(['T-evr-reinit']);
    expect(ecritures.filter((e) => e.op === 'insert')).toEqual([]);
    expect(
      ecritures.find(
        (e) =>
          e.table === 'tournees' &&
          (e.payload as Record<string, unknown>)?.['external_ref_commande'],
      ),
    ).toMatchObject({
      op: 'update',
      payload: { external_ref_commande: 'EVR-MOCK-1' },
      eqs: [['id', 'T-evr-reinit']],
    });
  });
});

// Garde : PRESTA_MTS1 et PRESTA_MTS1_BIS doivent rester deux prestataires du même
// type, sinon le premier describe ne prouverait plus le basculement Strike → Marathon.
it('fixtures : les deux prestataires MTS-1 sont distincts', () => {
  expect(PRESTA_MTS1).not.toBe(PRESTA_MTS1_BIS);
});
