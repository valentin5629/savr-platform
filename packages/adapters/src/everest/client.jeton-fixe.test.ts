// Jeton Everest fixe, chemin réseau réel (aucun handler injecté).
//
// Chaque appel à POST /auth crée un jeton et révoque le précédent (réponse
// d'Everest relayée par A Toutes!, 2026-10-19). Le client lit donc un jeton fixe
// dans EVEREST_API_TOKEN et n'appelle jamais /auth. Un jeton absent ou refusé
// est un réglage à corriger : erreur passagère + alerte Slack critique.
// Les valeurs de jeton ci-dessous sont inventées.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';

import { LogistiqueTransientError } from '../index.js';
import { EverestClient } from './client.js';
import { _setEverestHandlers } from './mock.js';

const JETON = 'jeton-fixe-de-test-0000';

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

type Operation = (client: EverestClient) => Promise<unknown>;
const OPERATIONS: Array<[string, Operation]> = [
  ['createMission', (c) => c.createMission(MISSION, 'corr-1')],
  ['cancelMission', (c) => c.cancelMission({ mission_id: 'm-1' }, 'corr-1')],
  ['getMission', (c) => c.getMission('m-1', 'corr-1')],
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function rejetDe(appel: () => Promise<unknown>): Promise<Error> {
  try {
    await appel();
  } catch (err) {
    return err as Error;
  }
  throw new Error("l'appel aurait dû échouer");
}

describe('EverestClient — jeton fixe EVEREST_API_TOKEN', () => {
  const fetchMock = vi.fn();
  const supabase = {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  } as never;
  let slack: SlackPayload[];

  beforeEach(() => {
    _setEverestHandlers(null);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    slack = [];
    setSlackSink(async (p) => {
      slack.push(p);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setSlackSink(async () => {});
  });

  it.each(OPERATIONS)(
    'M2.5/everest_jeton_fixe_bearer — %s : le jeton part en Bearer, en un seul appel, jamais vers /auth',
    async (_nom, operation) => {
      vi.stubEnv('EVEREST_API_TOKEN', JETON);
      fetchMock.mockResolvedValueOnce(json({ mission_id: 'm-1' }));

      await operation(new EverestClient(supabase));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).not.toMatch(/\/auth$/);
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${JETON}` });
      expect(slack).toEqual([]);
    },
  );

  it('M2.5/everest_jeton_fixe_blancs — jeton collé avec des blancs aux bords : envoyé sans eux', async () => {
    vi.stubEnv('EVEREST_API_TOKEN', `  ${JETON}\n`);
    fetchMock.mockResolvedValueOnce(json({ mission_id: 'm-1' }));

    await new EverestClient(supabase).getMission('m-1', 'corr-1');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${JETON}` });
  });

  it.each(OPERATIONS)(
    'M2.5/everest_jeton_absent — %s sans EVEREST_API_TOKEN : aucun appel, erreur passagère, alerte critique',
    async (nom, operation) => {
      vi.stubEnv('EVEREST_API_TOKEN', '   ');

      const err = await rejetDe(() => operation(new EverestClient(supabase)));

      expect(err).toBeInstanceOf(LogistiqueTransientError);
      expect(err.message).toBe(
        `Everest ${nom} : jeton absent (EVEREST_API_TOKEN non posé)`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(slack).toEqual([
        expect.objectContaining({
          canal: 'critique',
          titre: 'Jeton Everest absent',
          metadata: {
            event: 'everest.jeton_inutilisable',
            operation: nom,
            statut_http: 'aucun',
          },
        }),
      ]);
    },
  );

  it.each(OPERATIONS)(
    'M2.5/everest_jeton_refuse — %s refusé en 401 : un seul appel, aucune ré-authentification, erreur passagère, alerte critique sans le jeton',
    async (nom, operation) => {
      vi.stubEnv('EVEREST_API_TOKEN', JETON);
      fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));

      const err = await rejetDe(() => operation(new EverestClient(supabase)));

      expect(err).toBeInstanceOf(LogistiqueTransientError);
      expect(err.message).toBe(
        `Everest ${nom} : jeton refusé par Everest (401)`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(slack).toEqual([
        expect.objectContaining({
          canal: 'critique',
          titre: 'Jeton Everest refusé',
          metadata: {
            event: 'everest.jeton_inutilisable',
            operation: nom,
            statut_http: 401,
          },
        }),
      ]);
      expect(JSON.stringify(slack)).not.toContain(JETON);
      expect(String(err)).not.toContain(JETON);
    },
  );

  it('M2.5/everest_jeton_alerte_en_echec — alerte Slack en échec : l’erreur levée reste « jeton refusé »', async () => {
    vi.stubEnv('EVEREST_API_TOKEN', JETON);
    fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    setSlackSink(async () => {
      throw new Error('Slack injoignable');
    });

    const err = await rejetDe(() =>
      new EverestClient(supabase).getMission('m-1', 'corr-1'),
    );

    expect(err).toBeInstanceOf(LogistiqueTransientError);
    expect(err.message).toBe(
      'Everest getMission : jeton refusé par Everest (401)',
    );
  });
});
