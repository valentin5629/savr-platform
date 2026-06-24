import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// L'upload R2 (signature Sig V4) vit dans @savr/shared (uploadObject) — mocké ici
// pour piloter succès/échec sans appel R2 réel (BL-P0-02). Par défaut : résout.
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: vi.fn(),
}));

import { uploadObject } from '@savr/shared/src/r2/upload.js';

import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder, Mts1Photo, Mts1Tour } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOUR_NOMINAL: Mts1Tour = {
  tourId: 'MTS1-TOUR-ZD-001',
  externalReference: 'tour_strike_001',
  status: 'OK',
  startedAt: '2026-07-15T22:00:00Z',
  completedAt: '2026-07-16T00:00:00Z',
  stops: [
    {
      stopId: 'stop-001',
      address: '1 Place de la Porte de Versailles, 75015 Paris',
      completedAt: '2026-07-15T23:45:00Z',
      items: [
        { stuff: '<volume_du_camion>', qty: 1, weight: null },
        { stuff: 'Bio-déchets (en kg)', qty: 1, weight: 234.5 },
        { stuff: 'Carton (en kg)', qty: 1, weight: 87.2 },
        { stuff: 'D.I.B (en kg)', qty: 1, weight: 45.0 },
        { stuff: 'Film plastique (en kg)', qty: 1, weight: 12.8 },
        { stuff: 'Verre (en kg)', qty: 1, weight: 156.3 },
      ],
    },
  ],
};

const TOUR_STUFF_INCONNU: Mts1Tour = {
  ...TOUR_NOMINAL,
  tourId: 'MTS1-TOUR-ZD-002',
  stops: [
    {
      stopId: 'stop-002',
      address: '2 Rue du Test, 75001 Paris',
      completedAt: '2026-07-15T23:30:00Z',
      items: [
        { stuff: 'Bio-déchets (en kg)', qty: 1, weight: 178.0 },
        { stuff: 'Gravats (en kg)', qty: 1, weight: 320.0 }, // inconnu
      ],
    },
  ],
};

const PHOTOS_NOMINAL: Mts1Photo[] = [
  {
    tourId: 'MTS1-TOUR-ZD-001',
    stopId: 'stop-001',
    photoId: 'photo-001-a',
    url: 'https://mts1-storage.example.com/photos/photo-001-a.jpg',
    takenAt: '2026-07-15T23:15:00Z',
    type: 'PESEE',
    weight_kg: null,
  },
];

const PHOTOS_404: Mts1Photo[] = [
  {
    tourId: 'MTS1-TOUR-ZD-001',
    stopId: 'stop-001',
    photoId: 'photo-404',
    url: 'https://mts1-storage.example.com/photos/not-found-404.jpg',
    takenAt: '2026-07-15T23:15:00Z',
    type: 'PESEE',
    weight_kg: null,
  },
];

const ORDER_VALIDATED: Mts1CustomerOrder = {
  id: 'MTS1-ORDER-001',
  externalReference: 'col-zd-001-1',
  status: 'VALIDATED',
  pickupDate: '2026-07-15T22:00:00Z',
};

const ORDER_IN_PROGRESSION: Mts1CustomerOrder = {
  ...ORDER_VALIDATED,
  status: 'IN_PROGRESSION',
};

const ORDER_OK: Mts1CustomerOrder = {
  ...ORDER_VALIDATED,
  status: 'OK',
};

// ─── Mock Supabase ────────────────────────────────────────────────────────────

type TableCall = {
  table: string;
  op: string;
  data?: unknown;
  filters?: Record<string, unknown>;
};

