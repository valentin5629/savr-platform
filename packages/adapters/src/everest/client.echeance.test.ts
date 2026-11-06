// M1.5a — passage borné : le client Everest ne DÉMARRE aucun appel après
// l'échéance de l'ordre en cours. Chemin réel forcé (fetch, aucun handler).
// Depuis le jeton fixe (2026-10-19), plus d'authentification ni de reprise sur
// 401 : chaque opération est un seul appel, contrôlé avant de partir.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { avecEcheance } from '../echeance-passage.js';
import { LogistiqueTransientError } from '../index.js';
import { EverestClient } from './client.js';
import { _setEverestHandlers } from './mock.js';

describe('M1.5a / passage borné — client Everest', () => {
  const fetchMock = vi.fn();
  const supabase = {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };
  const client = () => new EverestClient(supabase as never);

  beforeEach(() => {
    _setEverestHandlers(null);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('EVEREST_API_TOKEN', 'jeton-de-test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('M1.5a/passage_borne_client_everest — échéance atteinte : ni la création, ni l’annulation, ni la lecture d’une mission ne partent', async () => {
    const creation = avecEcheance(Date.now() - 1, () =>
      client().createMission({} as never, 'corr'),
    );
    await expect(creation).rejects.toBeInstanceOf(LogistiqueTransientError);
    // Type et message exacts : le refus n'est pas rhabillé en « timeout » ambigu par l'appelant.
    await expect(creation).rejects.toThrow(
      /^Échéance du passage atteinte : Everest POST \/missions\/create non démarré$/,
    );

    const annulation = avecEcheance(Date.now() - 1, () =>
      client().cancelMission({ ref: 'm-1' }, 'corr'),
    );
    await expect(annulation).rejects.toBeInstanceOf(LogistiqueTransientError);
    await expect(annulation).rejects.toThrow(
      /^Échéance du passage atteinte : Everest POST \/missions\/cancel non démarré$/,
    );

    const lecture = avecEcheance(Date.now() - 1, () =>
      client().getMission('m-1', 'corr'),
    );
    await expect(lecture).rejects.toBeInstanceOf(LogistiqueTransientError);
    await expect(lecture).rejects.toThrow(
      /^Échéance du passage atteinte : Everest POST \/missions\/get non démarré$/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
