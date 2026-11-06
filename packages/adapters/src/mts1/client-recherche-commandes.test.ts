import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import { Mts1Client } from './client.js';
import { _setMts1Handlers } from './mock.js';

// Tests « wire » de la recherche de commandes : chemin réel (fetch, handlers à
// null), adresse EXACTE et forme de la réponse telles que mesurées sur le compte
// de démonstration le 2026-10-13 (lecture seule). Les handlers simulés de
// `mock.ts` ne voient ni l'adresse ni l'enveloppe : c'est par eux que la forme
// supposée (`{ customerOrders }`, `id`, `externalReference`, instants ISO) était
// restée verte alors que l'API répondait 500.

const fakeSupabase = {
  from: () => ({ insert: async () => ({ error: null }) }),
} as never;

// Une commande telle que la rend l'API (champs utiles + quelques voisins réels).
// La FORME est celle du fil ; les valeurs sont inventées (dépôt public).
const COMMANDE_REELLE = {
  customerOrderId: '65a1b2c3d4e5f60718293a4b',
  customerOrderStatus: 'VALIDATED',
  orderDate: '2026-10-16T09:30:00.000Z',
  orderDateMode: 'TOUR_DATE',
  orderNumber: '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9-1',
  timezone: 'Europe/Paris',
  currentTour: {
    tourId: '65a1b2c3d4e5f60718293a4c',
    stopId: 'ArretInventeAbCdEfGhIj',
    tourDate: '2026-10-16T09:30:00.000Z',
  },
};

function stubFetch(
  body: unknown,
  status = 200,
): ReturnType<
  typeof vi.fn<(url: string, init: { method: string }) => unknown>
> {
  const fetchMock = vi.fn(async (_url: string, _init: { method: string }) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetchMock as never);
  return fetchMock;
}