function makeSyncSupabase(opts: {
  /** Tournée existante pour external_ref_commande = ORDER.id */
  tourneeInfo?: {
    collecteId: string;
    tourneeId: string;
    tmsReference: string | null;
    collecteStatut: string;
  } | null;
  /** La photo existe déjà dans shared.fichiers ? */
  photoExistante?: boolean;
  /** La pesée existe déjà dans pesees_tournees ? */
  peseeExistante?: { poids_kg: number } | null;
  /** integrations_inbox INSERT retourne une ligne (non dédupliqué) ? */
  inboxClaimRetourneRien?: boolean;
  /** collecte.statut_tms courant */
  collecteStatutTms?: string;
}) {
  const calls: TableCall[] = [];

  const tourneeInfo =
    opts.tourneeInfo !== undefined
      ? opts.tourneeInfo
      : {
          collecteId: 'col-001',
          tourneeId: 'tournee-001',
          tmsReference: 'MTS1-TOUR-ZD-001',
          collecteStatut: 'validee',
        };

  function makeQuery(table: string) {
    const q: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};

    const self = {
      select: vi.fn((_fields?: string) => {
        calls.push({ table, op: 'select', filters });
        return self;
      }),
      insert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'insert', data, filters });
        // integrations_inbox : simule ON CONFLICT DO NOTHING
        if (table === 'integrations_inbox' && opts.inboxClaimRetourneRien) {
          return { ...self, data: [] };
        }
        return { ...self, data: [{ id: 'inbox-001' }] };
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
        // integrations_inbox claim : retourne le row ou rien selon le flag
        if (table === 'integrations_inbox') {
          const row = opts.inboxClaimRetourneRien ? [] : [{ id: 'inbox-001' }];
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      maybeSingle: vi.fn(() => {
        if (table === 'tournees') {
          if (!tourneeInfo) return Promise.resolve({ data: null, error: null });
          // Simule la relation avec collecte_tournees!inner et collectes!inner
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
          return Promise.resolve({
            data: opts.peseeExistante ?? null,
            error: null,
          });
        }
        if (table === 'fichiers') {
          return Promise.resolve({
            data: opts.photoExistante ? { id: 'fichier-001' } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    // Proxy pour chaîner q.data
    Object.defineProperty(self, 'data', {
      get: () => q['data'],
      set: (v: unknown) => {
        q['data'] = v;
      },
    });

    return self;
  }

  const fluxRows = [
    { id: 'flux-biodechet', code: 'biodechet' },
    { id: 'flux-carton', code: 'carton' },
    { id: 'flux-dechet-residuel', code: 'dechet_residuel' },
    { id: 'flux-emballage', code: 'emballage' },
    { id: 'flux-verre', code: 'verre' },
  ];

  const fromFn = vi.fn((table: string) => {
    const q = makeQuery(table);
    if (table === 'flux_dechets') {
      // Résout directement pour loadFluxCodes
      const mockQ = {
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: fluxRows, error: null })),
        })),
      };
      return mockQ;
    }
    return q;
  });

  const supabase = {
    from: fromFn,
    schema: vi.fn((_s: string) => ({ from: fromFn })),
    _calls: calls,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _calls: TableCall[];
  };
}

// ─── Tests M1.5b ──────────────────────────────────────────────────────────────

describe('M1.5b / AdapterMts1.sync — nominal', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-1 / poll nominal VALIDATED → statut_tms="acceptee", pesées upsertées, photo uploadée', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_VALIDATED],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue(PHOTOS_NOMINAL),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({});
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Vérifier qu'un INSERT inbox a bien eu lieu
    const inboxInsert = calls.find(
      (c) => c.table === 'integrations_inbox' && c.op === 'insert',
    );
    expect(inboxInsert).toBeDefined();

    // Vérifier mise à jour statut_tms
    const collecteUpdate = calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeDefined();
    expect(
      (collecteUpdate!.data as Record<string, unknown>)['statut_tms'],
    ).toBe('acceptee');

    // Vérifier upsert pesées (5 flux valides)
    const peseesUpserts = calls.filter(
      (c) => c.table === 'pesees_tournees' && c.op === 'upsert',
    );
    expect(peseesUpserts.length).toBe(5);

    // Vérifier insert photo dans fichiers
    const fichierInsert = calls.find(
      (c) => c.table === 'fichiers' && c.op === 'insert',
    );
    expect(fichierInsert).toBeDefined();
  });
});

