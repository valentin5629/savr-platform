import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import type { Collecte, Transporteur } from '../index.js';
import {
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder, Mts1Handlers } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// Reprise d'un ordre « à réconcilier » (outbox_events.requires_reconciliation) :
// ce que l'adapter demande à MTS-1 avant de créer, modifier ou annuler, et ce
// qu'il fait de la réponse. Contrat de la recherche mesuré sur le compte de
// démonstration le 2026-10-13 (cf. client-recherche-commandes.test.ts).

const COLLECTE: Collecte = {
  id: 'col-rech-001',
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
  lieu: {
    id: 'lieu-rech-001',
    nom: 'Salle Pleyel',
    adresse_acces: '252 Rue du Faubourg Saint-Honoré',
    code_postal: '75008',
    ville: 'Paris',
    latitude: 48.8789,
    longitude: 2.3049,
    acces_details: null,
    type_vehicule_max: 'camion_20m3',
    contraintes_horaires: null,
  },
};
// Clé du rang 1 (numéro entier des commandes créées avant le 2026-10-15), et
// numéro envoyé depuis : le nom du lieu en tête (ni traiteur ni pax ici).
const NUMERO = 'col-rech-001-1';
const NUMERO_ENVOYE = `Salle Pleyel · ${NUMERO}`;

const TRANSPORTEUR: Transporteur = {
  id: 'transp-rech',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: PRESTA_MTS1,
};

interface TourneeFixture {
  id: string;
  rang: number;
  reference_interne: string;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
  prestataire_logistique_id: string | null;
}

function tournee(rang: number, commande: string): TourneeFixture {
  return {
    id: `tournee-${rang}`,
    rang,
    reference_interne: `TMS-col-rech-001-${rang}`,
    external_ref_commande: commande,
    tms_reference: `TOUR-${rang}`,
    statut: 'en_cours',
    prestataire_logistique_id: PRESTA_MTS1,
  };
}

type Ecriture = { table: string; op: string; data: unknown };

// Base simulée : sert les tournées de la collecte, journalise chaque écriture.
function makeSupabase(tournees: TourneeFixture[] = []) {
  const ecritures: Ecriture[] = [];

  function builder(table: string): Record<string, unknown> {
    let op = 'select';
    let donnees: unknown;
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'gte']) b[m] = () => b;
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      b[m] = (data?: unknown) => {
        op = m;
        donnees = data;
        ecritures.push({ table, op: m, data });
        return b;
      };
    }
    // Écriture d'une tournée relue par `.single()` (upsertTournee).
    b['single'] = async () => ({
      data:
        table === 'tournees'
          ? {
              id: 'tournee-neuve',
              reference_interne: `TMS-${COLLECTE.id}-1`,
              tms_reference: null,
              statut: 'planifiee',
              ...(donnees as Record<string, unknown>),
            }
          : null,
      error: null,
    });
    b['then'] = (resolve: (v: unknown) => void) =>
      resolve({
        data:
          table === 'collecte_tournees' && op === 'select'
            ? tournees.map((t) => ({ rang: t.rang, tournees: t }))
            : null,
        error: null,
      });
    return b;
  }

  const supabase = {
    from: (table: string) =>
      table === 'transporteurs' ? builderTransporteurs() : builder(table),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { supabase, ecritures };
}

/** Commandes enregistrées sur une tournée de Savr (curseur de reprise). */
function enregistrees(ecritures: Ecriture[]): unknown[] {
  return ecritures
    .filter(
      (e) =>
        e.table === 'tournees' &&
        'external_ref_commande' in (e.data as Record<string, unknown>),
    )
    .map((e) => (e.data as Record<string, unknown>)['external_ref_commande']);
}

function commande(
  customerOrderId: string,
  surcharge: Partial<Mts1CustomerOrder> = {},
): Mts1CustomerOrder {
  return {
    customerOrderId,
    orderNumber: NUMERO,
    customerOrderStatus: 'DRAFT',
    orderDate: '2026-07-15T20:00:00.000Z',
    ...surcharge,
  };
}

