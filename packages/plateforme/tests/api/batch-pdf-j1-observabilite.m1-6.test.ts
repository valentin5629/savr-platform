/**
 * Cron batch-pdf-j1 — observabilité des échecs GLOBAUX des sous-batchs (§07/02, §07/03).
 *
 * Incident 2026-09-11 : les requêtes de sélection des 3 sous-batchs étaient cassées en
 * base réelle ; chaque sous-batch rangeait l'erreur dans `result.errors` et rendait la
 * main normalement → la route émettait `job.cron.completed`, 0 PDF produit pendant des
 * mois, aucune alerte « Job cron critique échoué ».
 *
 * Contrat testé : un échec global (sélection, ou 100 % des collectes tentées en échec)
 * → `job.cron.failed` + alerte Slack `eleve` + HTTP 500 ; un échec partiel → `completed`
 * (nb_errors) + `warn` par collecte, sans alerte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';

import { runBatchPdfJ1 } from '../../src/lib/pdf/batch-pdf-j1.js';
import { runBatchPdfJ1Ag } from '../../src/lib/pdf/batch-pdf-j1-ag.js';
import { runBatchSansExcedent } from '../../src/lib/pdf/batch-pdf-sans-excedent.js';

// ── Faux client Supabase aiguillé par table + filtres .eq() ──────────────────
// Les 3 sous-batchs tournent EN PARALLÈLE sur le même client : une file de réponses
// séquentielle ne marcherait pas, on répond donc selon la requête elle-même.

interface Requete {
  table: string;
  op: 'select' | 'insert';
  filtres: Record<string, unknown>;
  payload?: Record<string, unknown>;
}
interface Reponse {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}
type Resolveur = (q: Requete) => Reponse | undefined;

/** Clé de la sélection initiale d'un sous-batch : `type/statut` sur `collectes`. */
function cleSelection(q: Requete): string | null {
  if (q.table !== 'collectes' || q.op !== 'select') return null;
  return `${String(q.filtres.type)}/${String(q.filtres.statut)}`;
}

function fakeSupabase(resolve: Resolveur = () => undefined) {
  const requetes: Requete[] = [];
  const query = (table: string) => {
    const q: Requete = { table, op: 'select', filtres: {} };
    requetes.push(q);
    const settle = () =>
      Promise.resolve({
        data: q.op === 'insert' ? { id: `${table}-new` } : [],
        error: null,
        count: null,
        ...resolve(q),
      });
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (payload: Record<string, unknown>) => {
        q.op = 'insert';
        q.payload = payload;
        return chain;
      },
      eq: (k: string, v: unknown) => {
        q.filtres[k] = v;
        return chain;
      },
      in: () => chain,
      not: () => chain,
      lte: () => chain,
      order: () => chain,
      single: settle,
      maybeSingle: settle,
      then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
        settle().then(f, r),
    };
    return chain;
  };
  const rpcResult = () => {
    const p = Promise.resolve({ data: null, error: null });
    return { single: () => p, then: p.then.bind(p) };
  };
  return {
    from: vi.fn(query),
    schema: vi.fn(() => ({ from: query })),
    rpc: vi.fn(rpcResult),
    requetes,
    inserts: () => requetes.filter((r) => r.op === 'insert'),
  };
}

let courant = fakeSupabase();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => courant,
}));

// ── Capture logs (JSON 1 ligne sur console.log) + Slack ──────────────────────
interface Log {
  level: string;
  event: string;
  payload: Record<string, unknown>;
}
const alertes: SlackPayload[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  alertes.length = 0;
  setSlackSink(async (p) => {
    alertes.push(p);
  });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.env.CRON_SECRET = 'sekret-test';
});
afterEach(() => {
  logSpy.mockRestore();
  setSlackSink(async () => undefined);
});

function logs(): Log[] {
  return logSpy.mock.calls.flatMap((c) => {
    try {
      return [JSON.parse(c[0] as string) as Log];
    } catch {
      return [];
    }
  });
}
function cronEvents(event: string, jobName: string): Log[] {
  return logs().filter(
    (l) => l.event === event && l.payload.job_name === jobName,
  );
}

async function appelerCron() {
  const { POST } = await import('@/app/api/cron/batch-pdf-j1/route.js');
  return POST(
    new NextRequest('http://x/api/cron/batch-pdf-j1', {
      method: 'POST',
      headers: { authorization: 'Bearer sekret-test' },
    }),
  );
}

const ERREUR_EMBED = {
  message:
    "Could not embed because more than one relationship was found for 'evenements' and 'organisations'",
  code: 'PGRST201',
};

const JOBS = [
  'bordereaux_rapports_batch',
  'attestations_batch',
  'rapport_sans_excedent_batch',
] as const;

