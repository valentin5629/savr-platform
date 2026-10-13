import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
} from '../index.js';
import { estIdentifiantMts1, Mts1Client } from './client.js';
import type { Mts1Handlers } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// Identifiants MTS-1 dans les chemins, et forme d'un identifiant adopté.
//
// Six appels placent un identifiant dans un chemin (commande ou tournée). Lu en
// base ou rendu par MTS-1, il partait tel quel : avec des caractères de chemin,
// il visait une autre route du même hôte. Il est désormais encodé, et refusé
// quand l'encodage ne suffit pas (vide, « . », « .. », valeur qui n'est pas une
// chaîne, chaîne non encodable).
//
// Mesuré le 2026-10-13 sur le compte de démonstration, en lecture seule : les
// 98 identifiants distincts relevés, commandes et tournées, ont tous 24
// caractères hexadécimaux minuscules, et l'encodage n'en modifie aucun. Les
// valeurs de ce fichier sont inventées.
//
// Tests sur le fil : chemin réel (fetch), sauf mention contraire. L'adoption
// par la réconciliation (worker → adapter → client) est jouée dans
// adapter.reprise-curseurs.test.ts.

let journal: Array<Record<string, unknown>> = [];
const fakeSupabase = {
  from: () => ({
    insert: async (ligne: Record<string, unknown>) => {
      journal.push(ligne);
      return { error: null };
    },
  }),
} as never;

function stubFetchOk(corps: unknown = {}) {
  const fetchMock = vi.fn(async (_url: string, _init: { method: string }) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(corps),
    json: async () => corps,
  }));
  vi.stubGlobal('fetch', fetchMock as never);
  return fetchMock;
}

type Appel = (client: Mts1Client, identifiant: string) => Promise<unknown>;

// Les six appels qui placent un identifiant dans un chemin :
// [méthode du client, verbe, chemin avant l'identifiant, chemin après, appel].
const ROUTES: Array<[string, string, string, string, Appel]> = [
  [
    'dispatchTour',
    'POST',
    '/v3/dispatch/',
    '/toCarrier',
    (c, id) => c.dispatchTour(id, 'CA_1', 'corr'),
  ],
  [
    'validateTour',
    'PUT',
    '/v3/tours/',
    '/validate',
    (c, id) => c.validateTour(id, 'corr'),
  ],
  [
    'updateOrder',
    'PUT',
    '/v3/customerOrders/',
    '',
    (c, id) => c.updateOrder(id, {}, 'corr'),
  ],
  [
    'deleteOrder',
    'DELETE',
    '/v3/customerOrders/',
    '',
    (c, id) => c.deleteOrder(id, 'corr'),
  ],
  ['getTour', 'GET', '/v3/tours/', '', (c, id) => c.getTour(id)],
  ['getPhotos', 'GET', '/v3/tours/', '/photos', (c, id) => c.getPhotos(id)],
];

// Identifiant forgé pour viser une autre route, avec requête et fragment.
const FORGE = '../customerOrders/x?y=1#z';
const FORGE_ENCODE = '..%2FcustomerOrders%2Fx%3Fy%3D1%23z';
// Forme mesurée : 24 caractères hexadécimaux minuscules.
const MESURE = '0123456789abcdef01234567';

