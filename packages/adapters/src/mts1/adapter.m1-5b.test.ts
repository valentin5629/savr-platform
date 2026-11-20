import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1Carrier, Mts1CustomerOrder, Mts1Tour } from './mock.js';
import { _setMts1Handlers } from './mock.js';
import { stuffSimule, tourSimule } from './mock-tour.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// Tours dans la forme mesurée le 2026-10-13 (valeurs inventées) : les stuffs sont
// sur l'arrêt d'enlèvement ET répétés sur l'arrêt de dépôt, les kilos dans
// `quantityAfterDelivery` (`quantityAfterPickup` à 1, mesuré le 2026-11-12).

const TOUR_NOMINAL: Mts1Tour = tourSimule({
  tourId: 'MTS1-TOUR-ZD-001',
  customerOrderId: 'MTS1-ORDER-001',
  stopId: 'stop-001',
  stuffs: [
    stuffSimule('<volume_du_camion>', 1, 1),
    stuffSimule('Bio-déchets (en kg)', 234.5),
    stuffSimule('Carton (en kg)', 87.2),
    stuffSimule('D.I.B (en kg)', 45.0),
    stuffSimule('Film plastique (en kg)', 12.8),
    stuffSimule('Verre (en kg)', 156.3),
  ],
});

const TOUR_STUFF_INCONNU: Mts1Tour = tourSimule({
  tourId: 'MTS1-TOUR-ZD-002',
  customerOrderId: 'MTS1-ORDER-001',
  stopId: 'stop-002',
  stuffs: [
    stuffSimule('Bio-déchets (en kg)', 178.0),
    stuffSimule('Gravats (en kg)', 320.0), // inconnu
  ],
});

// Le même tour, avec une photo sur l'arrêt d'enlèvement.
const TOUR_AVEC_PHOTO: Mts1Tour = tourSimule({
  tourId: 'MTS1-TOUR-ZD-001',
  customerOrderId: 'MTS1-ORDER-001',
  stopId: 'stop-001',
  stuffs: TOUR_NOMINAL.stops![0]!.stuffs!,
  photosEnlevement: ['photo-001-a'],
});

const ORDER_VALIDATED: Mts1CustomerOrder = {
  customerOrderId: 'MTS1-ORDER-001',
  orderNumber: 'col-zd-001-1',
  customerOrderStatus: 'VALIDATED',
  orderDate: '2026-07-15T22:00:00.000Z',
};

const ORDER_IN_PROGRESSION: Mts1CustomerOrder = {
  ...ORDER_VALIDATED,
  customerOrderStatus: 'IN_PROGRESSION',
};

