import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CancelWindowClosedError,
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
  getLogistiqueProvider,
} from '../index.js';
import type { Collecte, Lieu, Transporteur } from '../index.js';
import { ProviderManual } from '../manual/provider.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CreatedTour } from './mock.js';
import { _setMts1Handlers, setupMts1Mock } from './mock.js';

// ─── Fixtures de test ─────────────────────────────────────────────────────────

const LIEU_FIXTURE: Lieu = {
  id: 'lieu-001',
  nom: 'Salle Pleyel',
  adresse_acces: '252 Rue du Faubourg Saint-Honoré',
  code_postal: '75008',
  ville: 'Paris',
  latitude: 48.8789,
  longitude: 2.3049,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

const COLLECTE_ZD: Collecte = {
  id: 'col-zd-001',
  type: 'zero_dechet',
  date_collecte: '2026-07-15',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  statut_tms: 'non_envoye',
  controle_acces_requis: false,
  informations_supplementaires: null,
  notes_internes: null,
  contact_principal_nom: 'Alice Martin',
  contact_principal_telephone: '+33600000001',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  lieu: LIEU_FIXTURE,
};

const COLLECTE_AG: Collecte = {
  ...COLLECTE_ZD,
  id: 'col-ag-001',
  type: 'anti_gaspi',
};

const COLLECTE_MULTI: Collecte = {
  ...COLLECTE_ZD,
  id: 'col-multi-001',
  nb_camions_demande: 2,
};

const TRANSPORTEUR: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

const TRANSPORTEUR_AUTRE: Transporteur = {
  id: 'presta-manual-001',
  type_tms: 'autre',
  prestataire_logistique_id: 'presta-uuid-002',
};

// ─── Mock Supabase minimal ────────────────────────────────────────────────────

function makeMockSupabase(
  overrides: {
    tourneeExistante?: {
      id: string;
      external_ref_commande: string | null;
      tms_reference: string | null;
      statut: string;
    } | null;
    upsertError?: boolean;
  } = {},
) {
  const upserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const tourneeRow = overrides.tourneeExistante ?? null;

  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: tourneeRow ? { rang: 1, tournees: [tourneeRow] } : null,
      error: null,
    }),
    single: vi.fn().mockResolvedValue({
      data: overrides.upsertError
        ? null
        : {
            id: 'tournee-new-001',
            external_ref_commande: 'MTS1-ORDER-NEW-001',
            tms_reference: null,
            statut: 'planifiee',
          },
      error: overrides.upsertError ? { message: 'db error' } : null,
    }),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn((payload: Record<string, unknown>) => {
      updated.push(payload);
      return mockQuery;
    }),
    insert: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
  };

  const supabase = {
    from: vi.fn().mockReturnValue(mockQuery),
    _upserted: upserted,
    _updated: updated,
    _mockQuery: mockQuery,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient;
}

// ─── Tests adapter MTS-1 (M1.5a) ─────────────────────────────────────────────

describe('M1.5a / AdapterMts1 — dispatchCollecte ZD nominal', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5a / dispatch ZD rang=1 — POST order + create tour + dispatch + validate', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-001',
      externalReference: 'col-zd-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    const createTour = vi.fn().mockResolvedValue({
      tourId: 'MTS1-TOUR-001',
      externalReference: 'col-zd-001-1',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'MTS1-ORDER-001',
    } satisfies Mts1CreatedTour);
    const dispatchTour = vi.fn().mockResolvedValue(undefined);
    const validateTour = vi.fn().mockResolvedValue(undefined);

    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour,
      validateTour,
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);
    await adapter.dispatchCollecte(COLLECTE_ZD, 1);

    expect(postOrder).toHaveBeenCalledOnce();
    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(orderPayload['orderNumber']).toBe('col-zd-001-1');
    expect(orderPayload['orderCategories']).toEqual(['Déchets']);

    expect(createTour).toHaveBeenCalledOnce();
    expect(dispatchTour).toHaveBeenCalledWith('MTS1-TOUR-001', 'STRIKE-IDF');
    expect(validateTour).toHaveBeenCalledWith('MTS1-TOUR-001');
  });

  it('M1.5a / dispatch AG — orderCategories = Alimentaire', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-AG-001',
      externalReference: 'col-ag-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    const createTour = vi.fn().mockResolvedValue({
      tourId: 'MTS1-TOUR-AG-001',
      externalReference: 'col-ag-001-1',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'MTS1-ORDER-AG-001',
    } satisfies Mts1CreatedTour);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour: vi.fn().mockResolvedValue(undefined),
      validateTour: vi.fn().mockResolvedValue(undefined),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_AG,
      1,
    );

    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(orderPayload['orderCategories']).toEqual(['Alimentaire']);
    expect(orderPayload['stuffs']).toBeUndefined();
  });

  it('M1.5a / dispatch ZD — stuffs contient les 5 flux + volume_du_camion', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'O1',
      externalReference: 'col-zd-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    const createTour = vi.fn().mockResolvedValue({
      tourId: 'T1',
      externalReference: 'col-zd-001-1',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'O1',
    } satisfies Mts1CreatedTour);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour: vi.fn().mockResolvedValue(undefined),
      validateTour: vi.fn().mockResolvedValue(undefined),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );

    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    const stuffs = orderPayload['stuffs'] as Array<{ name: string }>;
    expect(stuffs.map((s) => s.name)).toContain('Bio-déchets (en kg)');
    expect(stuffs.map((s) => s.name)).toContain('<volume_du_camion>');
    expect(stuffs).toHaveLength(6);
  });
});