describe('M1.5a / MTS-1 client — identifiant dans un chemin (fil)', () => {
  beforeEach(() => {
    journal = [];
    _setMts1Handlers(null); // force le chemin réel (fetch)
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  it('témoin — parti tel quel, l’identifiant forgé vise une autre route, et « .. » sort intact de l’encodage', () => {
    const brut = new URL(`https://mts1.test/v3/tours/${FORGE}/validate`);
    expect(brut.pathname).toBe('/v3/customerOrders/x');
    expect(brut.search).toBe('?y=1');

    expect(encodeURIComponent('..')).toBe('..');
    expect(new URL('https://mts1.test/v3/tours/../validate').pathname).toBe(
      '/v3/validate',
    );
    expect(new URL('https://mts1.test/v3/customerOrders/.').pathname).toBe(
      '/v3/customerOrders/',
    );
  });

  it.each(ROUTES)(
    'M1.5a/chemin_identifiant_encode (%s) — un identifiant à caractères de chemin part encodé, dans un seul segment : la route appelée reste celle de la méthode',
    async (_nom, verbe, avant, apres, appel) => {
      const fetchMock = stubFetchOk();

      await appel(new Mts1Client(fakeSupabase), FORGE);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(init.method).toBe(verbe);
      expect(url).toBe(`https://mts1.test${avant}${FORGE_ENCODE}${apres}`);
      // Ce qu'en lit un serveur : la route de la méthode, l'identifiant entier
      // dans son segment, ni requête ni fragment.
      const lue = new URL(url);
      expect(lue.pathname).toBe(`${avant}${FORGE_ENCODE}${apres}`);
      expect(lue.search).toBe('');
      expect(lue.hash).toBe('');
      expect(decodeURIComponent(FORGE_ENCODE)).toBe(FORGE);
      // Le journal porte le chemin réellement appelé.
      expect(journal.at(-1)).toMatchObject({
        methode: verbe,
        endpoint: `${avant}${FORGE_ENCODE}${apres}`,
      });
    },
  );

  it.each(ROUTES)(
    'M1.5a/chemin_identifiant_mesure_inchange (%s) — un identifiant de la forme mesurée part tel quel',
    async (_nom, verbe, avant, apres, appel) => {
      const fetchMock = stubFetchOk();

      await appel(new Mts1Client(fakeSupabase), MESURE);

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(init.method).toBe(verbe);
      expect(url).toBe(`https://mts1.test${avant}${MESURE}${apres}`);
    },
  );

  // Ce que l'encodage ne neutralise pas. Les deux derniers ne sont pas des
  // chaînes : la signature les interdit, pas l'exécution.
  const INUTILISABLES: Array<[string, string]> = [
    ['vide', ''],
    ['« . »', '.'],
    ['« .. »', '..'],
    ['un demi-caractère UTF-16 isolé', 'a\uD800b'],
    ['un tableau lu « .. »', ['..'] as unknown as string],
    ['un objet lu « .. »', { toString: () => '..' } as unknown as string],
  ];

  it.each(
    ROUTES.flatMap(([nom, , , , appel]) =>
      INUTILISABLES.map(([cas, id]) => [nom, cas, id, appel] as const),
    ),
  )(
    'M1.5a/chemin_identifiant_relatif_refuse (%s, %s) — refusé par la méthode avant son appel, échec définitif',
    async (_nom, _cas, id, appel) => {
      const fetchMock = stubFetchOk();

      const envoi = appel(new Mts1Client(fakeSupabase), id);

      await expect(envoi).rejects.toBeInstanceOf(LogistiquePermanentError);
      await expect(envoi).rejects.toThrow(
        'MTS-1 : identifiant inutilisable dans un chemin (vide, « . », « .. » ou non encodable)',
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(journal).toHaveLength(0);
    },
  );
});

// Même règle quand MTS-1 est simulé par des handlers (tests des adapters).
describe('M1.5a / MTS-1 client — identifiant dans un chemin (handlers simulés)', () => {
  beforeEach(() => {
    journal = [];
  });
  afterEach(() => _setMts1Handlers(null));

  const handlers = (surcharge: Partial<Mts1Handlers>): Mts1Handlers => ({
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder: vi.fn(),
    ...surcharge,
  });

  it.each(ROUTES)(
    'M1.5a/chemin_identifiant_simule_refuse (%s) — « .. » est refusé avant le handler, rien au journal',
    async (nom, _verbe, _avant, _apres, appel) => {
      const handler = vi.fn(async (..._args: unknown[]) => ({}));
      _setMts1Handlers(handlers({ [nom]: handler } as Partial<Mts1Handlers>));

      await expect(
        appel(new Mts1Client(fakeSupabase), '..'),
      ).rejects.toBeInstanceOf(LogistiquePermanentError);
      expect(handler).not.toHaveBeenCalled();
      expect(journal).toHaveLength(0);
    },
  );

  it.each(ROUTES)(
    'M1.5a/chemin_identifiant_simule_journal (%s) — le handler reçoit l’identifiant, le journal porte le chemin encodé',
    async (nom, verbe, avant, apres, appel) => {
      const handler = vi.fn(async (..._args: unknown[]) => ({}));
      _setMts1Handlers(handlers({ [nom]: handler } as Partial<Mts1Handlers>));

      await appel(new Mts1Client(fakeSupabase), FORGE);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]![0]).toBe(FORGE);
      expect(journal.at(-1)).toMatchObject({
        methode: verbe,
        endpoint: `${avant}${FORGE_ENCODE}${apres}`,
      });
    },
  );
});

// Un identifiant que Savr adopte va dans `tournees.external_ref_commande` ou
// `tms_reference`, puis dans les chemins ci-dessus.
const HORS_ALPHABET: Array<[string, unknown]> = [
  ['une barre oblique', 'a/b'],
  ['une remontée de chemin', '../x'],
  ['deux points seuls', '..'],
  ['un point', 'a.b'],
  ['un point d’interrogation', 'a?b'],
  ['un croisillon', 'a#b'],
  ['un pourcent', 'a%2Fb'],
  ['une espace', 'a b'],
  ['un saut de ligne final', 'abc\n'],
  ['une lettre accentuée', 'é1'],
  ['129 caractères', 'a'.repeat(129)],
];
const DANS_ALPHABET: Array<[string, string]> = [
  ['la forme mesurée', MESURE],
  ['majuscules, tiret et souligné', 'Ab-9_Z'],
  ['128 caractères', 'a'.repeat(128)],
];

describe('M1.5a / MTS-1 — alphabet d’un identifiant adopté', () => {
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

  it.each(HORS_ALPHABET)(
    'M1.5a/identifiant_alphabet_refuse — %s : hors de l’alphabet',
    (_cas, valeur) => {
      expect(estIdentifiantMts1(valeur)).toBe(false);
    },
  );

  it.each([
    ['une chaîne vide', ''],
    ['un nombre', 42],
    ['null', null],
    ['undefined', undefined],
    ['un tableau', ['abc']],
    ['un objet', { id: 'abc' }],
  ] as Array<[string, unknown]>)(
    'M1.5a/identifiant_alphabet_refuse — %s : pas un identifiant',
    (_cas, valeur) => {
      expect(estIdentifiantMts1(valeur)).toBe(false);
    },
  );

  it.each(DANS_ALPHABET)(
    'M1.5a/identifiant_alphabet_accepte — %s',
    (_cas, valeur) => {
      expect(estIdentifiantMts1(valeur)).toBe(true);
    },
  );

  it.each(HORS_ALPHABET)(
    'M1.5a/creation_commande_identifiant_hors_alphabet — 201 dont l’identifiant porte %s → erreur ambiguë, il n’est pas rendu',
    async (_cas, valeur) => {
      stubFetchOk({ customerOrderId: valeur, orderNumber: 'col-1-1' });

      const envoi = new Mts1Client(fakeSupabase).postOrder({
        orderNumber: 'col-1-1',
      } as unknown as Parameters<Mts1Client['postOrder']>[0]);

      await expect(envoi).rejects.toBeInstanceOf(LogistiqueAmbiguousError);
      await expect(envoi).rejects.toThrow(
        'MTS-1 POST /v3/customerOrders : création acceptée, mais « customerOrderId » est illisible dans la réponse',
      );
    },
  );

  it.each(HORS_ALPHABET)(
    'M1.5a/creation_tournee_identifiant_hors_alphabet — 201 dont l’identifiant porte %s → erreur ambiguë, il n’est pas rendu',
    async (_cas, valeur) => {
      stubFetchOk({ tourId: valeur });

      const envoi = new Mts1Client(fakeSupabase).createTour({
        orderNumber: 'col-1-1',
        tourDate: '2027-03-20',
      });

      await expect(envoi).rejects.toBeInstanceOf(LogistiqueAmbiguousError);
      await expect(envoi).rejects.toThrow(
        'MTS-1 POST /v3/tours : création acceptée, mais « tourId » est illisible dans la réponse',
      );
    },
  );

  it.each(DANS_ALPHABET)(
    'M1.5a/creation_identifiant_dans_alphabet — 201 avec %s → commande et tournée rendues telles quelles',
    async (_cas, valeur) => {
      stubFetchOk({ customerOrderId: valeur, tourId: valeur });
      const client = new Mts1Client(fakeSupabase);

      const commande = await client.postOrder({
        orderNumber: 'col-1-1',
      } as unknown as Parameters<Mts1Client['postOrder']>[0]);
      const tournee = await client.createTour({
        orderNumber: 'col-1-1',
        tourDate: '2027-03-20',
      });

      expect(commande.id).toBe(valeur);
      expect(tournee.tourId).toBe(valeur);
    },
  );
});
