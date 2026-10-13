// Client Pennylane, chemin réseau réel (aucun handler injecté) : quand `fetch`
// échoue, rien de ce que le moteur recopie dans son erreur — la clé d'API en
// tête — n'atteint le résultat rendu (que les appelants écrivent dans
// factures.erreur_synchro), la ligne integrations_logs ni les journaux.
//
// Avant : `message: String(err)`. Mesuré le 2026-10-13 (Node 22.23.2 et 25.9.0) :
// pour une clé portant un saut de ligne en son milieu, ce texte contient la clé
// entière.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInvoice } from '@/lib/pennylane/client.js';
import { _setPennylaneHandlers } from '@/lib/pennylane/mock.js';

// Jamais une vraie clé : deux moitiés reconnaissables, dont aucune ne doit sortir.
const DEBUT = 'FAUSSE-CLE-DE-TEST';
const FIN = 'SUITE-DE-LA-FAUSSE-CLE';

const lignes: Record<string, unknown>[] = [];
const supabase = {
  from: (table: string) => ({
    insert: (ligne: Record<string, unknown>) => {
      if (table === 'integrations_logs') lignes.push(ligne);
      return Promise.resolve({ data: null, error: null });
    },
  }),
} as unknown as import('@savr/shared/src/supabase-client.js').SupabaseClient;

function sansLaCle(texte: string): void {
  expect(texte).not.toContain(DEBUT);
  expect(texte).not.toContain(FIN);
}

describe('Client Pennylane — un appel sans réponse ne cite jamais la clé', () => {
  const vraiFetch = globalThis.fetch;
  let journaux: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _setPennylaneHandlers(null);
    lignes.length = 0;
    journaux = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('M0.9/erreur_reseau_pennylane_vrai_moteur — clé mal formée, vrai `fetch` : ni le résultat, ni integrations_logs, ni les journaux ne portent la clé', async () => {
    vi.stubEnv('PENNYLANE_API_KEY', `${DEBUT}\n${FIN}`);
    // Le vrai moteur reçoit les vrais en-têtes du client, mais vers une adresse
    // jamais contactée (le port 9 est de ceux que `fetch` refuse d'appeler) :
    // aucun appel ne peut partir vers Pennylane depuis ce test.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      vraiFetch('http://127.0.0.1:9/sonde', init),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await createInvoice(supabase, { foo: 'bar' }, 'facture-123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      ok: false,
      // Même forme qu'un 5xx : l'appelant retente.
      status: 503,
      error: 'network_error',
      message: 'en-tête de requête refusé (clé ou jeton mal formé)',
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      integration: 'pennylane',
      statut_http: 503,
      erreur:
        'network_error: en-tête de requête refusé (clé ou jeton mal formé)',
    });
    sansLaCle(JSON.stringify(res));
    sansLaCle(JSON.stringify(lignes));
    const ecrit = JSON.stringify(journaux.mock.calls);
    expect(ecrit).toContain('api.external.failed');
    sansLaCle(ecrit);
  });

  it('M0.9/erreur_reseau_pennylane_message_fabrique — `fetch` rejette avec un message qui cite la clé : elle ne ressort ni du résultat ni du journal', async () => {
    vi.stubEnv('PENNYLANE_API_KEY', 'cle-de-test-bien-formee');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new TypeError(
            `Headers.append: "Bearer ${DEBUT}${FIN}" is an invalid header value.`,
          ),
        ),
      ),
    );

    const res = await createInvoice(supabase, { foo: 'bar' }, 'facture-123');

    expect(res).toMatchObject({ ok: false, status: 503 });
    sansLaCle(JSON.stringify(res));
    sansLaCle(JSON.stringify(lignes));
    sansLaCle(JSON.stringify(journaux.mock.calls));
  });

  it('délai dépassé : libellé écrit ici, toujours à retenter', async () => {
    vi.stubEnv('PENNYLANE_API_KEY', 'cle-de-test-bien-formee');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          Object.assign(new Error('This operation was aborted'), {
            name: 'AbortError',
          }),
        ),
      ),
    );

    const res = await createInvoice(supabase, { foo: 'bar' }, 'facture-123');

    expect(res).toEqual({
      ok: false,
      status: 503,
      error: 'network_error',
      message: 'délai dépassé',
    });
  });

  it('clé absente : aucun appel, le résultat nomme la variable manquante', async () => {
    vi.stubEnv('PENNYLANE_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await createInvoice(supabase, { foo: 'bar' }, 'facture-123');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: false,
      status: 503,
      error: 'network_error',
      message: 'PENNYLANE_API_KEY non définie',
    });
    expect(lignes[0]!['erreur']).toBe(
      'network_error: PENNYLANE_API_KEY non définie',
    );
    expect(JSON.stringify(journaux.mock.calls)).toContain(
      'api.external.failed',
    );
  });
});
