import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  PRESTA_EVEREST,
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// =============================================================================
// Cloisonnement par provider — volet ENTRANT (polling MTS-1).
//
// `findTourneeByOrderId` rapprochait un customerOrder MTS-1 de N'IMPORTE quelle
// tournée portant cette `external_ref_commande`. Or la colonne est PARTAGÉE :
// l'adapter Everest y écrit son `mission_id`. Deux trous distincts, tous deux
// fermés ici :
//
//   1. aucun filtre provider — une tournée Everest homonyme était rapprochée, et
//      le poll MTS-1 écrivait `statut_tms`, `collectes.statut` et déclenchait
//      l'agrégation terminale sur la collecte de l'AUTRE transporteur ;
//   2. l'`error` de la requête n'était pas lue — `data` valait `null`, l'ordre
//      passait pour « sans tournée Savr » et `markInboxDone(traite=true)`
//      consommait la clé d'idempotence DÉFINITIVEMENT (pesées, statuts,
//      agrégation perdus, sans retry ni alerte). C'est exactement ce que
//      produit une collision sur `external_ref_commande` : `.maybeSingle()`
//      remonte PGRST116 quand la requête ramène plusieurs lignes.
//
// L'invariant DB qui rend la collision impossible est posé en parallèle
// (`uniq_tournee_par_external_ref`, pgTAP `SECU__cloisonnement_provider_db`) :
// ces deux tests prouvent le comportement de l'adapter QUAND ELLE SURVIENT.
// =============================================================================

const ORDER: Mts1CustomerOrder = {
  id: 'REF-PARTAGEE-001',
  externalReference: 'col-entrant-1',
  status: 'OK',
  pickupDate: '2026-07-15T22:00:00Z',
};

const ADAPTER_OPTS = {
  id: 'transp-entrant',
  type_tms: 'mts1' as const,
  code_transporteur_mts1: 'STRIKE',
  prestataire_logistique_id: PRESTA_MTS1,
};

const FENETRE = {
  depuis: new Date('2026-07-15T00:00:00Z'),
  jusqu_a: new Date('2026-07-17T00:00:00Z'),
};

type Call = { table: string; op: string; data?: unknown };

/**
 * Mock Supabase du chemin entrant.
 *
 * `from('tournees')` applique RÉELLEMENT le `.in('prestataire_logistique_id')`
 * reçu : servir une ligne déjà filtrée ne prouverait rien — retirer le `.in()`
 * du code laisserait la CI verte.
 */
function makeSupabase(opts: {
  /** Prestataire exécutant de la tournée portant la référence de l'ordre. */
  prestataireTournee: string;
  /** Erreur rendue par la lecture de rapprochement (collision PGRST116…). */
  erreurRapprochement?: { code: string; message: string };
}) {
  const calls: Call[] = [];

  function makeQuery(table: string) {
    const filtresIn: Record<string, unknown[]> = {};
    const self: Record<string, unknown> = {
      select: vi.fn(() => self),
      insert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'insert', data });
        return self;
      }),
      upsert: vi.fn((data: unknown) => {
        calls.push({ table, op: 'upsert', data });
        return self;
      }),
      update: vi.fn((data: unknown) => {
        calls.push({ table, op: 'update', data });
        return self;
      }),
      eq: vi.fn(() => self),
      in: vi.fn((col: string, vals: unknown[]) => {
        filtresIn[col] = vals;
        return self;
      }),
      limit: vi.fn(() => {
        if (table === 'integrations_inbox') {
          return Promise.resolve({ data: [{ id: 'inbox-1' }], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      maybeSingle: vi.fn(() => {
        if (table !== 'tournees') {
          return Promise.resolve({ data: null, error: null });
        }
        if (opts.erreurRapprochement) {
          return Promise.resolve({
            data: null,
            error: opts.erreurRapprochement,
          });
        }
        const admis = filtresIn['prestataire_logistique_id'];
        if (admis && !admis.includes(opts.prestataireTournee)) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({
          data: {
            id: 'tournee-partagee',
            tms_reference: null,
            collecte_tournees: [
              {
                collecte_id: 'col-autre-provider',
                collectes: { id: 'col-autre-provider', statut: 'validee' },
              },
            ],
          },
          error: null,
        });
      }),
    };
    return self;
  }

  const from = vi.fn((table: string) => {
    if (table === 'transporteurs') return builderTransporteurs();
    if (table === 'flux_dechets') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      };
    }
    if (table === 'parametres_algo') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      };
    }
    return makeQuery(table);
  });

  return {
    from,
    schema: vi.fn(() => ({ from })),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    _calls: calls,
  } as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _calls: Call[];
  };
}

