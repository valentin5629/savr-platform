import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CancelWindowClosedError,
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
  getLogistiqueProvider,
} from '../index.js';
import type { Collecte, Lieu, Transporteur } from '../index.js';
import { composerCommentaireTransporteur } from '../infos-acces.js';
import { ProviderManual } from '../manual/provider.js';
import { AdapterMts1, numeroPorteLaCle } from './adapter.js';
import { _setMts1Handlers, setupMts1Mock } from './mock.js';
import {
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';

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
  // Association destinataire résolue par le worker (point B), SANS point favori
  // MTS-1 : l'adresse part inline dans `stuffs[].relatedAddress.address`.
  association_adresse: '12 rue des Associations, Ivry-sur-Seine',
  association_contact_nom: 'Nadia Benali',
  association_contact_telephone: '+33699990001',
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
  prestataire_logistique_id: PRESTA_MTS1,
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
      // Explicite dans CHAQUE fixture, jamais posé par défaut par le helper :
      // une valeur injectée d'office par le mock rendrait le filtre provider
      // vrai par construction.
      prestataire_logistique_id: string | null;
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
    // findTournees lit la LISTE des liens de la collecte (plus de maybeSingle :
    // rien n'impose l'unicité de (collecte_id, rang)) → builder thenable.
    // FK sortante `collecte_tournees.tournee_id` → embed OBJET.
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: tourneeRow ? [{ rang: 1, tournees: tourneeRow }] : [],
        error: null,
      }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: tourneeRow ? { rang: 1, tournees: tourneeRow } : null,
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
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
  };

  const supabase = {
    // Routage PAR TABLE : le référentiel transporteurs ne doit jamais être servi
    // par le builder des tournées (sinon le filtre provider devient un no-op).
    from: vi.fn((table: string) =>
      table === 'transporteurs' ? builderTransporteurs() : mockQuery,
    ),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    _upserted: upserted,
    _updated: updated,
    _mockQuery: mockQuery,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient;
}