const ORDER_OK: Mts1CustomerOrder = {
  ...ORDER_VALIDATED,
  customerOrderStatus: 'OK',
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
    /** Prestataire exécutant — défaut : un prestataire `type_tms='mts1'`. */
    prestataireId?: string;
  } | null;
  /** La photo existe déjà dans shared.fichiers ? */
  photoExistante?: boolean;
  /** Pesées déjà écrites pour l'arrêt (lecture de liste de pesees_tournees). */
  peseesExistantes?: Array<{ flux_id: string; poids_kg: number }>;
  /** La réservation du statut bute sur l'unicité (23505) : clé déjà posée. */
  statutDejaReserve?: boolean;
  /** integrations_inbox claim renvoie une erreur DB (code testé : ≠23505 propage) */
  inboxClaimError?: { code: string; message?: string };
  /** ligne integrations_inbox déjà existante au re-query (crash-recovery A4-A2) */
  inboxExistant?: { traite: boolean };
  /** collecte.statut_tms courant */
  collecteStatutTms?: string;
  /** L'état d'attribution de la tournée nominale a déjà été relevé. */
  attributionDejaVue?: boolean;
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

  const DOUBLON = {
    code: '23505',
    message: 'duplicate key value violates unique constraint',
  };

  function makeQuery(table: string) {
    const q: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    let derniere: { op: string; data?: unknown } = { op: '' };

    // Résultat d'une chaîne attendue telle quelle (ni maybeSingle ni limit) :
    // la liste des pesées de l'arrêt.
    const resultatDirect = () => {
      if (table === 'pesees_tournees' && derniere.op === 'select') {
        return { data: opts.peseesExistantes ?? [], error: null };
      }
      return { data: null, error: null };
    };

    const self = {
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(resultatDirect()).then(resolve, reject),
      select: vi.fn((_fields?: string) => {
        calls.push({ table, op: 'select', filters });
        if (derniere.op !== 'insert') derniere = { op: 'select' };
        return self;
      }),
      insert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'insert', data, filters });
        derniere = { op: 'insert', data };
        return self;
      }),
      upsert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'upsert', data, filters });
        derniere = { op: 'upsert', data };
        return self;
      }),
      update: vi.fn((data: unknown) => {
        calls.push({ table, op: 'update', data, filters });
        derniere = { op: 'update', data };
        return self;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        filters[col] = val;
        return self;
      }),
      in: vi.fn((col: string, vals: unknown) => {
        filters[col] = vals;
        return self;
      }),
      neq: vi.fn((col: string, val: unknown) => {
        filters[`neq:${col}`] = val;
        return self;
      }),
      limit: vi.fn((_n: number) => {
        // integrations_inbox, lecture seule (clé d'attribution déjà relevée ?).
        if (table === 'integrations_inbox' && derniere.op === 'select') {
          // État déjà vu = celui de la tournée nominale (acceptée).
          return Promise.resolve({
            data: opts.attributionDejaVue
              ? [
                  {
                    id: 'inbox-attribution',
                    payload: { etat: 'MTS1-TOUR-ZD-001:2' },
                  },
                ]
              : [],
            error: null,
          });
        }
        // integrations_inbox, réservation du statut (INSERT nu … RETURNING id) :
        //   - erreur DB simulée → propagée par l'adapter si code≠23505 (OUTBOX-04)
        //   - 23505 = clé déjà posée ; sinon la ligne réservée
        if (table === 'integrations_inbox') {
          if (opts.inboxClaimError) {
            return Promise.resolve({
              data: null,
              error: {
                code: opts.inboxClaimError.code,
                message: opts.inboxClaimError.message ?? 'db error',
              },
            });
          }
          if (opts.statutDejaReserve) {
            return Promise.resolve({ data: null, error: DOUBLON });
          }
          return Promise.resolve({ data: [{ id: 'inbox-001' }], error: null });
        }
        // Recherche de doublon d'une photo (`limit(1)` sur la clé).
        if (table === 'fichiers') {
          return Promise.resolve({
            data: opts.photoExistante ? [{ id: 'fichier-001' }] : [],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      maybeSingle: vi.fn(() => {
        if (table === 'tournees') {
          if (!tourneeInfo) return Promise.resolve({ data: null, error: null });
          // Cloisonnement entrant : la requête restreint par
          // `.in('prestataire_logistique_id', <prestataires mts1>)`. Le mock
          // applique VRAIMENT ce filtre — retirer le `.in()` du code ne doit
          // pas laisser la CI verte.
          const prestasAdmis = filters['prestataire_logistique_id'] as
            | string[]
            | undefined;
          if (
            prestasAdmis &&
            !prestasAdmis.includes(tourneeInfo.prestataireId ?? PRESTA_MTS1)
          ) {
            return Promise.resolve({ data: null, error: null });
          }
          // Simule la relation avec collecte_tournees!inner et collectes!inner
          return Promise.resolve({
            data: {
              id: tourneeInfo.tourneeId,
              statut: 'planifiee',
              tms_reference: tourneeInfo.tmsReference,
              prestataire_logistique_id:
                tourneeInfo.prestataireId ?? PRESTA_MTS1,
              collecte_tournees: [
                {
                  collecte_id: tourneeInfo.collecteId,
                  rang: 1,
                  // FK sortante `collecte_tournees.collecte_id` → OBJET.
                  collectes: {
                    id: tourneeInfo.collecteId,
                    statut: tourneeInfo.collecteStatut,
                    statut_tms:
                      opts.collecteStatutTms ??
                      'attribuee_en_attente_acceptation',
                    prestataire_logistique_id:
                      tourneeInfo.prestataireId ?? PRESTA_MTS1,
                  },
                },
              ],
            },
            error: null,
          });
        }
        if (table === 'integrations_inbox') {
          // Re-query crash-recovery (A4-A2) : ligne déjà présente, traite=?
          return Promise.resolve({
            data: opts.inboxExistant
              ? { id: 'inbox-001', traite: opts.inboxExistant.traite }
              : null,
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
    // Référentiel provider : `findTourneeByOrderId` restreint le rapprochement
    // aux prestataires `type_tms='mts1'`. Le builder applique réellement les
    // `.eq()` reçus (cf. mock-referentiel-transporteurs).
    if (table === 'transporteurs') {
      return builderTransporteurs();
    }
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
    // f_upsert_alerte_admin (pesée hors seuil / divergence post-clôture) passe par rpc
    // L'agrégation se lit par `.single()`, les alertes s'attendent telles quelles.
    rpc: vi.fn((name: string, args?: unknown) => {
      calls.push({ table: name, op: 'rpc', data: args });
      const resultat = {
        data: name === 'fn_agreger_terminal_collecte' ? 'pending' : null,
        error: null,
      };
      return {
        single: () => Promise.resolve(resultat),
        then: (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve(resultat).then(resolve, reject),
      };
    }),
    _calls: calls,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _calls: TableCall[];
  };
}

// ─── Tests M1.5b ──────────────────────────────────────────────────────────────

describe('M1.5b / AdapterMts1.sync — nominal', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-1 / poll nominal, tournée acceptée par le transporteur → statut_tms="acceptee", pesées upsertées, photo non rangée', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_VALIDATED]),
      getTour: vi.fn().mockResolvedValue(TOUR_AVEC_PHOTO),
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

    // Le statut est réservé par un INSERT nu (OUTBOX-04 : l'unicité arbitre).
    const inboxClaim = calls.find(
      (c) => c.table === 'integrations_inbox' && c.op === 'insert',
    );
    expect(inboxClaim).toBeDefined();

    // Vérifier mise à jour statut_tms
    const collecteUpdate = calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeDefined();
    expect(
      (collecteUpdate!.data as Record<string, unknown>)['statut_tms'],
    ).toBe('acceptee');

    // Vérifier upsert pesées : 5 flux, lus sur l'arrêt d'enlèvement seul (les
    // mêmes stuffs sont répétés sur l'arrêt de dépôt ; les lire donnerait 10).
    const peseesUpserts = calls.filter(
      (c) => c.table === 'pesees_tournees' && c.op === 'upsert',
    );
    expect(peseesUpserts.length).toBe(5);
    expect(
      peseesUpserts.map((c) => (c.data as { stop_id: string }).stop_id),
    ).toEqual(['stop-001', 'stop-001', 'stop-001', 'stop-001', 'stop-001']);

    // La photo du tour n'est pas rangée : l'Admin choisit celles qu'il garde
    // depuis la fiche collecte (décision Val 2026-11-20).
    expect(calls.filter((c) => c.table === 'fichiers')).toEqual([]);
  });
});

// ─── BL-P1-API-03 : résolution plaque + chauffeur (GET /v3/carrier) ──────────────

const CARRIER_FIXTURE: Mts1Carrier[] = [
  {
    carrierShareableCode: 'CA_STRIKE',
    name: 'Strike',
    vehicles: [
      {
        name: 'Camion 20m3',
        numberPlate: '12ABC23',
        vehicleShareableCode: 'VE_001',
      },
    ],
    transporters: [
      {
        firstname: 'Jean',
        lastname: 'Dupont',
        transporterShareableCode: 'TR_001',
      },
    ],
  },
];

// Tour avec bloc dispatch (codes opaques → résolus via carrier).
const TOUR_WITH_DISPATCH: Mts1Tour = {
  ...TOUR_NOMINAL,
  dispatch: {
    carrierShareableCode: 'CA_STRIKE',
    vehicleShareableCode: 'VE_001',
    transporterUserShareableCode: 'TR_001',
  },
};

describe('M1.5b / résolution plaque + chauffeur (BL-P1-API-03)', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-carrier / dispatch.{vehicle,transporter}ShareableCode → tournees.plaque + chauffeur_nom', async () => {
    const getCarrier = vi.fn().mockResolvedValue(CARRIER_FIXTURE);
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_VALIDATED]),
      getTour: vi.fn().mockResolvedValue(TOUR_WITH_DISPATCH),
      getCarrier,
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({});
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'CA_STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    expect(getCarrier).toHaveBeenCalled();

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    const tourneeUpdate = calls.find(
      (c) =>
        c.table === 'tournees' &&
        c.op === 'update' &&
        typeof c.data === 'object' &&
        c.data !== null &&
        'plaque_immatriculation' in (c.data as Record<string, unknown>),
    );
    expect(tourneeUpdate).toBeDefined();
    const data = tourneeUpdate!.data as Record<string, unknown>;
    expect(data['plaque_immatriculation']).toBe('12ABC23');
    expect(data['chauffeur_nom']).toBe('Jean Dupont');
    // 1re résolution → plaque_saisie_at posé.
    expect(data['plaque_saisie_at']).toBeDefined();
  });

  it('M1.5b-carrier / tour sans dispatch → aucun appel carrier, aucune écriture plaque', async () => {
    const getCarrier = vi.fn().mockResolvedValue(CARRIER_FIXTURE);
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_VALIDATED]),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL), // pas de dispatch
      getCarrier,
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({});
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'CA_STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );

    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    expect(getCarrier).not.toHaveBeenCalled();
    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    const plaqueWrite = calls.find(
      (c) =>
        c.table === 'tournees' &&
        c.op === 'update' &&
        typeof c.data === 'object' &&
        c.data !== null &&
        'plaque_immatriculation' in (c.data as Record<string, unknown>),
    );
    expect(plaqueWrite).toBeUndefined();
  });

  it('M1.5b-carrier / téléphone NON exposé par MTS-1 → chauffeur_telephone reste NULL (as-built §6)', async () => {
    const getCarrier = vi.fn().mockResolvedValue(CARRIER_FIXTURE); // transporters[] sans phone
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_VALIDATED]),
      getTour: vi.fn().mockResolvedValue(TOUR_WITH_DISPATCH),
      getCarrier,
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({});
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'CA_STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );
    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    const tourneeUpdate = calls.find(
      (c) =>
        c.table === 'tournees' &&
        c.op === 'update' &&
        typeof c.data === 'object' &&
        c.data !== null &&
        'chauffeur_nom' in (c.data as Record<string, unknown>),
    );
    expect(tourneeUpdate).toBeDefined();
    const data = tourneeUpdate!.data as Record<string, unknown>;
    expect(data['chauffeur_nom']).toBe('Jean Dupont');
    // MTS-1 n'expose pas le téléphone → jamais écrit par le poll (saisie Admin).
    expect('chauffeur_telephone' in data).toBe(false);
  });

  it('M1.5b-carrier / téléphone exposé (provider futur) → chauffeur_telephone peuplé (seam)', async () => {
    const carrierAvecTel: Mts1Carrier[] = [
      {
        carrierShareableCode: 'CA_STRIKE',
        name: 'Strike',
        vehicles: [
          {
            name: 'Camion 20m3',
            numberPlate: '12ABC23',
            vehicleShareableCode: 'VE_001',
          },
        ],
        transporters: [
          {
            firstname: 'Jean',
            lastname: 'Dupont',
            transporterShareableCode: 'TR_001',
            phone: '0611223344',
          },
        ],
      },
    ];
    const getCarrier = vi.fn().mockResolvedValue(carrierAvecTel);
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_VALIDATED]),
      getTour: vi.fn().mockResolvedValue(TOUR_WITH_DISPATCH),
      getCarrier,
      postOrder: vi.fn(),
    });

    const supabase = makeSyncSupabase({});
    const adapter = new AdapterMts1(
      {
        id: 'presta-001',
        type_tms: 'mts1',
        code_transporteur_mts1: 'CA_STRIKE',
        prestataire_logistique_id: 'presta-001',
      },
      supabase,
    );
    await adapter.sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    const tourneeUpdate = calls.find(
      (c) =>
        c.table === 'tournees' &&
        c.op === 'update' &&
        typeof c.data === 'object' &&
        c.data !== null &&
        'chauffeur_telephone' in (c.data as Record<string, unknown>),
    );
    expect(tourneeUpdate).toBeDefined();
    const data = tourneeUpdate!.data as Record<string, unknown>;
    expect(data['chauffeur_telephone']).toBe('0611223344');
  });
});

