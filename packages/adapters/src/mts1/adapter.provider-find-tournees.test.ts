// Cloisonnement par provider des lectures de tournées — E1 / E2 / E3.
//
// POURQUOI CE FICHIER
// `tournees.external_ref_commande` est PARTAGÉE entre providers : l'adapter
// MTS-1 y stocke un customerOrderId, l'adapter Everest un id de mission
// (everest/adapter.ts, garde-fou 5). Une collecte peut changer de provider en
// cours de vie — une AG dispatchée Everest puis refusée retombe `programmee`
// (« retour file d'attente + monitoring Ops ») et Ops la re-dispatche vers
// Strike ou Marathon. Le rang pointe alors encore la tournée EVEREST.
//
// Sans cloisonnement, les trois chemins sortants MTS-1 lisent cette tournée :
//   E1 — `tms_reference` est null (Everest ne l'écrit jamais) donc pas de
//        no-op : un tourId MTS-1 serait écrit SUR la ligne Everest, puis l'id
//        de mission Everest partirait en `addCustomerOrderToTour` → 404 →
//        `LogistiquePermanentError` → E1 en DLQ, collecte JAMAIS dispatchée ;
//   E2 — un `PUT /v3/customerOrders/{id_mission_everest}` ;
//   E3 — un `DELETE` sur ce même identifiant ;
//   et la réduction de N supprimerait la tournée d'un provider tiers.
//
// Le filtre est porté par `findTournee`/`findTournees`, pas répété chez les
// appelants : un handler ajouté plus tard en hérite.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Collecte, Lieu, Transporteur } from '../index.js';
import { LogistiqueTransientError } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import { _setMts1Handlers } from './mock.js';
import {
  PRESTA_EVEREST,
  PRESTA_MTS1,
  PRESTA_MTS1_BIS,
  builderTransporteurs,
} from '../testing/transporteurs.js';

const LIEU: Lieu = {
  id: 'lieu-1',
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

const COLLECTE: Collecte = {
  id: 'col-1',
  type: 'anti_gaspi',
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
  lieu: LIEU,
};

// L'adapter tourne pour Strike ; Marathon (PRESTA_MTS1_BIS) est l'AUTRE
// transporteur MTS-1 du référentiel.
const STRIKE: Transporteur = {
  id: 'transp-strike',
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
  // `undefined` modélise la colonne absente du `select` — cf. le cas fail-closed.
  prestataire_logistique_id?: string | null;
}

/** Tournée Everest : son `external_ref_commande` est un id de MISSION. */
function tourneeEverest(rang = 1): TourneeFixture {
  return {
    id: `T-EVR-${rang}`,
    rang,
    external_ref_commande: `EVR-MISSION-${rang}`,
    tms_reference: null,
    statut: 'planifiee',
    prestataire_logistique_id: PRESTA_EVEREST,
  };
}

function tourneeMts1(
  rang = 1,
  prestataire: string = PRESTA_MTS1,
): TourneeFixture {
  return {
    id: `T-MTS1-${rang}`,
    rang,
    external_ref_commande: `MTS1-ORDER-${rang}`,
    tms_reference: `MTS1-TOUR-${rang}`,
    statut: 'en_cours',
    prestataire_logistique_id: prestataire,
  };
}

/**
 * Mock Supabase routé PAR TABLE. `transporteurs` sert le référentiel COMPLET et
 * applique lui-même les `.eq()` reçus : une liste pré-filtrée ne prouverait que
 * « l'adapter consulte un Set », jamais que ce Set est celui des transporteurs
 * MTS-1.
 */
function makeSupabase(
  tournees: TourneeFixture[],
  opts: { erreurLectureTournees?: { code?: string; message: string } } = {},
) {
  const upserts: Array<{ table: string; payload: unknown }> = [];
  const deletes: string[] = [];
  let table = '';

  const resultatTournees = opts.erreurLectureTournees
    ? { data: null, error: opts.erreurLectureTournees }
    : {
        data: tournees.map((t) => ({ rang: t.rang, tournees: t })),
        error: null,
      };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    update: vi.fn(chain),
    delete: vi.fn(() => {
      deletes.push(table);
      return builder;
    }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn((payload: unknown) => {
      upserts.push({ table, payload });
      return builder;
    }),
    maybeSingle: vi.fn(async () => {
      if (table !== 'collecte_tournees') return { data: null, error: null };
      if (opts.erreurLectureTournees) {
        return { data: null, error: opts.erreurLectureTournees };
      }
      const t = tournees[0];
      return { data: t ? { rang: t.rang, tournees: t } : null, error: null };
    }),
    single: vi.fn(async () => ({
      data: {
        id: 'T-MTS1-NEUVE',
        external_ref_commande: 'MTS1-ORDER-NEUF',
        tms_reference: null,
        statut: 'planifiee',
      },
      error: null,
    })),
    then: (resolve: (v: unknown) => void) =>
      resolve(
        table === 'collecte_tournees'
          ? resultatTournees
          : { data: null, error: null },
      ),
  });

  const supabase = {
    from: vi.fn((t: string) => {
      table = t;
      return t === 'transporteurs'
        ? builderTransporteurs([
            { type_tms: 'mts1', prestataire_logistique_id: PRESTA_MTS1 },
          ])
        : builder;
    }),
  } as unknown as SupabaseClient;

  return { supabase, upserts, deletes };
}

