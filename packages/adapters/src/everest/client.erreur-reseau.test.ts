// Client Everest, chemin réseau réel (aucun handler injecté) : quand `fetch`
// échoue, rien de ce que le moteur recopie dans son erreur — le jeton, le secret
// du compte — n'atteint l'erreur levée ni integrations_logs.
//
// Avant : sept messages interpolaient `String(err)` (auth, puis création,
// annulation et lecture de mission, chacune en premier essai et en reprise après
// 401). Mesuré le 2026-10-13 (Node 22.23.2 et 25.9.0) : pour un jeton portant un
// saut de ligne en son milieu, ce texte contient le jeton entier.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogistiqueAmbiguousError } from '../index.js';
import { EverestClient, _invalidateEverestTokenCache } from './client.js';
import { _setEverestHandlers } from './mock.js';

const CLIENT_ID = 'client-erreur-reseau-test';
// Jamais un vrai jeton : deux moitiés reconnaissables, dont aucune ne doit sortir.
const DEBUT = 'FAUX-JETON-DE-TEST';
const FIN = 'SUITE-DU-FAUX-JETON';

const MISSION = {
  service_id: 71,
  client_ref: 'c0000000-0000-0000-0000-0000000000c1',
  pickup: {
    address: '1 rue du Test, 75001 Paris',
    contact: { name: 'Contact Test', phone: '+33100000000' },
  },
  dropoff: { address: '2 rue du Test, 94200 Ivry-sur-Seine' },
  timeslot: { date: '2026-10-20', start: '22:00', end: '23:00' },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** L'erreur que le moteur lève pour un en-tête refusé, la valeur citée en entier. */
function refusCitantLeJeton(): TypeError {
  return new TypeError(
    `Headers.append: "Bearer ${DEBUT}${FIN}" is an invalid header value.`,
  );
}

function sansLeJeton(texte: string): void {
  expect(texte).not.toContain(DEBUT);
  expect(texte).not.toContain(FIN);
}

async function rejetDe(appel: () => Promise<unknown>): Promise<Error> {
  try {
    await appel();
  } catch (err) {
    return err as Error;
  }
  throw new Error("l'appel aurait dû échouer");
}

type Operation = (client: EverestClient) => Promise<unknown>;
const creer: Operation = (c) => c.createMission(MISSION, 'corr-1');
const annuler: Operation = (c) =>
  c.cancelMission({ mission_id: 'm-1' }, 'corr-1');
const lire: Operation = (c) => c.getMission('m-1', 'corr-1');

describe('Client Everest — un appel sans réponse ne cite jamais le jeton', () => {
  const vraiFetch = globalThis.fetch;
  const fetchMock = vi.fn();
  const lignes: Record<string, unknown>[] = [];
  const supabase = {
    from: () => ({
      insert: (ligne: Record<string, unknown>) => {
        lignes.push(ligne);
        return Promise.resolve({ error: null });
      },
    }),
  } as never;

  beforeEach(() => {
    _setEverestHandlers(null);
    _invalidateEverestTokenCache(CLIENT_ID);
    fetchMock.mockReset();
    lignes.length = 0;
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _invalidateEverestTokenCache(CLIENT_ID);
  });

  // Les sept messages : chaque ligne fait échouer UN appel précis, par une
  // erreur qui cite le jeton.
  it.each<[string, Operation, Response[], string]>([
    ['auth', lire, [], 'Everest auth timeout'],
    [
      'création',
      creer,
      [json({ token: 't' })],
      'Everest createMission timeout',
    ],
    [
      'création, reprise après 401',
      creer,
      [json({ token: 't' }), json({}, 401), json({ token: 't2' })],
      'Everest createMission timeout (retry)',
    ],
    [
      'annulation',
      annuler,
      [json({ token: 't' })],
      'Everest cancelMission timeout',
    ],
    [
      'annulation, reprise après 401',
      annuler,
      [json({ token: 't' }), json({}, 401), json({ token: 't2' })],
      'Everest cancelMission timeout (retry)',
    ],
    ['lecture', lire, [json({ token: 't' })], 'Everest getMission timeout'],
    [
      'lecture, reprise après 401',
      lire,
      [json({ token: 't' }), json({}, 401), json({ token: 't2' })],
      'Everest getMission timeout (retry)',
    ],
  ])(
    'M0.9/erreur_reseau_everest_message_fabrique — %s : l’erreur levée ne porte pas le jeton',
    async (_nom, operation, reponsesAvant, prefixe) => {
      for (const r of reponsesAvant) fetchMock.mockResolvedValueOnce(r);
      fetchMock.mockRejectedValueOnce(refusCitantLeJeton());

      const client = new EverestClient(CLIENT_ID, 'secret', supabase);
      const err = await rejetDe(() => operation(client));

      // Le type d'erreur ne change pas : sans réponse = ambiguë, à réconcilier.
      expect(err).toBeInstanceOf(LogistiqueAmbiguousError);
      expect(err.message).toBe(
        `${prefixe} : en-tête de requête refusé (clé ou jeton mal formé)`,
      );
      // Ce que le worker écrit dans outbox_events.last_error et dans l'alerte.
      sansLeJeton(String(err));
      sansLeJeton(JSON.stringify(lignes));
      expect(fetchMock).toHaveBeenCalledTimes(reponsesAvant.length + 1);
    },
  );

  it('M0.9/erreur_reseau_everest_vrai_moteur — jeton mal formé rendu par l’auth, vrai `fetch` : l’erreur levée ne porte pas le jeton', async () => {
    // Adresse jamais contactée : le port 9 est de ceux que `fetch` refuse d'appeler.
    vi.stubEnv('EVEREST_BASE_URL', 'http://127.0.0.1:9');
    fetchMock
      .mockResolvedValueOnce(json({ token: `${DEBUT}\n${FIN}` }))
      .mockImplementationOnce((...args: Parameters<typeof fetch>) =>
        vraiFetch(...args),
      );

    try {
      const client = new EverestClient(CLIENT_ID, 'secret', supabase);
      const err = await rejetDe(() => lire(client));

      expect(err).toBeInstanceOf(LogistiqueAmbiguousError);
      expect(err.message).toBe(
        'Everest getMission timeout : en-tête de requête refusé (clé ou jeton mal formé)',
      );
      sansLeJeton(String(err));
      sansLeJeton(JSON.stringify(lignes));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('délai dépassé et panne de transport : libellés écrits ici, avec le code de la panne', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      ),
    );
    const client = new EverestClient(CLIENT_ID, 'secret', supabase);
    const delai = await rejetDe(() => lire(client));
    expect(delai.message).toBe('Everest auth timeout : délai dépassé');

    fetchMock.mockResolvedValueOnce(json({ token: 't' })).mockRejectedValueOnce(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error(`connect ECONNRESET ${DEBUT}`), {
          code: 'ECONNRESET',
        }),
      }),
    );
    const panne = await rejetDe(() => lire(client));
    expect(panne.message).toBe(
      'Everest getMission timeout : service injoignable (ECONNRESET)',
    );
    sansLeJeton(String(panne));
  });
});