describe('M1.5b / AdapterMts1.sync — dédup statut', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-2 / même ordre même statut → statut non rejoué, tour relu quand même', async () => {
    const getTour = vi.fn().mockResolvedValue(TOUR_NOMINAL);
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_VALIDATED]),
      getTour,
      postOrder: vi.fn(),
    });

    // La clé du statut est déjà posée (23505) et entièrement traitée (re-lecture
    // = null par défaut → tenu pour traité). L'état d'attribution de la tournée
    // aussi : il a sa propre clé (adapter.attribution-transporteur.test.ts).
    const supabase = makeSyncSupabase({
      statutDejaReserve: true,
      attributionDejaVue: true,
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

    // Le statut n'est pas rejoué : aucune mise à jour de la collecte.
    const collecteUpdate = calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(collecteUpdate).toBeUndefined();

    // Le tour, lui, est relu à chaque passage (§08 §3bis.7, décision Val
    // 2026-10-13) : les pesées qui manquaient sont écrites.
    expect(getTour).toHaveBeenCalledOnce();
    const peseesUpserts = calls.filter(
      (c) => c.table === 'pesees_tournees' && c.op === 'upsert',
    );
    expect(peseesUpserts.length).toBe(5);
  });
});

describe('M1.5b / AdapterMts1.sync — IN_PROGRESSION', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-3 / IN_PROGRESSION → collectes.statut mis à en_cours (pas de changement statut_tms)', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_IN_PROGRESSION]),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      postOrder: vi.fn(),
    });

    // L'attribution de la tournée est déjà relevée : seul le statut de la
    // commande joue ici.
    const supabase = makeSyncSupabase({
      tourneeInfo: {
        collecteId: 'col-001',
        tourneeId: 'tournee-001',
        tmsReference: 'MTS1-TOUR-ZD-001',
        collecteStatut: 'validee',
      },
      attributionDejaVue: true,
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
      pollOrders: vi.fn().mockResolvedValue([ORDER_OK]),
      getTour: vi.fn().mockResolvedValue(TOUR_STUFF_INCONNU),
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
      pollOrders: vi.fn().mockResolvedValue([ORDER_OK]),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
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
      peseesExistantes: [{ flux_id: 'flux-biodechet', poids_kg: 200.0 }],
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

    // BL-P2-37 : 2 sorties attendues (§08 §3bis.7 l.442) —
    // (1) trace technique integrations_logs
    const logInsert = calls.find(
      (c) =>
        c.table === 'integrations_logs' &&
        c.op === 'insert' &&
        String((c.data as Record<string, unknown>)['erreur']).includes(
          'PESEE_DIVERGENCE_POST_CLOTURE',
        ),
    );
    expect(logInsert).toBeDefined();

    // (2) alerte Ops in-app f_upsert_alerte_admin (sinon divergence silencieuse)
    const alerteOps = calls.find(
      (c) =>
        c.op === 'rpc' &&
        c.table === 'f_upsert_alerte_admin' &&
        (c.data as Record<string, unknown>)['p_code'] ===
          'pesee_divergence_post_cloture',
    );
    expect(alerteOps).toBeDefined();
  });
});