afterEach(() => _setMts1Handlers(null));

describe('E1 dispatchCollecte — une tournée Everest n’est jamais reprise', () => {
  it('le rang occupé par une tournée Everest ne fournit ni son id de mission ni sa ligne : E1 commande sa propre tournée', async () => {
    const postOrder = vi.fn().mockResolvedValue({
      ok: true,
      id: 'MTS1-ORDER-NEUF',
      externalReference: 'col-1-1',
      status: 'PLANNED',
      createdAt: '',
    });
    const createTour = vi.fn().mockResolvedValue({
      tourId: 'MTS1-TOUR-NEUF',
      externalReference: 'col-1-1',
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'MTS1-ORDER-NEUF',
    });
    const addCustomerOrder = vi.fn().mockResolvedValue(undefined);

    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour,
      addCustomerOrder,
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
    });

    const { supabase } = makeSupabase([tourneeEverest(1)]);
    await new AdapterMts1(STRIKE, supabase).dispatchCollecte(COLLECTE, 1);

    // Le cœur du défaut : l'identifiant transmis à MTS-1 ne doit JAMAIS être
    // celui de la mission Everest (sinon 404 → DLQ, collecte non dispatchée).
    expect(addCustomerOrder).toHaveBeenCalledTimes(1);
    expect(addCustomerOrder.mock.calls[0]![1]).toBe('MTS1-ORDER-NEUF');
    expect(addCustomerOrder.mock.calls[0]![1]).not.toBe('EVR-MISSION-1');
    // La commande MTS-1 a bien été créée : la tournée Everest n'a pas servi de
    // curseur de reprise.
    expect(postOrder).toHaveBeenCalledTimes(1);
  });

  it('une tournée MTS-1 déjà menée à terme reste un no-op (le filtre ne casse pas l’idempotence)', async () => {
    const postOrder = vi.fn();
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour: vi.fn(),
      addCustomerOrder: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
    });

    const { supabase } = makeSupabase([tourneeMts1(1)]);
    const consumer = await new AdapterMts1(STRIKE, supabase).dispatchCollecte(
      COLLECTE,
      1,
    );

    expect(consumer).toBe('adapter_mts1');
    expect(postOrder).not.toHaveBeenCalled();
  });
});

