// M1.5a — passage borné : le client Everest ne DÉMARRE aucun appel après
// l'échéance de l'ordre en cours — ni l'authentification, ni la mission, ni la
// ré-authentification sur 401. Chemin réel forcé (fetch, aucun handler).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { avecEcheance } from '../echeance-passage.js';
import { LogistiqueTransientError } from '../index.js';
import { EverestClient, _invalidateEverestTokenCache } from './client.js';
import { _setEverestHandlers } from './mock.js';

const CLIENT_ID = 'client-echeance-test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('M1.5a / passage borné — client Everest', () => {
  const fetchMock = vi.fn();
  const supabase = {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };
  const client = () =>
    new EverestClient(CLIENT_ID, 'secret', supabase as never);

  beforeEach(() => {
    _setEverestHandlers(null);
    _invalidateEverestTokenCache(CLIENT_ID);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _invalidateEverestTokenCache(CLIENT_ID);
  });

  it('M1.5a/passage_borne_client_everest — échéance atteinte, sans jeton : l’authentification ne part pas', async () => {
    const appel = avecEcheance(Date.now() - 1, () =>
      client().createMission({} as never, 'corr'),
    );

    await expect(appel).rejects.toBeInstanceOf(LogistiqueTransientError);
    await expect(appel).rejects.toThrow(/Everest POST \/auth non démarré/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('échéance atteinte, jeton déjà en mémoire : ni la création ni la lecture d’une mission ne partent', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ token: 'jeton' }))
      .mockResolvedValueOnce(json({ mission_id: 'm-1', status: 'created' }));
    await client().getMission('m-1', 'corr');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const creation = avecEcheance(Date.now() - 1, () =>
      client().createMission({} as never, 'corr'),
    );
    await expect(creation).rejects.toBeInstanceOf(LogistiqueTransientError);
    // Type et message exacts : le refus n'est pas rhabillé en « timeout » ambigu par l'appelant.
    await expect(creation).rejects.toThrow(
      /^Échéance du passage atteinte : Everest POST \/missions\/create non démarré$/,
    );

    const lecture = avecEcheance(Date.now() - 1, () =>
      client().getMission('m-1', 'corr'),
    );
    await expect(lecture).rejects.toBeInstanceOf(LogistiqueTransientError);
    await expect(lecture).rejects.toThrow(
      /^Échéance du passage atteinte : Everest GET \S+ non démarré$/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('échéance atteinte pendant un refus 401 : la ré-authentification ne part pas, et l’erreur est passagère (jamais « identifiants refusés »)', async () => {
    vi.useFakeTimers();
    const echeance = Date.now() + 10_000;
    fetchMock
      .mockResolvedValueOnce(json({ token: 'jeton-perime' }))
      .mockImplementationOnce(async () => {
        // La réponse 401 arrive après l'échéance.
        vi.setSystemTime(echeance + 1);
        return json({ error: 'unauthorized' }, 401);
      });

    const appel = avecEcheance(echeance, () =>
      client().createMission({} as never, 'corr'),
    );

    await expect(appel).rejects.toBeInstanceOf(LogistiqueTransientError);
    await expect(appel).rejects.toThrow(/Everest POST \/auth non démarré/);
    // Authentification + première création, rien d'autre.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
