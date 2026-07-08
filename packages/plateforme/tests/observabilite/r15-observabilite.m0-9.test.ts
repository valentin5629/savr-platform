/**
 * R15 — Observabilité câblée (BL-P1-OBS-01/02/03).
 * Vérifie les 3 chaînes fermées par R15 :
 *  - OBS-01 : le logger @savr/shared est CÂBLÉ (émission d'events canoniques) et
 *    rédige la PII au call-site (sanitizePayload).
 *  - OBS-02 : le wrapper cron émet job.cron.started/completed/failed (§07/02) et
 *    pousse une alerte Slack §07/03 sur échec d'un job critique.
 *  - OBS-03 : les mutations sensibles écrivent audit_log avec la valeur d'action
 *    exacte du catalogue §07/06 (+ motif obligatoire).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';
import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';
import { withCronObservability } from '@/lib/cron-observabilite.js';

// ── OBS-01 — logger câblé + PII ──────────────────────────────────────────────
describe('M0.9 R15 / OBS-01 — logger câblé', () => {
  it('M0.9-10 — un call-site réel émet un event canonique JSON via le logger (stdout)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('collecte.realisee', { collecte_id: 'c-1', type: 'zd' });
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0]![0] as string) as {
      event: string;
      level: string;
      payload: Record<string, unknown>;
    };
    expect(entry.event).toBe('collecte.realisee');
    expect(entry.level).toBe('info');
    expect(entry.payload.collecte_id).toBe('c-1');
    spy.mockRestore();
  });

  it('M0.9-11 — sanitizePayload rédige la PII par clé (siret/email), préserve le montant', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.warn('api_route.error', {
      siret: '12345678900011',
      contact_email: 'jean@traiteur.fr',
      montant_ttc: 120,
    });
    const entry = JSON.parse(spy.mock.calls[0]![0] as string) as {
      payload: Record<string, unknown>;
    };
    expect(entry.payload.siret).toBe('[REDACTED]');
    expect(String(entry.payload.contact_email)).not.toContain(
      'jean@traiteur.fr',
    );
    expect(entry.payload.montant_ttc).toBe(120); // §07/01 : montant préservé
    spy.mockRestore();
  });
});

// ── OBS-02 — chaînes cron → job.cron.* + alerte Slack ────────────────────────
describe('M0.9 R15 / OBS-02 — wrapper cron', () => {
  const alerts: SlackPayload[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alerts.length = 0;
    setSlackSink(async (p) => {
      alerts.push(p);
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.CRON_SECRET = 'sekret-test';
  });
  afterEach(() => {
    logSpy.mockRestore();
    // Repuits Slack neutre (évite toute fuite d'état inter-fichiers).
    setSlackSink(async () => undefined);
  });

  function events(): string[] {
    return logSpy.mock.calls.map(
      (c) => (JSON.parse(c[0] as string) as { event: string }).event,
    );
  }

  it('M0.9-12 — succès : job.cron.started + job.cron.completed(nb_traite), 200, pas d’alerte', async () => {
    const handler = withCronObservability('email_retry', async () => ({
      nb_traite: 3,
    }));
    const req = new NextRequest('http://x/api/cron/email-retry', {
      method: 'POST',
      headers: { authorization: 'Bearer sekret-test' },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(events()).toContain('job.cron.started');
    const completed = logSpy.mock.calls
      .map(
        (c) =>
          JSON.parse(c[0] as string) as {
            event: string;
            payload: { nb_traite?: number };
          },
      )
      .find((e) => e.event === 'job.cron.completed');
    expect(completed?.payload.nb_traite).toBe(3);
    expect(alerts).toHaveLength(0);
  });

  it('M0.9-13 — job critique échoué : job.cron.failed + sendAlert(eleve) + 500', async () => {
    const handler = withCronObservability(
      'mts1_polling',
      async () => {
        throw new Error('boom');
      },
      { canalOnFailure: 'eleve' },
    );
    const req = new NextRequest('http://x/cron/critique', {
      method: 'POST',
      headers: { authorization: 'Bearer sekret-test' },
    });
    const res = await handler(req);
    expect(res.status).toBe(500);
    expect(events()).toContain('job.cron.failed');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.canal).toBe('eleve');
    expect(alerts[0]!.metadata?.job_name).toBe('mts1_polling');
  });

  it('M0.9-14 — garde CRON_SECRET : 401 sans Bearer valide', async () => {
    const handler = withCronObservability('email_retry', async () => ({}));
    const res = await handler(
      new NextRequest('http://x/api/cron/email-retry', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('M0.9-23 — job.cron.started porte job_name ET trace_id non-null (§07/02 l.18)', async () => {
    const handler = withCronObservability('email_retry', async () => ({
      nb_traite: 0,
    }));
    const req = new NextRequest('http://x/api/cron/email-retry', {
      method: 'POST',
      headers: { authorization: 'Bearer sekret-test' },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const parsed = logSpy.mock.calls.map(
      (c) =>
        JSON.parse(c[0] as string) as {
          event: string;
          trace_id: string | null;
          payload: { job_name?: string; trace_id?: string | null };
        },
    );
    const started = parsed.find((e) => e.event === 'job.cron.started');
    expect(started).toBeDefined();
    // §07/02 l.18 : payload obligatoire { job_name, trace_id }.
    expect(started!.payload.job_name).toBe('email_retry');
    expect(typeof started!.payload.trace_id).toBe('string');
    expect(started!.payload.trace_id).toBeTruthy();
    // §07/01 : le champ top-level trace_id du schema est renseigne (via ALS).
    expect(started!.trace_id).toBe(started!.payload.trace_id);
    // Propagation « sur toute la chaine » : completed partage le meme trace_id.
    const completed = parsed.find((e) => e.event === 'job.cron.completed');
    expect(completed!.trace_id).toBe(started!.trace_id);
  });
});

// ── OBS-03 — audit_log valeurs d'action du catalogue §07/06 ──────────────────
const mockGenerateLink = vi.fn();
const mockChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  auth: { admin: { generateLink: mockGenerateLink } },
};
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockChain,
}));

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockSignIn = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
      signInWithPassword: mockSignIn,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function jwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function authAs(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'admin-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jwt({ user_role: role }) } },
    error: null,
  });
}
function patch(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://x${url}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('M0.9 R15 / OBS-03 — audit_log catalogue §07/06', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChain.from.mockReturnThis();
    mockChain.select.mockReturnThis();
    mockChain.insert.mockReturnThis();
    mockChain.update.mockReturnThis();
    mockChain.eq.mockReturnThis();
  });

  it('M0.9-15 — user_role_modifie : changement de rôle → audit action exacte + motif', async () => {
    authAs('admin_savr');
    mockChain.single
      .mockResolvedValueOnce({
        data: { id: 'u-1', role: 'traiteur_commercial', actif: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'u-1',
          prenom: 'A',
          nom: 'B',
          email: 'a@b.fr',
          role: 'traiteur_manager',
          actif: true,
        },
        error: null,
      });
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      patch('/api/v1/admin/users/u-1', {
        role: 'traiteur_manager',
        motif: 'Réassignation validée par la direction',
      }),
      { params: Promise.resolve({ id: 'u-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user_role_modifie',
        table_name: 'users',
        motif: 'Réassignation validée par la direction',
      }),
    );
  });

  it('M0.9-16 — tarif_refacture_pax_zd_update : modif tarif orga → audit action exacte', async () => {
    authAs('admin_savr');
    mockChain.single
      .mockResolvedValueOnce({
        data: { tarif_refacture_pax_zd: 1.5 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'org-1',
          raison_sociale: 'Orga',
          type: 'traiteur',
          actif: true,
          tarif_refacture_pax_zd: 2.5,
        },
        error: null,
      });
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      patch('/api/v1/admin/organisations/org-1', {
        tarif_refacture_pax_zd: 2.5,
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tarif_refacture_pax_zd_update',
        table_name: 'organisations',
        old_values: { tarif_refacture_pax_zd: 1.5 },
      }),
    );
  });

  it('M0.9-20 — impersonation : audit impersonation_session + event auth.impersonation_started', async () => {
    authAs('admin_savr');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockChain.single.mockResolvedValueOnce({
      data: {
        id: 'cible-1',
        email: 'cible@traiteur.fr',
        prenom: 'P',
        nom: 'M',
        role: 'traiteur_manager',
        organisation_id: 'org-1',
        actif: true,
      },
      error: null,
    });
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'imp-hash' } },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/users/[id]/impersoner/route.js');
    const res = await POST(
      new NextRequest('http://x/api/v1/admin/users/cible-1/impersoner', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cible-1' }) },
    );
    expect(res.status).toBe(200);
    // §07/06 : audit impersonation_session (impersonator_id renseigné)
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'impersonation_session',
        impersonator_id: 'admin-1',
      }),
    );
    // §07/01 : event business auth.impersonation_started (warn)
    const started = logSpy.mock.calls
      .map(
        (c) =>
          JSON.parse(c[0] as string) as {
            event: string;
            payload: Record<string, unknown>;
          },
      )
      .find((e) => e.event === 'auth.impersonation_started');
    expect(started).toBeDefined();
    expect(started!.payload.target_user).toBe('cible-1');
    expect(started!.payload.impersonator_id).toBe('admin-1');
    logSpy.mockRestore();
  });
});

// ── OBS-02 (chaînes stat) — events émis, agrégation plateforme ───────────────
describe('M0.9 R15 / OBS-02 — chaînes bruteforce & RLS deny (events)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('M0.9-17 — login échoué : auth.login_failed émis avec email HACHÉ (jamais en clair)', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    const { POST } = await import('@/app/api/auth/login/route.js');
    const res = await POST(
      new NextRequest('http://x/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'attaquant@evil.com',
          mot_de_passe: 'x',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(401);
    const entry = logSpy.mock.calls
      .map(
        (c) =>
          JSON.parse(c[0] as string) as {
            event: string;
            payload: Record<string, unknown>;
          },
      )
      .find((e) => e.event === 'auth.login_failed');
    expect(entry).toBeDefined();
    expect(entry!.payload.email_hash).not.toContain('attaquant@evil.com');
    expect(typeof entry!.payload.email_hash).toBe('string');
  });

  it('M0.9-18 — deny RLS (Postgres 42501) → event rls.policy.deny émis', async () => {
    const { writeError } = await import('@/lib/api-helpers.js');
    const err = Object.assign(
      new Error('permission denied for table factures'),
      {
        code: '42501',
      },
    );
    const res = writeError(err, 'admin.factures.update');
    expect(res.status).toBe(422);
    const events = logSpy.mock.calls.map(
      (c) => (JSON.parse(c[0] as string) as { event: string }).event,
    );
    expect(events).toContain('rls.policy.deny');
  });

  it('M0.9-19 — login réussi : auth.login_success avec { user_id, ip, role } (§07/01)', async () => {
    const token = `h.${Buffer.from(JSON.stringify({ user_role: 'traiteur_manager' })).toString('base64url')}.s`;
    mockSignIn.mockResolvedValue({
      data: {
        user: { id: 'u-42', email: 'ok@traiteur.fr' },
        session: { access_token: token },
      },
      error: null,
    });
    const { POST } = await import('@/app/api/auth/login/route.js');
    const res = await POST(
      new NextRequest('http://x/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'ok@traiteur.fr', mot_de_passe: 'x' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
    const entry = logSpy.mock.calls
      .map(
        (c) =>
          JSON.parse(c[0] as string) as {
            event: string;
            payload: Record<string, unknown>;
          },
      )
      .find((e) => e.event === 'auth.login_success');
    expect(entry).toBeDefined();
    expect(entry!.payload.user_id).toBe('u-42');
    expect(entry!.payload.role).toBe('traiteur_manager');
    expect(entry!.payload).toHaveProperty('ip');
  });
});