// Handlers simulés : la création de commande, de sa tournée unitaire et le
// rattachement répondent (jamais d'envoi au transporteur ni de validation,
// décision Val 2026-10-15) ; la recherche est fournie par le test.
function armer(recherche: Partial<Mts1Handlers>) {
  const pipeline = {
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder: vi.fn(async (payload: Record<string, unknown>) => ({
      ok: true as const,
      id: 'CMD-NEUVE',
      externalReference: String(payload['orderNumber']),
      status: 'DRAFT' as const,
      createdAt: '',
    })),
    createTour: vi.fn(async () => ({
      tourId: 'TOUR-NEUF',
      externalReference: NUMERO,
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: '',
    })),
    addCustomerOrder: vi.fn().mockResolvedValue(undefined),
    updateOrder: vi.fn().mockResolvedValue(undefined),
    deleteOrder: vi.fn().mockResolvedValue(undefined),
  };
  _setMts1Handlers({ ...pipeline, ...recherche });
  return pipeline;
}

afterEach(() => _setMts1Handlers(null));

// ─── E1 : création reprise ────────────────────────────────────────────────────

describe('M1.5a / réconciliation d’une création reprise (E1)', () => {
  const reprendre = (
    supabase: import('@supabase/supabase-js').SupabaseClient,
  ) =>
    new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(COLLECTE, 1, {
      requiresReconciliation: true,
    });

  it('M1.5a/reconciliation_creation_fenetre_sans_numero — la recherche part sur J-1 → J+1, en jours, sans filtre de numéro (le libellé a pu changer, la clé est reconnue ici)', async () => {
    const scanOrdersByDateRange = vi
      .fn()
      .mockResolvedValue([commande('CMD-DEJA-CREEE')]);
    const h = armer({ scanOrdersByDateRange });

    const { supabase, ecritures } = makeSupabase();
    await reprendre(supabase);

    // Des jours, pas des instants (un instant fait répondre 500 à MTS-1), et le
    // jour de la collecte lui-même au milieu : c'est lui que l'API compare.
    expect(scanOrdersByDateRange).toHaveBeenCalledOnce();
    expect(scanOrdersByDateRange).toHaveBeenCalledWith(
      '2026-07-14',
      '2026-07-16',
      undefined,
    );
    // Commande retrouvée : reprise sur elle, jamais de second POST.
    expect(h.postOrder).not.toHaveBeenCalled();
    expect(enregistrees(ecritures)).toEqual(['CMD-DEJA-CREEE']);
  });

  it('M1.5a/reconciliation_creation_numero_strict — une commande vivante d’un AUTRE numéro n’est pas reprise', async () => {
    // Le filtre distant est une aide, pas une garantie : l'égalité se rejoue ici.
    const h = armer({
      scanOrdersByDateRange: vi
        .fn()
        .mockResolvedValue([
          commande('CMD-RANG-10', { orderNumber: `${NUMERO}0` }),
          commande('CMD-AUTRE-TENTATIVE', { orderNumber: `${NUMERO}-r2` }),
          commande('CMD-CASSE', { orderNumber: NUMERO.toUpperCase() }),
        ]),
    });

    const { supabase, ecritures } = makeSupabase();
    await reprendre(supabase);

    expect(h.postOrder).toHaveBeenCalledOnce();
    expect(enregistrees(ecritures)).toEqual(['CMD-NEUVE']);
  });

  it.each(['OK', 'PARTIAL', 'ARCHIVED'] as const)(
    'M1.5a/reconciliation_creation_commande_terminee — une commande %s du même numéro arrête la reprise : échec définitif, ni reprise ni nouvelle création',
    async (statut) => {
      // Commande terminée ou archivée sous ce numéro : rien ne repart seul.
      const h = armer({
        scanOrdersByDateRange: vi
          .fn()
          .mockResolvedValue([
            commande('CMD-FAITE', { customerOrderStatus: statut }),
          ]),
      });
      const { supabase, ecritures } = makeSupabase();

      const reprise = reprendre(supabase);

      await expect(reprise).rejects.toBeInstanceOf(LogistiquePermanentError);
      await expect(reprise).rejects.toThrow(
        `collecte col-rech-001 : une commande de clé ${NUMERO} est déjà terminée chez MTS-1 (CMD-FAITE ${statut}) — ni reprise ni nouvelle création`,
      );
      expect(h.postOrder).not.toHaveBeenCalled();
      // Rien n'est enregistré côté Savr : la commande n'est pas adoptée.
      expect(ecritures.filter((e) => e.table === 'tournees')).toHaveLength(0);
    },
  );

  it('M1.5a/reconciliation_creation_terminee_identifiant_illisible — commande terminée dont l’identifiant sort de l’alphabet adopté : l’arrêt a lieu, et le message ne recopie pas l’identifiant', async () => {
    const h = armer({
      scanOrdersByDateRange: vi
        .fn()
        .mockResolvedValue([
          commande('../v3/x?y', { customerOrderStatus: 'OK' }),
        ]),
    });

    const reprise = reprendre(makeSupabase().supabase);

    await expect(reprise).rejects.toThrow(
      `collecte col-rech-001 : une commande de clé ${NUMERO} est déjà terminée chez MTS-1 (identifiant illisible OK) — ni reprise ni nouvelle création`,
    );
    expect(h.postOrder).not.toHaveBeenCalled();
  });

  it('M1.5a/reconciliation_creation_terminee_et_en_cours — une commande terminée ET une commande en cours du même numéro : échec définitif, la commande en cours n’est pas reprise', async () => {
    const lot = [
      commande('CMD-EN-COURS', { customerOrderStatus: 'VALIDATED' }),
      commande('CMD-FAITE', { customerOrderStatus: 'OK' }),
    ];
    for (const ordre of [lot, [...lot].reverse()]) {
      const h = armer({
        scanOrdersByDateRange: vi.fn().mockResolvedValue(ordre),
      });
      const { supabase, ecritures } = makeSupabase();

      await expect(reprendre(supabase)).rejects.toBeInstanceOf(
        LogistiquePermanentError,
      );
      expect(h.postOrder).not.toHaveBeenCalled();
      expect(ecritures.filter((e) => e.table === 'tournees')).toHaveLength(0);
    }
  });

  it('M1.5a/reconciliation_creation_terminee_autre_numero — une commande terminée d’un AUTRE numéro n’arrête rien : la création part', async () => {
    // Le filtre distant est rejoué ici : une réponse plus large que demandé ne
    // doit pas tuer l'ordre d'un autre rang.
    const h = armer({
      scanOrdersByDateRange: vi.fn().mockResolvedValue([
        commande('CMD-AUTRE-RANG', {
          orderNumber: 'col-rech-001-2',
          customerOrderStatus: 'OK',
        }),
      ]),
    });

    const { supabase, ecritures } = makeSupabase();
    await reprendre(supabase);

    expect(h.postOrder).toHaveBeenCalledOnce();
    expect(enregistrees(ecritures)).toEqual(['CMD-NEUVE']);
  });

  it.each(['CANCELED', 'KO'] as const)(
    'M1.5a/reconciliation_creation_commande_morte — une commande %s du même numéro n’est jamais reprise',
    async (statut) => {
      // La reprendre ferait croire commandé un camion qui ne viendra pas.
      const h = armer({
        scanOrdersByDateRange: vi
          .fn()
          .mockResolvedValue([
            commande('CMD-MORTE', { customerOrderStatus: statut }),
          ]),
      });

      const { supabase, ecritures } = makeSupabase();
      await reprendre(supabase);

      expect(h.postOrder).toHaveBeenCalledOnce();
      expect(enregistrees(ecritures)).toEqual(['CMD-NEUVE']);
    },
  );

  it('M1.5a/reconciliation_creation_doublons — plusieurs commandes du même numéro : choix stable, doublons tracés', async () => {
    // Plusieurs commandes coexistent sous un même numéro chez MTS-1 (jusqu'à 25
    // mesurées) et l'ordre de la réponse n'est pas garanti.
    const lot = [
      commande('CMD-B'),
      commande('CMD-MORTE', { customerOrderStatus: 'CANCELED' }),
      // Classée AVANT « CMD-A » : si elle n'était pas écartée, c'est elle que le
      // tri retiendrait.
      commande('CMD-0-EN-ECHEC', { customerOrderStatus: 'KO' }),
      commande('CMD-A', { customerOrderStatus: 'VALIDATED' }),
      commande('CMD-C'),
    ];
    for (const ordre of [lot, [...lot].reverse()]) {
      const h = armer({
        scanOrdersByDateRange: vi.fn().mockResolvedValue(ordre),
      });
      const { supabase, ecritures } = makeSupabase();

      await reprendre(supabase);

      expect(h.postOrder).not.toHaveBeenCalled();
      expect(enregistrees(ecritures)).toEqual(['CMD-A']);
      const traces = ecritures.filter(
        (e) =>
          e.table === 'integrations_logs' &&
          String((e.data as { erreur?: string }).erreur).startsWith(
            'COMMANDES_EN_DOUBLE',
          ),
      );
      expect(traces).toHaveLength(1);
      expect(traces[0]!.data).toMatchObject({
        integration: 'mts1',
        correlation_id: NUMERO,
        erreur:
          'COMMANDES_EN_DOUBLE: 3 commandes portent cette clé (CMD-A, CMD-B, CMD-C), reprise sur CMD-A',
      });
    }
  });

  it.each([
    ['une seule commande retrouvée', [commande('CMD-SEULE')]],
    [
      'la même commande rendue deux fois',
      [commande('CMD-SEULE'), commande('CMD-SEULE')],
    ],
  ])(
    'M1.5a/reconciliation_creation_sans_doublon_sans_trace — %s : aucune trace de doublon',
    async (_cas, rendues) => {
      const h = armer({
        scanOrdersByDateRange: vi.fn().mockResolvedValue(rendues),
      });
      const { supabase, ecritures } = makeSupabase();

      await reprendre(supabase);

      expect(h.postOrder).not.toHaveBeenCalled();
      expect(enregistrees(ecritures)).toEqual(['CMD-SEULE']);

      expect(
        ecritures.filter((e) =>
          String(
            (e.data as { erreur?: string } | undefined)?.erreur,
          ).startsWith('COMMANDES_EN_DOUBLE'),
        ),
      ).toEqual([]);
    },
  );

  it('M1.5a/reconciliation_creation_recherche_en_echec — une recherche en erreur ne vaut pas « commande absente » : aucun POST', async () => {
    const h = armer({
      scanOrdersByDateRange: vi
        .fn()
        .mockRejectedValue(
          new LogistiqueTransientError('MTS-1 500 : INTERNAL_ERROR'),
        ),
    });

    await expect(reprendre(makeSupabase().supabase)).rejects.toBeInstanceOf(
      LogistiqueTransientError,
    );
    expect(h.postOrder).not.toHaveBeenCalled();
  });

  it('M1.5a/reconciliation_creation_hors_reprise — sans reprise, aucune recherche : la création part directement', async () => {
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([]);
    const h = armer({ scanOrdersByDateRange });

    await new AdapterMts1(
      TRANSPORTEUR,
      makeSupabase().supabase,
    ).dispatchCollecte(COLLECTE, 1);

    expect(scanOrdersByDateRange).not.toHaveBeenCalled();
    expect(h.postOrder).toHaveBeenCalledOnce();
  });
});

