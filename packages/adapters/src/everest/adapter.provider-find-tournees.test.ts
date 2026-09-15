// Cloisonnement par provider côté Everest — miroir de mts1/adapter.provider-find-tournees.
//
// `tournees.external_ref_commande` est partagée : une collecte d'abord
// dispatchée MTS-1 puis ré-attribuée à A Toutes! porte, sur son rang, une
// tournée MTS-1 dont cette colonne contient un customerOrderId. Sans filtre,
// `cancelCollecte` l'enverrait en `cancelMission` — l'identifiant d'un autre
// prestataire divulgué à Everest.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Collecte, Lieu, Transporteur } from '../index.js';
import { LogistiqueTransientError } from '../index.js';
import { AdapterEverest } from './adapter.js';
import { _setEverestHandlers, setupEverestMock } from './mock.js';
import {
  PRESTA_EVEREST,
  PRESTA_MTS1,
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
  type_vehicule_max: 'velo_cargo',
  contraintes_horaires: null,
};

const COLLECTE: Collecte = {
  id: 'col-ag-1',
  type: 'anti_gaspi',
  date_collecte: '2026-07-15',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  statut_tms: 'attribuee_en_attente_acceptation',
  controle_acces_requis: false,
  informations_supplementaires: null,
  notes_internes: null,
  contact_principal_nom: 'Alice Martin',
  contact_principal_telephone: '+33600000001',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  lieu: LIEU,
};

const A_TOUTES: Transporteur = {
  id: 'transp-a-toutes',
  type_tms: 'a_toutes',
  code_transporteur_mts1: null,
  prestataire_logistique_id: PRESTA_EVEREST,
};

interface TourneeFixture {
  id: string;
  rang: number;
  external_ref_commande: string | null;
  statut: string;
  prestataire_logistique_id?: string | null;
}

function makeSupabase(
  tournees: TourneeFixture[],
  opts: {
    erreurLectureTournees?: { message: string };
    erreurReferentiel?: { message: string };
  } = {},
) {
  let table = '';
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    update: vi.fn(chain),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn(async () => {
      if (table === 'everest_missions') {
        // Aucune ligne : c'est précisément le cas d'une tournée d'un AUTRE
        // provider — et sans filtre, l'adapter poursuivait quand même.
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }),
    single: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: (v: unknown) => void) => {
      if (table !== 'collecte_tournees') {
        return resolve({ data: null, error: null });
      }
      if (opts.erreurLectureTournees) {
        return resolve({ data: null, error: opts.erreurLectureTournees });
      }
      return resolve({
        data: tournees.map((t) => ({ rang: t.rang, tournees: t })),
        error: null,
      });
    },
  });

  return {
    from: vi.fn((t: string) => {
      table = t;
      if (t !== 'transporteurs') return builder;
      if (opts.erreurReferentiel) {
        // Référentiel illisible : sans throw, le Set serait vide → toutes les
        // tournées écartées → `noop_no_remote`. Fail-closed sur la fuite, mais
        // fail-SILENT sur l'annulation.
        const ko: Record<string, unknown> = {};
        Object.assign(ko, {
          select: () => ko,
          eq: () => ko,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: opts.erreurReferentiel }),
        });
        return ko;
      }
      return builderTransporteurs([
        { type_tms: 'a_toutes', prestataire_logistique_id: PRESTA_EVEREST },
      ]);
    }),
  } as unknown as SupabaseClient;
}

afterEach(() => _setEverestHandlers(null));

describe('E3 cancelCollecte Everest — cloisonnement par provider', () => {
  it("une tournée MTS-1 n'est pas annulée chez Everest : son customerOrderId ne part jamais en cancelMission", async () => {
    const { cancelledIds } = setupEverestMock();

    const supabase = makeSupabase([
      {
        id: 'T-MTS1',
        rang: 1,
        external_ref_commande: 'MTS1-ORDER-777',
        statut: 'en_cours',
        prestataire_logistique_id: PRESTA_MTS1,
      },
    ]);

    const consumer = await new AdapterEverest(
      A_TOUTES,
      supabase,
    ).cancelCollecte(COLLECTE);

    expect(consumer).toBe('noop_no_remote');
    expect([...cancelledIds]).toEqual([]);
  });

  it('colonne `prestataire_logistique_id` absente du select → tournée écartée (fail-closed)', async () => {
    const { cancelledIds } = setupEverestMock();

    const supabase = makeSupabase([
      {
        id: 'T-?',
        rang: 1,
        external_ref_commande: 'EVR-MISSION-1',
        statut: 'planifiee',
      },
    ]);

    const consumer = await new AdapterEverest(
      A_TOUTES,
      supabase,
    ).cancelCollecte(COLLECTE);

    expect(consumer).toBe('noop_no_remote');
    expect([...cancelledIds]).toEqual([]);
  });

  it('une erreur de lecture des tournées lève un Transient, jamais un « rien à annuler »', async () => {
    setupEverestMock();

    const supabase = makeSupabase([], {
      erreurLectureTournees: { message: 'connexion perdue' },
    });

    await expect(
      new AdapterEverest(A_TOUTES, supabase).cancelCollecte(COLLECTE),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
  });

  it('un référentiel transporteurs illisible lève un Transient, jamais un no-op silencieux', async () => {
    const { cancelledIds } = setupEverestMock();

    // Sur erreur, `data` est null → Set vide → toutes les tournées écartées.
    // Sans le throw, `cancelCollecte` rendrait `noop_no_remote` : « rien à
    // annuler » alors que la mission est commandée — sans retry ni alerte, et
    // le vélo se présente. Miroir exact de la garde MTS-1.
    const supabase = makeSupabase(
      [
        {
          id: 'T-EVR',
          rang: 1,
          external_ref_commande: 'EVR-MISSION-1',
          statut: 'planifiee',
          prestataire_logistique_id: PRESTA_EVEREST,
        },
      ],
      { erreurReferentiel: { message: 'connexion interrompue' } },
    );

    await expect(
      new AdapterEverest(A_TOUTES, supabase).cancelCollecte(COLLECTE),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    expect([...cancelledIds]).toEqual([]);
  });
});