/** Tournée unitaire simulée : création, puis rattachement de la commande. */
function tourneeUnitaireSimulee(tourId = 'MTS1-TOUR-001') {
  return {
    createTour: vi.fn().mockResolvedValue({
      tourId,
      externalReference: '',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: '',
    }),
    addCustomerOrder: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests adapter MTS-1 (M1.5a) ─────────────────────────────────────────────

describe('M1.5a / AdapterMts1 — dispatchCollecte ZD nominal', () => {
  afterEach(() => {
    _setMts1Handlers(null);
    vi.unstubAllEnvs();
  });

  it('M1.5a / dispatch ZD rang=1 — commande et tournée unitaire, sans envoi au transporteur ni validation', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-001',
      externalReference: 'col-zd-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    const tournee = tourneeUnitaireSimulee();

    // Aucun crochet d'envoi au transporteur ni de validation : un tel appel
    // partirait sur le fil et échouerait.
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tournee,
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);
    await adapter.dispatchCollecte(COLLECTE_ZD, 1);

    expect(postOrder).toHaveBeenCalledOnce();
    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    // Nom du point dans la console : le libellé (ici le seul lieu, ni traiteur
    // ni pax dans cette collecte), puis la clé de la commande.
    expect(orderPayload['orderNumber']).toBe('Salle Pleyel · col-zd-001-1');
    expect(orderPayload['orderCategories']).toEqual(['Déchets']);
    // Contact terrain = objet UNIQUE firstname/lastname/phone (CustomerOrderContactInput),
    // plus l'ancien tableau `contacts` (ignoré par MTS-1 → arrivait vide).
    expect(orderPayload['contact']).toMatchObject({
      firstname: 'Alice',
      lastname: 'Martin',
      phone: '+33600000001',
    });
    expect(orderPayload['contacts']).toBeUndefined();
    // Créneau porté par le lieu (place.timeslots), pas au niveau commande, au
    // format HH:mm (heure_collecte='22:00:00' → '22:00'), point fixe V1 (start=end).
    const place = orderPayload['place'] as {
      timeslots?: Array<{ start: string; end: string }>;
    };
    expect(place.timeslots).toEqual([{ start: '22:00', end: '22:00' }]);
    expect(orderPayload['timeslots']).toBeUndefined();

    // Tournée unitaire : `tourDate` (yyyy-MM-dd) obligatoire sur POST /v3/tours,
    // puis la commande y est rattachée (le customerOrderId du POST /v3/tours est
    // ignoré par MTS-1). Elle n'est ni envoyée au transporteur ni validée :
    // l'Admin regroupe et envoie dans la console MTS-1 (décision Val 2026-10-15).
    expect(tournee.createTour).toHaveBeenCalledOnce();
    expect(
      (tournee.createTour.mock.calls[0]![0] as Record<string, unknown>)[
        'tourDate'
      ],
    ).toBe('2026-07-15');
    expect(tournee.addCustomerOrder).toHaveBeenCalledWith(
      'MTS1-TOUR-001',
      'MTS1-ORDER-001',
    );
    // La commande et la tournée sont enregistrées (curseurs de reprise), la fiche
    // affiche l'identifiant de la commande, la collecte attend sa tournée.
    const q = supabase as unknown as {
      _mockQuery: { upsert: ReturnType<typeof vi.fn> };
      _updated: Record<string, unknown>[];
    };
    expect(q._mockQuery.upsert.mock.calls[0]![0]).toMatchObject({
      external_ref_commande: 'MTS1-ORDER-001',
      statut: 'planifiee',
    });
    expect(q._updated).toContainEqual({ tms_reference: 'MTS1-TOUR-001' });
    expect(q._updated).toContainEqual({ tms_reference: 'MTS1-ORDER-001' });
    expect(q._updated).toContainEqual(
      expect.objectContaining({ statut_tms: 'a_attribuer' }),
    );
  });

  it('M1.5a / dispatch AG — orderCategories = Alimentaire', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-AG-001',
      externalReference: 'col-ag-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_AG,
      1,
    );

    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(orderPayload['orderCategories']).toEqual(['Alimentaire']);
    // AG = un seul stuff « Don alimentaire » (pesé plus tard, quantity 0).
    // COLLECTE_AG n'a pas de point favori → point B = adresse de l'association inline.
    const stuffs = orderPayload['stuffs'] as Array<{
      name: string;
      relatedAddress?: unknown;
    }>;
    expect(stuffs).toHaveLength(1);
    expect(stuffs[0]!.name).toBe('Don alimentaire');
    expect(stuffs[0]!.relatedAddress).toEqual({
      address: {
        addressSingleLine: '12 rue des Associations, Ivry-sur-Seine',
      },
    });
  });

  // BL-P1-API-02 — point de dépôt AG = point de dépôt de l'association (favoritePlace
  // id_point_collecte_mts1), porté par le stuff « Don alimentaire » (relatedAddress).
  it('M1.5a / dispatch AG — point B (asso) sur le stuff Don alimentaire (relatedAddress)', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-AG-FAV',
      externalReference: 'col-ag-fav-1',
      status: 'PLANNED',
      createdAt: '',
    });
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });

    const collecteAgFavorite: Collecte = {
      ...COLLECTE_AG,
      id: 'col-ag-fav',
      association_id_point_collecte_mts1: 'PLACE_BLUESPACE_IVRY',
    };
    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      collecteAgFavorite,
      1,
    );

    // Point B AG = point de dépôt de l'association, porté par le stuff « Don
    // alimentaire » (relatedAddress.placeId).
    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    const stuffs = orderPayload['stuffs'] as Array<{
      name: string;
      relatedAddress?: { placeId?: string };
    }>;
    expect(stuffs).toHaveLength(1);
    expect(stuffs[0]!.name).toBe('Don alimentaire');
    expect(stuffs[0]!.relatedAddress).toEqual({
      placeId: 'PLACE_BLUESPACE_IVRY',
    });
  });

  // AG sans point favori (association.id_point_collecte_mts1 NULL) → le point B
  // est l'adresse postale de l'association, inline dans `relatedAddress.address`
  // (CustomerOrderPlaceInput) : MTS-1 sait toujours où livrer le don.
  it('M1.5a / dispatch AG — pas de point favori → adresse de l’association inline en point B', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'O-AG-NOFAV',
      externalReference: 'col-ag-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    // COLLECTE_AG n'a pas association_id_point_collecte_mts1 (undefined)
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_AG,
      1,
    );

    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    const stuffs = orderPayload['stuffs'] as Array<{
      name: string;
      relatedAddress?: unknown;
    }>;
    expect(stuffs).toHaveLength(1);
    expect(stuffs[0]!.name).toBe('Don alimentaire');
    expect(stuffs[0]!.relatedAddress).toEqual({
      address: {
        addressSingleLine: '12 rue des Associations, Ivry-sur-Seine',
      },
    });
  });

  // AG sans association attribuée → aucun point B possible : refus permanent
  // AVANT tout appel MTS-1 (décision Val 2026-10-01, l'association est choisie
  // avant le prestataire — jamais un camion qui ne sait pas où livrer).
  it('M1.5a / dispatch AG — sans association attribuée → LogistiquePermanentError, aucun POST', async () => {
    const postOrder = vi.fn();
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await expect(
      new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
        {
          ...COLLECTE_AG,
          association_id_point_collecte_mts1: null,
          association_adresse: null,
        },
        1,
      ),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);
    // Aucun effet de bord : ni commande, ni tournée MTS-1, ni tournée en base.
    expect(postOrder).not.toHaveBeenCalled();
    expect(
      (supabase as unknown as { _upserted: unknown[] })._upserted,
    ).toHaveLength(0);
  });

  it('M1.5a / dispatch ZD — stuffs contient les 5 flux + volume_du_camion', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'O1',
      externalReference: 'col-zd-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });

    vi.stubEnv('MTS1_ENTREPOT_PLACE_ID', 'Entrepôt Savr');
    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );

    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    const stuffs = orderPayload['stuffs'] as Array<{
      name: string;
      relatedAddress?: { placeId?: string };
    }>;
    expect(stuffs.map((s) => s.name)).toContain('Bio-déchets (en kg)');
    expect(stuffs.map((s) => s.name)).toContain('<volume_du_camion>');
    expect(stuffs).toHaveLength(6);
    // Point B (livraison) ZD = entrepôt Savr, porté par CHAQUE stuff (relatedAddress).
    for (const s of stuffs) {
      expect(s.relatedAddress).toEqual({ placeId: 'Entrepôt Savr' });
    }
  });

  it('M1.5a / dispatch ZD — MTS1_ENTREPOT_PLACE_ID absent → stuffs sans relatedAddress (dégradation gracieuse)', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'O-NOENV',
      externalReference: 'col-zd-001-1',
      status: 'PLANNED',
      createdAt: '',
    });
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });

    // Config entrepôt absente → aucun point B, mais pas de throw : les stuffs
    // partent sans relatedAddress (dégradation gracieuse).
    vi.stubEnv('MTS1_ENTREPOT_PLACE_ID', '');
    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );

    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    const stuffs = orderPayload['stuffs'] as Array<{
      relatedAddress?: unknown;
    }>;
    expect(stuffs).toHaveLength(6);
    for (const s of stuffs) {
      expect(s.relatedAddress).toBeUndefined();
    }
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
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);

    await adapter.dispatchCollecte(COLLECTE_MULTI, 1);
    await adapter.dispatchCollecte(COLLECTE_MULTI, 2);

    expect(postOrder).toHaveBeenCalledTimes(2);
    expect(
      (postOrder.mock.calls[0]![0] as Record<string, unknown>)['orderNumber'],
    ).toBe('Salle Pleyel · col-multi-001-1');
    expect(
      (postOrder.mock.calls[1]![0] as Record<string, unknown>)['orderNumber'],
    ).toBe('Salle Pleyel · col-multi-001-2');
  });
});

