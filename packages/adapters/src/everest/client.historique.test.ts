// Historique des étapes d'une mission (POST /missions/statuses), sur le chemin
// réseau réel (aucun handler injecté). Forme mesurée sur le compte A Toute! le
// 2026-11-17 ; les valeurs sont inventées.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogistiqueTransientError } from '../index.js';
import { EverestClient } from './client.js';
import { _setEverestHandlers } from './mock.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('EverestClient.getStatuses — historique des étapes', () => {
  const fetchMock = vi.fn();
  const supabase = {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  } as never;

  beforeEach(() => {
    _setEverestHandlers(null);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('EVEREST_API_TOKEN', 'jeton-de-test');
    vi.stubEnv('EVEREST_BASE_URL', 'https://everest.invalid/api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POST /missions/statuses { refs } ; lit étapes, dates et champs saisis', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        success: true,
        missions: [
          {
            ref: 'REF-1',
            statuses: [
              {
                id: 1,
                status: 'nouvelle-mission',
                extras: [''],
                extras_fields: [],
                date_created: 1794417354,
              },
              {
                id: 2,
                status: 'mission-en-cours-de-livraison',
                extras_fields: [
                  {
                    name: 'Poids en Kg obligatoire',
                    value: '12,5',
                    type: 'number',
                  },
                  { name: 'Minutes', value: 7 },
                  { value: 'sans nom' },
                ],
                date_created: 1794420000,
              },
              { id: 3, status: 'sans-date' },
            ],
          },
          { ref: 'REF-NON-DEMANDEE', statuses: [] },
        ],
      }),
    );

    const lus = await new EverestClient(supabase).getStatuses(
      ['REF-1', 'REF-2'],
      'corr',
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://everest.invalid/api/missions/statuses');
    expect(JSON.parse(String(init.body))).toEqual({ refs: ['REF-1', 'REF-2'] });
    expect([...lus.keys()]).toEqual(['REF-1']);
    expect(lus.get('REF-1')).toEqual([
      { statut_code: 'nouvelle-mission', date: 1794417354, champs: [] },
      {
        statut_code: 'mission-en-cours-de-livraison',
        date: 1794420000,
        champs: [
          { name: 'Poids en Kg obligatoire', value: '12,5', type: 'number' },
          { name: 'Minutes', value: '7', type: null },
        ],
      },
    ]);
  });

  it('aucune référence : aucun appel', async () => {
    const lus = await new EverestClient(supabase).getStatuses([], 'corr');
    expect(lus.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('5xx = erreur passagère', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'down' }, 503));
    await expect(
      new EverestClient(supabase).getStatuses(['REF-1'], 'corr'),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
  });
});
