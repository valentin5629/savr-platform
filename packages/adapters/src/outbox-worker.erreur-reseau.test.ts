// De l'appel réseau en échec jusqu'à l'ordre abandonné : la clé d'API ne se
// retrouve ni dans outbox_events.last_error (que lit la fiche collecte Admin)
// ni dans l'alerte Slack.
//
// On appelle le VRAI passage du worker (réservation, traitement de l'erreur,
// alerte) et le VRAI client du prestataire. Seule la méthode d'envoi de
// l'adapter est remplacée, par un appel direct à ce client : elle ne fait rien
// d'autre de l'erreur du client que la laisser remonter. Frontières simulées : la
// base, `fetch`, le canal Slack.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';

import { AdapterEverest } from './everest/adapter.js';
import {
  EverestClient,
  _invalidateEverestTokenCache,
} from './everest/client.js';
import { _setEverestHandlers } from './everest/mock.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { Mts1Client } from './mts1/client.js';
import { _setMts1Handlers } from './mts1/mock.js';
import { runOutboxWorker } from './outbox-worker.js';

// Jamais une vraie clé : deux moitiés reconnaissables, dont aucune ne doit sortir.
const DEBUT = 'FAUSSE-CLE-DE-TEST';
const FIN = 'SUITE-DE-LA-FAUSSE-CLE';
const COLLECTE_ID = 'c0000000-0000-0000-0000-0000000000c1';
const PRESTA_ID = 'aa000000-0000-0000-0000-0000000000a1';
const CLIENT_EVEREST = 'client-worker-erreur-reseau';

interface AppelRpc {
  name: string;
  args: Record<string, unknown> | undefined;
}