const CAS_SELECTION = [
  {
    module: 'M1.6',
    jobName: 'bordereaux_rapports_batch',
    selection: 'zero_dechet/cloturee',
  },
  {
    module: 'M2.4',
    jobName: 'attestations_batch',
    selection: 'anti_gaspi/cloturee',
  },
  {
    module: 'M2.4',
    jobName: 'rapport_sans_excedent_batch',
    selection: 'anti_gaspi/realisee_sans_collecte',
  },
] as const;

// ── Route : sélection en échec → job.cron.failed (pas completed) ─────────────

for (const cas of CAS_SELECTION) {
  describe(`${cas.module} / cron batch-pdf-j1 — sélection ${cas.jobName} en échec`, () => {
    it('job.cron.failed(etape=selection) + alerte eleve + 500, JAMAIS completed ; les autres sous-batchs restent completed', async () => {
      courant = fakeSupabase((q) =>
        cleSelection(q) === cas.selection
          ? { data: null, error: ERREUR_EMBED }
          : undefined,
      );

      const res = await appelerCron();

      expect(res.status).toBe(500);
      expect(cronEvents('job.cron.completed', cas.jobName)).toHaveLength(0);
      const failed = cronEvents('job.cron.failed', cas.jobName);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.level).toBe('error');
      expect(failed[0]!.payload.etape).toBe('selection');
      // error_code §07/02 = code PostgREST réel, pas 'UNKNOWN'.
      expect(failed[0]!.payload.error_code).toBe('PGRST201');

      expect(alertes).toHaveLength(1);
      expect(alertes[0]!.canal).toBe('eleve');
      expect(alertes[0]!.titre).toBe('Job cron critique échoué');
      expect(alertes[0]!.metadata?.job_name).toBe(cas.jobName);
      expect(alertes[0]!.metadata?.etape).toBe('selection');
      expect(alertes[0]!.message).toContain('more than one relationship');

      // Isolation : les deux autres sous-batchs ne sont pas contaminés.
      for (const autre of JOBS.filter((j) => j !== cas.jobName)) {
        expect(cronEvents('job.cron.completed', autre)).toHaveLength(1);
        expect(cronEvents('job.cron.failed', autre)).toHaveLength(0);
      }
    });
  });
}

describe('M1.6 / cron batch-pdf-j1 — nominal sans collecte', () => {
  it('3 × job.cron.completed(nb_traite=0), 200, aucune alerte (pas de faux positif)', async () => {
    courant = fakeSupabase();

    const res = await appelerCron();

    expect(res.status).toBe(200);
    for (const job of JOBS) {
      const completed = cronEvents('job.cron.completed', job);
      expect(completed).toHaveLength(1);
      expect(completed[0]!.payload.nb_traite).toBe(0);
      expect(cronEvents('job.cron.failed', job)).toHaveLength(0);
    }
    expect(alertes).toHaveLength(0);
  });
});

// ── Sélection d'idempotence en échec → fail-closed (jamais de doublon) ───────
// Si la lecture « documents déjà émis » échoue, traiter quand même = ré-émettre des
// documents déjà émis (numéros gapless BSAV/ATT-DON consommés, attestation fiscale en
// double). Le batch doit s'arrêter en échec global, sans aucun INSERT.

const ERREUR_DB = { message: 'connection timeout', code: '57014' };

describe('M1.6 / batch ZD — lecture bordereaux existants en échec', () => {
  it('fatal etape=selection, aucun INSERT', async () => {
    const sb = fakeSupabase((q) => {
      if (cleSelection(q) === 'zero_dechet/cloturee')
        return { data: [{ id: 'col-1', evenement_id: 'ev-1' }] };
      if (q.table === 'bordereaux_savr' && q.op === 'select')
        return { data: null, error: ERREUR_DB };
      return undefined;
    });

    const result = await runBatchPdfJ1(sb as never);

    expect(result.fatal?.etape).toBe('selection');
    expect(result.fatal?.code).toBe('57014');
    expect(result.enqueued).toBe(0);
    expect(sb.inserts()).toHaveLength(0);
  });
});

describe('M2.4 / batch AG — lecture attestations existantes en échec', () => {
  it('fatal etape=selection, aucun INSERT (pas d’attestation fiscale en double)', async () => {
    const sb = fakeSupabase((q) => {
      if (cleSelection(q) === 'anti_gaspi/cloturee')
        return {
          data: [
            {
              id: 'col-ag-1',
              evenement_id: 'ev-1',
              evenements: { organisation_id: 'org-1' },
              attributions_antgaspi: { id: 'att-1', volume_repas_realise: 40 },
            },
          ],
        };
      if (q.table === 'attestations_don' && q.op === 'select')
        return { data: null, error: ERREUR_DB };
      return undefined;
    });

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.fatal?.etape).toBe('selection');
    expect(result.enqueued).toBe(0);
    expect(sb.inserts()).toHaveLength(0);
  });
});