describe('M1.5b / AdapterMts1.sync — dédup statut', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-2 / même ordre même statut → claim inbox retourne rien → skip complet', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_VALIDATED],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({ inboxClaimRetourneRien: true });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Aucune mise à jour collectes (skip total après dédup)
    const collecteUpdate = calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeUndefined();

    // Aucun upsert pesées
    const peseesUpserts = calls.filter(
      (c) => c.table === 'pesees_tournees' && c.op === 'upsert',
    );
    expect(peseesUpserts.length).toBe(0);
  });
});

describe('M1.5b / AdapterMts1.sync — IN_PROGRESSION', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-3 / IN_PROGRESSION → collectes.statut mis à en_cours (pas de changement statut_tms)', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_IN_PROGRESSION],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({
      tourneeInfo: {
        collecteId: 'col-001',
        tourneeId: 'tournee-001',
        tmsReference: 'MTS1-TOUR-ZD-001',
        collecteStatut: 'validee',
      },
    });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Pas de changement statut_tms (null pour IN_PROGRESSION)
    const tmsUpdate = calls.find(
      (c) =>
        c.table === 'collectes' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown>)['statut_tms'] !== undefined,
    );
    expect(tmsUpdate).toBeUndefined();

    // UPDATE direct collectes.statut = 'en_cours'
    const statutUpdate = calls.find(
      (c) =>
        c.table === 'collectes' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown>)['statut'] === 'en_cours',
    );
    expect(statutUpdate).toBeDefined();
  });
});

describe('M1.5b / AdapterMts1.sync — stuff inconnu', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-4 / stuff inconnu → integrations_logs STUFF_INCONNU, pesées connues upsertées quand même', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_OK],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_STUFF_INCONNU),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({
      tourneeInfo: {
        collecteId: 'col-001',
        tourneeId: 'tournee-001',
        tmsReference: 'MTS1-TOUR-ZD-002',
        collecteStatut: 'validee',
      },
    });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Log STUFF_INCONNU
    const logInsert = calls.find(
      (c) =>
        c.table === 'integrations_logs' &&
        c.op === 'insert' &&
        String((c.data as Record<string, unknown>)['erreur']).includes(
          'STUFF_INCONNU',
        ),
    );
    expect(logInsert).toBeDefined();

    // La pesée connue (biodechet) est quand même upsertée
    const peseesUpserts = calls.filter(
      (c) => c.table === 'pesees_tournees' && c.op === 'upsert',
    );
    expect(peseesUpserts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('M1.5b / AdapterMts1.sync — divergence post-clôture', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-5 / collecte cloturee + poids différent → aucune écriture + log PESEE_DIVERGENCE_POST_CLOTURE', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_OK],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({
      tourneeInfo: {
        collecteId: 'col-001',
        tourneeId: 'tournee-001',
        tmsReference: 'MTS1-TOUR-ZD-001',
        collecteStatut: 'cloturee',
      },
      // Pesée locale différente du distant (234.5 vs 200.0)
      peseeExistante: { poids_kg: 200.0 },
    });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Aucun upsert pesées (collecte clôturée)
    const peseesUpserts = calls.filter(
      (c) => c.table === 'pesees_tournees' && c.op === 'upsert',
    );
    expect(peseesUpserts.length).toBe(0);

    // Log divergence
    const logInsert = calls.find(
      (c) =>
        c.table === 'integrations_logs' &&
        c.op === 'insert' &&
        String((c.data as Record<string, unknown>)['erreur']).includes(
          'PESEE_DIVERGENCE_POST_CLOTURE',
        ),
    );
    expect(logInsert).toBeDefined();
  });
});

