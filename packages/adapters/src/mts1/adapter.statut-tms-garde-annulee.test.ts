import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// =============================================================================
// Polling MTS-1 : un ordre CANCELED/KO ne réécrit pas le statut_tms d'une
// collecte sortie de l'exécution.
//
// Chemin corrigé : annulation Savr (E3 = DELETE de l'ordre) puis l'ordre remonte
// CANCELED/KO au poll suivant. `processOrder` écrivait `statut_tms =
// rejetee_par_prestataire` sur la collecte sans regarder son statut — une
// collecte annulée affichait « rejetée par le prestataire ». Arbitrage Val
// 2026-09-17 : une collecte `annulation_demandee` garde sa demande, rien n'est
// écrit dessus. Le pendant SQL (fn_agreger_terminal_collecte) est couvert par
// supabase/tests/agreger_rejet_garde_annulee.test.sql.
//
// Le mock porte UNE ligne `collectes` en mémoire et applique réellement les
// filtres `.eq()` / `.in()` de l'UPDATE : retirer la garde du code fait
// réécrire la ligne et rougit le test.
// =============================================================================

const FENETRE = {
  depuis: new Date('2026-07-15T00:00:00Z'),
  jusqu_a: new Date('2026-07-17T00:00:00Z'),
};

const ADAPTER_OPTS = {
  id: 'transp-garde',
  type_tms: 'mts1' as const,
  code_transporteur_mts1: 'STRIKE',
  prestataire_logistique_id: PRESTA_MTS1,
};

const STATUT_TMS_INITIAL = 'en_attente_execution';

type Ligne = { id: string; statut: string; statut_tms: string };

function makeSupabase(collecte: Ligne) {
  const rpcs: string[] = [];

  /** UPDATE thenable : applique le patch à la ligne si tous les filtres matchent. */
  function updateCollectes(patch: Record<string, unknown>) {
    const conditions: Array<(l: Ligne) => boolean> = [];
    const builder = {
      eq: (col: keyof Ligne, val: unknown) => {
        conditions.push((l) => l[col] === val);
        return builder;
      },
      in: (col: keyof Ligne, vals: unknown[]) => {
        conditions.push((l) => vals.includes(l[col]));
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (conditions.every((c) => c(collecte))) {
          Object.assign(collecte, patch);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return builder;
  }

  /** Builder générique : chaîne tout, résout vide (inbox, tournées, logs…). */
  function builderNeutre(table: string) {
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'upsert', 'update', 'eq', 'in']) {
      self[m] = vi.fn(() => self);
    }
    self['limit'] = vi.fn(() =>
      Promise.resolve({
        data: table === 'integrations_inbox' ? [{ id: 'inbox-1' }] : [],
        error: null,
      }),
    );
    self['maybeSingle'] = vi.fn(() => {
      if (table !== 'tournees')
        return Promise.resolve({ data: null, error: null });
      return Promise.resolve({
        data: {
          id: 'tournee-1',
          tms_reference: null,
          collecte_tournees: [
            {
              collecte_id: collecte.id,
              collectes: { id: collecte.id, statut: collecte.statut },
            },
          ],
        },
        error: null,
      });
    });
    self['then'] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
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
    if (table === 'collectes') {
      const neutre = builderNeutre(table);
      return {
        ...neutre,
        update: (patch: Record<string, unknown>) => updateCollectes(patch),
      };
    }
    return builderNeutre(table);
  });

  const rpc = vi.fn((name: string) => {
    rpcs.push(name);
    const res = { data: 'pending', error: null };
    return {
      single: () => Promise.resolve(res),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(res).then(resolve),
    };
  });

  return {
    client: {
      from,
      schema: vi.fn(() => ({ from })),
      rpc,
    } as unknown as import('@supabase/supabase-js').SupabaseClient,
    rpcs,
  };
}

function armerPoll(status: Mts1CustomerOrder['status']) {
  _setMts1Handlers({
    pollOrders: vi.fn().mockResolvedValue({
      customerOrders: [
        {
          id: 'MTS1-ORDER-GARDE',
          externalReference: 'col-garde-1',
          status,
          pickupDate: '2026-07-15T22:00:00Z',
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50,
    }),
    getTour: vi.fn(),
    getPhotos: vi.fn().mockResolvedValue([]),
    postOrder: vi.fn(),
  });
}

async function poller(statut: string, status: Mts1CustomerOrder['status']) {
  armerPoll(status);
  const collecte: Ligne = {
    id: 'col-garde',
    statut,
    statut_tms: STATUT_TMS_INITIAL,
  };
  const { client, rpcs } = makeSupabase(collecte);
  await new AdapterMts1(ADAPTER_OPTS, client).sync(FENETRE);
  return { collecte, rpcs };
}

describe('polling MTS-1 — statut_tms gardé sur les collectes en exécution', () => {
  afterEach(() => _setMts1Handlers(null));

  it.each([
    ['annulee', 'CANCELED'],
    ['annulee', 'KO'],
    ['annulation_demandee', 'CANCELED'],
    ['annulation_demandee', 'KO'],
    ['realisee', 'CANCELED'],
    ['realisee_sans_collecte', 'KO'],
    ['cloturee', 'CANCELED'],
  ] as const)(
    'collecte %s + ordre %s → statut_tms inchangé',
    async (statut, status) => {
      const { collecte, rpcs } = await poller(statut, status);

      expect(collecte.statut_tms).toBe(STATUT_TMS_INITIAL);
      expect(collecte.statut).toBe(statut);
      // Le chemin terminal a bien été parcouru : la garde n'est pas un
      // court-circuit en amont (la décision de statut reste à la RPC gardée).
      expect(rpcs).toContain('fn_agreger_terminal_collecte');
    },
  );

  it.each([
    ['programmee', 'CANCELED'],
    ['validee', 'KO'],
    ['en_cours', 'CANCELED'],
  ] as const)(
    'collecte %s + ordre %s → statut_tms rejetee_par_prestataire (refus transporteur)',
    async (statut, status) => {
      const { collecte } = await poller(statut, status);

      expect(collecte.statut_tms).toBe('rejetee_par_prestataire');
    },
  );

  it('collecte programmee + ordre VALIDATED → statut_tms acceptee (la garde ne sur-ferme pas)', async () => {
    const { collecte } = await poller('programmee', 'VALIDATED');

    expect(collecte.statut_tms).toBe('acceptee');
  });

  it('collecte annulee + ordre VALIDATED → statut_tms inchangé', async () => {
    const { collecte } = await poller('annulee', 'VALIDATED');

    expect(collecte.statut_tms).toBe(STATUT_TMS_INITIAL);
  });
});
