import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder, Mts1Tour } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOUR_POIDS_BAS: Mts1Tour = {
  tourId: 'MTS1-TOUR-M18-001',
  externalReference: 'tour_m18_001',
  status: 'OK',
  startedAt: '2026-07-15T22:00:00Z',
  completedAt: '2026-07-16T00:00:00Z',
  stops: [
    {
      stopId: 'stop-m18-001',
      address: '1 Place de la Porte de Versailles, 75015 Paris',
      completedAt: '2026-07-15T23:45:00Z',
      items: [
        { stuff: 'Bio-déchets (en kg)', qty: 1, weight: 2 }, // < seuil_min=5
        { stuff: 'Carton (en kg)', qty: 1, weight: 87.2 },
      ],
    },
  ],
};

const TOUR_NORMAL: Mts1Tour = {
  tourId: 'MTS1-TOUR-M18-002',
  externalReference: 'tour_m18_002',
  status: 'OK',
  startedAt: '2026-07-15T22:00:00Z',
  completedAt: '2026-07-16T00:00:00Z',
  stops: [
    {
      stopId: 'stop-m18-002',
      address: '1 Place de la Porte de Versailles, 75015 Paris',
      completedAt: '2026-07-15T23:45:00Z',
      items: [{ stuff: 'Bio-déchets (en kg)', qty: 1, weight: 234.5 }],
    },
  ],
};

const ORDER_VALIDATED_M18: Mts1CustomerOrder = {
  id: 'MTS1-ORDER-M18-VALIDATED',
  externalReference: 'col-m18-1',
  status: 'VALIDATED',
  pickupDate: '2026-07-15T22:00:00Z',
};

const ORDER_KO_M18: Mts1CustomerOrder = {
  id: 'MTS1-ORDER-M18-KO',
  externalReference: 'col-m18-ko-1',
  status: 'KO',
  pickupDate: '2026-07-15T22:00:00Z',
};

// ─── Mock Supabase étendu (M1.8 — support parametres_algo clé-valeur + rpc) ───

type TableCall = {
  table: string;
  op: string;
  data?: unknown;
  filters?: Record<string, unknown>;
};
type RpcCall = { name: string; args: unknown };

function makeSyncSupabaseM18(opts: {
  tourneeInfo?: {
    collecteId: string;
    tourneeId: string;
    tmsReference: string | null;
    collecteStatut: string;
  } | null;
  seuils?: { min: number; max: number };
  inboxClaimRetourneRien?: boolean;
  agregerTerminalResult?: string;
}) {
  const calls: TableCall[] = [];
  const rpcCalls: RpcCall[] = [];

  const tourneeInfo =
    opts.tourneeInfo !== undefined
      ? opts.tourneeInfo
      : {
          collecteId: 'col-m18-001',
          tourneeId: 'tournee-m18-001',
          tmsReference: 'MTS1-TOUR-M18-001',
          collecteStatut: 'validee',
        };

  const seuils = opts.seuils ?? { min: 5, max: 5000 };
  const agregerResult = opts.agregerTerminalResult ?? 'pending';

  function makeQuery(table: string) {
    const filters: Record<string, unknown> = {};
    const self = {
      select: vi.fn((_fields?: string) => {
        calls.push({ table, op: 'select', filters });
        return self;
      }),
      insert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'insert', data, filters });
        if (table === 'integrations_inbox' && opts.inboxClaimRetourneRien) {
          return { ...self, data: [] };
        }
        const inboxId =
          table === 'integrations_inbox' ? 'inbox-m18-001' : `${table}-001`;
        return { ...self, data: [{ id: inboxId }] };
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
      in: vi.fn((_col: string, _vals: unknown) => self),
      limit: vi.fn((_n: number) => {
        if (table === 'integrations_inbox') {
          const row = opts.inboxClaimRetourneRien
            ? []
            : [{ id: 'inbox-m18-001' }];
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      maybeSingle: vi.fn(() => {
        if (table === 'tournees') {
          if (!tourneeInfo) return Promise.resolve({ data: null, error: null });
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
        if (table === 'pesees_tournees') {
          return Promise.resolve({ data: null, error: null });
        }
        if (table === 'fichiers') {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };
    return self;
  }

  const fluxRows = [
    { id: 'flux-biodechet', code: 'biodechet' },
    { id: 'flux-carton', code: 'carton' },
  ];

  const seuilRows = [
    { cle: 'pesee_seuil_min_kg', valeur: seuils.min },
    { cle: 'pesee_seuil_max_kg', valeur: seuils.max },
  ];

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'flux_dechets') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: fluxRows, error: null })),
          })),
        };
      }
      if (table === 'parametres_algo') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: seuilRows, error: null })),
          })),
        };
      }
      return makeQuery(table);
    }),
    rpc: vi.fn((name: string, args?: unknown) => {
      rpcCalls.push({ name, args: args ?? null });
      if (name === 'fn_agreger_terminal_collecte') {
        return {
          single: vi.fn(() =>
            Promise.resolve({ data: agregerResult, error: null }),
          ),
        };
      }
      return {
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
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

const ADAPTER_OPTS = {
  id: 'presta-m18',
  type_tms: 'mts1' as const,
  code_transporteur_mts1: 'STRIKE',
  prestataire_logistique_id: 'presta-m18',
};

const FENETRE = {
  depuis: new Date('2026-07-15T00:00:00Z'),
  jusqu_a: new Date('2026-07-17T00:00:00Z'),
};

// ─── Tests M1.8 adapter ───────────────────────────────────────────────────────

describe('M1.8 / E2E / variante-pesee-hors-seuil', () => {
  afterEach(() => _setMts1Handlers(null));

  it('pesée < seuil_min → f_upsert_alerte_admin pesee_hors_seuil + upsert quand même', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_VALIDATED_M18],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_POIDS_BAS),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabaseM18({
      tourneeInfo: {
        collecteId: 'col-m18-001',
        tourneeId: 'tournee-m18-001',
        tmsReference: 'MTS1-TOUR-M18-001',
        collecteStatut: 'en_cours',
      },
    });

    const adapter = new AdapterMts1(ADAPTER_OPTS, supabase);
    await adapter.sync(FENETRE);

    // Pesée hors seuil (2 < 5) → alerte
    const alerteCall = supabase._rpcCalls.find(
      (c) =>
        c.name === 'f_upsert_alerte_admin' &&
        (c.args as Record<string, unknown>)['p_code'] === 'pesee_hors_seuil',
    );
    expect(alerteCall).toBeDefined();

    // Pesée upsertée quand même (la règle dit "alerte + upsert", pas blocage)
    const upserts = supabase._calls.filter(
      (c) => c.table === 'pesees_tournees' && c.op === 'upsert',
    );
    expect(upserts.length).toBeGreaterThanOrEqual(1);
    // Vérifier que le poids hors-seuil est bien parmi les upserts
    const horsSeuilUpsert = upserts.find(
      (c) => (c.data as Record<string, unknown>)['poids_kg'] === 2,
    );
    expect(horsSeuilUpsert).toBeDefined();
  });
});

