import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import { Mts1Client } from './client.js';
import type { Mts1Handlers } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// Réponse d'une CRÉATION chez MTS-1 (POST /v3/customerOrders, seule création
// depuis que l'Admin compose les tournées dans la console — décision Val
// 2026-10-15).
// Dès que MTS-1 a répondu 201, l'objet existe : si son identifiant n'est pas
// lisible, ce n'est ni un refus ni une erreur passagère. Le client lève une
// erreur AMBIGUË, que le worker range « à réconcilier » — rejouée telle quelle,
// la création ferait un second objet (API présumée non idempotente).
//
// Tests sur le fil : chemin réel (fetch), aucun handler simulé. La reprise
// complète (worker → adapter → client) est dans adapter.reprise-curseurs.test.ts.

const fakeSupabase = {
  from: () => ({ insert: async () => ({ error: null }) }),
} as never;

const COMMANDE = { orderNumber: 'col-1-1' } as unknown as Parameters<
  Mts1Client['postOrder']
>[0];

/** Corps de réponse qui n'est pas du JSON. */
const PAS_DU_JSON = Symbol('pas du JSON');

/** MTS-1 répond `status` avec ce corps. */
function stubFetch(status: number, corps: unknown) {
  const illisible = corps === PAS_DU_JSON;
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (illisible ? '<html>' : JSON.stringify(corps)),
    json: async () => {
      if (illisible) throw new SyntaxError('Unexpected token < in JSON');
      return corps;
    },
  }));
  vi.stubGlobal('fetch', fetchMock as never);
  return fetchMock;
}

// Corps d'un 201 dont l'identifiant ne se lit pas.
const CORPS_SANS_IDENTIFIANT: Array<[string, unknown]> = [
  ['un corps qui n’est pas du JSON', PAS_DU_JSON],
  ['un objet vide', {}],
  ['null', null],
  ['un tableau', []],
  ['un identifiant vide', { customerOrderId: '' }],
  ['un identifiant numérique', { customerOrderId: 42 }],
];

describe('M1.5a / MTS-1 client — réponse d’une création (fil)', () => {
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

  describe('POST /v3/customerOrders', () => {
    it.each(CORPS_SANS_IDENTIFIANT)(
      'M1.5a/creation_fil_commande_201_illisible — 201 avec %s → erreur ambiguë',
      async (_cas, corps) => {
        const fetchMock = stubFetch(201, corps);

        const envoi = new Mts1Client(fakeSupabase).postOrder(COMMANDE);

        await expect(envoi).rejects.toBeInstanceOf(LogistiqueAmbiguousError);
        await expect(envoi).rejects.toThrow(
          'MTS-1 POST /v3/customerOrders : création acceptée, mais « customerOrderId » est illisible dans la réponse',
        );
        // Un seul appel : le client ne rejoue pas la création de lui-même.
        expect(fetchMock).toHaveBeenCalledOnce();
      },
    );

    it('M1.5a/creation_fil_commande_201_lisible — 201 avec son identifiant → rendu tel quel', async () => {
      stubFetch(201, {
        customerOrderId: 'O-XYZ',
        orderNumber: 'col-1-1',
        customerOrderStatus: 'DRAFT',
      });

      const creee = await new Mts1Client(fakeSupabase).postOrder(COMMANDE);

      expect(creee).toMatchObject({
        id: 'O-XYZ',
        externalReference: 'col-1-1',
      });
    });

    it('témoin — un refus (422) reste définitif, une erreur serveur (503) reste passagère', async () => {
      stubFetch(422, { error: 'INVALID_REQUEST' });
      await expect(
        new Mts1Client(fakeSupabase).postOrder(COMMANDE),
      ).rejects.toBeInstanceOf(LogistiquePermanentError);

      stubFetch(503, { error: 'UNAVAILABLE' });
      await expect(
        new Mts1Client(fakeSupabase).postOrder(COMMANDE),
      ).rejects.toBeInstanceOf(LogistiqueTransientError);
    });
  });
});

// Même règle quand MTS-1 est simulé par des handlers (tests des adapters) :
// l'identifiant est contrôlé au même endroit, quel que soit le chemin.
describe('M1.5a / MTS-1 client — réponse d’une création (handlers simulés)', () => {
  afterEach(() => _setMts1Handlers(null));

  const handlers = (surcharge: Partial<Mts1Handlers>): Mts1Handlers => ({
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder: vi.fn(),
    ...surcharge,
  });

  it('M1.5a/creation_simulee_commande_sans_identifiant — commande acceptée sans identifiant → erreur ambiguë', async () => {
    _setMts1Handlers(
      handlers({
        postOrder: async () => ({
          ok: true,
          id: undefined as unknown as string,
          externalReference: 'col-1-1',
          status: 'DRAFT',
          createdAt: '',
        }),
      }),
    );

    await expect(
      new Mts1Client(fakeSupabase).postOrder(COMMANDE),
    ).rejects.toBeInstanceOf(LogistiqueAmbiguousError);
  });
});
