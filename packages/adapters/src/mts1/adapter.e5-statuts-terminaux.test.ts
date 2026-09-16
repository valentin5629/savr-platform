// E5 `lieu.champ_critique_modifie` — seules les collectes NON TERMINALES du lieu
// reçoivent un PUT d'adresse.
//
// `realisee_sans_collecte` (AG « aucun repas ») est un état terminal au même
// titre que `realisee` (CDC §05 machine à états ; §04 `outbox_events`, extension
// events lieu : « collectes futures non terminales du lieu »). Il manquait au
// filtre : une collecte du jour déjà close recevait une nouvelle adresse chez
// MTS-1.
//
// Les mocks des tests E5 voisins servent le lot de collectes sans appliquer le
// `.not('statut', 'in', …)` — le filtre n'y est donc jamais sous test. Celui-ci
// applique réellement `eq` / `gte` / `not in` aux lignes, à la manière de
// PostgREST : retirer un statut de la liste fait partir le PUT correspondant.

import { jourParis } from '@savr/shared/src/temps/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Lieu, Transporteur } from '../index.js';
import { STATUTS_COLLECTE_TERMINAUX } from '../statuts-collecte.js';
import { AdapterMts1 } from './adapter.js';
import { _setMts1Handlers } from './mock.js';

const PRESTA_MTS1 = 'presta-strike-uuid';

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

const TRANSPORTEUR_MTS1: Transporteur = {
  id: 'transporteur-strike',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: PRESTA_MTS1,
};

/** Lecture d'un chemin pointé (`evenements.lieu_id`) sur une ligne embarquée. */
const lire = (row: unknown, chemin: string): unknown =>
  chemin
    .split('.')
    .reduce<unknown>(
      (acc, k) => (acc as Record<string, unknown> | undefined)?.[k],
      row,
    );

/** `(a,b,c)` PostgREST → ['a','b','c']. */
const listePostgrest = (v: string): string[] => {
  expect(v).toMatch(/^\(.*\)$/);
  return v.slice(1, -1).split(',');
};

/**
 * Builder thenable qui APPLIQUE les filtres reçus (`eq`, `gte`, `not in`) aux
 * lignes de la table, au lieu de les ignorer.
 */
function makeSupabase(
  tables: Record<string, unknown[]>,
): import('@supabase/supabase-js').SupabaseClient {
  const makeBuilder = (rows: unknown[]) => {
    const filtres: Array<(r: unknown) => boolean> = [];
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        filtres.push((r) => lire(r, col) === val);
        return builder;
      }),
      gte: vi.fn((col: string, val: string) => {
        filtres.push((r) => String(lire(r, col)) >= val);
        return builder;
      }),
      not: vi.fn((col: string, op: string, val: string) => {
        expect(op).toBe('in');
        const exclus = listePostgrest(val);
        filtres.push((r) => !exclus.includes(String(lire(r, col))));
        return builder;
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: rows.filter((r) => filtres.every((f) => f(r))),
          error: null,
        }),
    });
    return builder;
  };
  return {
    from: vi.fn((table: string) => makeBuilder(tables[table] ?? [])),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const collecte = (statut: string) => ({
  id: `col-${statut}`,
  statut,
  nb_camions_demande: 1,
  // Collecte DU JOUR : la borne `gte(date_collecte, jourParis())` la retient,
  // seul le statut peut l'écarter.
  date_collecte: jourParis(),
  heure_collecte: '22:00:00',
  type: 'anti_gaspi',
  controle_acces_requis: false,
  informations_supplementaires: null,
  lieu_overrides: null,
  evenements: { lieu_id: LIEU.id },
  collecte_tournees: [
    {
      tournee_id: `T-${statut}`,
      rang: 1,
      tournees: {
        id: `T-${statut}`,
        external_ref_commande: `ORDER-${statut}`,
        tms_reference: `TOUR-${statut}`,
        statut: 'en_cours',
        prestataire_logistique_id: PRESTA_MTS1,
      },
    },
  ],
});

function stubUpdateOrder(): ReturnType<typeof vi.fn> {
  const updateOrder = vi.fn().mockResolvedValue(undefined);
  _setMts1Handlers({
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder: vi.fn(),
    updateOrder,
  });
  return updateOrder;
}

const ordersAppeles = (updateOrder: ReturnType<typeof vi.fn>): unknown[] =>
  updateOrder.mock.calls.map((c) => c[0]);

describe('E5 updateLieu — les collectes terminales ne reçoivent aucun PUT', () => {
  afterEach(() => _setMts1Handlers(null));

  it('la liste des terminaux est exactement celle du CDC §05', () => {
    expect([...STATUTS_COLLECTE_TERMINAUX].sort()).toEqual(
      [
        'annulee',
        'cloturee',
        'realisee',
        'realisee_sans_collecte',
        'rejetee_par_prestataire',
      ].sort(),
    );
  });

  it("une collecte du jour `realisee_sans_collecte` ne reçoit pas l'adresse, une `en_cours` du même lieu si", async () => {
    const updateOrder = stubUpdateOrder();
    const supabase = makeSupabase({
      collectes: [collecte('realisee_sans_collecte'), collecte('en_cours')],
      transporteurs: [
        { prestataire_logistique_id: PRESTA_MTS1, type_tms: 'mts1' },
      ],
    });

    await new AdapterMts1(TRANSPORTEUR_MTS1, supabase).updateLieu(LIEU);

    // Non-vacuité : la collecte vivante est bien poussée — le lot n'est pas
    // vide pour une autre raison (lieu, date, provider).
    expect(ordersAppeles(updateOrder)).toEqual(['ORDER-en_cours']);
  });

  it.each(STATUTS_COLLECTE_TERMINAUX)(
    'statut terminal `%s` : aucun PUT',
    async (statut) => {
      const updateOrder = stubUpdateOrder();
      const supabase = makeSupabase({
        collectes: [collecte(statut)],
        transporteurs: [
          { prestataire_logistique_id: PRESTA_MTS1, type_tms: 'mts1' },
        ],
      });

      await new AdapterMts1(TRANSPORTEUR_MTS1, supabase).updateLieu(LIEU);

      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
});