describe('M1.5a / MTS-1 client — recherche de commandes (wire)', () => {
  beforeEach(() => {
    _setMts1Handlers(null); // force le chemin réel (fetch)
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  it('M1.5a/recherche_fil_fenetre_en_jours — GET /v3/customerOrders?minDate&maxDate en yyyy-MM-dd, sans pageSize', async () => {
    const fetchMock = stubFetch([COMMANDE_REELLE]);
    await new Mts1Client(fakeSupabase).scanOrdersByDateRange(
      '2026-10-14',
      '2026-10-17',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    // Adresse mesurée en 200. La forme d'avant
    // (…minDate=2026-10-14T22%3A00%3A00.000Z…&pageSize=200) répond 500.
    expect(url).toBe(
      'https://mts1.test/v3/customerOrders?minDate=2026-10-14&maxDate=2026-10-17',
    );
    expect(init.method).toBe('GET');
  });

  it('M1.5a/recherche_fil_filtre_numero — le numéro de commande part en filtre, avec les deux jours', async () => {
    const fetchMock = stubFetch([COMMANDE_REELLE]);
    await new Mts1Client(fakeSupabase).scanOrdersByDateRange(
      '2026-10-15',
      '2026-10-17',
      '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9-1',
    );

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://mts1.test/v3/customerOrders?minDate=2026-10-15&maxDate=2026-10-17&orderNumber=1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9-1',
    );
  });

  it('M1.5a/recherche_fil_numero_encode — un numéro qui porterait des caractères d’adresse est encodé, jamais recopié', async () => {
    // Un numéro tel que « a&customerOrderIds=x » ne doit pas ajouter de paramètre.
    const fetchMock = stubFetch([]);
    await new Mts1Client(fakeSupabase).scanOrdersByDateRange(
      '2026-10-15',
      '2026-10-17',
      'a&customerOrderIds=x #/?',
    );

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://mts1.test/v3/customerOrders?minDate=2026-10-15&maxDate=2026-10-17&orderNumber=a%26customerOrderIds%3Dx+%23%2F%3F',
    );
  });

  it('M1.5a/recherche_fil_tableau_nu — la réponse est un tableau nu, lu avec ses vrais champs', async () => {
    stubFetch([COMMANDE_REELLE]);
    const commandes = await new Mts1Client(fakeSupabase).scanOrdersByDateRange(
      '2026-10-14',
      '2026-10-17',
    );

    expect(commandes).toHaveLength(1);
    expect(commandes[0]!.customerOrderId).toBe('65a1b2c3d4e5f60718293a4b');
    expect(commandes[0]!.orderNumber).toBe(
      '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9-1',
    );
    expect(commandes[0]!.customerOrderStatus).toBe('VALIDATED');
  });

  it('M1.5a/recherche_fil_aucune_commande — un tableau vide est une réponse valide (aucune commande)', async () => {
    stubFetch([]);
    await expect(
      new Mts1Client(fakeSupabase).scanOrdersByDateRange(
        '2026-10-14',
        '2026-10-17',
      ),
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "l'enveloppe supposée { customerOrders }",
      { customerOrders: [COMMANDE_REELLE] },
    ],
    ['un objet creux', {}],
    ['null', null],
    [
      "une commande sans customerOrderId (l'ancienne forme supposée)",
      [{ id: 'X', externalReference: 'ref-1', status: 'PLANNED' }],
    ],
    [
      'une commande à identifiant vide',
      [{ ...COMMANDE_REELLE, customerOrderId: '' }],
    ],
    ['un élément null', [null]],
    [
      'un identifiant qui n’est pas un texte',
      [{ ...COMMANDE_REELLE, customerOrderId: 123 }],
    ],
  ])(
    'M1.5a/recherche_fil_forme_inattendue — %s : erreur passagère, jamais « aucune commande »',
    async (_cas, corps) => {
      stubFetch(corps);
      // Lue comme une liste vide, cette réponse autoriserait le re-POST d'une
      // commande peut-être déjà créée.
      await expect(
        new Mts1Client(fakeSupabase).scanOrdersByDateRange(
          '2026-10-14',
          '2026-10-17',
        ),
      ).rejects.toBeInstanceOf(LogistiqueTransientError);
    },
  );

  it.each([
    ['instants ISO', '2026-10-14T22:00:00.000Z', '2026-10-17T22:00:00.000Z'],
    [
      'un instant en borne haute seulement',
      '2026-10-14',
      '2026-10-17T22:00:00Z',
    ],
    ['bornes inversées', '2026-10-17', '2026-10-14'],
    ['borne vide', '', '2026-10-17'],
    // « - » se classe avant un chiffre : seule la forme du jour refuse ici, pas
    // le contrôle de l'ordre des bornes.
    ['texte avant le jour', '-2026-10-14', '2026-10-17'],
    ['texte après le jour', '2026-10-14', '2026-10-17x'],
  ])(
    'M1.5a/recherche_fil_refus_instant — %s : refusé avant tout appel',
    async (_cas, minDate, maxDate) => {
      // MTS-1 répond 500 INTERNAL_ERROR à ces formes : autant ne pas les envoyer.
      const fetchMock = stubFetch([]);
      await expect(
        new Mts1Client(fakeSupabase).scanOrdersByDateRange(minDate, maxDate),
      ).rejects.toBeInstanceOf(LogistiquePermanentError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('M1.5a/recherche_fil_refus_instant_simule — le refus vaut aussi sous handlers simulés', async () => {
    // Sans cela, un appelant qui repasserait des instants resterait vert en test.
    const scanOrdersByDateRange = vi.fn().mockResolvedValue([]);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      scanOrdersByDateRange,
    });
    await expect(
      new Mts1Client(fakeSupabase).scanOrdersByDateRange(
        '2026-10-14T22:00:00.000Z',
        '2026-10-17T22:00:00.000Z',
      ),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);
    expect(scanOrdersByDateRange).not.toHaveBeenCalled();
  });

  it('M1.5a/recherche_fil_erreur_500 — un 500 de la recherche reste une erreur passagère', async () => {
    stubFetch({ reasons: ['INTERNAL_ERROR'] }, 500);
    await expect(
      new Mts1Client(fakeSupabase).scanOrdersByDateRange(
        '2026-10-14',
        '2026-10-17',
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
  });

  it('M1.5a/recherche_fil_par_identifiants — GET /v3/customerOrders?customerOrderIds=a,b (virgule encodée)', async () => {
    const fetchMock = stubFetch([COMMANDE_REELLE]);
    const commandes = await new Mts1Client(fakeSupabase).findOrdersByIds([
      '65a1b2c3d4e5f60718293a4b',
      '65a1b2c3d4e5f60718293a4d',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://mts1.test/v3/customerOrders?customerOrderIds=65a1b2c3d4e5f60718293a4b%2C65a1b2c3d4e5f60718293a4d',
    );
    expect(init.method).toBe('GET');
    // L'identifiant inconnu est simplement absent du tableau rendu.
    expect(commandes.map((c) => c.customerOrderId)).toEqual([
      '65a1b2c3d4e5f60718293a4b',
    ]);
  });

  it('M1.5a/recherche_fil_par_identifiants_vide — aucun identifiant : aucun appel', async () => {
    // Sans identifiant ni dates, MTS-1 répond 400.
    const fetchMock = stubFetch([]);
    await expect(
      new Mts1Client(fakeSupabase).findOrdersByIds([]),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['une réponse qui n’est pas un tableau', { customerOrders: [] }],
    ['une commande sans customerOrderId', [{ orderNumber: 'ref-1' }]],
  ])(
    'M1.5a/recherche_fil_par_identifiants_forme — %s lève, elle ne dit pas « commande absente »',
    async (_cas, corps) => {
      stubFetch(corps);
      await expect(
        new Mts1Client(fakeSupabase).findOrdersByIds([
          '65a1b2c3d4e5f60718293a4b',
        ]),
      ).rejects.toBeInstanceOf(LogistiqueTransientError);
    },
  );
});

describe('M1.5b / MTS-1 client — référentiel transporteurs (wire)', () => {
  beforeEach(() => {
    _setMts1Handlers(null);
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  const TRANSPORTEUR_REEL = {
    name: 'Strike',
    carrierShareableCode: 'CA_INVENTE',
    transporters: [
      {
        firstname: 'Jean',
        lastname: 'Dupont',
        transporterShareableCode: 'TR_1',
      },
    ],
    vehicles: [
      {
        name: 'Camion 20',
        numberPlate: '12ABC23',
        vehicleShareableCode: 'VE_1',
      },
    ],
  };

  it('M1.5b/releve_fil_referentiel_transporteurs — GET /v3/carrier rend un tableau nu', async () => {
    const fetchMock = stubFetch([TRANSPORTEUR_REEL]);
    const carriers = await new Mts1Client(fakeSupabase).getCarrier();

    expect(fetchMock.mock.calls[0]![0]).toBe('https://mts1.test/v3/carrier');
    expect(carriers).toHaveLength(1);
    expect(carriers[0]!.vehicles[0]!.numberPlate).toBe('12ABC23');
  });

  it('M1.5b/releve_fil_referentiel_forme — l’enveloppe supposée { carriers } est refusée', async () => {
    stubFetch({ carriers: [TRANSPORTEUR_REEL] });
    await expect(
      new Mts1Client(fakeSupabase).getCarrier(),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
  });
});
