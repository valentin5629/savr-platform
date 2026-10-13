// Client MTS-1, chemin réseau réel (aucun handler injecté) : quand `fetch`
// échoue, rien de ce que le moteur recopie dans son erreur — la clé d'API en
// tête — n'atteint l'erreur levée, la ligne integrations_logs ni le résultat de
// la sonde de santé.
//
// Avant : `String(err)` allait tel quel dans integrations_logs.erreur et dans
// l'erreur levée (donc outbox_events.last_error, l'alerte Slack et la fiche
// collecte). Mesuré le 2026-10-13 (Node 22.23.2 et 25.9.0) : pour une clé
// portant un saut de ligne en son milieu, ce texte contient la clé entière.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLogistiqueProvider,
  LogistiqueAmbiguousError,
  LogistiqueTransientError,
} from '../index.js';
import type { Transporteur } from '../index.js';
import { Mts1Client, type CreateOrderPayload } from './client.js';
import { _setMts1Handlers } from './mock.js';

// Jamais une vraie clé : deux moitiés reconnaissables, dont aucune ne doit sortir.
const DEBUT = 'FAUSSE-CLE-DE-TEST';
const FIN = 'SUITE-DE-LA-FAUSSE-CLE';
const CLE_MAL_FORMEE = `${DEBUT}\n${FIN}`;
// Jamais contactée : le port 9 est de ceux que `fetch` refuse d'appeler.
const BASE_MORTE = 'http://127.0.0.1:9';

const COMMANDE: CreateOrderPayload = {
  orderNumber: 'c0000000-0000-0000-0000-0000000000c1-1',
  orderDate: '2026-10-20',
  timezone: 'Europe/Paris',
  serviceTime: 30,
  transportersNeededCount: 1,
  orderCategories: [],
  place: { address: { addressSingleLine: '1 rue du Test, 75001 Paris' } },
};

const T_MTS1: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'CODE-DE-TEST',
  prestataire_logistique_id: 'presta-uuid-001',
};

function fauxSupabase() {
  const lignes: Record<string, unknown>[] = [];
  const supabase = {
    from: (table: string) => ({
      insert: (ligne: Record<string, unknown>) => {
        if (table === 'integrations_logs') lignes.push(ligne);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { supabase: supabase as never, lignes };
}

function sansLaCle(texte: string): void {
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

describe('Client MTS-1 — un appel sans réponse ne cite jamais la clé', () => {
  beforeEach(() => {
    _setMts1Handlers(null);
    vi.stubEnv('MTS1_BASE_URL', BASE_MORTE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('M0.9/erreur_reseau_mts1_vrai_moteur — clé mal formée, vrai `fetch` : ni l’erreur levée ni la ligne integrations_logs ne portent la clé', async () => {
    vi.stubEnv('MTS1_API_KEY', CLE_MAL_FORMEE);
    const { supabase, lignes } = fauxSupabase();

    const err = await rejetDe(() =>
      new Mts1Client(supabase).postOrder(COMMANDE),
    );

    expect(err).toBeInstanceOf(LogistiqueTransientError);
    expect(err.message).toBe(
      'MTS-1 réseau : en-tête de requête refusé (clé ou jeton mal formé)',
    );
    // Ce que le worker écrit dans outbox_events.last_error et dans l'alerte.
    sansLaCle(String(err));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      integration: 'mts1',
      methode: 'POST',
      endpoint: '/v3/customerOrders',
      erreur: 'en-tête de requête refusé (clé ou jeton mal formé)',
    });
    sansLaCle(JSON.stringify(lignes));
  });

  it('M0.9/erreur_reseau_mts1_message_fabrique — `fetch` rejette avec un message qui cite la clé : elle ne ressort ni de l’erreur levée ni du journal', async () => {
    vi.stubEnv('MTS1_API_KEY', 'cle-de-test-bien-formee');
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
    const { supabase, lignes } = fauxSupabase();

    const err = await rejetDe(() =>
      new Mts1Client(supabase).postOrder(COMMANDE),
    );

    expect(err).toBeInstanceOf(LogistiqueTransientError);
    sansLaCle(String(err));
    sansLaCle(JSON.stringify(lignes));
    expect(lignes[0]!['erreur']).toBe(
      'en-tête de requête refusé (clé ou jeton mal formé)',
    );
  });

  it('les erreurs gardent leur type : délai dépassé = ambiguë, panne de transport = passagère avec son code', async () => {
    vi.stubEnv('MTS1_API_KEY', 'cle-de-test-bien-formee');
    const { supabase, lignes } = fauxSupabase();

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
    const delai = await rejetDe(() =>
      new Mts1Client(supabase).postOrder(COMMANDE),
    );
    expect(delai).toBeInstanceOf(LogistiqueAmbiguousError);
    expect(delai.message).toBe('MTS-1 timeout : POST /v3/customerOrders');

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new TypeError('fetch failed', {
            cause: Object.assign(new Error(`connect ECONNREFUSED ${DEBUT}`), {
              code: 'ECONNREFUSED',
            }),
          }),
        ),
      ),
    );
    const panne = await rejetDe(() =>
      new Mts1Client(supabase).postOrder(COMMANDE),
    );
    expect(panne).toBeInstanceOf(LogistiqueTransientError);
    expect(panne.message).toBe(
      'MTS-1 réseau : service injoignable (ECONNREFUSED)',
    );

    expect(lignes.map((l) => l['erreur'])).toEqual([
      'délai dépassé',
      'service injoignable (ECONNREFUSED)',
    ]);
    sansLaCle(JSON.stringify(lignes));
  });

  it('M0.9/erreur_reseau_mts1_sonde_sante — sonde de santé, clé mal formée : ni le message rendu ni le journal ne portent la clé', async () => {
    vi.stubEnv('MTS1_API_KEY', CLE_MAL_FORMEE);
    const { supabase, lignes } = fauxSupabase();

    const r = await getLogistiqueProvider(T_MTS1, supabase).healthCheck();

    expect(r.ok).toBe(false);
    expect(r.etat).toBe('ko');
    expect(JSON.stringify(r)).toContain(
      'Réseau : en-tête de requête refusé (clé ou jeton mal formé)',
    );
    sansLaCle(JSON.stringify(r));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!['erreur']).toBe(
      'Réseau : en-tête de requête refusé (clé ou jeton mal formé)',
    );
    sansLaCle(JSON.stringify(lignes));
  });
});
