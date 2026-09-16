// Alerte anticipée outbox étendue aux events `lieu` (§07/03 + §04 outbox_events,
// arbitrage Val 2026-09-16 — divergence OBS_20260915_alerte-anticipee-events-lieu).
//
// Avant : `if (event.aggregate_type !== 'collecte') return;` — un E5
// `lieu.champ_critique_modifie` en échec avant une collecte du soir restait
// silencieux ~25 h (DLQ seule) et le camion partait à l'ancienne adresse.
// Désormais : date de référence = plus proche `date_collecte` parmi les collectes
// FUTURES NON TERMINALES du lieu (jointure `evenements.lieu_id`), même seuil,
// même canal.
//
// G5 : VRAI `runOutboxWorker`. Frontières mockées : client Supabase + appel HTTP
// de l'adapter (spyOn `updateLieu`). Le mock `collectes` APPLIQUE les filtres que
// le worker pose (lieu, date ≥ aujourd'hui, statuts exclus, tri, limite) sur une
// table en mémoire : un filtre retiré côté worker change le résultat, donc le
// test — jamais de ligne « déjà filtrée » servie par la fixture.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';
import { jourParis, jourParisDecale } from '@savr/shared/src/temps/index.js';

import { LogistiqueTransientError } from './index.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { runOutboxWorker } from './outbox-worker.js';

const LIEU_ID = '11111111-1111-1111-1111-111111111111';
const AUTRE_LIEU_ID = '22222222-2222-2222-2222-222222222222';

interface CollecteEnBase {
  id: string;
  lieu_id: string;
  date_collecte: string;
  statut: string;
}

interface Filtres {
  eq: Array<[string, unknown]>;
  gte: Array<[string, string]>;
  notIn: Array<[string, string[]]>;
  order: Array<[string, boolean]>;
  limit: number | null;
}

function appliquer(rows: CollecteEnBase[], f: Filtres) {
  let out = rows.filter((r) =>
    f.eq.every(([col, v]) =>
      col === 'evenements.lieu_id'
        ? r.lieu_id === v
        : col === 'id' && r.id === v,
    ),
  );
  for (const [col, v] of f.gte)
    out = out.filter((r) => String(r[col as keyof CollecteEnBase]) >= v);
  for (const [col, vals] of f.notIn)
    out = out.filter(
      (r) => !vals.includes(String(r[col as keyof CollecteEnBase])),
    );
  for (const [col, asc] of f.order)
    out = [...out].sort((a, b) => {
      const c = String(a[col as keyof CollecteEnBase]).localeCompare(
        String(b[col as keyof CollecteEnBase]),
      );
      return asc ? c : -c;
    });
  if (f.limit !== null) out = out.slice(0, f.limit);
  return out;
}