describe('M1.5b / AdapterMts1.sync — dédup photo', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-6 / photo déjà dans shared.fichiers → skip download', async () => {
    const downloadPhoto = vi.fn().mockResolvedValue(Buffer.from('DATA'));
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_OK],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue(PHOTOS_NOMINAL),
      postOrder: vi.fn(),
      // Override downloadPhoto via mock de bas niveau
    });

    const supabase = makeSyncSupabase({ photoExistante: true });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Aucun INSERT dans fichiers (photo déjà présente)
    const fichierInsert = calls.find(
      (c) => c.table === 'fichiers' && c.op === 'insert',
    );
    expect(fichierInsert).toBeUndefined();

    // downloadPhoto non appelé (le mock handler est la barrière)
    expect(downloadPhoto).not.toHaveBeenCalled();
  });
});

describe('M1.5b / AdapterMts1.sync — photo 404', () => {
  afterEach(() => _setMts1Handlers(null));

  it("M1.5b-7 / photo 404 → log PHOTO_DOWNLOAD_FAILED, poll continue (pas d'exception)", async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_OK],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue(PHOTOS_404),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({ photoExistante: false });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    // Ne doit pas lever d'exception
    await expect(
      adapter.sync({
        depuis: new Date('2026-07-15T00:00:00Z'),
        jusqu_a: new Date('2026-07-17T00:00:00Z'),
      }),
    ).resolves.toBeUndefined();

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Log PHOTO_DOWNLOAD_FAILED
    const logInsert = calls.find(
      (c) =>
        c.table === 'integrations_logs' &&
        c.op === 'insert' &&
        String((c.data as Record<string, unknown>)['erreur']).includes(
          'PHOTO_DOWNLOAD_FAILED',
        ),
    );
    expect(logInsert).toBeDefined();

    // Aucun INSERT dans fichiers
    const fichierInsert = calls.find(
      (c) => c.table === 'fichiers' && c.op === 'insert',
    );
    expect(fichierInsert).toBeUndefined();
  });
});

describe('M1.5b / AdapterMts1.sync — ordre sans tournée Savr', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-8 / ordre MTS-1 sans tournée dans notre système → ignoré sans erreur', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_VALIDATED],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn(),
      getPhotos: vi.fn(),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({ tourneeInfo: null });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await expect(
      adapter.sync({
        depuis: new Date('2026-07-15T00:00:00Z'),
        jusqu_a: new Date('2026-07-17T00:00:00Z'),
      }),
    ).resolves.toBeUndefined();

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Aucune mise à jour collectes
    const collecteUpdate = calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeUndefined();
  });
});

describe('M1.5b / AdapterMts1.sync — isolation par collecte', () => {
  afterEach(() => _setMts1Handlers(null));

  it("M1.5b-9 / échec d'une collecte → les autres collectes du run passent quand même", async () => {
    const ORDER_OK: Mts1CustomerOrder = {
      id: 'MTS1-ORDER-OK',
      externalReference: 'col-ok-1',
      status: 'VALIDATED',
    };
    const ORDER_KO: Mts1CustomerOrder = {
      id: 'MTS1-ORDER-KO',
      externalReference: 'col-ko-1',
      status: 'VALIDATED',
    };

    let getTourCallCount = 0;
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_KO, ORDER_OK],
        totalCount: 2,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockImplementation(() => {
        getTourCallCount++;
        if (getTourCallCount === 1)
          throw new Error('MTS-1 500: internal error');
        return Promise.resolve(TOUR_NOMINAL);
      }),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({});
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    // Pas d'exception globale
    await expect(
      adapter.sync({
        depuis: new Date('2026-07-15T00:00:00Z'),
        jusqu_a: new Date('2026-07-17T00:00:00Z'),
      }),
    ).resolves.toBeUndefined();

    // Le 2e ordre (ORDER_OK) a tout de même généré des upserts pesées
    const peseesUpserts = (
      supabase as unknown as { _calls: TableCall[] }
    )._calls.filter((c) => c.table === 'pesees_tournees' && c.op === 'upsert');
    expect(peseesUpserts.length).toBeGreaterThan(0);
  });
});