describe('M1.5a / AdapterMts1 — curseur de reprise', () => {
  afterEach(() => _setMts1Handlers(null));

  const statutsDepuis = (supabase: unknown) =>
    (
      supabase as { _mockQuery: { in: ReturnType<typeof vi.fn> } }
    )._mockQuery.in.mock.calls.filter((c) => c[0] === 'statut_tms');

  it('M1.5a / dispatch idempotent — commande du rang déjà enregistrée : aucun POST, la reprise ne recule pas le statut', async () => {
    const postOrder = vi.fn();
    const tournee = tourneeUnitaireSimulee();
    // La commande est relue : elle est déjà dans sa tournée.
    const findOrdersByIds = vi.fn().mockResolvedValue([
      {
        customerOrderId: 'MTS1-ORDER-EXISTING',
        orderNumber: 'col-zd-001-1',
        customerOrderStatus: 'DRAFT',
        currentTour: { tourId: 'MTS1-TOUR-EXISTING' },
      },
    ]);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      findOrdersByIds,
      ...tournee,
    });

    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing',
        external_ref_commande: 'MTS1-ORDER-EXISTING',
        tms_reference: 'MTS1-TOUR-EXISTING',
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_MTS1,
      },
    });

    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );

    expect(postOrder).not.toHaveBeenCalled();
    expect(findOrdersByIds).toHaveBeenCalledWith(['MTS1-ORDER-EXISTING']);
    expect(tournee.createTour).not.toHaveBeenCalled();
    expect(tournee.addCustomerOrder).not.toHaveBeenCalled();
    // La référence et « à attribuer » sont réécrites (coupure entre la commande
    // enregistrée et ces écritures) ; le statut ne part que de « non envoyé » :
    // la relève a pu l'avancer entre-temps.
    expect(
      (supabase as unknown as { _updated: Record<string, unknown>[] })._updated,
    ).toContainEqual({ tms_reference: 'MTS1-ORDER-EXISTING' });
    expect(statutsDepuis(supabase)).toEqual([['statut_tms', ['non_envoye']]]);
  });

  it('M1.5a / commande neuve — « à attribuer » depuis tout statut de l’attribution (un camion ajouté ramène la collecte à attribuer)', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn().mockResolvedValue({
        ok: true,
        id: 'MTS1-ORDER-RANG-2',
        externalReference: 'col-multi-001-2',
        status: 'PLANNED',
        createdAt: '',
      }),
      ...tourneeUnitaireSimulee('MTS1-TOUR-RANG-2'),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_MULTI,
      2,
    );

    expect(statutsDepuis(supabase)).toEqual([
      [
        'statut_tms',
        [
          'non_envoye',
          'a_attribuer',
          'attribuee_en_attente_acceptation',
          'acceptee',
        ],
      ],
    ]);
    // Rang 2 : la référence affichée reste celle du rang 1.
    expect(
      (supabase as unknown as { _updated: Record<string, unknown>[] })._updated,
    ).not.toContainEqual({ tms_reference: 'MTS1-ORDER-RANG-2' });
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
        customerOrderId: 'MTS1-ORDER-FOUND',
        orderNumber: 'col-zd-001-1',
        customerOrderStatus: 'PLANNED',
      },
    ]);
    const postOrder = vi.fn();
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      scanOrdersByDateRange,
      ...tourneeUnitaireSimulee(),
    });

    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
      { requiresReconciliation: true },
    );

    // L'ordre a été retrouvé via scan — pas de re-POST, et c'est lui qui est
    // enregistré.
    expect(postOrder).not.toHaveBeenCalled();
    expect(scanOrdersByDateRange).toHaveBeenCalledOnce();
    expect(
      (
        supabase as unknown as {
          _mockQuery: { upsert: ReturnType<typeof vi.fn> };
        }
      )._mockQuery.upsert.mock.calls[0]![0],
    ).toMatchObject({ external_ref_commande: 'MTS1-ORDER-FOUND' });

    // Fenêtre en JOURS, J-1 → J+1 autour de la collecte, sans filtre de numéro
    // (le libellé a pu changer, la clé est reconnue par l'adapter) : l'API ne lit
    // que des « yyyy-MM-dd », bornes incluses, jour compté à Paris (mesuré le
    // 2026-10-13). Les instants envoyés avant (« 2026-07-13T22:00:00.000Z ») lui
    // faisaient répondre 500.
    expect(scanOrdersByDateRange).toHaveBeenCalledWith(
      '2026-07-14',
      '2026-07-16',
      undefined,
    );
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
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      scanOrdersByDateRange,
      ...tourneeUnitaireSimulee(),
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
      // `transporteurs` sert le référentiel : sans lui, la lecture du provider
      // échoue et l'on ne testerait plus le no-op mais l'indisponibilité du
      // référentiel.
      from: vi.fn((table: string) =>
        table === 'transporteurs' ? builderTransporteurs() : mockQuery,
      ),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
            tournees: {
              id: 'T1',
              external_ref_commande: 'MTS1-ORDER-001',
              tms_reference: 'MTS1-TOUR-001',
              statut: 'en_cours',
              prestataire_logistique_id: PRESTA_MTS1,
            },
          },
        ],
        error: null,
      }),
    };
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'transporteurs' ? builderTransporteurs() : mockQuery,
      ),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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