describe('M1.8 / E2E / variante-multi-camions-ko-partiel', () => {
  afterEach(() => _setMts1Handlers(null));

  it('2 ordres OK+KO → fn_agreger_terminal_collecte realisee + alerte collecte_partiellement_servie', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_KO_M18],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NORMAL),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    // fn_agreger_terminal_collecte retourne 'realisee' — le OK est déjà terminal
    const supabase = makeSyncSupabaseM18({
      agregerTerminalResult: 'realisee',
      tourneeInfo: {
        collecteId: 'col-m18-001',
        tourneeId: 'tournee-m18-ko',
        tmsReference: null, // pas de tour details pour KO
        collecteStatut: 'en_cours',
      },
    });

    const adapter = new AdapterMts1(ADAPTER_OPTS, supabase);
    await adapter.sync(FENETRE);

    // fn_agreger_terminal_collecte appelé
    const agregerCall = supabase._rpcCalls.find(
      (c) => c.name === 'fn_agreger_terminal_collecte',
    );
    expect(agregerCall).toBeDefined();
    expect(
      (agregerCall!.args as Record<string, unknown>)['p_collecte_id'],
    ).toBe('col-m18-001');

    // Alerte KO partiel déclenchée (ordre KO + agrégation → realisee)
    const alerteCall = supabase._rpcCalls.find(
      (c) =>
        c.name === 'f_upsert_alerte_admin' &&
        (c.args as Record<string, unknown>)['p_code'] ===
          'collecte_partiellement_servie',
    );
    expect(alerteCall).toBeDefined();

    // Tournée mise à 'annulee' (ordre KO)
    const tourneeUpdate = supabase._calls.find(
      (c) =>
        c.table === 'tournees' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown>)['statut'] === 'annulee',
    );
    expect(tourneeUpdate).toBeDefined();
  });
});

// ─── Test A2 : tous tours annulés → rejetee_par_prestataire ──────────────────

describe('M1.8 / E2E / variante-tous-annules-rejetee', () => {
  afterEach(() => _setMts1Handlers(null));

  it('tous camions KO → fn_agreger_terminal_collecte rejetee_par_prestataire, pas alerte partielle', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_KO_M18],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NORMAL),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    // fn_agreger_terminal_collecte retourne 'rejetee_par_prestataire' — tous les tours sont KO
    const supabase = makeSyncSupabaseM18({
      agregerTerminalResult: 'rejetee_par_prestataire',
      tourneeInfo: {
        collecteId: 'col-m18-ko-total',
        tourneeId: 'tournee-m18-ko-total',
        tmsReference: null,
        collecteStatut: 'en_cours',
      },
    });

    const adapter = new AdapterMts1(ADAPTER_OPTS, supabase);
    await adapter.sync(FENETRE);

    // fn_agreger_terminal_collecte appelé
    const agregerCall = supabase._rpcCalls.find(
      (c) => c.name === 'fn_agreger_terminal_collecte',
    );
    expect(agregerCall).toBeDefined();

    // Pas d'alerte 'collecte_partiellement_servie' (tous KO, pas de partiel)
    const alertePartielle = supabase._rpcCalls.find(
      (c) =>
        c.name === 'f_upsert_alerte_admin' &&
        (c.args as Record<string, unknown>)['p_code'] ===
          'collecte_partiellement_servie',
    );
    expect(alertePartielle).toBeUndefined();

    // Tournée mise à 'annulee'
    const tourneeUpdate = supabase._calls.find(
      (c) =>
        c.table === 'tournees' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown>)['statut'] === 'annulee',
    );
    expect(tourneeUpdate).toBeDefined();
  });
});