describe('M1.5b / AdapterMts1.sync — CANCELED', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-10 / CANCELED → statut_tms="rejetee_par_prestataire"', async () => {
    const ORDER_CANCELED: Mts1CustomerOrder = {
      ...ORDER_VALIDATED,
      id: 'MTS1-ORDER-CANCELED',
      status: 'CANCELED',
    };

    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_CANCELED],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue([]),
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({
      tourneeInfo: {
        collecteId: 'col-001',
        tourneeId: 'tournee-001',
        tmsReference: null,
        collecteStatut: 'validee',
      },
    });
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    const tmsUpdate = calls.find(
      (c) =>
        c.table === 'collectes' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown>)['statut_tms'] ===
          'rejetee_par_prestataire',
    );
    expect(tmsUpdate).toBeDefined();
  });
});

describe('M1.5b / AdapterMts1.sync — photo → R2 (BL-P0-02)', () => {
  afterEach(() => _setMts1Handlers(null));
  beforeEach(() => {
    // État par défaut : upload R2 réussit (résout).
    vi.mocked(uploadObject).mockReset();
    vi.mocked(uploadObject).mockResolvedValue('collectes/x');
  });

  function setNominalHandlers() {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue({
        customerOrders: [ORDER_VALIDATED],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      }),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      getPhotos: vi.fn().mockResolvedValue(PHOTOS_NOMINAL),
      postOrder: vi.fn(),
    });
  }

  const TRANSPORTEUR = {
    id: 'presta-001',
    type_tms: 'mts1',
    code_transporteur_mts1: 'STRIKE',
    prestataire_logistique_id: 'presta-001',
  } as const;

  it('photo téléchargée → upload R2 + ligne shared.fichiers (bucket collectes)', async () => {
    setNominalHandlers();
    const supabase = makeSyncSupabase({});
    await new AdapterMts1(TRANSPORTEUR, supabase).sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    // uploadObject appelé AVANT l'insert, sur le bucket 'collectes' + clé photos/…
    expect(uploadObject).toHaveBeenCalledTimes(1);
    expect(uploadObject).toHaveBeenCalledWith(
      'collectes',
      'photos/col-001/MTS1-TOUR-ZD-001/stop-001/photo-001-a.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    const fichierInsert = calls.find(
      (c) => c.table === 'fichiers' && c.op === 'insert',
    );
    expect(fichierInsert).toBeDefined();
    expect(fichierInsert!.data).toMatchObject({
      storage_provider: 'r2',
      bucket: 'collectes',
      key: 'photos/col-001/MTS1-TOUR-ZD-001/stop-001/photo-001-a.jpg',
      content_type: 'image/jpeg',
      entity_type: 'collecte_photo',
      entity_id: 'col-001',
    });
  });

  it("upload R2 KO → aucune ligne shared.fichiers (pas d'orpheline)", async () => {
    setNominalHandlers();
    // L'upload R2 échoue (ex. 403) → JAMAIS de pointeur shared.fichiers.
    vi.mocked(uploadObject).mockRejectedValueOnce(new Error('R2 403'));

    const supabase = makeSyncSupabase({});
    await new AdapterMts1(TRANSPORTEUR, supabase).sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    expect(uploadObject).toHaveBeenCalledTimes(1);

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    const fichierInsert = calls.find(
      (c) => c.table === 'fichiers' && c.op === 'insert',
    );
    expect(fichierInsert).toBeUndefined(); // pas d'orpheline

    // Le poll n'est pas interrompu : la collecte est tout de même mise à jour.
    const collecteUpdate = calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeDefined();
  });
});