// ─── OUTBOX-04 : réservation atomique du statut (INSERT nu, unicité) ──────────
// ⚠ Jamais d'`upsert … onConflict` sur integrations_inbox : son index unique est
// PARTIEL et PostgreSQL ne l'infère pas sans son prédicat. Mesuré le 2026-10-13
// sur la base locale, en SQL comme par l'API : 42P10. Écrite ainsi, la
// réservation échouait pour chaque commande sur une base réelle (la base
// simulée de ces tests ne pouvait pas le voir).
describe('M1.5b / AdapterMts1.sync — claim entrant atomique (BL-P1-OUTBOX-04)', () => {
  afterEach(() => _setMts1Handlers(null));

  const TRANSPORTEUR = {
    id: 'presta-001',
    type_tms: 'mts1',
    code_transporteur_mts1: 'STRIKE',
    prestataire_logistique_id: 'presta-001',
  } as const;
  const FENETRE = {
    depuis: new Date('2026-07-15T00:00:00Z'),
    jusqu_a: new Date('2026-07-17T00:00:00Z'),
  };
  const handlers = () =>
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_OK]),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
      postOrder: vi.fn(),
    });

  it('M1.5b/releve_reservation_statut_insert — le statut est réservé par un INSERT, jamais par un upsert', async () => {
    handlers();
    const supabase = makeSyncSupabase({});
    await new AdapterMts1(TRANSPORTEUR, supabase).sync(FENETRE);

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    const reservations = calls.filter(
      (c) =>
        c.table === 'integrations_inbox' &&
        c.op === 'insert' &&
        (c.data as Record<string, unknown>)['event_type'] === 'order_status',
    );
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.data).toEqual({
      source: 'mts1',
      event_type: 'order_status',
      event_id_externe: 'mts1:MTS1-ORDER-001:OK',
      payload: { orderId: 'MTS1-ORDER-001', status: 'OK' },
    });
    expect(
      calls.some((c) => c.table === 'integrations_inbox' && c.op === 'upsert'),
    ).toBe(false);
  });

  it('clé déjà posée (23505) et statut traité → statut non rejoué (ni collecte, ni tournée, ni agrégation)', async () => {
    handlers();
    // La re-lecture de la ligne rend null par défaut → tenu pour traité. L'état
    // d'attribution de la tournée est déjà relevé lui aussi.
    const supabase = makeSyncSupabase({
      statutDejaReserve: true,
      attributionDejaVue: true,
    });
    await new AdapterMts1(TRANSPORTEUR, supabase).sync(FENETRE);

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    expect(
      calls.filter((c) => c.table === 'collectes' && c.op === 'update'),
    ).toEqual([]);
    expect(
      calls.filter((c) => c.table === 'tournees' && c.op === 'update'),
    ).toEqual([]);
    expect(
      calls.filter((c) => c.table === 'fn_agreger_terminal_collecte'),
    ).toEqual([]);
  });

  it('clé déjà posée (23505) mais statut NON traité (crash-recovery A4-A2) → REJOUE (effets idempotents)', async () => {
    handlers();
    // Un run précédent a posé la clé puis CRASHÉ avant markInboxDone : la
    // re-lecture trouve la ligne avec traite=false → on REJOUE (tous les effets
    // sont idempotents). Sans ce rejeu, la collecte ne passerait jamais realisee.
    const supabase = makeSyncSupabase({
      statutDejaReserve: true,
      inboxExistant: { traite: false },
    });
    await new AdapterMts1(TRANSPORTEUR, supabase).sync(FENETRE);

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    // Rejeu du statut terminal `OK` : tournée terminée, collecte agrégée, ligne
    // marquée traitée.
    expect(
      calls.find((c) => c.table === 'tournees' && c.op === 'update')!.data,
    ).toEqual({ statut: 'terminee' });
    expect(
      calls.filter((c) => c.table === 'fn_agreger_terminal_collecte'),
    ).toHaveLength(1);
    expect(
      calls.some(
        (c) =>
          c.table === 'integrations_inbox' &&
          c.op === 'update' &&
          (c.data as { traite?: boolean }).traite === true,
      ),
    ).toBe(true);
  });

  it('erreur DB ≠ 23505 sur le claim → propagée (jamais avalée comme « déjà traité »)', async () => {
    handlers();
    // Erreur transitoire (ex : connexion) — DOIT remonter, pas être confondue avec
    // un doublon bénin → l'event est retenté au poll suivant (sync log l'échec).
    const supabase = makeSyncSupabase({
      inboxClaimError: { code: '08006', message: 'connection failure' },
    });
    // sync() isole par collecte (try/catch) → log SYNC_ORDER_FAILED, pas de throw global
    await new AdapterMts1(TRANSPORTEUR, supabase).sync(FENETRE);

    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;
    // L'erreur a été propagée → loggée comme échec de traitement, pas de pesées écrites
    const syncFailed = calls.find(
      (c) =>
        c.table === 'integrations_logs' &&
        c.op === 'insert' &&
        String((c.data as Record<string, unknown>)['erreur']).includes(
          'SYNC_ORDER_FAILED',
        ),
    );
    expect(syncFailed).toBeDefined();
    expect(
      calls.filter((c) => c.table === 'pesees_tournees' && c.op === 'upsert')
        .length,
    ).toBe(0);
  });
});