function makeSupabase(opts: { attempts: number; collectes: CollecteEnBase[] }) {
  const claimedEvent = {
    id: 'evt-e5-anticipee',
    aggregate_type: 'lieu',
    aggregate_id: LIEU_ID,
    event_type: 'lieu.champ_critique_modifie',
    payload: { lieu_id: LIEU_ID },
    consumer: 'adapter_mts1',
    attempts: opts.attempts,
    requires_reconciliation: false,
  };

  const makeTableQuery = (table: string) => {
    const f: Filtres = { eq: [], gte: [], notIn: [], order: [], limit: null };
    const q: Record<string, unknown> = {};
    q['select'] = vi.fn(() => q);
    q['eq'] = vi.fn((col: string, v: unknown) => (f.eq.push([col, v]), q));
    q['gte'] = vi.fn((col: string, v: string) => (f.gte.push([col, v]), q));
    q['not'] = vi.fn((col: string, op: string, v: string) => {
      if (op !== 'in') throw new Error(`opérateur non simulé : ${op}`);
      f.notIn.push([col, v.replace(/[()]/g, '').split(',')]);
      return q;
    });
    q['order'] = vi.fn(
      (col: string, o?: { ascending?: boolean }) => (
        f.order.push([col, o?.ascending ?? true]),
        q
      ),
    );
    q['limit'] = vi.fn((n: number) => ((f.limit = n), q));
    q['single'] = vi.fn(async () =>
      table === 'lieux'
        ? { data: { id: LIEU_ID, nom: 'Pavillon Gabriel' }, error: null }
        : { data: null, error: null },
    );
    q['maybeSingle'] = vi.fn(async () => {
      if (table !== 'collectes') return { data: null, error: null };
      const rows = appliquer(opts.collectes, f);
      // PostgREST : maybeSingle sur > 1 ligne = erreur (d'où le limit(1) requis).
      if (rows.length > 1)
        return { data: null, error: { message: 'multiple rows' } };
      const r = rows[0];
      return {
        data: r ? { id: r.id, date_collecte: r.date_collecte } : null,
        error: null,
      };
    });
    q['then'] = (resolve: (v: unknown) => void) =>
      resolve(
        table === 'transporteurs'
          ? {
              data: [
                {
                  id: 'transp-001',
                  type_tms: 'mts1',
                  code_transporteur_mts1: 'STRIKE',
                  prestataire_logistique_id: 'presta-strike',
                },
              ],
              error: null,
            }
          : { data: [], error: null },
      );
    return q;
  };

  const rpc = vi.fn(async (name: string) => {
    if (name === 'fn_reap_outbox_claims') return { data: 0, error: null };
    if (name === 'fn_claim_outbox_batch')
      return { data: [claimedEvent], error: null };
    return { data: null, error: null };
  });

  return {
    rpc,
    from: vi.fn((table: string) => makeTableQuery(table)),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

function captureAlerts(): SlackPayload[] {
  const alerts: SlackPayload[] = [];
  setSlackSink(async (p) => {
    alerts.push(p);
  });
  return alerts;
}

const e5EchoueEnBoucle = () =>
  vi
    .spyOn(AdapterMts1.prototype, 'updateLieu')
    .mockRejectedValue(new LogistiqueTransientError('503 MTS-1'));

const collecte = (
  id: string,
  date_collecte: string,
  statut = 'validee',
  lieu_id = LIEU_ID,
): CollecteEnBase => ({ id, lieu_id, date_collecte, statut });

const anticipees = (alerts: SlackPayload[]) =>
  alerts.filter((a) => a.canal === 'critique' && a.titre.includes('J-1'));

describe('Alerte anticipée outbox — events aggregate_type=lieu (E5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setSlackSink(async () => {});
  });

  it('attempts ≥ 2 + collecte non terminale du lieu aujourd’hui → 1 alerte critique', async () => {
    const alerts = captureAlerts();
    e5EchoueEnBoucle();
    const supabase = makeSupabase({
      attempts: 2,
      collectes: [collecte('col-ce-soir', jourParis())],
    });

    const result = await runOutboxWorker(supabase);

    expect(result.failed).toBe(1);
    const a = anticipees(alerts);
    expect(a).toHaveLength(1);
    expect(a[0]!.message).toContain(`lieu_id=${LIEU_ID}`);
    expect(a[0]!.message).toContain('collecte_id=col-ce-soir');
    expect(a[0]!.metadata).toMatchObject({
      event_type: 'lieu.champ_critique_modifie',
    });
  });

  it('attempts = 1 → aucune alerte anticipée (seuil inchangé)', async () => {
    const alerts = captureAlerts();
    e5EchoueEnBoucle();
    const supabase = makeSupabase({
      attempts: 1,
      collectes: [collecte('col-ce-soir', jourParis())],
    });

    await runOutboxWorker(supabase);

    expect(anticipees(alerts)).toHaveLength(0);
  });

  it('collectes du jour toutes terminales → aucune alerte', async () => {
    const alerts = captureAlerts();
    e5EchoueEnBoucle();
    const jour = jourParis();
    const supabase = makeSupabase({
      attempts: 2,
      collectes: [
        collecte('col-cloturee', jour, 'cloturee'),
        collecte('col-realisee', jour, 'realisee'),
        collecte('col-sans-collecte', jour, 'realisee_sans_collecte'),
        collecte('col-annulee', jour, 'annulee'),
        collecte('col-rejetee', jour, 'rejetee_par_prestataire'),
      ],
    });

    await runOutboxWorker(supabase);

    expect(anticipees(alerts)).toHaveLength(0);
  });

  it('collecte imminente d’un AUTRE lieu → aucune alerte', async () => {
    const alerts = captureAlerts();
    e5EchoueEnBoucle();
    const supabase = makeSupabase({
      attempts: 2,
      collectes: [
        collecte('col-autre-lieu', jourParis(), 'validee', AUTRE_LIEU_ID),
      ],
    });

    await runOutboxWorker(supabase);

    expect(anticipees(alerts)).toHaveLength(0);
  });

  it('collecte passée non terminale + prochaine au-delà de 24 h → aucune alerte', async () => {
    const alerts = captureAlerts();
    e5EchoueEnBoucle();
    const supabase = makeSupabase({
      attempts: 2,
      collectes: [
        collecte('col-hier', jourParisDecale(-1), 'en_cours'),
        collecte('col-dans-10j', jourParisDecale(10)),
      ],
    });

    await runOutboxWorker(supabase);

    expect(anticipees(alerts)).toHaveLength(0);
  });

  it('plusieurs collectes à venir → UNE seule alerte, sur la plus proche', async () => {
    const alerts = captureAlerts();
    e5EchoueEnBoucle();
    const supabase = makeSupabase({
      attempts: 3,
      collectes: [
        collecte('col-dans-10j', jourParisDecale(10)),
        collecte('col-ce-soir', jourParis(), 'programmee'),
        collecte('col-dans-5j', jourParisDecale(5)),
      ],
    });

    await runOutboxWorker(supabase);

    const a = anticipees(alerts);
    expect(a).toHaveLength(1);
    expect(a[0]!.message).toContain('collecte_id=col-ce-soir');
  });

  it('retries épuisés → alerte DLQ seule, pas de doublon anticipée', async () => {
    const alerts = captureAlerts();
    e5EchoueEnBoucle();
    const supabase = makeSupabase({
      attempts: 4,
      collectes: [collecte('col-ce-soir', jourParis())],
    });

    const result = await runOutboxWorker(supabase);

    expect(result.dead).toBe(1);
    expect(alerts.filter((a) => a.titre.includes('[DLQ]'))).toHaveLength(1);
    expect(anticipees(alerts)).toHaveLength(0);
  });
});