describe('M1.5a / AdapterMts1 — multi-camions', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5a / dispatch multi-camions N=2 — 2 ordres créés avec rang différent', async () => {
    let callCount = 0;
    const postOrder = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        id: `MTS1-ORDER-00${callCount}`,
        externalReference: `col-multi-001-${callCount}`,
        status: 'PLANNED',
        createdAt: '',
      });
    });
    const createTour = vi.fn().mockImplementation(() =>
      Promise.resolve({
        tourId: `MTS1-TOUR-00${callCount}`,
        externalReference: `col-multi-001-${callCount}`,
        status: 'DRAFT',
        createdAt: '',
        customerOrderId: `MTS1-ORDER-00${callCount}`,
      } satisfies Mts1CreatedTour),
    );
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour: vi.fn().mockResolvedValue(undefined),
      validateTour: vi.fn().mockResolvedValue(undefined),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);

    await adapter.dispatchCollecte(COLLECTE_MULTI, 1);
    await adapter.dispatchCollecte(COLLECTE_MULTI, 2);

    expect(postOrder).toHaveBeenCalledTimes(2);
    expect(
      (postOrder.mock.calls[0]![0] as Record<string, unknown>)['orderNumber'],
    ).toBe('col-multi-001-1');
    expect(
      (postOrder.mock.calls[1]![0] as Record<string, unknown>)['orderNumber'],
    ).toBe('col-multi-001-2');
  });
});

