// =============================================================================
// Régression Lot A — adapter MTS-1 (A2 / A4 / A7)
// =============================================================================
// A2 : rejeu d'un event inbox tant que traite=false (crash-safety) ; skip si traite=true.
// A4 : 404-après-DELETE = succès idempotent (≠ fenêtre fermée) ; reconciliation E3.
// A7 : 'OK' = statut terminal réel MTS-1 → déclenche l'agrégation (avant : 'DELIVERED'
//      jamais renvoyé → collecte jamais realisee).
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CancelWindowClosedError, LogistiquePermanentError } from '../index.js';
import type { Collecte, Lieu, Transporteur } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder } from './mock.js';
import { _setMts1Handlers } from './mock.js';

const TRANSPORTEUR: Transporteur = {
  id: 'presta-lota',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE',
  prestataire_logistique_id: 'presta-lota',
};

const LIEU: Lieu = {
  id: 'lieu-lota',
  nom: 'Salle Test',
  adresse_acces: '1 rue du Test',
  code_postal: '75001',
  ville: 'Paris',
  latitude: null,
  longitude: null,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

const COLLECTE: Collecte = {
  id: 'col-lota-001',
  type: 'zero_dechet',
  date_collecte: '2026-07-15',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  statut_tms: 'attribuee_en_attente_acceptation',
  controle_acces_requis: false,
  informations_supplementaires: null,
  notes_internes: null,
  contact_principal_nom: 'Alice',
  contact_principal_telephone: '+33600000001',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  lieu: LIEU,
};

type TableCall = {
  table: string;
  op: string;
  data?: unknown;
  filters?: Record<string, unknown>;
};
type RpcCall = { name: string; args: unknown };

// ─── Mock Supabase pour processOrder (A2 / A7) ───────────────────────────────
function makeSyncSupabase(opts: {
  /** Ligne integrations_inbox déjà présente (ON CONFLICT) → { id, traite }. null = pas de ligne. */
  inboxExistante?: { id: string; traite: boolean } | null;
  tourneeInfo?: {
    collecteId: string;
    tourneeId: string;
    tmsReference: string | null;
    collecteStatut: string;
  };
  agregerTerminalResult?: string;
}) {
  const calls: TableCall[] = [];
  const rpcCalls: RpcCall[] = [];
  const tourneeInfo = opts.tourneeInfo ?? {
    collecteId: 'col-lota-001',
    tourneeId: 'tournee-lota-001',
    tmsReference: null,
    collecteStatut: 'validee',
  };

  function makeQuery(table: string) {
    const filters: Record<string, unknown> = {};
    const self: Record<string, unknown> = {
      select: vi.fn(() => {
        calls.push({ table, op: 'select', filters });
        return self;
      }),
      insert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'insert', data, filters });
        // integrations_inbox : conflit (ON CONFLICT) si une ligne existe déjà
        if (
          table === 'integrations_inbox' &&
          opts.inboxExistante !== undefined
        ) {
          return { ...self, data: [] };
        }
        return { ...self, data: [{ id: `${table}-001` }] };
      }),
      upsert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'upsert', data, filters });
        return self;
      }),
      update: vi.fn((data: unknown) => {
        calls.push({ table, op: 'update', data, filters });
        return self;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        filters[col] = val;
        return self;
      }),
      in: vi.fn(() => self),
      limit: vi.fn(() => {
        if (table === 'integrations_inbox') {
          const row =
            opts.inboxExistante !== undefined ? [] : [{ id: 'inbox-lota-001' }];
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      maybeSingle: vi.fn(() => {
        if (table === 'integrations_inbox') {
          // Lookup A2 : ligne déjà présente { id, traite }
          return Promise.resolve({
            data: opts.inboxExistante ?? null,
            error: null,
          });
        }
        if (table === 'tournees') {
          return Promise.resolve({
            data: {
              id: tourneeInfo.tourneeId,
              tms_reference: tourneeInfo.tmsReference,
              collecte_tournees: [
                {
                  collecte_id: tourneeInfo.collecteId,
                  collectes: [
                    {
                      id: tourneeInfo.collecteId,
                      statut: tourneeInfo.collecteStatut,
                    },
                  ],
                },
              ],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };
    return self;
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'flux_dechets') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }
      if (table === 'parametres_algo') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }
      return makeQuery(table);
    }),
    schema: vi.fn(() => ({ from: vi.fn((t: string) => makeQuery(t)) })),
    rpc: vi.fn((name: string, args?: unknown) => {
      rpcCalls.push({ name, args: args ?? null });
      return {
        single: vi.fn(() =>
          Promise.resolve({
            data: opts.agregerTerminalResult ?? 'pending',
            error: null,
          }),
        ),
      };
    }),
    _calls: calls,
    _rpcCalls: rpcCalls,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _calls: TableCall[];
    _rpcCalls: RpcCall[];
  };
}

const FENETRE = {
  depuis: new Date('2026-07-15T00:00:00Z'),
  jusqu_a: new Date('2026-07-17T00:00:00Z'),
};

// ─── A2 : rejeu tant que traite=false ────────────────────────────────────────
describe('Lot A / A2 — rejeu inbox non terminé (crash-safety)', () => {
  afterEach(() => _setMts1Handlers(null));

  const ORDER_VALIDATED: Mts1CustomerOrder = {
    id: 'MTS1-ORDER-A2',
    externalReference: 'col-lota-001-1',
    status: 'VALIDATED',
    pickupDate: '2026-07-15T22:00:00Z',
  };

  it('A2 / clé inbox présente mais traite=false → l’event est REJOUÉ (collectes.update)', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_VALIDATED],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn(),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({
      inboxExistante: { id: 'inbox-existant', traite: false },
    });
    await new AdapterMts1(TRANSPORTEUR, supabase).sync(FENETRE);

    const collecteUpdate = supabase._calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeDefined();
    expect(
      (collecteUpdate!.data as Record<string, unknown>)['statut_tms'],
    ).toBe('acceptee');
    // markInboxDone a confirmé le traitement
    const inboxDone = supabase._calls.find(
      (c) =>
        c.table === 'integrations_inbox' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown>)['traite'] === true,
    );
    expect(inboxDone).toBeDefined();
  });

  it('A2 / clé inbox présente ET traite=true → skip (aucun effet rejoué)', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_VALIDATED],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn(),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({
      inboxExistante: { id: 'inbox-existant', traite: true },
    });
    await new AdapterMts1(TRANSPORTEUR, supabase).sync(FENETRE);

    const collecteUpdate = supabase._calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeUndefined();
  });
});

