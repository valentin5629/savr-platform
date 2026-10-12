// Auth Everest en chemin réseau réel (aucun handler injecté) : POST /auth
// répond `{ "token": "..." }` (swagger https://a-toute.everst.io/api/swagger.json,
// mesuré sur le profil test 2026-10-12), pas `access_token`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EverestClient, _invalidateEverestTokenCache } from './client.js';
import { _setEverestHandlers } from './mock.js';

const CLIENT_ID = 'client-auth-token-test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('EverestClient — jeton renvoyé par POST /auth', () => {
  const fetchMock = vi.fn();
  const supabase = {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };

  beforeEach(() => {
    _setEverestHandlers(null);
    _invalidateEverestTokenCache(CLIENT_ID);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _invalidateEverestTokenCache(CLIENT_ID);
  });

  it("envoie le champ `token` de la réponse d'auth en Bearer", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ token: 'jeton-reel' }))
      .mockResolvedValueOnce(json({ mission_id: 'm-1', status: 'created' }));

    const client = new EverestClient(CLIENT_ID, 'secret', supabase as never);
    await client.getMission('m-1', 'corr-1');

    const appelMission = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(appelMission[1].headers).toMatchObject({
      Authorization: 'Bearer jeton-reel',
    });
  });
});