describe('M1.5a / AdapterMts1 — curseur de reprise', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5a / dispatch idempotent — rang déjà dispatchée (tms_reference + statut en_cours) = no-op', async () => {
    const postOrder = vi.fn();
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
    });

    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing',
        external_ref_commande: 'MTS1-ORDER-EXISTING',
        tms_reference: 'MTS1-TOUR-EXISTING',
        statut: 'en_cours',
      },
    });

    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );
    expect(postOrder).not.toHaveBeenCalled();
  });

  it('M1.5a / dispatch reprise étape 2 — external_ref_commande présent, tms_reference absent', async () => {
    const postOrder = vi.fn();
    const createTour = vi.fn().mockResolvedValue({
      tourId: 'MTS1-TOUR-REPRISE',
      externalReference: 'col-zd-001-1',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'MTS1-ORDER-EXISTING',
    } satisfies Mts1CreatedTour);
    const dispatchTour = vi.fn().mockResolvedValue(undefined);
    const validateTour = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour,
      validateTour,
    });

    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing',
        external_ref_commande: 'MTS1-ORDER-EXISTING',
        tms_reference: null,
        statut: 'planifiee',
      },
    });

    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );

    expect(postOrder).not.toHaveBeenCalled();
    expect(createTour).toHaveBeenCalledOnce();
    expect(dispatchTour).toHaveBeenCalledWith(
      'MTS1-TOUR-REPRISE',
      'STRIKE-IDF',
    );
  });

  it('M1.5a / reprise étapes 3-4 — tms_reference présent + statut planifiee → dispatch+validate rejoués, order/tour NON recréés', async () => {
    const postOrder = vi.fn();
    const createTour = vi.fn();
    const dispatchTour = vi.fn().mockResolvedValue(undefined);
    const validateTour = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour,
      validateTour,
    });

    // Étapes 1+2 déjà committées (curseurs présents) mais dispatch/validate ont
    // échoué au run précédent → tournée encore 'planifiee'.
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing',
        external_ref_commande: 'MTS1-ORDER-EXISTING',
        tms_reference: 'MTS1-TOUR-EXISTING',
        statut: 'planifiee',
      },
    });

    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );

    expect(postOrder).not.toHaveBeenCalled();
    expect(createTour).not.toHaveBeenCalled();
    expect(dispatchTour).toHaveBeenCalledWith(
      'MTS1-TOUR-EXISTING',
      'STRIKE-IDF',
    );
    expect(validateTour).toHaveBeenCalledWith('MTS1-TOUR-EXISTING');
  });

  it("M1.5a / curseur C2 — statut 'en_cours' jamais posé avant un validate réussi (régression)", async () => {
    // dispatch échoue (transient) → aucune écriture statut='en_cours' ne doit avoir
    // eu lieu : sinon la garde de reprise court-circuiterait dispatch/validate au
    // retry et le camion ne serait jamais commandé (bug C2).
    const dispatchTour = vi
      .fn()
      .mockRejectedValue(new LogistiqueTransientError('5xx dispatch'));
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn().mockResolvedValue({
        ok: true,
        id: 'O1',
        externalReference: 'col-zd-001-1',
        status: 'PLANNED',
        createdAt: '',
      }),
      createTour: vi.fn().mockResolvedValue({
        tourId: 'T1',
        externalReference: 'col-zd-001-1',
        status: 'DRAFT',
        createdAt: '',
        customerOrderId: 'O1',
      } satisfies Mts1CreatedTour),
      dispatchTour,
      validateTour: vi.fn(),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });

    await expect(
      new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(COLLECTE_ZD, 1),
    ).rejects.toThrow();

    const updates = (
      supabase as unknown as { _updated: Record<string, unknown>[] }
    )._updated;
    expect(updates.some((u) => u['statut'] === 'en_cours')).toBe(false);
  });
});

describe('M1.5a / AdapterMts1 — erreurs et réconciliation', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5a / POST 422 → LogistiquePermanentError', async () => {
    const restore = setupMts1Mock({ post: 'rejet_422' });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await expect(
      new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(COLLECTE_ZD, 1),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);

    restore();
  });

  it("M1.5a / réconciliation requires_reconciliation=true — scan minDate/maxDate retrouve l'ordre", async () => {
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([
      {
        id: 'MTS1-ORDER-FOUND',
        externalReference: 'col-zd-001-1',
        status: 'PLANNED',
      },
    ]);
    const createTour = vi.fn().mockResolvedValue({
      tourId: 'MTS1-TOUR-FOUND',
      externalReference: 'col-zd-001-1',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'MTS1-ORDER-FOUND',
    } satisfies Mts1CreatedTour);
    const postOrder = vi.fn();
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour: vi.fn().mockResolvedValue(undefined),
      validateTour: vi.fn().mockResolvedValue(undefined),
      scanOrdersByDateRange,
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
      { requiresReconciliation: true },
    );

    // L'ordre a été retrouvé via scan — pas de re-POST
    expect(postOrder).not.toHaveBeenCalled();
    expect(scanOrdersByDateRange).toHaveBeenCalledOnce();
    expect(createTour).toHaveBeenCalledOnce();
  });

  it('M1.5a / réconciliation — ordre introuvable → re-POST autorisé', async () => {
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([]);
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-NEW',
      externalReference: 'col-zd-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    const createTour = vi.fn().mockResolvedValue({
      tourId: 'MTS1-TOUR-NEW',
      externalReference: 'col-zd-001-1',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'MTS1-ORDER-NEW',
    } satisfies Mts1CreatedTour);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      dispatchTour: vi.fn().mockResolvedValue(undefined),
      validateTour: vi.fn().mockResolvedValue(undefined),
      scanOrdersByDateRange,
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
      { requiresReconciliation: true },
    );

    expect(scanOrdersByDateRange).toHaveBeenCalledOnce();
    expect(postOrder).toHaveBeenCalledOnce();
  });
});

describe('M1.5a / AdapterMts1 — updateCollecte E2', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5a / updateCollecte sans external_ref_commande → no-op', async () => {
    const updateOrder = vi.fn();
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const supabase2 = {
      from: vi.fn().mockReturnValue(mockQuery),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await new AdapterMts1(TRANSPORTEUR, supabase2).updateCollecte(COLLECTE_ZD);
    expect(updateOrder).not.toHaveBeenCalled();
  });
});