describe('M1.5b / AdapterMts1.sync — ordre sans tournée Savr', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5b-8 / ordre MTS-1 sans tournée dans notre système → ignoré sans erreur', async () => {
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_VALIDATED]),
      getTour: vi.fn(),
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
      customerOrderId: 'MTS1-ORDER-OK',
      orderNumber: 'col-ok-1',
      customerOrderStatus: 'VALIDATED',
    };
    const ORDER_KO: Mts1CustomerOrder = {
      customerOrderId: 'MTS1-ORDER-KO',
      orderNumber: 'col-ko-1',
      customerOrderStatus: 'VALIDATED',
    };

    let getTourCallCount = 0;
    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_KO, ORDER_OK]),
      getTour: vi.fn().mockImplementation(() => {
        getTourCallCount++;
        if (getTourCallCount === 1)
          throw new Error('MTS-1 500: internal error');
        return Promise.resolve(
          tourSimule({
            tourId: 'MTS1-TOUR-ZD-001',
            customerOrderId: 'MTS1-ORDER-OK',
            stopId: 'stop-001',
            stuffs: [stuffSimule('Bio-déchets (en kg)', 234.5)],
          }),
        );
      }),
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
      customerOrderId: 'MTS1-ORDER-CANCELED',
      customerOrderStatus: 'CANCELED',
    };

    _setMts1Handlers({
      pollOrders: vi.fn().mockResolvedValue([ORDER_CANCELED]),
      getTour: vi.fn().mockResolvedValue(TOUR_NOMINAL),
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

// ─── Recherche des commandes : contrat mesuré le 2026-10-13 ───────────────────
// GET /v3/customerOrders ne lit que des jours « yyyy-MM-dd » (bornes incluses,
// jour compté à Paris) et rend un tableau nu de commandes nommées
// `customerOrderId` / `customerOrderStatus`. Avant, la relève envoyait des
// instants ISO (500 à chaque passage) et lisait `id` / `status`.
// Ces tests portent sur la remontée des statuts ; pesées et photos sur la forme
// réelle du tour : adapter.releve-pesees-photos.test.ts.

describe('M1.5b / AdapterMts1.sync — recherche des commandes (forme réelle)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  const ADAPTER = {
    id: 'presta-001',
    type_tms: 'mts1' as const,
    code_transporteur_mts1: 'STRIKE',
    prestataire_logistique_id: PRESTA_MTS1,
  };

  it('M1.5b/releve_fenetre_en_jours_paris — la fenêtre du cron part en jours comptés à Paris, sans filtre de numéro', async () => {
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([]);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      scanOrdersByDateRange,
    });

    await new AdapterMts1(ADAPTER, makeSyncSupabase({})).sync({
      // 22h30 UTC le 13 = 00h30 à Paris le 14 : en UTC la borne basse serait le 13.
      depuis: new Date('2026-10-13T22:30:00.000Z'),
      // 22h30 UTC le 15 = 00h30 à Paris le 16 : en UTC la borne haute serait le 15.
      jusqu_a: new Date('2026-10-15T22:30:00.000Z'),
    });

    expect(scanOrdersByDateRange).toHaveBeenCalledOnce();
    expect(scanOrdersByDateRange.mock.calls[0]).toEqual([
      '2026-10-14',
      '2026-10-16',
      undefined,
    ]);
  });

  it('M1.5b/releve_fil_statut_relaye — chemin réel : adresse en jours, tableau nu, statut et véhicule relayés', async () => {
    _setMts1Handlers(null); // force le chemin réel (fetch)
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');

    // Réponses dans la forme mesurée : tableaux nus, vrais noms de champs, tour
    // portant `stuffs` (pas `items`) sur l'arrêt qui nomme la commande.
    const reponses: Record<string, { status: number; corps: unknown }> = {
      '/v3/customerOrders?minDate=2026-07-15&maxDate=2026-07-17': {
        status: 200,
        corps: [
          {
            customerOrderId: 'MTS1-ORDER-001',
            orderNumber: 'col-001-1',
            customerOrderStatus: 'VALIDATED',
            orderDate: '2026-07-15T20:00:00.000Z',
            currentTour: { tourId: 'MTS1-TOUR-ZD-001', stopId: 'stop-001' },
          },
        ],
      },
      '/v3/tours/MTS1-TOUR-ZD-001': {
        status: 200,
        corps: {
          ...tourSimule({
            tourId: 'MTS1-TOUR-ZD-001',
            customerOrderId: 'MTS1-ORDER-001',
            stopId: 'stop-001',
            stuffs: [stuffSimule('Bio-déchets (en kg)', null)],
          }),
          dispatch: {
            carrierShareableCode: 'CA_STRIKE',
            vehicleShareableCode: 'VE_001',
            transporterUserShareableCode: 'TR_001',
          },
        },
      },
      '/v3/carrier': { status: 200, corps: CARRIER_FIXTURE },
    };
    const adresses: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        adresses.push(url);
        const r = reponses[url.replace('https://mts1.test', '')];
        if (!r) throw new Error(`adresse inattendue : ${url}`);
        return {
          ok: r.status === 200,
          status: r.status,
          text: async () => JSON.stringify(r.corps),
          json: async () => r.corps,
        };
      }) as never,
    );

    const supabase = makeSyncSupabase({});
    await new AdapterMts1(ADAPTER, supabase).sync({
      depuis: new Date('2026-07-15T00:00:00Z'),
      jusqu_a: new Date('2026-07-17T00:00:00Z'),
    });
    const calls = (supabase as unknown as { _calls: TableCall[] })._calls;

    // Adresse mesurée en 200 ; la forme d'avant (instants ISO + pageSize) → 500.
    expect(adresses[0]).toBe(
      'https://mts1.test/v3/customerOrders?minDate=2026-07-15&maxDate=2026-07-17',
    );

    // La clé de dédup porte l'identifiant et le statut réels de la commande —
    // lus sous les anciens noms, elle valait « mts1:undefined:undefined » pour
    // toutes les commandes.
    const claim = calls.find(
      (c) => c.table === 'integrations_inbox' && c.op === 'insert',
    );
    expect((claim!.data as Record<string, unknown>)['event_id_externe']).toBe(
      'mts1:MTS1-ORDER-001:VALIDATED',
    );
    expect((claim!.data as Record<string, unknown>)['payload']).toEqual({
      orderId: 'MTS1-ORDER-001',
      status: 'VALIDATED',
    });

    // La tournée est rapprochée par l'identifiant de la commande…
    const rapprochement = calls.find(
      (c) => c.table === 'tournees' && c.op === 'select',
    );
    expect(rapprochement!.filters!['external_ref_commande']).toBe(
      'MTS1-ORDER-001',
    );
    // … et le statut relayé à la collecte.
    const collecteUpdate = calls.find(
      (c) => c.table === 'collectes' && c.op === 'update',
    );
    expect(
      (collecteUpdate!.data as Record<string, unknown>)['statut_tms'],
    ).toBe('acceptee');

    // Le référentiel transporteurs (tableau nu) résout plaque et chauffeur. Lu
    // sous l'enveloppe supposée `{ carriers }`, il levait ici et le traitement de
    // la commande s'arrêtait avant son statut terminal.
    const tourneeUpdate = calls.find(
      (c) => c.table === 'tournees' && c.op === 'update',
    );
    expect(tourneeUpdate!.data).toMatchObject({
      plaque_immatriculation: '12ABC23',
      chauffeur_nom: 'Jean Dupont',
    });

    // Aucune commande en échec de traitement.
    expect(
      calls.filter((c) =>
        String((c.data as { erreur?: string } | undefined)?.erreur).startsWith(
          'SYNC_ORDER_FAILED',
        ),
      ),
    ).toEqual([]);
  });

  it('M1.5b/releve_fil_recherche_en_echec — un 500 de la recherche fait échouer le passage (jamais « rien à relever »)', async () => {
    _setMts1Handlers(null);
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => '{"reasons":["INTERNAL_ERROR"]}',
        json: async () => ({ reasons: ['INTERNAL_ERROR'] }),
      })) as never,
    );

    await expect(
      new AdapterMts1(ADAPTER, makeSyncSupabase({})).sync({
        depuis: new Date('2026-07-15T00:00:00Z'),
        jusqu_a: new Date('2026-07-17T00:00:00Z'),
      }),
    ).rejects.toThrow('MTS-1 500');
  });
});