describe('M2.4 / batch sans-excédent — lecture rapports existants en échec', () => {
  it('fatal etape=selection, aucun INSERT', async () => {
    const sb = fakeSupabase((q) => {
      if (cleSelection(q) === 'anti_gaspi/realisee_sans_collecte')
        return { data: [{ id: 'col-se-1', evenement_id: 'ev-1' }] };
      if (q.table === 'rapports_rse' && q.op === 'select')
        return { data: null, error: ERREUR_DB };
      return undefined;
    });

    const result = await runBatchSansExcedent(sb as never);

    expect(result.fatal?.etape).toBe('selection');
    expect(result.enqueued).toBe(0);
    expect(sb.inserts()).toHaveLength(0);
  });
});

// ── Échecs PAR COLLECTE : partiel = warn seul ; total = échec global ─────────

function collecteSansExcedent(id: string) {
  return {
    id,
    evenement_id: `ev-${id}`,
    controle_acces_requis: false,
    aucun_repas_motif: 'Aucun excédent',
    evenements: {
      nom_evenement: 'Gala',
      date_evenement: '2026-09-10',
      pax: 120,
      nom_client_organisateur: null,
      organisation_id: 'org-1',
      traiteur_operationnel_organisation_id: null,
      client_organisateur_organisation_id: null,
      logo_client_organisateur_url: null,
      organisations: {
        raison_sociale: 'Traiteur SAS',
        type: 'traiteur',
        logo_url: null,
      },
      traiteur_operationnel: null,
      client_organisateur: null,
      lieux: null,
    },
  };
}

/** Sous-batch sans-excédent : INSERT rapports_rse en échec pour les ids `enEchec`. */
function resolveurSansExcedent(ids: string[], enEchec: string[]): Resolveur {
  return (q) => {
    if (cleSelection(q) === 'anti_gaspi/realisee_sans_collecte')
      return { data: ids.map(collecteSansExcedent) };
    if (
      q.table === 'rapports_rse' &&
      q.op === 'insert' &&
      enEchec.includes(String(q.payload?.collecte_id))
    )
      return { data: null, error: { message: 'insert KO' } };
    return undefined;
  };
}

function warnsCollecte(): Log[] {
  return logs().filter(
    (l) => l.level === 'warn' && l.event === 'pdf.batch.collecte_failed',
  );
}

describe('M2.4 / batch sans-excédent — échec partiel par collecte', () => {
  it('1 collecte KO sur 2 : pas de fatal, warn avec collecte_id, l’autre produite', async () => {
    const sb = fakeSupabase(
      resolveurSansExcedent(['col-ok', 'col-ko'], ['col-ko']),
    );

    const result = await runBatchSansExcedent(sb as never);

    expect(result.fatal).toBeUndefined();
    expect(result.enqueued).toBe(1);
    expect(result.errors).toHaveLength(1);
    const warns = warnsCollecte();
    expect(warns).toHaveLength(1);
    expect(warns[0]!.payload.collecte_id).toBe('col-ko');
    expect(warns[0]!.payload.job_name).toBe('rapport_sans_excedent_batch');
  });
});

describe('M2.4 / batch sans-excédent — toutes les collectes tentées en échec', () => {
  it('fatal etape=traitement (défaut systémique ≠ aléa isolé)', async () => {
    const sb = fakeSupabase(resolveurSansExcedent(['col-a'], ['col-a']));

    const result = await runBatchSansExcedent(sb as never);

    expect(result.fatal?.etape).toBe('traitement');
    expect(result.fatal?.message).toContain('insert KO');
    expect(warnsCollecte()).toHaveLength(1);
  });

  it('via la route : job.cron.failed(etape=traitement) + alerte eleve + 500', async () => {
    courant = fakeSupabase(resolveurSansExcedent(['col-a'], ['col-a']));

    const res = await appelerCron();

    expect(res.status).toBe(500);
    const job = 'rapport_sans_excedent_batch';
    expect(cronEvents('job.cron.completed', job)).toHaveLength(0);
    expect(cronEvents('job.cron.failed', job)[0]?.payload.etape).toBe(
      'traitement',
    );
    expect(alertes.map((a) => a.metadata?.job_name)).toEqual([job]);
  });
});

describe('M2.4 / cron batch-pdf-j1 — échec partiel via la route', () => {
  it('completed(nb_traite=1, nb_errors=1), 200, aucune alerte', async () => {
    courant = fakeSupabase(
      resolveurSansExcedent(['col-ok', 'col-ko'], ['col-ko']),
    );

    const res = await appelerCron();

    expect(res.status).toBe(200);
    const completed = cronEvents(
      'job.cron.completed',
      'rapport_sans_excedent_batch',
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]!.payload.nb_traite).toBe(1);
    expect(completed[0]!.payload.nb_errors).toBe(1);
    expect(alertes).toHaveLength(0);
  });
});