// ─── A7 : 'OK' est le statut terminal réel ───────────────────────────────────
describe('Lot A / A7 — OK = terminal → agrégation déclenchée', () => {
  afterEach(() => _setMts1Handlers(null));

  const ORDER_OK: Mts1CustomerOrder = {
    id: 'MTS1-ORDER-A7',
    externalReference: 'col-lota-001-1',
    status: 'OK',
    pickupDate: '2026-07-15T22:00:00Z',
  };

  it("A7 / order 'OK' → tournée 'terminee' + fn_agreger_terminal_collecte appelé", async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_OK],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn(),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({
      agregerTerminalResult: 'realisee',
      tourneeInfo: {
        collecteId: 'col-lota-001',
        tourneeId: 'tournee-lota-001',
        tmsReference: null,
        collecteStatut: 'en_cours',
      },
    });
    await new AdapterMts1(TRANSPORTEUR, supabase).sync(FENETRE);

    // tournée passée à 'terminee' (OK = succès terminal, pas 'annulee')
    const tourneeTerminee = supabase._calls.find(
      (c) =>
        c.table === 'tournees' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown>)['statut'] === 'terminee',
    );
    expect(tourneeTerminee).toBeDefined();

    // agrégation terminale déclenchée (avec l'ancien set {DELIVERED,...} : jamais)
    const agreger = supabase._rpcCalls.find(
      (c) => c.name === 'fn_agreger_terminal_collecte',
    );
    expect(agreger).toBeDefined();
  });
});

// ─── A4 : cancelCollecte 404 idempotent + reconciliation ─────────────────────
describe('Lot A / A4 — annulation E3 idempotente', () => {
  afterEach(() => _setMts1Handlers(null));

  /** Mock minimal : findTournees renvoie 1 tournée avec external_ref. */
  function makeCancelSupabase() {
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      // integrations_logs.insert (logging client) → no-op résolu
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      eq: vi.fn().mockResolvedValue({
        data: [
          {
            rang: 1,
            tournees: [
              {
                id: 'T1',
                external_ref_commande: 'MTS1-ORDER-A4',
                tms_reference: 'MTS1-TOUR-A4',
                statut: 'en_cours',
              },
            ],
          },
        ],
        error: null,
      }),
    };
    return {
      from: vi.fn().mockReturnValue(mockQuery),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;
  }

  it('A4 / deleteOrder 404 → succès idempotent (PAS CancelWindowClosedError)', async () => {
    const deleteOrder = vi
      .fn()
      .mockRejectedValue(
        new LogistiquePermanentError('MTS-1 404 : order not found'),
      );
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    await expect(
      new AdapterMts1(TRANSPORTEUR, makeCancelSupabase()).cancelCollecte(
        COLLECTE,
      ),
    ).resolves.toBeUndefined();
    expect(deleteOrder).toHaveBeenCalledOnce();
  });

  it('A4 / autre 4xx (409) → CancelWindowClosedError (fenêtre fermée)', async () => {
    const deleteOrder = vi
      .fn()
      .mockRejectedValue(
        new LogistiquePermanentError('MTS-1 409 : cancel window closed'),
      );
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    await expect(
      new AdapterMts1(TRANSPORTEUR, makeCancelSupabase()).cancelCollecte(
        COLLECTE,
      ),
    ).rejects.toBeInstanceOf(CancelWindowClosedError);
  });

  it('A4 / requiresReconciliation + ordre distant absent → DELETE court-circuité', async () => {
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    // scan de réconciliation ne retrouve pas l'ordre → déjà supprimé
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([]);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
      scanOrdersByDateRange,
    });

    await expect(
      new AdapterMts1(TRANSPORTEUR, makeCancelSupabase()).cancelCollecte(
        COLLECTE,
        { requiresReconciliation: true },
      ),
    ).resolves.toBeUndefined();
    expect(scanOrdersByDateRange).toHaveBeenCalledOnce();
    expect(deleteOrder).not.toHaveBeenCalled();
  });
});
