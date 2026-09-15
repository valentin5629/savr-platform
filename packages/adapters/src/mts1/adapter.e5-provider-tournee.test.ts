// E5 `lieu.champ_critique_modifie` — cloisonnement par provider.
//
// Un lieu est partagé par toutes les collectes qui s'y tiennent : le même
// Pavillon peut porter une collecte ZD dispatchée MTS-1 et une collecte AG
// dispatchée Everest (vélo cargo IDF). Les DEUX tournées portent un
// `external_ref_commande` — l'adapter Everest y stocke son id de mission
// (everest/adapter.ts, `update({ external_ref_commande: missionId })`).
//
// Filtrer sur la seule présence de `external_ref_commande` fait donc partir un
// `PUT /v3/customerOrders/{id_mission_everest}` : un identifiant Everest
// divulgué à MTS-1, suivi d'un 404 → `LogistiquePermanentError` → E5 en DLQ,
// l'adresse ne se propageant alors sur AUCUNE collecte du lieu.
//
// Le provider d'une tournée se lit sur `prestataire_logistique_id`, résolu par
// `transporteurs.type_tms` (même résolution que le worker, `fetchTransporteur`).

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Lieu, Transporteur } from '../index.js';
import { LogistiqueTransientError } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import { _setMts1Handlers } from './mock.js';

const PRESTA_MTS1 = 'presta-strike-uuid';
const PRESTA_EVEREST = 'presta-atoutes-uuid';

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

interface CollecteFixture {
  id: string;
  /** Prestataire exécutant porté par la tournée de cette collecte. */
  prestataire_logistique_id: string | null;
  /** Ref de commande chez le provider (customerOrderId MTS-1 / mission Everest). */
  external_ref_commande: string | null;
}

/**
 * Référentiel transporteurs COMPLET — MTS-1 et non-MTS-1 mélangés, comme en base.
 *
 * Servir au mock une liste déjà filtrée prouverait seulement que la boucle
 * consulte un Set, jamais que ce Set est celui des transporteurs MTS-1 : un
 * refactor perdant le `.eq('type_tms', 'mts1')` rouvrirait la fuite avec une CI
 * verte. Le mock applique donc lui-même les `.eq()` reçus.
 */
const REFERENTIEL_TRANSPORTEURS = [
  { prestataire_logistique_id: PRESTA_MTS1, type_tms: 'mts1' },
  { prestataire_logistique_id: 'presta-marathon-uuid', type_tms: 'mts1' },
  { prestataire_logistique_id: PRESTA_EVEREST, type_tms: 'a_toutes' },
  { prestataire_logistique_id: 'presta-par-mail-uuid', type_tms: 'par_mail' },
];

/**
 * Mock supabase routé PAR TABLE — `from('collectes')` et `from('transporteurs')`
 * ne renvoient pas la même chose. Un builder unique partagé (comme dans les
 * tests voisins) ferait répondre le lot de collectes à la requête transporteurs,
 * et le filtre testé ici deviendrait un no-op silencieux.
 *
 * Le builder est thenable : `await from().select().eq().gte().not()` résout. Les
 * `.eq()` sont ACCUMULÉS et appliqués aux lignes à la résolution — c'est ce qui
 * rend le `type_tms='mts1'` de l'adapter réellement sous test.
 */