describe('E2 updateCollecte / E3 cancelCollecte — cloisonnement', () => {
  it('E2 — aucune tournée MTS-1 : no-op succès, jamais de PUT sur une mission Everest', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      createTour: vi.fn(),
      addCustomerOrder: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
      updateOrder,
    });

    const { supabase } = makeSupabase([tourneeEverest(1)]);
    const consumer = await new AdapterMts1(STRIKE, supabase).updateCollecte({
      ...COLLECTE,
      nb_camions_demande: 0,
    });

    expect(consumer).toBe('noop_no_remote');
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('E3 — aucune tournée MTS-1 : no-op succès, jamais de DELETE sur une mission Everest', async () => {
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    const { supabase } = makeSupabase([tourneeEverest(1)]);
    const consumer = await new AdapterMts1(STRIKE, supabase).cancelCollecte(
      COLLECTE,
    );

    expect(consumer).toBe('noop_no_remote');
    expect(deleteOrder).not.toHaveBeenCalled();
  });

  it('E3 — lot mixte : seule la commande MTS-1 est annulée', async () => {
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    const { supabase } = makeSupabase([tourneeMts1(1), tourneeEverest(2)]);
    await new AdapterMts1(STRIKE, supabase).cancelCollecte(COLLECTE);

    expect(deleteOrder.mock.calls.map((c) => c[0])).toEqual(['MTS1-ORDER-1']);
  });

  it('E2 — les DEUX transporteurs MTS-1 sont servis, pas seulement celui de l’instance', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      createTour: vi.fn(),
      addCustomerOrder: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
      updateOrder,
    });

    // Le worker tire UN transporteur MTS-1 avec son `.limit(1)` : filtrer sur
    // `this.transporteur` rendrait Marathon muet dès que Strike est tiré.
    const { supabase } = makeSupabase([
      tourneeMts1(1, PRESTA_MTS1),
      tourneeMts1(2, PRESTA_MTS1_BIS),
    ]);
    await new AdapterMts1(STRIKE, supabase).updateCollecte({
      ...COLLECTE,
      nb_camions_demande: 2,
    });

    expect(updateOrder.mock.calls.map((c) => c[0])).toEqual([
      'MTS1-ORDER-1',
      'MTS1-ORDER-2',
    ]);
  });

  it('E2 réduction de N — la tournée d’un autre provider n’est jamais supprimée', async () => {
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      createTour: vi.fn(),
      addCustomerOrder: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
      updateOrder,
      deleteOrder,
    });

    // N passe à 1 : le rang 2 est « au-delà de N ». Il appartient à Everest —
    // `deleteTourneeRang` ne doit ni l'annuler ni purger ses lignes DB.
    const { supabase, deletes } = makeSupabase([
      tourneeMts1(1),
      tourneeEverest(2),
    ]);
    await new AdapterMts1(STRIKE, supabase).updateCollecte({
      ...COLLECTE,
      nb_camions_demande: 1,
    });

    expect(deleteOrder).not.toHaveBeenCalled();
    expect(deletes).toEqual([]);
  });
});

describe('robustesse du prédicat', () => {
  it('colonne `prestataire_logistique_id` absente du select → tournée écartée (fail-closed)', async () => {
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    // `undefined` (et non `null`) : c'est ce que remonte une colonne oubliée du
    // `select`. Un test de nullité la laisserait passer.
    const sansProvider: TourneeFixture = {
      id: 'T-X',
      rang: 1,
      external_ref_commande: 'ORDER-X',
      tms_reference: 'TOUR-X',
      statut: 'en_cours',
    };
    const { supabase } = makeSupabase([sansProvider]);
    const consumer = await new AdapterMts1(STRIKE, supabase).cancelCollecte(
      COLLECTE,
    );

    expect(consumer).toBe('noop_no_remote');
    expect(deleteOrder).not.toHaveBeenCalled();
  });

  it('E3 — une erreur de lecture lève un Transient, jamais un « rien à annuler »', async () => {
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    const { supabase } = makeSupabase([tourneeMts1(1)], {
      erreurLectureTournees: { message: 'connexion perdue' },
    });

    // Rendre un lot vide ferait marquer l'event `done` sur `noop_no_remote` :
    // « rien à annuler » alors que le camion est commandé — sans retry, sans
    // alerte, et le camion se présente.
    await expect(
      new AdapterMts1(STRIKE, supabase).cancelCollecte(COLLECTE),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    expect(deleteOrder).not.toHaveBeenCalled();
  });

  it('E1 — une erreur de lecture lève un Transient, jamais un re-POST de commande', async () => {
    const postOrder = vi.fn();
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder,
      createTour: vi.fn(),
      addCustomerOrder: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
    });

    const { supabase } = makeSupabase([tourneeMts1(1)], {
      erreurLectureTournees: { message: 'connexion perdue' },
    });

    // Rendre `null` ferait repartir E1 sur un POST /v3/customerOrders alors que
    // la commande existe : sur une API présumée NON idempotente (CLAUDE.md §2),
    // c'est un second camion commandé.
    await expect(
      new AdapterMts1(STRIKE, supabase).dispatchCollecte(COLLECTE, 1),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    expect(postOrder).not.toHaveBeenCalled();
  });
});