function armerPoll() {
  _setMts1Handlers({
    pollOrders: vi.fn().mockResolvedValue({
      customerOrders: [ORDER],
      totalCount: 1,
      page: 1,
      pageSize: 50,
    }),
    getTour: vi.fn(),
    getPhotos: vi.fn().mockResolvedValue([]),
    postOrder: vi.fn(),
  });
}

describe('cloisonnement entrant — findTourneeByOrderId', () => {
  afterEach(() => _setMts1Handlers(null));

  it('une tournée EVEREST portant la même référence n’est pas rapprochée (aucune écriture sur sa collecte)', async () => {
    armerPoll();
    const supabase = makeSupabase({ prestataireTournee: PRESTA_EVEREST });

    await new AdapterMts1(ADAPTER_OPTS, supabase).sync(FENETRE);

    // Le statut du poll est 'OK' (terminal) : sans le filtre, l'adapter aurait
    // écrit statut_tms, passé la tournée à 'terminee' et lancé l'agrégation
    // terminale sur une collecte servie par A Toutes!.
    const ecrituresCollecte = supabase._calls.filter(
      (c) => c.table === 'collectes',
    );
    const ecrituresTournee = supabase._calls.filter(
      (c) => c.table === 'tournees' && c.op === 'update',
    );
    expect(ecrituresCollecte).toHaveLength(0);
    expect(ecrituresTournee).toHaveLength(0);
  });

  it('la MÊME tournée chez un prestataire MTS-1 est bien rapprochée (le filtre ne sur-ferme pas)', async () => {
    armerPoll();
    const supabase = makeSupabase({ prestataireTournee: PRESTA_MTS1 });

    await new AdapterMts1(ADAPTER_OPTS, supabase).sync(FENETRE);

    const ecrituresTournee = supabase._calls.filter(
      (c) => c.table === 'tournees' && c.op === 'update',
    );
    expect(ecrituresTournee.length).toBeGreaterThanOrEqual(1);
  });

  it('une collision sur external_ref_commande ne consomme PLUS la clé d’idempotence (traite reste false)', async () => {
    armerPoll();
    const supabase = makeSupabase({
      prestataireTournee: PRESTA_MTS1,
      // `.maybeSingle()` sur une requête qui ramène 2 lignes.
      erreurRapprochement: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });

    // sync() encapsule l'échec par ordre (log integrations_logs) — il ne relance pas.
    await new AdapterMts1(ADAPTER_OPTS, supabase).sync(FENETRE);

    const marquagesDone = supabase._calls.filter(
      (c) =>
        c.table === 'integrations_inbox' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown> | undefined)?.['traite'] === true,
    );
    expect(marquagesDone).toHaveLength(0);

    // L'erreur est tracée sur la ligne d'inbox (le poll suivant rejouera) et
    // dans integrations_logs (SYNC_ORDER_FAILED).
    const erreursInbox = supabase._calls.filter(
      (c) =>
        c.table === 'integrations_inbox' &&
        c.op === 'update' &&
        (c.data as Record<string, unknown> | undefined)?.['erreur'] !==
          undefined,
    );
    expect(erreursInbox).toHaveLength(1);

    // `direction='entrant'` : le client MTS-1 trace aussi ses appels HTTP
    // (direction 'sortant'), qui ne sont pas des erreurs de traitement.
    const logs = supabase._calls.filter(
      (c) =>
        c.table === 'integrations_logs' &&
        c.op === 'insert' &&
        (c.data as Record<string, unknown>)['direction'] === 'entrant',
    );
    expect(logs).toHaveLength(1);
    expect(
      String((logs[0]!.data as Record<string, unknown>)['erreur']),
    ).toContain('SYNC_ORDER_FAILED');
  });
});