/** Base simulée : un ordre de création réservé, à sa 4e et dernière tentative. */
function fauxSupabase(typeTms: 'mts1' | 'a_toutes') {
  const rpcs: AppelRpc[] = [];
  const journal: Record<string, unknown>[] = [];
  const lignes: Record<string, unknown> = {
    collectes: {
      id: COLLECTE_ID,
      type: 'zero_dechet',
      // Loin dans le temps : pas d'alerte anticipée, seule l'alerte d'abandon part.
      date_collecte: '2027-01-01',
      heure_collecte: '22:00:00',
      nb_camions_demande: 1,
      statut_tms: 'non_envoye',
      controle_acces_requis: false,
      informations_supplementaires: null,
      notes_internes: null,
      prestataire_logistique_id: PRESTA_ID,
      evenement: [
        {
          contact_principal_nom: 'Contact Test',
          contact_principal_telephone: '+33100000000',
          contact_secours_nom: null,
          contact_secours_telephone: null,
          lieux: [
            {
              id: 'lieu-001',
              nom: 'Lieu',
              adresse_acces: '1 rue du Test',
              code_postal: '75001',
              ville: 'Paris',
              latitude: null,
              longitude: null,
              acces_details: null,
              type_vehicule_max: 'fourgon',
              contraintes_horaires: null,
            },
          ],
        },
      ],
    },
    transporteurs: {
      id: 'transp-001',
      type_tms: typeTms,
      code_transporteur_mts1: typeTms === 'mts1' ? 'CODE-DE-TEST' : null,
      prestataire_logistique_id: PRESTA_ID,
    },
  };

  const requete = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'in', 'not', 'order']) {
      q[m] = () => q;
    }
    const uneLigne = async () => ({ data: lignes[table] ?? null, error: null });
    q['single'] = uneLigne;
    q['maybeSingle'] = uneLigne;
    q['insert'] = async (ligne: Record<string, unknown>) => {
      if (table === 'integrations_logs') journal.push(ligne);
      return { data: null, error: null };
    };
    return q;
  };

  const supabase = {
    from: (table: string) => requete(table),
    rpc: async (name: string, args?: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (name === 'fn_reap_outbox_claims') return { data: 0, error: null };
      if (name === 'fn_claim_outbox_batch') {
        return {
          data: [
            {
              id: 'evt-erreur-reseau-001',
              aggregate_type: 'collecte',
              aggregate_id: COLLECTE_ID,
              event_type: 'collecte.creee',
              payload: { collecte_id: COLLECTE_ID },
              consumer: 'adapter_mts1',
              attempts: 4,
              requires_reconciliation: false,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  return {
    supabase:
      supabase as unknown as import('@supabase/supabase-js').SupabaseClient,
    rpcs,
    journal,
  };
}

function sansLaCle(texte: string): void {
  expect(texte).not.toContain(DEBUT);
  expect(texte).not.toContain(FIN);
}

describe('Worker de la file d’envoi — un appel réseau en échec ne livre jamais la clé', () => {
  let alertes: SlackPayload[];

  beforeEach(() => {
    alertes = [];
    setSlackSink(async (p) => {
      alertes.push(p);
    });
    _setMts1Handlers(null);
    _setEverestHandlers(null);
    _invalidateEverestTokenCache(CLIENT_EVEREST);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setSlackSink(async () => {});
    _invalidateEverestTokenCache(CLIENT_EVEREST);
  });

  it('M0.9/erreur_reseau_alerte_mts1 — clé MTS-1 mal formée, vrai `fetch` : ordre abandonné, ni last_error ni l’alerte ni le journal ne portent la clé', async () => {
    // Adresse jamais contactée : le port 9 est de ceux que `fetch` refuse d'appeler.
    vi.stubEnv('MTS1_BASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('MTS1_API_KEY', `${DEBUT}\n${FIN}`);
    const { supabase, rpcs, journal } = fauxSupabase('mts1');
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockImplementation(
      async () => {
        await new Mts1Client(supabase).postOrder({
          orderNumber: `${COLLECTE_ID}-1`,
          orderDate: '2027-01-01',
          timezone: 'Europe/Paris',
          serviceTime: 30,
          transportersNeededCount: 1,
          orderCategories: [],
          place: { address: { addressSingleLine: '1 rue du Test' } },
        });
        return 'adapter_mts1';
      },
    );

    const bilan = await runOutboxWorker(supabase);

    expect(bilan.dead).toBe(1);
    const resultat = rpcs.find((c) => c.name === 'fn_result_outbox');
    expect(resultat?.args).toMatchObject({
      p_statut: 'dead',
      p_last_error:
        'LogistiqueTransientError: MTS-1 réseau : en-tête de requête refusé (clé ou jeton mal formé)',
    });
    expect(alertes).toHaveLength(1);
    expect(alertes[0]!.titre).toContain('[DLQ]');
    expect(alertes[0]!.metadata).toMatchObject({
      error:
        'LogistiqueTransientError: MTS-1 réseau : en-tête de requête refusé (clé ou jeton mal formé)',
    });
    sansLaCle(JSON.stringify(rpcs));
    sansLaCle(JSON.stringify(alertes));
    expect(journal).toHaveLength(1);
    sansLaCle(JSON.stringify(journal));
  });

  it('M0.9/erreur_reseau_alerte_everest — jeton Everest cité par l’erreur de `fetch` : ordre abandonné, ni last_error ni l’alerte ne portent le jeton', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 't' }), { status: 200 }),
      )
      .mockRejectedValueOnce(
        new TypeError(
          `Headers.append: "Bearer ${DEBUT}${FIN}" is an invalid header value.`,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { supabase, rpcs } = fauxSupabase('a_toutes');
    vi.spyOn(AdapterEverest.prototype, 'dispatchCollecte').mockImplementation(
      async () => {
        await new EverestClient(
          CLIENT_EVEREST,
          'secret',
          supabase,
        ).createMission(
          {
            service_id: 71,
            client_ref: COLLECTE_ID,
            pickup: {
              address: '1 rue du Test',
              contact: { name: 'Contact Test', phone: '+33100000000' },
            },
            dropoff: { address: '2 rue du Test' },
            timeslot: { date: '2027-01-01', start: '22:00', end: '23:00' },
          },
          COLLECTE_ID,
        );
        return 'adapter_everest';
      },
    );

    const bilan = await runOutboxWorker(supabase);

    expect(bilan.dead).toBe(1);
    const resultat = rpcs.find((c) => c.name === 'fn_result_outbox');
    expect(resultat?.args).toMatchObject({
      p_statut: 'dead',
      p_requires_reconciliation: true,
      p_last_error:
        'Everest createMission timeout : en-tête de requête refusé (clé ou jeton mal formé)',
    });
    expect(alertes).toHaveLength(1);
    expect(alertes[0]!.titre).toContain('[DLQ]');
    sansLaCle(JSON.stringify(rpcs));
    sansLaCle(JSON.stringify(alertes));
  });
});
