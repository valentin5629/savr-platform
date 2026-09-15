// Cloisonnement par provider des tournées lues — E1 / E2 / E3 (suite de #313).
//
// LE DÉFAUT. `findTournee` / `findTournees` joignaient `collecte_tournees` à
// `tournees` SANS filtrer sur le prestataire exécutant. Une collecte dont
// `prestataire_logistique_id` désigne MTS-1 mais qui traîne une tournée Everest
// résiduelle — refus Everest puis re-dispatch vers MTS-1 : la colonne de la
// collecte change, les tournées déjà créées restent — voyait donc
// `updateCollecte` appeler `PUT /v3/customerOrders/{id_mission_everest}` et
// `cancelCollecte` un `DELETE` sur ce même identifiant. #313 n'avait fermé
// cette classe de fuite que sur `updateLieu` (E5) ; `findTournees` est commun à
// E1, E2 et E3.
//
// `external_ref_commande` ne dit PAS quel provider a dispatché : l'adapter
// Everest y stocke son id de mission exactement comme MTS-1 son customerOrderId.
// Seul `tournees.prestataire_logistique_id`, résolu par `transporteurs.type_tms`,
// tranche.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Collecte, Lieu, Transporteur } from '../index.js';
import { LogistiqueTransientError } from '../index.js';
import {
  PRESTA_EVEREST,
  PRESTA_MTS1,
  PRESTA_MTS1_BIS,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import { _setMts1Handlers } from './mock.js';

const REF_MTS1 = 'MTS1-ORDER-42';
const REF_EVEREST = 'EVEREST-MISSION-77';

const LIEU: Lieu = {
  id: 'lieu-001',
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

function collecte(nbCamions = 1): Collecte {
  return {
    id: 'col-redispatchee',
    type: 'zero_dechet',
    date_collecte: '2026-07-15',
    heure_collecte: '22:00:00',
    nb_camions_demande: nbCamions,
    statut_tms: 'acceptee',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    contact_principal_nom: 'Alice',
    contact_principal_telephone: '+33600000001',
    contact_secours_nom: null,
    contact_secours_telephone: null,
    lieu: LIEU,
  };
}

const TRANSPORTEUR_STRIKE: Transporteur = {
  id: 'transporteur-strike',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: PRESTA_MTS1,
};

interface TourneeFixture {
  id: string;
  rang: number;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
  prestataire_logistique_id: string | null;
}

function tourneeMts1(over: Partial<TourneeFixture> = {}): TourneeFixture {
  return {
    id: 'T-mts1',
    rang: 1,
    external_ref_commande: REF_MTS1,
    tms_reference: 'MTS1-TOUR-42',
    statut: 'en_cours',
    prestataire_logistique_id: PRESTA_MTS1,
    ...over,
  };
}

/** Tournée laissée par un dispatch Everest antérieur (course refusée, puis re-dispatch). */
function tourneeEverest(over: Partial<TourneeFixture> = {}): TourneeFixture {
  return {
    id: 'T-everest',
    rang: 1,
    external_ref_commande: REF_EVEREST,
    // Everest n'a pas de notion de tour : la colonne reste NULL.
    tms_reference: null,
    statut: 'planifiee',
    prestataire_logistique_id: PRESTA_EVEREST,
    ...over,
  };
}

/**
 * Mock supabase routé PAR TABLE.
 *
 * `transporteurs` sert le référentiel COMPLET et applique lui-même les `.eq()`
 * reçus (cf. mock-referentiel-transporteurs.ts) : un mock qui servirait une
 * liste déjà filtrée laisserait passer la suppression du `.eq('type_tms', …)`
 * avec une CI verte.
 */
function makeSupabase(
  tournees: TourneeFixture[],
  opts: { erreurCollecteTournees?: boolean } = {},
) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  const builder = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    const chain = () => self;
    Object.assign(self, {
      select: vi.fn(chain),
      eq: vi.fn(chain),
      update: vi.fn(chain),
      upsert: vi.fn(chain),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn(chain),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'T-mts1-neuve',
          external_ref_commande: 'MTS1-ORDER-NEUVE',
          tms_reference: null,
          statut: 'planifiee',
          prestataire_logistique_id: PRESTA_MTS1,
        },
        error: null,
      }),
      then: (resolve: (v: unknown) => void) => {
        if (table === 'collecte_tournees') {
          if (opts.erreurCollecteTournees) {
            return resolve({
              data: null,
              error: { message: 'connexion interrompue' },
            });
          }
          // FK sortante `collecte_tournees.tournee_id` → embed OBJET.
          return resolve({
            data: tournees.map((t) => ({ rang: t.rang, tournees: t })),
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

  return { supabase, rpc };
}

function stubHandlers() {
  const updateOrder = vi.fn().mockResolvedValue(undefined);
  const deleteOrder = vi.fn().mockResolvedValue(undefined);
  const postOrder = vi.fn().mockResolvedValue({
    ok: true,
    id: 'MTS1-ORDER-NEUVE',
    externalReference: 'col-redispatchee-1',
    status: 'DRAFT',
    createdAt: '2026-07-14T10:00:00Z',
  });
  const createTour = vi.fn().mockResolvedValue({
    tourId: 'MTS1-TOUR-NEUF',
    externalReference: 'col-redispatchee-1',
    status: 'DRAFT',
    createdAt: '2026-07-14T10:00:00Z',
    customerOrderId: 'MTS1-ORDER-NEUVE',
  });
  const addCustomerOrder = vi.fn().mockResolvedValue(undefined);
  const dispatchTour = vi.fn().mockResolvedValue(undefined);
  const validateTour = vi.fn().mockResolvedValue(undefined);
  _setMts1Handlers({
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder,
    updateOrder,
    deleteOrder,
    createTour,
    addCustomerOrder,
    dispatchTour,
    validateTour,
  });
  return {
    updateOrder,
    deleteOrder,
    postOrder,
    createTour,
    addCustomerOrder,
    dispatchTour,
    validateTour,
  };
}

/** Tous les identifiants passés au client MTS-1, quel que soit l'appel. */
function refsTransmises(handlers: Record<string, ReturnType<typeof vi.fn>>) {
  return Object.values(handlers).flatMap((h) =>
    h.mock.calls.flatMap((args) => args.filter((a) => typeof a === 'string')),
  );
}

describe('E3 cancelCollecte — une tournée Everest résiduelle ne part jamais chez MTS-1', () => {
  afterEach(() => _setMts1Handlers(null));

  it('collecte re-dispatchée : seule la tournée Everest subsiste → no-op, aucun DELETE', async () => {
    // AVANT le correctif : `avecRef` retenait la tournée Everest (elle porte une
    // référence) et l'annulation partait en
    // `DELETE /v3/customerOrders/EVEREST-MISSION-77`.
    const h = stubHandlers();
    const { supabase } = makeSupabase([tourneeEverest()]);

    const consumer = await new AdapterMts1(
      TRANSPORTEUR_STRIKE,
      supabase,
    ).cancelCollecte(collecte());

    expect(consumer).toBe('noop_no_remote');
    expect(h.deleteOrder).not.toHaveBeenCalled();
    expect(refsTransmises(h)).not.toContain(REF_EVEREST);
  });

  it('collecte mixte : le DELETE ne porte que sur la commande MTS-1', async () => {
    const h = stubHandlers();
    const { supabase } = makeSupabase([
      tourneeMts1(),
      tourneeEverest({ rang: 2 }),
    ]);

    await new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).cancelCollecte(
      collecte(2),
    );

    expect(h.deleteOrder.mock.calls.map((c) => c[0])).toEqual([REF_MTS1]);
  });

  it('un autre transporteur MTS-1 que celui de l’instance reste servi', async () => {
    // Le worker instancie l'adapter avec « n'importe quel » transporteur mts1
    // (`.limit(1)`) : le filtre porte sur le TYPE, pas sur le prestataire de
    // l'instance — sinon Marathon serait muet dès que le worker tire Strike.
    const h = stubHandlers();
    const { supabase } = makeSupabase([
      tourneeMts1({
        id: 'T-marathon',
        external_ref_commande: 'MTS1-ORDER-MARATHON',
        prestataire_logistique_id: PRESTA_MTS1_BIS,
      }),
    ]);

    await new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).cancelCollecte(
      collecte(),
    );

    expect(h.deleteOrder.mock.calls.map((c) => c[0])).toEqual([
      'MTS1-ORDER-MARATHON',
    ]);
  });
});

describe('E2 updateCollecte — le PUT ne porte que sur les commandes MTS-1', () => {
  afterEach(() => _setMts1Handlers(null));

  it('seule une tournée Everest subsiste → no-op, aucun PUT', async () => {
    const h = stubHandlers();
    const { supabase } = makeSupabase([tourneeEverest()]);

    const consumer = await new AdapterMts1(
      TRANSPORTEUR_STRIKE,
      supabase,
    ).updateCollecte(collecte());

    expect(consumer).toBe('noop_no_remote');
    expect(h.updateOrder).not.toHaveBeenCalled();
    expect(refsTransmises(h)).not.toContain(REF_EVEREST);
  });

  it('collecte mixte : PUT sur la commande MTS-1 seule, la tournée Everest n’est ni modifiée ni supprimée', async () => {
    const h = stubHandlers();
    // N=1 : la tournée Everest est au rang 2 — sans filtre elle serait vue comme
    // un rang excédentaire et `deleteTourneeRang` enverrait un DELETE MTS-1 sur
    // l'identifiant de mission Everest, puis purgerait la tournée en base.
    const { supabase } = makeSupabase([
      tourneeMts1(),
      tourneeEverest({ rang: 2 }),
    ]);

    await new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).updateCollecte(
      collecte(1),
    );

    expect(h.updateOrder.mock.calls.map((c) => c[0])).toEqual([REF_MTS1]);
    expect(h.deleteOrder).not.toHaveBeenCalled();
    expect(refsTransmises(h)).not.toContain(REF_EVEREST);
  });
});

describe('E1 dispatchCollecte — une tournée Everest résiduelle ne sert pas de curseur', () => {
  afterEach(() => _setMts1Handlers(null));

  it('le rang occupé par une tournée Everest est dispatché chez MTS-1 avec une commande neuve', async () => {
    // AVANT : la tournée Everest du rang 1 faisait office de curseur de reprise
    // (`external_ref_commande` présent) → aucun `POST /v3/customerOrders`, et le
    // tour MTS-1 se voyait rattacher l'identifiant de mission Everest.
    const h = stubHandlers();
    const { supabase } = makeSupabase([tourneeEverest()]);

    await new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).dispatchCollecte(
      collecte(),
      1,
    );

    expect(h.postOrder).toHaveBeenCalledOnce();
    expect(h.addCustomerOrder.mock.calls[0]).toContain('MTS1-ORDER-NEUVE');
    expect(refsTransmises(h)).not.toContain(REF_EVEREST);
  });
});

