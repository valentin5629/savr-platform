// E5 `lieu.champ_critique_modifie` × `collectes.lieu_overrides`.
//
// §05 R_lieu_modif_pending point 4 : le snapshot lieu d'une collecte qui porte un
// override est FIGÉ. Une édition ultérieure du lieu officiel par l'Admin ne doit
// pas re-propager sur les champs surchargés — sinon la correction saisie par le
// traiteur est silencieusement écrasée par l'adresse de référence, et le camion
// repart au mauvais endroit, de nuit.
//
// Le figeage est PAR CHAMP : un override d'`adresse_acces` ne fige pas la
// propagation d'un `code_postal` corrigé au référentiel.
//
// Couvre le dernier volet du scénario `lieu_override_sans_update_referentiel`
// (specs/cdc/… tests/06.01-formulaire-programmation-scenarios.md), jusqu'ici
// non testé.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Lieu, Transporteur } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import { _setMts1Handlers } from './mock.js';

// Le lieu officiel APRÈS l'édition Admin : l'adresse et le code postal ont changé.
const LIEU_OFFICIEL_EDITE: Lieu = {
  id: 'lieu-001',
  nom: 'Pavillon Gabriel',
  adresse_acces: '5 Avenue Gabriel',
  code_postal: '75009',
  ville: 'Paris',
  latitude: 48.87,
  longitude: 2.3,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

const TRANSPORTEUR: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

interface CollecteFixture {
  id: string;
  lieu_overrides: Record<string, unknown> | null;
}

// Mock supabase : le builder est thenable → `await from().select().eq().gte().not()`
// résout vers les collectes du lieu. `insert` sert aux logs integrations_logs.
function makeSupabase(
  collectes: CollecteFixture[],
): import('@supabase/supabase-js').SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    gte: vi.fn(chain),
    not: vi.fn(chain),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: collectes.map((c) => ({
          id: c.id,
          nb_camions_demande: 1,
          date_collecte: '2026-07-15',
          heure_collecte: '22:00:00',
          type: 'zero_dechet',
          controle_acces_requis: false,
          informations_supplementaires: null,
          lieu_overrides: c.lieu_overrides,
          collecte_tournees: [
            {
              tournee_id: `T-${c.id}`,
              rang: 1,
              tournees: [
                {
                  id: `T-${c.id}`,
                  external_ref_commande: `MTS1-ORDER-${c.id}`,
                  tms_reference: `MTS1-TOUR-${c.id}`,
                  statut: 'en_cours',
                },
              ],
            },
          ],
        })),
        error: null,
      }),
  });
  return {
    from: vi.fn(() => builder),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

function adresseTransmise(
  updateOrder: ReturnType<typeof vi.fn>,
  orderId: string,
): string | undefined {
  const call = updateOrder.mock.calls.find((c) => c[0] === orderId);
  if (!call) return undefined;
  const payload = call[1] as {
    place: { address: { addressSingleLine: string } };
  };
  return payload.place.address.addressSingleLine;
}

describe('E5 updateLieu — snapshot figé par champ surchargé (R_lieu_modif_pending §4)', () => {
  afterEach(() => _setMts1Handlers(null));

  it('un override d’adresse_acces survit à l’édition Admin, mais le code postal officiel se propage', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    const supabase = makeSupabase([
      {
        id: 'col-override',
        lieu_overrides: {
          adresse_acces: 'Entrée livraisons, sonner interphone Cuisine',
        },
      },
    ]);

    await new AdapterMts1(TRANSPORTEUR, supabase).updateLieu(
      LIEU_OFFICIEL_EDITE,
    );

    const adresse = adresseTransmise(updateOrder, 'MTS1-ORDER-col-override');
    // Le champ surchargé reste celui du traiteur…
    expect(adresse).toContain('Entrée livraisons, sonner interphone Cuisine');
    expect(adresse).not.toContain('5 Avenue Gabriel');
    // …et le champ NON surchargé porte bien la nouvelle valeur officielle
    // (granularité par champ : l'override d'adresse ne fige pas le code postal).
    expect(adresse).toContain('75009');
  });

  it('une collecte dont toute l’adresse est surchargée ne reçoit aucun PUT', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    const supabase = makeSupabase([
      {
        id: 'col-fige',
        lieu_overrides: {
          adresse_acces: 'Entrée livraisons',
          code_postal: '75008',
          ville: 'Paris',
        },
      },
    ]);

    await new AdapterMts1(TRANSPORTEUR, supabase).updateLieu(
      LIEU_OFFICIEL_EDITE,
    );

    // Rien de neuf à propager : l'adresse recomposée est celle déjà transmise en E1.
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('2 champs d’adresse sur 3 surchargés : le troisième se propage encore', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    const supabase = makeSupabase([
      {
        id: 'col-partiel',
        lieu_overrides: {
          adresse_acces: 'Entrée livraisons',
          ville: 'Levallois',
        },
      },
    ]);

    await new AdapterMts1(TRANSPORTEUR, supabase).updateLieu(
      LIEU_OFFICIEL_EDITE,
    );

    // Le cas intermédiaire entre « rien de surchargé » et « adresse figée » :
    // le PUT part quand même, et seul le code postal officiel change.
    expect(adresseTransmise(updateOrder, 'MTS1-ORDER-col-partiel')).toBe(
      'Entrée livraisons, 75009 Levallois',
    );
  });

  it('une collecte sans override reçoit l’adresse officielle éditée en entier', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    const supabase = makeSupabase([{ id: 'col-nue', lieu_overrides: null }]);

    await new AdapterMts1(TRANSPORTEUR, supabase).updateLieu(
      LIEU_OFFICIEL_EDITE,
    );

    expect(adresseTransmise(updateOrder, 'MTS1-ORDER-col-nue')).toBe(
      '5 Avenue Gabriel, 75009 Paris',
    );
  });

  it('collectes mixtes sur le même lieu : chacune reçoit sa propre adresse', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    const supabase = makeSupabase([
      { id: 'col-nue', lieu_overrides: null },
      {
        id: 'col-override',
        lieu_overrides: { adresse_acces: 'Entrée livraisons' },
      },
      // Un null d'override n'est pas une surcharge : le champ officiel passe.
      { id: 'col-null', lieu_overrides: { adresse_acces: null } },
    ]);

    await new AdapterMts1(TRANSPORTEUR, supabase).updateLieu(
      LIEU_OFFICIEL_EDITE,
    );

    expect(adresseTransmise(updateOrder, 'MTS1-ORDER-col-nue')).toBe(
      '5 Avenue Gabriel, 75009 Paris',
    );
    expect(adresseTransmise(updateOrder, 'MTS1-ORDER-col-override')).toBe(
      'Entrée livraisons, 75009 Paris',
    );
    expect(adresseTransmise(updateOrder, 'MTS1-ORDER-col-null')).toBe(
      '5 Avenue Gabriel, 75009 Paris',
    );
  });
});
