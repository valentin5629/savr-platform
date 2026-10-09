/**
 * M1.6 — `pnpm documents:dev` : branchement de la garde et enchaînement.
 *
 * La garde « savr-dev seulement » est la seule barrière de cette commande, qui
 * agit avec la clé de service : elle doit passer AVANT toute création de client,
 * sur l'environnement réellement utilisé. Ici la fabrique du client, les quatre
 * traitements et le lecteur du bucket sont simulés : rien de réel n'est appelé,
 * même si la garde était retirée — c'est alors l'assertion qui échoue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_PROJECT_REF } from '../../../shared/src/seed/constants.js';

const sim = vi.hoisted(() => {
  const vide = { processed: 0, done: 0, dead: 0, errors: [] as string[] };
  const etat = {
    appels: [] as string[],
    rpc: [] as string[],
    fabrique: 0,
    bucket: 'bucket-de-test' as string | null,
    erreursBatch: {} as Record<string, string[]>,
    passes: [] as Array<typeof vide>,
    vide,
    // Faux sous-batch : consigne son passage et rend les erreurs demandées.
    batch: (nom: string) => async () => {
      etat.appels.push(nom);
      return {
        enqueued: 0,
        already_done: 0,
        errors: etat.erreursBatch[nom] ?? [],
      };
    },
  };
  return etat;
});

vi.mock('../../../shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => {
    sim.fabrique++;
    return {
      rpc: async (nom: string) => {
        sim.rpc.push(nom);
        sim.appels.push('cloture');
        return { data: 3, error: null };
      },
    };
  },
}));
vi.mock('../../../shared/src/r2/bucket.js', () => ({
  bucketEnvironnement: () => {
    if (!sim.bucket) throw new Error('Variable R2 manquante');
    return sim.bucket;
  },
}));
vi.mock('../../src/lib/pdf/batch-pdf-j1.js', () => ({
  runBatchPdfJ1: sim.batch('zd'),
}));
vi.mock('../../src/lib/pdf/batch-pdf-j1-ag.js', () => ({
  runBatchPdfJ1Ag: sim.batch('ag'),
}));
vi.mock('../../src/lib/pdf/batch-pdf-sans-excedent.js', () => ({
  runBatchSansExcedent: sim.batch('sans_excedent'),
}));
vi.mock('../../src/lib/pdf/pdf-worker.js', () => ({
  runPdfWorker: async () => {
    sim.appels.push('worker');
    return sim.passes.shift() ?? sim.vide;
  },
}));

import { sendAlert } from '../../../shared/src/alerting/slack.js';
import { main } from '../../../../scripts/documents-dev.js';

const URL_DEV = `https://${DEV_PROJECT_REF}.supabase.co`;
const fetchReel = vi.fn();

beforeEach(() => {
  sim.appels.length = 0;
  sim.rpc.length = 0;
  sim.fabrique = 0;
  sim.bucket = 'bucket-de-test';
  sim.erreursBatch = {};
  sim.passes = [];
  fetchReel.mockReset();
  vi.stubGlobal('fetch', fetchReel);
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_DEV);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('M1.6 / documents:dev — la garde passe avant tout', () => {
  it.each([
    ['une autre base', 'https://abcdefghijklmnopqrst.supabase.co', ''],
    ['un déploiement Vercel', URL_DEV, 'preview'],
  ])(
    '%s : refus, aucun client créé, aucun traitement lancé',
    async (_cas, url, vercelEnv) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
      vi.stubEnv('VERCEL_ENV', vercelEnv);

      await expect(main()).rejects.toThrow(/^refusé : /);

      expect(sim.fabrique).toBe(0);
      expect(sim.appels).toEqual([]);
    },
  );

  it('aucun bucket désigné : arrêt avant toute création de client', async () => {
    sim.bucket = null;

    await expect(main()).rejects.toThrow(/Variable R2 manquante/);

    expect(sim.fabrique).toBe(0);
    expect(sim.appels).toEqual([]);
  });
});

describe('M1.6 / documents:dev — enchaînement sur savr-dev', () => {
  it('clôture, puis les trois batchs, puis le worker jusqu’à file vide', async () => {
    sim.passes = [
      { processed: 5, done: 5, dead: 0, errors: [] },
      { processed: 2, done: 2, dead: 0, errors: [] },
    ];

    await expect(main()).resolves.toBeUndefined();

    expect(sim.fabrique).toBe(1);
    expect(sim.rpc).toEqual(['fn_cloturer_collectes_embargo']);
    expect(sim.appels).toEqual([
      'cloture',
      'zd',
      'ag',
      'sans_excedent',
      'worker',
      'worker',
      'worker',
    ]);
  });

  it('une erreur dans un batch : les PDF en file sont quand même fabriqués, puis échec', async () => {
    sim.erreursBatch = { ag: ['collecte AG c-1: INSERT refusé'] };

    await expect(main()).rejects.toThrow(/^échec : /);

    expect(sim.appels).toEqual([
      'cloture',
      'zd',
      'ag',
      'sans_excedent',
      'worker',
    ]);
  });

  it('un PDF en échec : échec de la commande', async () => {
    sim.passes = [{ processed: 1, done: 0, dead: 0, errors: ['job j-1: KO'] }];

    await expect(main()).rejects.toThrow(/^échec : /);
  });

  it('une alerte Slack de la chaîne est affichée, jamais envoyée', async () => {
    vi.stubEnv('SLACK_WEBHOOK_ELEVE', 'https://hooks.exemple.test/eleve');
    await main();

    await sendAlert({ canal: 'eleve', titre: 'PDF mort', message: 'job j-1' });

    expect(fetchReel).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('alerte Slack « eleve » non envoyée : PDF mort'),
    );
  });
});