describe('tournée résiduelle : écartée en silence, ou alerte Ops', () => {
  afterEach(() => _setMts1Handlers(null));

  const alertes = (rpc: ReturnType<typeof vi.fn>) =>
    rpc.mock.calls.filter(([fn]) => fn === 'f_upsert_alerte_admin');

  it('résiduelle encore vivante → alerte Ops in-app sur la collecte', async () => {
    // Ignorer en silence laisserait une commande courir chez l'autre
    // transporteur : personne n'annule la mission Everest de la collecte
    // annulée, et le vélo cargo se présente.
    stubHandlers();
    const { supabase, rpc } = makeSupabase([tourneeEverest()]);

    await new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).cancelCollecte(
      collecte(),
    );

    expect(alertes(rpc)).toHaveLength(1);
    expect(alertes(rpc)[0]![1]).toMatchObject({
      p_code: 'tournee_autre_provider',
      p_entity_type: 'collectes',
      p_entity_id: 'col-redispatchee',
    });
  });

  it('résiduelle déjà annulée → écartée en silence, aucune alerte', async () => {
    // Plus rien ne peut être vivant chez l'autre provider : alerter ici ne
    // ferait que du bruit à chaque event de la collecte.
    stubHandlers();
    const { supabase, rpc } = makeSupabase([
      tourneeMts1(),
      tourneeEverest({ rang: 2, statut: 'annulee' }),
    ]);

    await new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).cancelCollecte(
      collecte(2),
    );

    expect(alertes(rpc)).toHaveLength(0);
  });

  it('résiduelle sans référence de commande → écartée en silence, aucune alerte', async () => {
    stubHandlers();
    const { supabase, rpc } = makeSupabase([
      tourneeMts1(),
      tourneeEverest({ rang: 2, external_ref_commande: null }),
    ]);

    await new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).cancelCollecte(
      collecte(2),
    );

    expect(alertes(rpc)).toHaveLength(0);
  });
});

describe('lecture des tournées en échec', () => {
  afterEach(() => _setMts1Handlers(null));

  it('une erreur PostgREST lève au lieu de passer pour « aucune tournée »', async () => {
    // Sans ce throw, l'event serait marqué `done` : E1 re-POSTerait un
    // customerOrder déjà créé (MTS-1 présumé NON idempotent), E2/E3 sortiraient
    // en `noop_no_remote` sur une collecte pourtant dispatchée.
    const h = stubHandlers();
    const { supabase } = makeSupabase([tourneeMts1()], {
      erreurCollecteTournees: true,
    });

    await expect(
      new AdapterMts1(TRANSPORTEUR_STRIKE, supabase).cancelCollecte(collecte()),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);

    expect(h.deleteOrder).not.toHaveBeenCalled();
  });
});
