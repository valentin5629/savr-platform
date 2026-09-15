// Cloisonnement par provider côté Everest — symétrique de l'adapter MTS-1.
//
// `AdapterEverest.cancelCollecte` filtrait `avecRef` sur la seule présence de
// `external_ref_commande`, sans regarder le prestataire exécutant. Or cette
// colonne est PARTAGÉE : MTS-1 y stocke son customerOrderId. Une collecte AG
// passée d'un transporteur à l'autre (camion MTS-1 refusé → vélo cargo, ou
// l'inverse) traîne donc une tournée MTS-1 résiduelle, et l'annulation partait
// en `POST /missions/cancel { mission_id: "<customerOrderId MTS-1>" }`.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Collecte, Lieu, Transporteur } from '../index.js';
import { LogistiqueTransientError } from '../index.js';
import {
  PRESTA_EVEREST,
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterEverest } from './adapter.js';
import { _setEverestHandlers, setupEverestMock } from './mock.js';

const REF_EVEREST = 'EVEREST-MISSION-77';
const REF_MTS1 = 'MTS1-ORDER-42';

const LIEU: Lieu = {
  id: 'lieu-001',
  nom: 'Pavillon Gabriel',
  adresse_acces: '5 Avenue Gabriel',
  code_postal: '75008',
  ville: 'Paris',
  latitude: 48.87,
  longitude: 2.3,
  acces_details: null,
  type_vehicule_max: 'velo_cargo',
  contraintes_horaires: null,
};

const COLLECTE_AG: Collecte = {
  id: 'col-ag-redispatchee',
  type: 'anti_gaspi',
  date_collecte: '2026-07-15',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
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

const TRANSPORTEUR_EVEREST: Transporteur = {
  id: 'transporteur-atoutes',
  type_tms: 'a_toutes',
  code_transporteur_mts1: null,
  prestataire_logistique_id: PRESTA_EVEREST,
};

interface TourneeFixture {
  id: string;
  rang: number;
  external_ref_commande: string | null;
  statut: string;
  prestataire_logistique_id: string | null;
}

const TOURNEE_EVEREST: TourneeFixture = {
  id: 'T-everest',
  rang: 1,
  external_ref_commande: REF_EVEREST,
  statut: 'planifiee',
  prestataire_logistique_id: PRESTA_EVEREST,
};

/** Tournée laissée par un dispatch MTS-1 antérieur (camion refusé, puis vélo cargo). */
const TOURNEE_MTS1_RESIDUELLE: TourneeFixture = {
  id: 'T-mts1',
  rang: 2,
  external_ref_commande: REF_MTS1,
  statut: 'planifiee',
  prestataire_logistique_id: PRESTA_MTS1,
};

/**
 * Mock supabase routé PAR TABLE ; `transporteurs` sert le référentiel complet et
 * applique lui-même les `.eq()` (cf. mock-referentiel-transporteurs.ts).
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
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      // findMission : une mission active existe pour chaque tournée Everest.
      maybeSingle: vi.fn().mockResolvedValue({
        data:
          table === 'everest_missions'
            ? { id: 'em-001', statut_everest: 'created' }
            : null,
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

describe("E3 cancelCollecte Everest — un customerOrderId MTS-1 n'est jamais annulé chez Everest", () => {
  afterEach(() => _setEverestHandlers(null));

  it('seule une tournée MTS-1 résiduelle subsiste → no-op, aucun cancel', async () => {
    const { cancelledIds } = setupEverestMock();
    const { supabase } = makeSupabase([TOURNEE_MTS1_RESIDUELLE]);

    const consumer = await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabase,
    ).cancelCollecte(COLLECTE_AG);

    expect(consumer).toBe('noop_no_remote');
    expect(cancelledIds.size).toBe(0);
  });

  it('collecte mixte : seule la mission Everest est annulée', async () => {
    const { cancelledIds } = setupEverestMock();
    const { supabase } = makeSupabase([
      TOURNEE_EVEREST,
      TOURNEE_MTS1_RESIDUELLE,
    ]);

    await new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).cancelCollecte(
      COLLECTE_AG,
    );

    expect([...cancelledIds]).toEqual([REF_EVEREST]);
  });

  it('résiduelle MTS-1 encore vivante → alerte Ops in-app', async () => {
    setupEverestMock();
    const { supabase, rpc } = makeSupabase([
      TOURNEE_EVEREST,
      TOURNEE_MTS1_RESIDUELLE,
    ]);

    await new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).cancelCollecte(
      COLLECTE_AG,
    );

    const alertes = rpc.mock.calls.filter(
      ([fn]) => fn === 'f_upsert_alerte_admin',
    );
    expect(alertes).toHaveLength(1);
    expect(alertes[0]![1]).toMatchObject({
      p_code: 'tournee_autre_provider',
      p_entity_id: 'col-ag-redispatchee',
    });
  });

  it('une erreur de lecture lève au lieu de passer pour « aucune tournée »', async () => {
    const { cancelledIds } = setupEverestMock();
    const { supabase } = makeSupabase([TOURNEE_EVEREST], {
      erreurCollecteTournees: true,
    });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).cancelCollecte(
        COLLECTE_AG,
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);

    expect(cancelledIds.size).toBe(0);
  });
});