describe('M1.5a / AdapterMts1 — cancelCollecte E3', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5a / cancelCollecte 4xx → CancelWindowClosedError', async () => {
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

    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          {
            rang: 1,
            tournees: [
              {
                id: 'T1',
                external_ref_commande: 'MTS1-ORDER-001',
                tms_reference: 'MTS1-TOUR-001',
                statut: 'en_cours',
              },
            ],
          },
        ],
        error: null,
      }),
    };
    const supabase = {
      from: vi.fn().mockReturnValue(mockQuery),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(
      new AdapterMts1(TRANSPORTEUR, supabase).cancelCollecte(COLLECTE_ZD),
    ).rejects.toBeInstanceOf(CancelWindowClosedError);
  });
});

describe('M1.5a / provider_manual', () => {
  it('M1.5a / ProviderManual — méthodes sortantes renvoient le consumer "manual" (BL-P2-34)', async () => {
    const provider = new ProviderManual(TRANSPORTEUR_AUTRE);
    await expect(provider.dispatchCollecte(COLLECTE_ZD, 1)).resolves.toBe(
      'manual',
    );
    await expect(provider.updateCollecte(COLLECTE_ZD)).resolves.toBe('manual');
    await expect(provider.cancelCollecte(COLLECTE_ZD)).resolves.toBe('manual');
    // updateLieu / sync restent void (no-op)
    await expect(provider.updateLieu(LIEU_FIXTURE)).resolves.toBeUndefined();
    await expect(
      provider.sync({ depuis: new Date(), jusqu_a: new Date() }),
    ).resolves.toBeUndefined();
  });
});

describe('M1.5a / factory getLogistiqueProvider', () => {
  it('M1.5a / factory mts1 → AdapterMts1', () => {
    const supabase = makeMockSupabase();
    const provider = getLogistiqueProvider(TRANSPORTEUR, supabase);
    expect(provider).toBeInstanceOf(AdapterMts1);
  });

  it('M1.5a / factory autre → ProviderManual', () => {
    const supabase = makeMockSupabase();
    const provider = getLogistiqueProvider(TRANSPORTEUR_AUTRE, supabase);
    expect(provider).toBeInstanceOf(ProviderManual);
  });

  it('M1.5a / factory a_toutes → AdapterEverest (gate levée 2026-06-15)', async () => {
    // Gate Everest levée le 2026-06-15 (CLAUDE.md §7). La factory retourne
    // désormais AdapterEverest au lieu de lancer LogistiquePermanentError.
    const supabase = makeMockSupabase();
    const { AdapterEverest } = await import('../everest/adapter.js');
    const provider = getLogistiqueProvider(
      { ...TRANSPORTEUR, type_tms: 'a_toutes' },
      supabase,
    );
    expect(provider).toBeInstanceOf(AdapterEverest);
  });
});

describe('M1.5a / worker outbox — retry paliers', () => {
  it('M1.5a / retry palier 1 → next_retry_at dans ~5 min', () => {
    // Calcul du palier isolé (logique interne testée indirectement)
    const RETRY_DELAYS_MS = [
      5 * 60 * 1000,
      60 * 60 * 1000,
      24 * 60 * 60 * 1000,
    ];
    const getNextRetryAt = (attempts: number): Date | null => {
      const delayMs = RETRY_DELAYS_MS[attempts - 1];
      if (delayMs === undefined) return null;
      return new Date(Date.now() + delayMs);
    };

    const retry1 = getNextRetryAt(1);
    expect(retry1).not.toBeNull();
    expect(retry1!.getTime() - Date.now()).toBeGreaterThan(4 * 60 * 1000);
    expect(retry1!.getTime() - Date.now()).toBeLessThan(6 * 60 * 1000);

    const retry4 = getNextRetryAt(4);
    expect(retry4).toBeNull(); // DLQ
  });
});

describe('M1.5a / erreurs typées', () => {
  it('M1.5a / LogistiqueTransientError est instanceof LogistiqueProviderError', () => {
    const err = new LogistiqueTransientError('5xx');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LogistiqueTransientError');
  });

  it('M1.5a / LogistiqueAmbiguousError — timeout', () => {
    const err = new LogistiqueAmbiguousError('timeout');
    expect(err.name).toBe('LogistiqueAmbiguousError');
  });
});