// ─── E1 sur le chemin réel ────────────────────────────────────────────────────

describe('M1.5a / réconciliation d’une création reprise — chemin réel (wire)', () => {
  beforeEach(() => {
    _setMts1Handlers(null); // force le chemin réel (fetch)
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Simule MTS-1 route par route ; journalise « MÉTHODE adresse » et les corps.
  function stubMts1(recherche: { status: number; corps: unknown }) {
    const appels: Array<{ ligne: string; corps: unknown }> = [];
    const fetchMock = vi.fn(
      async (url: string, init: { method: string; body?: string }) => {
        const chemin = url.replace('https://mts1.test', '');
        appels.push({
          ligne: `${init.method} ${chemin}`,
          corps: init.body ? (JSON.parse(init.body) as unknown) : undefined,
        });
        const estRecherche =
          init.method === 'GET' && chemin.startsWith('/v3/customerOrders?');
        const status = estRecherche ? recherche.status : 200;
        const corps = estRecherche
          ? recherche.corps
          : init.method === 'POST' && chemin === '/v3/customerOrders'
            ? { customerOrderId: 'CMD-NEUVE', orderNumber: NUMERO }
            : init.method === 'POST' && chemin === '/v3/tours'
              ? { tourId: 'TOUR-REEL' }
              : {};
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(corps),
          json: async () => corps,
        };
      },
    );
    vi.stubGlobal('fetch', fetchMock as never);
    return appels;
  }

  const reprendre = (
    supabase: import('@supabase/supabase-js').SupabaseClient = makeSupabase()
      .supabase,
  ) =>
    new AdapterMts1(TRANSPORTEUR, supabase).dispatchCollecte(COLLECTE, 1, {
      requiresReconciliation: true,
    });

  it('M1.5a/reconciliation_creation_fil — la commande déjà créée est retrouvée par l’adresse réelle et reprise sans second POST', async () => {
    const appels = stubMts1({
      status: 200,
      // Tableau nu, vrais noms de champs, comme sur le fil.
      corps: [
        {
          customerOrderId: '65a1b2c3d4e5f60718293a4b',
          orderNumber: NUMERO,
          customerOrderStatus: 'DRAFT',
          orderDate: '2026-07-15T20:00:00.000Z',
          currentTour: { tourDate: '2026-07-15T20:00:00.000Z' },
        },
      ],
    });

    const { supabase, ecritures } = makeSupabase();
    await reprendre(supabase);

    // Pas de second POST de commande ; la commande retrouvée n'est dans aucune
    // tournée : sa tournée unitaire est créée et elle y est rattachée, sans envoi
    // au transporteur ni validation.
    expect(appels.map((a) => a.ligne)).toEqual([
      'GET /v3/customerOrders?minDate=2026-07-14&maxDate=2026-07-16',
      'POST /v3/tours',
      'PUT /v3/tours/addCustomerOrder',
    ]);
    expect(appels[2]!.corps).toEqual({
      tourId: 'TOUR-REEL',
      customerOrderId: '65a1b2c3d4e5f60718293a4b',
    });
    expect(enregistrees(ecritures)).toEqual(['65a1b2c3d4e5f60718293a4b']);
  });

  it('M1.5a/reconciliation_creation_fil_absente — tableau vide : la commande n’existe pas, le POST repart', async () => {
    const appels = stubMts1({ status: 200, corps: [] });

    await reprendre();

    expect(appels.map((a) => a.ligne).slice(0, 2)).toEqual([
      'GET /v3/customerOrders?minDate=2026-07-14&maxDate=2026-07-16',
      'POST /v3/customerOrders',
    ]);
  });

  it('M1.5a/reconciliation_creation_fil_tentative — rang réattribué : la création porte la clé suffixée de la tentative, que la recherche reconnaît', async () => {
    // Sans le suffixe, la reprise chercherait la commande de la tentative
    // précédente et, ne trouvant rien de vivant, en créerait une de plus.
    const appels = stubMts1({ status: 200, corps: [] });
    const reattribuee: TourneeFixture = {
      ...tournee(1, 'INUTILE'),
      reference_interne: 'TMS-col-rech-001-1-r2',
      external_ref_commande: null,
      tms_reference: null,
      statut: 'planifiee',
    };

    await new AdapterMts1(
      TRANSPORTEUR,
      makeSupabase([reattribuee]).supabase,
    ).dispatchCollecte(COLLECTE, 1, { requiresReconciliation: true });

    expect(appels[0]!.ligne).toBe(
      'GET /v3/customerOrders?minDate=2026-07-14&maxDate=2026-07-16',
    );
    expect(appels[1]!.ligne).toBe('POST /v3/customerOrders');
    expect(appels[1]!.corps).toMatchObject({
      orderNumber: 'Salle Pleyel · col-rech-001-1-r2',
    });
  });

  it.each([
    [
      'un 500 de MTS-1',
      { status: 500, corps: { reasons: ['INTERNAL_ERROR'] } },
    ],
    [
      'l’enveloppe supposée { customerOrders }',
      { status: 200, corps: { customerOrders: [] } },
    ],
  ])(
    'M1.5a/reconciliation_creation_fil_illisible — %s : erreur passagère, aucun POST',
    async (_cas, recherche) => {
      const appels = stubMts1(recherche);

      await expect(reprendre()).rejects.toBeInstanceOf(
        LogistiqueTransientError,
      );
      expect(appels.map((a) => a.ligne)).toEqual([
        'GET /v3/customerOrders?minDate=2026-07-14&maxDate=2026-07-16',
      ]);
    },
  );
});

// ─── E2 : modification reprise ────────────────────────────────────────────────

describe('M1.5a / modification reprise (E2)', () => {
  const COLLECTE_2: Collecte = { ...COLLECTE, nb_camions_demande: 2 };
  const modifier = (tournees: TourneeFixture[]) =>
    new AdapterMts1(
      TRANSPORTEUR,
      makeSupabase(tournees).supabase,
    ).updateCollecte(COLLECTE_2, { requiresReconciliation: true });

  it('M1.5a/reprise_modification_par_identifiant — l’existence se lit par identifiant, jamais par fenêtre de dates', async () => {
    const findOrdersByIds = vi
      .fn()
      .mockResolvedValue([commande('CMD-1'), commande('CMD-2')]);
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([]);
    const h = armer({ findOrdersByIds, scanOrdersByDateRange });

    await expect(
      modifier([tournee(1, 'CMD-1'), tournee(2, 'CMD-2')]),
    ).resolves.toBe('adapter_mts1');

    expect(findOrdersByIds).toHaveBeenCalledOnce();
    expect(findOrdersByIds).toHaveBeenCalledWith(['CMD-1', 'CMD-2']);
    // La collecte vient peut-être de changer de date : une fenêtre autour de sa
    // nouvelle date manquerait la commande, restée à l'ancienne chez MTS-1.
    expect(scanOrdersByDateRange).not.toHaveBeenCalled();
    expect(h.updateOrder.mock.calls.map((c) => c[0])).toEqual([
      'CMD-1',
      'CMD-2',
    ]);
  });

  it('M1.5a/reprise_modification_commande_disparue — commande absente chez MTS-1 : échec définitif, les autres rangs sont modifiés', async () => {
    // Avant : l'ordre était clos en succès sans PUT, la modification perdue.
    const h = armer({
      findOrdersByIds: vi.fn().mockResolvedValue([commande('CMD-2')]),
    });

    const essai = modifier([tournee(1, 'CMD-1'), tournee(2, 'CMD-2')]);
    await expect(essai).rejects.toBeInstanceOf(LogistiquePermanentError);
    await expect(essai).rejects.toThrow(
      "collecte col-rech-001 : commande introuvable chez MTS-1 pour le rang 1 (CMD-1) — la modification n'a pas été transmise",
    );
    expect(h.updateOrder.mock.calls.map((c) => c[0])).toEqual(['CMD-2']);
  });

  it('M1.5a/reprise_modification_disparue_sans_augmentation — commande disparue : le camion supplémentaire demandé n’est pas commandé dans cet ordre', async () => {
    // La collecte demande 3 camions, 2 sont commandés. L'échec arrête l'ordre
    // avant la création du 3e : il n'est pas commandé tant que le rang dont la
    // commande a disparu n'est pas traité.
    const h = armer({
      findOrdersByIds: vi.fn().mockResolvedValue([commande('CMD-2')]),
    });

    await expect(
      new AdapterMts1(
        TRANSPORTEUR,
        makeSupabase([tournee(1, 'CMD-1'), tournee(2, 'CMD-2')]).supabase,
      ).updateCollecte(
        { ...COLLECTE, nb_camions_demande: 3 },
        { requiresReconciliation: true },
      ),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);
    expect(h.updateOrder.mock.calls.map((c) => c[0])).toEqual(['CMD-2']);
    expect(h.postOrder).not.toHaveBeenCalled();
  });

  it('M1.5a/reprise_modification_recherche_en_echec — une lecture en erreur ne vaut pas « commande disparue »', async () => {
    const h = armer({
      findOrdersByIds: vi
        .fn()
        .mockRejectedValue(
          new LogistiqueTransientError('MTS-1 500 : INTERNAL_ERROR'),
        ),
    });

    await expect(
      modifier([tournee(1, 'CMD-1'), tournee(2, 'CMD-2')]),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    expect(h.updateOrder).not.toHaveBeenCalled();
  });

  it('M1.5a/reprise_modification_hors_reprise — sans reprise, aucune lecture préalable', async () => {
    const findOrdersByIds = vi.fn().mockResolvedValue([]);
    const h = armer({ findOrdersByIds });

    await new AdapterMts1(
      TRANSPORTEUR,
      makeSupabase([tournee(1, 'CMD-1'), tournee(2, 'CMD-2')]).supabase,
    ).updateCollecte(COLLECTE_2);

    expect(findOrdersByIds).not.toHaveBeenCalled();
    expect(h.updateOrder).toHaveBeenCalledTimes(2);
  });
});

// ─── E3 : annulation reprise ──────────────────────────────────────────────────

describe('M1.5a / annulation reprise (E3)', () => {
  const annuler = (tournees: TourneeFixture[]) =>
    new AdapterMts1(
      TRANSPORTEUR,
      makeSupabase(tournees).supabase,
    ).cancelCollecte(COLLECTE, { requiresReconciliation: true });

  it('M1.5a/reprise_annulation_par_identifiant — seules les commandes encore présentes chez MTS-1 sont supprimées', async () => {
    const findOrdersByIds = vi.fn().mockResolvedValue([commande('CMD-2')]);
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([]);
    const h = armer({ findOrdersByIds, scanOrdersByDateRange });
    const { supabase, ecritures } = makeSupabase([
      tournee(1, 'CMD-1'),
      tournee(2, 'CMD-2'),
    ]);

    await expect(
      new AdapterMts1(TRANSPORTEUR, supabase).cancelCollecte(COLLECTE, {
        requiresReconciliation: true,
      }),
    ).resolves.toBe('adapter_mts1');

    expect(findOrdersByIds).toHaveBeenCalledOnce();
    expect(findOrdersByIds).toHaveBeenCalledWith(['CMD-1', 'CMD-2']);
    expect(scanOrdersByDateRange).not.toHaveBeenCalled();
    // CMD-1 n'est plus rendue : elle est tenue pour déjà annulée, aucun DELETE.
    expect(h.deleteOrder.mock.calls.map((c) => c[0])).toEqual(['CMD-2']);
    // Seul chemin clos en succès sans rien envoyer : il laisse une trace, et une
    // seule (rien pour CMD-2, dont le DELETE est parti).
    const traces = ecritures
      .filter((e) => e.table === 'integrations_logs')
      .map((e) => e.data as Record<string, unknown>)
      .filter((d) => String(d['erreur']).startsWith('ANNULATION_SANS_DELETE'));
    expect(traces).toEqual([
      {
        integration: 'mts1',
        direction: 'sortant',
        methode: 'GET',
        endpoint: '/v3/customerOrders',
        correlation_id: NUMERO_ENVOYE,
        erreur:
          'ANNULATION_SANS_DELETE: commande CMD-1 absente chez MTS-1 à la reprise, tenue pour déjà annulée',
      },
    ]);
  });

  it('M1.5a/reprise_annulation_recherche_en_echec — une lecture en erreur ne vaut pas « déjà annulée » : rien n’est clos', async () => {
    const h = armer({
      findOrdersByIds: vi
        .fn()
        .mockRejectedValue(
          new LogistiqueTransientError('MTS-1 500 : INTERNAL_ERROR'),
        ),
    });

    await expect(annuler([tournee(1, 'CMD-1')])).rejects.toBeInstanceOf(
      LogistiqueTransientError,
    );
    expect(h.deleteOrder).not.toHaveBeenCalled();
  });
});
