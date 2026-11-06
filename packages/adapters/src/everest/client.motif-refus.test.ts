// Raison d'un refus Everest : lue dans la réponse, portée par l'erreur levée
// (outbox_events.last_error, puis la fiche collecte) et par integrations_logs.
// Avant, la fiche n'affichait que « Everest createMission 400 » (2026-10-30).
// Les valeurs sont inventées.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import { EverestClient, LONGUEUR_MAX_MOTIF_REFUS } from './client.js';
import { _setEverestHandlers } from './mock.js';

const MISSION = {
  service_id: 71,
  client_ref: 'tournee-0000-0001',
  start_date: 1784577600,
  address_start: '1 rue du Test, 75001 Paris',
  address_end: '2 rue du Test, 94200 Ivry-sur-Seine',
  comment: 'Pesée obligatoire, photo marchandise obligatoire',
};

function reponse(corps: string, status: number): Response {
  return new Response(corps, { status });
}

describe('EverestClient — raison des refus', () => {
  const fetchMock = vi.fn();
  const journal: Array<Record<string, unknown>> = [];
  const supabase = {
    from: () => ({
      insert: (ligne: Record<string, unknown>) => {
        journal.push(ligne);
        return Promise.resolve({ error: null });
      },
    }),
  } as never;
  const client = () => new EverestClient(supabase);

  beforeEach(() => {
    _setEverestHandlers(null);
    fetchMock.mockReset();
    journal.length = 0;
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('EVEREST_API_TOKEN', 'jeton-de-test');
    vi.stubEnv('EVEREST_BASE_URL', 'https://everest.invalid/api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('createMission 400 : la raison donnée par Everest est dans l’erreur et dans le journal', async () => {
    fetchMock.mockResolvedValueOnce(
      reponse('{"error":\n  "address_end introuvable"}', 400),
    );

    const erreur = await client()
      .createMission(MISSION, 'corr-1')
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(LogistiquePermanentError);
    expect((erreur as Error).message).toBe(
      'Everest createMission 400 : {"error": "address_end introuvable"}',
    );
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      endpoint: '/missions/create',
      statut_http: 400,
      erreur: '{"error": "address_end introuvable"}',
    });
  });

  it('createMission 400 sans corps : message inchangé, rien dans la colonne erreur', async () => {
    fetchMock.mockResolvedValueOnce(reponse('', 400));

    const erreur = await client()
      .createMission(MISSION, 'corr-1')
      .catch((e: unknown) => e);

    expect((erreur as Error).message).toBe('Everest createMission 400');
    expect(journal[0]?.['erreur']).toBeUndefined();
  });

  it('réponse longue : raison bornée', async () => {
    fetchMock.mockResolvedValueOnce(reponse('x'.repeat(5000), 422));

    const erreur = await client()
      .createMission(MISSION, 'corr-1')
      .catch((e: unknown) => e);

    expect((erreur as Error).message).toBe(
      `Everest createMission 422 : ${'x'.repeat(LONGUEUR_MAX_MOTIF_REFUS)}…`,
    );
  });

  it('5xx : reste passagère, avec sa raison', async () => {
    fetchMock.mockResolvedValueOnce(reponse('maintenance', 503));

    const erreur = await client()
      .createMission(MISSION, 'corr-1')
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(LogistiqueTransientError);
    expect((erreur as Error).message).toBe(
      'Everest createMission 503 : maintenance',
    );
  });

  it('cancelMission et getMission portent aussi la raison', async () => {
    fetchMock
      .mockResolvedValueOnce(reponse('mission déjà livrée', 409))
      .mockResolvedValueOnce(reponse('ref inconnue', 404));

    const annulation = await client()
      .cancelMission({ ref: 'REF-1' }, 'corr-1')
      .catch((e: unknown) => e);
    const relecture = await client()
      .getMission('REF-2', 'corr-2')
      .catch((e: unknown) => e);

    expect((annulation as Error).message).toBe(
      'Everest cancelMission 409 : mission déjà livrée',
    );
    expect((relecture as Error).message).toBe(
      'Everest getMission 404 : ref inconnue',
    );
  });
});