function makeSupabase(
  collectes: CollecteFixture[],
): import('@supabase/supabase-js').SupabaseClient {
  const makeBuilder = (rows: unknown[], filtrable: boolean) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    const egalites: Array<[string, unknown]> = [];
    Object.assign(builder, {
      select: vi.fn(chain),
      eq: vi.fn((col: string, val: unknown) => {
        egalites.push([col, val]);
        return builder;
      }),
      gte: vi.fn(chain),
      not: vi.fn(chain),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        // Le lot de collectes est servi tel quel (ses filtres — lieu, date,
        // statut — ne sont pas l'objet de ce fichier) ; le référentiel
        // transporteurs, lui, est réellement filtré.
        const data = filtrable
          ? rows.filter((r) =>
              egalites.every(
                ([col, val]) => (r as Record<string, unknown>)[col] === val,
              ),
            )
          : rows;
        return resolve({ data, error: null });
      },
    });
    return builder;
  };

  const collecteRows = collectes.map((c) => ({
    id: c.id,
    nb_camions_demande: 1,
    date_collecte: '2026-07-15',
    heure_collecte: '22:00:00',
    type: 'zero_dechet',
    controle_acces_requis: false,
    informations_supplementaires: null,
    collecte_tournees: [
      {
        tournee_id: `T-${c.id}`,
        rang: 1,
        // FK sortante `collecte_tournees.tournee_id` → embed OBJET.
        tournees: {
          id: `T-${c.id}`,
          external_ref_commande: c.external_ref_commande,
          tms_reference: `TOUR-${c.id}`,
          statut: 'en_cours',
          prestataire_logistique_id: c.prestataire_logistique_id,
        },
      },
    ],
  }));

  return {
    from: vi.fn((table: string) =>
      table === 'transporteurs'
        ? makeBuilder(REFERENTIEL_TRANSPORTEURS, true)
        : makeBuilder(collecteRows, false),
    ),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

/** Mock dont la table nommée répond une erreur PostgREST. */
function makeSupabaseEnErreur(
  tableEnErreur: 'collectes' | 'transporteurs',
): import('@supabase/supabase-js').SupabaseClient {
  const makeBuilder = (enErreur: boolean) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: vi.fn(chain),
      eq: vi.fn(chain),
      gte: vi.fn(chain),
      not: vi.fn(chain),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve(
          enErreur
            ? { data: null, error: { message: 'connexion interrompue' } }
            : {
                data: [
                  {
                    id: 'col-zd',
                    nb_camions_demande: 1,
                    date_collecte: '2026-07-15',
                    heure_collecte: '22:00:00',
                    type: 'zero_dechet',
                    controle_acces_requis: false,
                    informations_supplementaires: null,
                    collecte_tournees: [
                      {
                        tournee_id: 'T-1',
                        rang: 1,
                        tournees: {
                          id: 'T-1',
                          external_ref_commande: 'MTS1-ORDER-1',
                          tms_reference: 'TOUR-1',
                          statut: 'en_cours',
                          prestataire_logistique_id: PRESTA_MTS1,
                        },
                      },
                    ],
                  },
                ],
                error: null,
              },
        ),
    });
    return builder;
  };
  return {
    from: vi.fn((table: string) => makeBuilder(table === tableEnErreur)),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

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

describe('E5 updateLieu — seules les tournées dispatchées via MTS-1 reçoivent un PUT', () => {
  afterEach(() => _setMts1Handlers(null));

  it('un lieu mixte MTS-1 × Everest ne pousse que la commande MTS-1', async () => {
    const updateOrder = stubUpdateOrder();

    const supabase = makeSupabase([
      {
        id: 'col-zd-mts1',
        prestataire_logistique_id: PRESTA_MTS1,
        external_ref_commande: 'MTS1-ORDER-42',
      },
      {
        // Collecte AG du même lieu, dispatchée Everest : `external_ref_commande`
        // porte un id de MISSION EVEREST, jamais un customerOrderId MTS-1.
        id: 'col-ag-everest',
        prestataire_logistique_id: PRESTA_EVEREST,
        external_ref_commande: 'EVEREST-MISSION-77',
      },
    ]);

    await new AdapterMts1(TRANSPORTEUR_MTS1, supabase).updateLieu(LIEU);

    // L'identifiant Everest ne doit jamais être transmis à MTS-1.
    expect(ordersAppeles(updateOrder)).toEqual(['MTS1-ORDER-42']);
  });

  it('deux transporteurs MTS-1 distincts sont tous deux servis', async () => {
    // Le worker instancie l'adapter avec « n'importe quel » transporteur mts1
    // (`.limit(1)`) : le filtre porte sur type_tms, pas sur le prestataire de
    // l'instance — sinon les tournées Marathon seraient muettes dès que le
    // worker tire Strike.
    const updateOrder = stubUpdateOrder();
    // Second transporteur mts1 du référentiel (cf. REFERENTIEL_TRANSPORTEURS).
    const PRESTA_MTS1_BIS = 'presta-marathon-uuid';

    const supabase = makeSupabase([
      {
        id: 'col-strike',
        prestataire_logistique_id: PRESTA_MTS1,
        external_ref_commande: 'MTS1-ORDER-A',
      },
      {
        id: 'col-marathon',
        prestataire_logistique_id: PRESTA_MTS1_BIS,
        external_ref_commande: 'MTS1-ORDER-B',
      },
    ]);

    await new AdapterMts1(TRANSPORTEUR_MTS1, supabase).updateLieu(LIEU);

    expect(ordersAppeles(updateOrder)).toEqual([
      'MTS1-ORDER-A',
      'MTS1-ORDER-B',
    ]);
  });

  it('une tournée sans prestataire résolu en transporteur MTS-1 est ignorée', async () => {
    // `par_mail` / `par_telephone` / `autre` (provider_manual) : une tournée
    // saisie à la main ne s'adresse pas en HTTP.
    const updateOrder = stubUpdateOrder();

    const supabase = makeSupabase([
      {
        id: 'col-manuelle',
        prestataire_logistique_id: 'presta-par-mail-uuid',
        external_ref_commande: 'REF-SAISIE-MAIN',
      },
    ]);

    await new AdapterMts1(TRANSPORTEUR_MTS1, supabase).updateLieu(LIEU);

    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('une tournée MTS-1 pas encore dispatchée ne reçoit pas de PUT', async () => {
    // Cas métier courant : la collecte est programmée, la tournée existe, mais
    // E1 n'a pas encore créé le customerOrder (`external_ref_commande` NULL).
    // Il n'y a alors aucun ordre distant à ré-adresser — E1 transmettra
    // l'adresse à jour. Un PUT partirait sur `null`/`''` et 404erait.
    const updateOrder = stubUpdateOrder();

    const supabase = makeSupabase([
      {
        id: 'col-pas-encore-dispatchee',
        prestataire_logistique_id: PRESTA_MTS1,
        external_ref_commande: null,
      },
    ]);

    await new AdapterMts1(TRANSPORTEUR_MTS1, supabase).updateLieu(LIEU);

    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('un client dont aucune requête ne porte la colonne prestataire ne laisse rien passer', async () => {
    // Incident réellement vécu : un mock à builder UNIQUE (celui d'origine de
    // adapter.e5-lieu-overrides.test.ts) fait répondre le lot de collectes à la
    // requête `transporteurs`. Ni les lignes du référentiel ni les tournées ne
    // portent alors `prestataire_logistique_id` : les deux valent `undefined`.
    //
    // Un prédicat écrit `!== null` laisse passer `undefined` DES DEUX CÔTÉS —
    // il entre dans le Set, et `has(undefined)` répond true. Le filtre dégénère
    // en « tout passe » et la fuite Everest se rouvre, CI verte. D'où le
    // `typeof === 'string'` aux deux endroits.
    const updateOrder = stubUpdateOrder();

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
          data: [
            {
              id: 'col-sans-colonne',
              nb_camions_demande: 1,
              date_collecte: '2026-07-15',
              heure_collecte: '22:00:00',
              type: 'zero_dechet',
              controle_acces_requis: false,
              informations_supplementaires: null,
              collecte_tournees: [
                {
                  tournee_id: 'T-1',
                  rang: 1,
                  // `prestataire_logistique_id` volontairement ABSENT.
                  tournees: {
                    id: 'T-1',
                    external_ref_commande: 'MTS1-ORDER-X',
                    tms_reference: 'TOUR-1',
                    statut: 'en_cours',
                  },
                },
              ],
            },
          ],
          error: null,
        }),
    });
    const supabase = {
      from: vi.fn(() => builder),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await new AdapterMts1(TRANSPORTEUR_MTS1, supabase).updateLieu(LIEU);

    expect(updateOrder).not.toHaveBeenCalled();
  });

  it.each(['transporteurs', 'collectes'] as const)(
    'une erreur de lecture sur %s lève au lieu de se taire',
    async (table) => {
      // Sans ce throw, l'event E5 serait marqué `done` avec le consumer
      // `adapter_mts1` — un no-op indistinguable d'un dispatch réussi, sans
      // retry ni alerte, et le camion se présente à l'ancienne adresse.
      // Transient : le worker rejoue ses paliers plutôt qu'un dead immédiat.
      const updateOrder = stubUpdateOrder();

      await expect(
        new AdapterMts1(
          TRANSPORTEUR_MTS1,
          makeSupabaseEnErreur(table),
        ).updateLieu(LIEU),
      ).rejects.toBeInstanceOf(LogistiqueTransientError);

      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
});