// ─── BL-P1-PROG-03 : informations_supplementaires → comment MTS-1 (§08 l.389) ──
describe('M1.5a / PROG-03 comment MTS-1', () => {
  afterEach(() => _setMts1Handlers(null));

  function setupHandlers() {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-C',
      externalReference: 'x',
      status: 'PLANNED',
      createdAt: '',
    });
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });
    return postOrder;
  }

  it('M1.5a / buildOrderPayload mappe informations_supplementaires vers comment MTS-1', async () => {
    const postOrder = setupHandlers();
    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      {
        ...COLLECTE_ZD,
        informations_supplementaires: 'Sonner interphone B au RDC',
      },
      1,
    );
    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(orderPayload['comment']).toBe('Sonner interphone B au RDC');
  });

  // ─── Commentaire au transporteur → `comment` MTS-1 (Val 2026-10-15) ─────────
  // Composé en amont par fetchCollecte (composerCommentaireTransporteur, partagé
  // avec Everest) ; ce test ferme le maillon aval : ce qui est composé atteint
  // le fil, dans `comment`, au format décidé par Val (C60) — sans « Véhicule
  // max » ni « Stationnement ».
  it('M1.5 / commentaire au transporteur : traiteur, pax, instructions d’accès, contacts, au format de Val, dans comment', async () => {
    const postOrder = setupHandlers();
    const supabase = makeMockSupabase({ tourneeExistante: null });
    const lieuAcces: Lieu = {
      ...LIEU_FIXTURE,
      acces_details: 'Quai n°2, sonner interphone B',
      stationnement: 'difficile',
      contraintes_horaires: 'Livraison avant 9h uniquement',
      acces_office: 'tres_difficile',
      type_vehicule_max: 'camionnette',
      flux_autorises: ['biodéchets', 'carton'],
    };
    const collecte: Collecte = {
      ...COLLECTE_ZD,
      lieu: lieuAcces,
      contact_secours_nom: 'Bruno Secours',
      contact_secours_telephone: '+33600000002',
    };

    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      {
        ...collecte,
        informations_supplementaires: composerCommentaireTransporteur({
          traiteurNom: 'Traiteur Essai',
          pax: 120,
          lieu: lieuAcces,
          informationsSupplementaires: 'Demander Karim à la plonge',
          contact: {
            nom: collecte.contact_principal_nom,
            telephone: collecte.contact_principal_telephone,
          },
          contactSecours: {
            nom: collecte.contact_secours_nom,
            telephone: collecte.contact_secours_telephone,
          },
          vehicule: null,
          livraison: null,
        }),
      },
      1,
    );

    const orderPayload = postOrder.mock.calls[0]![0] as {
      comment?: string;
      contact?: { phoneAlternatives?: string[] };
    };
    expect(orderPayload.comment).toBe(
      [
        'Traiteur : Traiteur Essai',
        'Nombre de pax : 120',
        "Instructions d'accès :",
        '- Accès : Quai n°2, sonner interphone B',
        '- Précisions du traiteur : Demander Karim à la plonge',
        '- Contraintes horaires : Livraison avant 9h uniquement',
        '- Accès office : très difficile',
        '- Flux acceptés : biodéchets, carton',
        `Contact : ${collecte.contact_principal_nom}, ${collecte.contact_principal_telephone}`,
        'Contact de secours : Bruno Secours, +33600000002',
      ].join('\n'),
    );
    // Le téléphone de secours part aussi nativement.
    expect(orderPayload.contact?.phoneAlternatives).toEqual(['+33600000002']);
  });

  it('M1.5a / buildOrderPayload sans informations_supplementaires — pas de comment', async () => {
    const postOrder = setupHandlers();
    const supabase = makeMockSupabase({ tourneeExistante: null });
    await new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(
      COLLECTE_ZD,
      1,
    );
    const orderPayload = postOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(orderPayload['comment']).toBeUndefined();
  });
});

