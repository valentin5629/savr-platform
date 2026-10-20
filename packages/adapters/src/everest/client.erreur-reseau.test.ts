// Client Everest, chemin réseau réel (aucun handler injecté) : quand `fetch`
// échoue, rien de ce que le moteur recopie dans son erreur — le jeton du compte —
// n'atteint l'erreur levée ni integrations_logs.
//
// Avant : sept messages interpolaient `String(err)` (auth, puis création,
// annulation et lecture de mission, chacune en premier essai et en reprise après
// 401). Mesuré le 2026-10-13 (Node 22.23.2 et 25.9.0) : pour un jeton portant un
// saut de ligne en son milieu, ce texte contient le jeton entier. Depuis le
// jeton fixe (2026-10-19), il n'y a plus ni auth ni reprise : trois messages.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogistiqueAmbiguousError } from '../index.js';
import { EverestClient } from './client.js';
import { _setEverestHandlers } from './mock.js';

// Jamais un vrai jeton : deux moitiés reconnaissables, dont aucune ne doit sortir.
const DEBUT = 'FAUX-JETON-DE-TEST';
const FIN = 'SUITE-DU-FAUX-JETON';

const MISSION = {
  service_id: 71,
  client_ref: 'c0000000-0000-0000-0000-0000000000c1',
  start_date: 1792526400,
  address_start: '1 rue du Test, 75001 Paris',
  address_start_name: 'Contact Test',
  address_start_tel: '+33100000000',
  address_end: '2 rue du Test, 94200 Ivry-sur-Seine',
  comment: 'Pesée obligatoire, photo marchandise obligatoire',
};

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
const annuler: Operation = (c) => c.cancelMission({ ref: 'm-1' }, 'corr-1');
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
    fetchMock.mockReset();
    lignes.length = 0;
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('EVEREST_API_TOKEN', `${DEBUT}${FIN}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Les trois messages : chaque ligne fait échouer UN appel précis, par une
  // erreur qui cite le jeton.
  it.each<[string, Operation, string]>([
    ['création', creer, 'Everest createMission timeout'],
    ['annulation', annuler, 'Everest cancelMission timeout'],
    ['lecture', lire, 'Everest getMission timeout'],
  ])(
    'M0.9/erreur_reseau_everest_message_fabrique — %s : l’erreur levée ne porte pas le jeton',
    async (_nom, operation, prefixe) => {
      fetchMock.mockRejectedValueOnce(refusCitantLeJeton());

      const client = new EverestClient(supabase);
      const err = await rejetDe(() => operation(client));

      // Le type d'erreur ne change pas : sans réponse = ambiguë, à réconcilier.
      expect(err).toBeInstanceOf(LogistiqueAmbiguousError);
      expect(err.message).toBe(
        `${prefixe} : en-tête de requête refusé (clé ou jeton mal formé)`,
      );
      // Ce que le worker écrit dans outbox_events.last_error et dans l'alerte.
      sansLeJeton(String(err));
      // L'erreur du moteur n'est pas attachée : un outil de capture la lirait.
      expect(err.cause).toBeUndefined();
      sansLeJeton(String(err.stack));
      // Ce client n'écrit aucune ligne integrations_logs pour un appel resté
      // sans réponse : l'assertion suivante ne prouve rien aujourd'hui, elle
      // garde une écriture future.
      sansLeJeton(JSON.stringify(lignes));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('M0.9/erreur_reseau_everest_vrai_moteur — jeton mal formé posé dans EVEREST_API_TOKEN, vrai `fetch` : l’erreur levée ne porte pas le jeton', async () => {
    // Adresse jamais contactée : le port 9 est de ceux que `fetch` refuse d'appeler.
    vi.stubEnv('EVEREST_BASE_URL', 'http://127.0.0.1:9');
    // Saut de ligne AU MILIEU : la lecture du jeton ne retire que les blancs
    // des bords, le moteur refuse donc l'en-tête.
    vi.stubEnv('EVEREST_API_TOKEN', `${DEBUT}\n${FIN}`);
    fetchMock.mockImplementationOnce((...args: Parameters<typeof fetch>) =>
      vraiFetch(...args),
    );

    const client = new EverestClient(supabase);
    const err = await rejetDe(() => lire(client));

    expect(err).toBeInstanceOf(LogistiqueAmbiguousError);
    expect(err.message).toBe(
      'Everest getMission timeout : en-tête de requête refusé (clé ou jeton mal formé)',
    );
    sansLeJeton(String(err));
    sansLeJeton(JSON.stringify(lignes));
  });

  it('M0.9/erreur_reseau_everest_libelles — délai dépassé et panne de transport : libellés écrits ici, avec le code de la panne', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      ),
    );
    const client = new EverestClient(supabase);
    const delai = await rejetDe(() => lire(client));
    expect(delai.message).toBe('Everest getMission timeout : délai dépassé');

    fetchMock.mockRejectedValueOnce(
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
