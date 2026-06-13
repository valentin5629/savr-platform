import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  captureException,
  setSentrySink,
  type SentrySink,
  type SentryContext,
} from './sentry.js';
import { sendAlert, setSlackSink, type SlackPayload } from './slack.js';

describe('M0.9 — Sentry sink injectable', () => {
  it('capture une exception avec role + organisation_id (sans PII directe)', () => {
    const calls: Array<{ error: Error; context: SentryContext }> = [];

    const mockSink: SentrySink = {
      captureException(error, context) {
        calls.push({ error, context });
      },
    };

    setSentrySink(mockSink);

    const err = new Error('DB connection lost');
    captureException(err, { role: 'admin_savr', organisation_id: 'org-123' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.error.message).toBe('DB connection lost');
    expect(calls[0]!.context).toMatchObject({
      role: 'admin_savr',
      organisation_id: 'org-123',
    });

    // Pas de user_id ni email nominatif dans le context
    expect(calls[0]!.context).not.toHaveProperty('email');
    expect(calls[0]!.context).not.toHaveProperty('password');
  });

  it('appelle exactement 1 fois le sink (pas de doublon)', () => {
    const sink = { captureException: vi.fn() };
    setSentrySink(sink);

    captureException(new Error('test'), {});

    expect(sink.captureException).toHaveBeenCalledOnce();
  });
});

describe('M0.9 — Slack sendAlert', () => {
  const captured: SlackPayload[] = [];

  beforeEach(() => {
    captured.length = 0;
    setSlackSink(async (payload) => {
      captured.push(payload);
    });
  });

  it('route vers critique pour une erreur applicative non catchée', async () => {
    await sendAlert({
      canal: 'critique',
      titre: 'Erreur applicative non catchée',
      message: 'TypeError: Cannot read properties of undefined',
      metadata: { route: '/api/collectes', trace_id: 'abc-123' },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.canal).toBe('critique');
    expect(captured[0]!.titre).toBe('Erreur applicative non catchée');
    expect(captured[0]!.metadata?.route).toBe('/api/collectes');
  });

  it('route vers eleve pour un job cron critique échoué', async () => {
    await sendAlert({
      canal: 'eleve',
      titre: 'Job cron critique échoué',
      message: 'attestations_batch a échoué après 3 tentatives',
      metadata: { job_name: 'attestations_batch', error_code: 'DB_TIMEOUT' },
    });

    expect(captured[0]!.canal).toBe('eleve');
  });

  it('route vers info pour un pack épuisé', async () => {
    await sendAlert({
      canal: 'info',
      titre: 'Pack AG épuisé',
      message: "L'organisation org-1 n'a plus de crédits pack AG",
    });

    expect(captured[0]!.canal).toBe('info');
  });

  it('le payload contient titre + message + metadata', async () => {
    await sendAlert({
      canal: 'critique',
      titre: 'Outbox DLQ',
      message: 'Event E1 en DLQ après 4 tentatives',
      metadata: { outbox_id: 'evt-999', collecte_id: 'col-42' },
    });

    expect(captured[0]!).toMatchObject({
      canal: 'critique',
      titre: 'Outbox DLQ',
      message: 'Event E1 en DLQ après 4 tentatives',
      metadata: { outbox_id: 'evt-999', collecte_id: 'col-42' },
    });
  });
});