// ─── Nom du point et contact de livraison (décisions Val 2026-10-15) ─────────
// MTS-1 affiche le numéro de commande comme nom du point (C59) ; le contact de
// livraison (« Contact livr. ») est celui de l'association quand son adresse part
// en clair (C62). Formes mesurées sur le compte de démonstration le 2026-10-15.

describe('M1.5a / nom du point et contact de livraison (Val 2026-10-15)', () => {
  afterEach(() => _setMts1Handlers(null));

  async function corpsCree(collecte: Collecte): Promise<{
    orderNumber: string;
    stuffs: Array<Record<string, unknown>>;
  }> {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-LIB',
      externalReference: '',
      status: 'DRAFT',
      createdAt: '',
    });
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      ...tourneeUnitaireSimulee(),
    });
    await new AdapterMts1(
      TRANSPORTEUR,
      makeMockSupabase({ tourneeExistante: null }),
    ).dispatchCollecte(collecte, 1);
    return postOrder.mock.calls[0]![0] as {
      orderNumber: string;
      stuffs: Array<Record<string, unknown>>;
    };
  }

  it('M1.5a/numero_commande_libelle — « Traiteur - Lieu - N pax · clé »', async () => {
    const corps = await corpsCree({
      ...COLLECTE_ZD,
      traiteur_nom: 'Traiteur Essai',
      pax: 120,
    });
    expect(corps.orderNumber).toBe(
      'Traiteur Essai - Salle Pleyel - 120 pax · col-zd-001-1',
    );
  });

  it('M1.5a/numero_commande_libelle_borne — traiteur et lieu repliés sur une ligne et bornés à 40 caractères chacun, pax absent ou nul omis', async () => {
    const corps = await corpsCree({
      ...COLLECTE_ZD,
      traiteur_nom: `Traiteur\nau nom ${'très '.repeat(10)}long`,
      pax: 0,
      lieu: { ...LIEU_FIXTURE, nom: `  Château\tde ${'l’Essai '.repeat(6)} ` },
    });
    const [libelle, cle] = corps.orderNumber.split(' · ');
    expect(cle).toBe('col-zd-001-1');
    const [traiteur, lieu, ...reste] = libelle!.split(' - ');
    expect(reste).toEqual([]);
    expect(traiteur).toBe(
      `${'Traiteur au nom très très très très très'.slice(0, 39)}…`,
    );
    expect(traiteur).toHaveLength(40);
    expect(lieu!.startsWith('Château de l’Essai')).toBe(true);
    expect(lieu!.length).toBeLessThanOrEqual(40);
    expect(corps.orderNumber).not.toMatch(/[\n\t]/);
  });

  it('M1.5a/numero_commande_sans_libelle — ni traiteur, ni lieu nommé, ni pax : le numéro est la clé seule', async () => {
    const corps = await corpsCree({
      ...COLLECTE_ZD,
      lieu: { ...LIEU_FIXTURE, nom: '   ' },
    });
    expect(corps.orderNumber).toBe('col-zd-001-1');
  });

  it('M1.5a/contact_livraison_association — AG, adresse de l’association en clair : son contact part en contact de livraison (relatedContact)', async () => {
    const corps = await corpsCree(COLLECTE_AG);
    expect(corps.stuffs[0]!['relatedContact']).toEqual({
      firstname: 'Nadia',
      lastname: 'Benali',
      phone: '+33699990001',
    });
  });

  it.each([
    [
      'AG, association lieu favori (placeId)',
      {
        ...COLLECTE_AG,
        association_id_point_collecte_mts1: 'PLACE_ASSO_FAVORI',
      } as Collecte,
    ],
    [
      'AG, association sans contact',
      {
        ...COLLECTE_AG,
        association_contact_nom: null,
        association_contact_telephone: null,
      } as Collecte,
    ],
  ])(
    'M1.5a/contact_livraison_absent — %s : aucun contact de livraison',
    async (_cas, collecte) => {
      const corps = await corpsCree(collecte);
      expect(corps.stuffs[0]).not.toHaveProperty('relatedContact');
    },
  );
});

describe('M1.5a / reconnaissance de la clé dans un numéro (numeroPorteLaCle)', () => {
  it.each([
    ['la clé seule (commande d’avant le 2026-10-15)', 'col-1-1', true],
    ['le libellé puis la clé', 'Traiteur - Lieu - 120 pax · col-1-1', true],
    [
      'un autre libellé puis la clé',
      'Autre - Ailleurs - 80 pax · col-1-1',
      true,
    ],
    ['la clé du rang 11', 'Traiteur - Lieu · col-1-11', false],
    ['la clé d’une tentative r2', 'Traiteur - Lieu · col-1-1-r2', false],
    ['la clé collée sans séparateur', 'Traiteur - Lieucol-1-1', false],
    ['la clé d’une autre collecte', 'Traiteur · autre-col-1-1', false],
  ])('M1.5a/numero_porte_la_cle — %s', (_cas, numero, attendu) => {
    expect(numeroPorteLaCle(numero, 'col-1-1')).toBe(attendu);
  });

  it('M1.5a/numero_porte_la_cle — un numéro qui n’est pas une chaîne ne porte aucune clé', () => {
    expect(numeroPorteLaCle(undefined, 'col-1-1')).toBe(false);
    expect(numeroPorteLaCle(42, 'col-1-1')).toBe(false);
  });
});
