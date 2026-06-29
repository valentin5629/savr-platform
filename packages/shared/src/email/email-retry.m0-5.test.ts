/**
 * R10b · BL-P1-API-05 — Resend : refus MISSING_VARIABLE (règle inversée) + retry worker.
 *
 * Vérifie (CDC §08 §4 « Gestion des échecs d'envoi ») :
 *  • Variable requise déclarée (email_templates.variables) absente du payload → REFUS
 *    d'envoi (aucun Resend, aucune ligne emails_envoyes) + trace integrations_logs MISSING_VARIABLE.
 *  • Toutes variables présentes → envoi + emails_envoyes porte variables_jsonb + tentative_numero=1.
 *  • runEmailRetryWorker : ligne 'failed' échue (palier dépassé) ré-émise ; non échue ignorée ;
 *    tentative 4 en échec → statut='failed' + trace echec_final.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const sendResult = {
    value: { data: { id: 'rs_1' }, error: null } as {
      data: { id: string } | null;
      error: { message: string } | null;
    },
  };
  const mockSend = vi.fn(async () => sendResult.value);
  const ResendCtor = vi.fn(() => ({ emails: { send: mockSend } }));
  return { mockSend, ResendCtor, sendResult };
});

vi.mock('resend', () => ({ Resend: h.ResendCtor }));

// ─── Mock Supabase configurable ───────────────────────────────────────────────
type Row = Record<string, unknown>;
const cfg: {
  template: Row | null;
  failedRows: Row[];
} = { template: null, failedRows: [] };

const captures: {
  inserts: Record<string, Row[]>;
  updates: Record<string, Row[]>;
} = { inserts: {}, updates: {} };

function record(bucket: Record<string, Row[]>, table: string, data: Row): void {
  if (!bucket[table]) bucket[table] = [];
  bucket[table]!.push(data);
}

function readBuilder(table: string) {
  const b: Record<string, unknown> = {};
  b['select'] = vi.fn(() => b);
  b['eq'] = vi.fn(() => b);
  b['lt'] = vi.fn(() => b);
  b['single'] = vi.fn(async () =>
    table === 'email_templates'
      ? {
          data: cfg.template,
          error: cfg.template ? null : { code: 'PGRST116' },
        }
      : { data: null, error: null },
  );
  // thenable (await direct sur la query, ex. worker .select().eq().lt())
  b['then'] = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
    const res =
      table === 'emails_envoyes'
        ? { data: cfg.failedRows, error: null }
        : { data: null, error: null };
    return Promise.resolve(res).then(onF, onR);
  };
  return b;
}

function writeBuilder(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  b['eq'] = vi.fn(() => b);
  b['select'] = vi.fn(() => b);
  b['single'] = vi.fn(async () => ({ data: null, error: null }));
  b['then'] = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(onF, onR);
  return b;
}

const mockSupabase = {
  from: (table: string) => ({
    select: () => readBuilder(table),
    insert: (data: Row) => {
      record(captures.inserts, table, data);
      return writeBuilder();
    },
    update: (data: Row) => {
      record(captures.updates, table, data);
      return writeBuilder();
    },
  }),
};

vi.mock('../supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabase,
}));

import {
  sendEmail,
  runEmailRetryWorker,
  setEmailCaptureSink,
} from './index.js';

beforeEach(() => {
  vi.clearAllMocks();
  captures.inserts = {};
  captures.updates = {};
  cfg.template = {
    code: 'confirmation_collecte',
    sujet: 'Collecte {{prenom}}',
    corps_html: '<p>Le {{date}}</p>',
    actif: true,
    variables: ['prenom', 'date'],
  };
  cfg.failedRows = [];
  h.sendResult.value = { data: { id: 'rs_1' }, error: null };
  setEmailCaptureSink(null);
  process.env['RESEND_API_KEY'] = 'test';
});

describe('M0.5 / BL-P1-API-05 — refus MISSING_VARIABLE', () => {
  it('variable requise absente → aucun envoi, aucune ligne emails_envoyes, trace MISSING_VARIABLE', async () => {
    await sendEmail('confirmation_collecte', 'dest@savr-test.local', {
      prenom: 'Jean',
    }); // 'date' manquante

    expect(h.mockSend).not.toHaveBeenCalled();
    expect(captures.inserts['emails_envoyes']).toBeUndefined();
    const logs = captures.inserts['integrations_logs'] ?? [];
    expect(logs).toHaveLength(1);
    expect(String(logs[0]!['erreur'])).toContain('MISSING_VARIABLE');
    expect(String(logs[0]!['erreur'])).toContain('date');
  });

  it('toutes variables présentes → envoi + emails_envoyes porte variables_jsonb + tentative_numero=1', async () => {
    await sendEmail('confirmation_collecte', 'dest@savr-test.local', {
      prenom: 'Jean',
      date: '2026-06-29',
    });

    const rows = captures.inserts['emails_envoyes'] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]!['statut']).toBe('sent');
    expect(rows[0]!['tentative_numero']).toBe(1);
    expect(rows[0]!['variables_jsonb']).toMatchObject({
      prenom: 'Jean',
      date: '2026-06-29',
    });
    // template sans variables requises manquantes → pas de trace MISSING_VARIABLE
    expect(captures.inserts['integrations_logs']).toBeUndefined();
  });

  it('slug inexistant → aucun envoi, throw + trace TEMPLATE_NOT_FOUND (CDC l.548)', async () => {
    cfg.template = null;
    await expect(
      sendEmail('inexistant', 'dest@savr-test.local', {}),
    ).rejects.toThrow();
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(captures.inserts['emails_envoyes']).toBeUndefined();
    const logs = captures.inserts['integrations_logs'] ?? [];
    expect(
      logs.some((l) => String(l['erreur']).includes('TEMPLATE_NOT_FOUND')),
    ).toBe(true);
  });

  it('template inactif → aucun envoi, aucune ligne emails_envoyes, trace SKIP_INACTIF (CDC l.548)', async () => {
    cfg.template = {
      code: 'confirmation_collecte',
      sujet: 'S',
      corps_html: 'H',
      actif: false,
      variables: [],
    };
    await sendEmail('confirmation_collecte', 'dest@savr-test.local', {});
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(captures.inserts['emails_envoyes']).toBeUndefined();
    const logs = captures.inserts['integrations_logs'] ?? [];
    expect(logs.some((l) => String(l['erreur']).includes('SKIP_INACTIF'))).toBe(
      true,
    );
  });
});

describe('M0.5 / BL-P1-API-05 — runEmailRetryWorker (paliers 5min/1h/24h)', () => {
  const T0 = Date.parse('2026-06-29T00:00:00Z');

  it('ligne failed échue (palier 5min dépassé) → ré-émise et passée à sent', async () => {
    cfg.failedRows = [
      {
        id: 'em-1',
        template_code: 'confirmation_collecte',
        destinataire: 'dest@savr-test.local',
        variables_jsonb: { prenom: 'Jean', date: '2026-06-29' },
        tentative_numero: 1,
        created_at: new Date(T0).toISOString(),
      },
    ];
    // now = T0 + 6 min → palier 1 (5 min) dépassé
    const res = await runEmailRetryWorker(
      mockSupabase as never,
      T0 + 6 * 60 * 1000,
    );

    expect(res.scanned).toBe(1);
    expect(res.retried).toBe(1);
    expect(res.succeeded).toBe(1);
    const upd = captures.updates['emails_envoyes']?.[0] as Row;
    expect(upd['statut']).toBe('sent');
    expect(upd['tentative_numero']).toBe(2);
  });

  it('ligne failed non encore échue (palier 5min non atteint) → ignorée', async () => {
    cfg.failedRows = [
      {
        id: 'em-2',
        template_code: 'confirmation_collecte',
        destinataire: 'dest@savr-test.local',
        variables_jsonb: { prenom: 'Jean', date: '2026-06-29' },
        tentative_numero: 1,
        created_at: new Date(T0).toISOString(),
      },
    ];
    // now = T0 + 2 min → palier 1 (5 min) non atteint
    const res = await runEmailRetryWorker(
      mockSupabase as never,
      T0 + 2 * 60 * 1000,
    );

    expect(res.retried).toBe(0);
    expect(captures.updates['emails_envoyes']).toBeUndefined();
  });

  it('tentative 3 qui échoue → tentative 4, statut failed + trace echec_final', async () => {
    process.env['RESEND_API_KEY'] = 'live'; // force le vrai chemin Resend (mocké)
    h.sendResult.value = { data: null, error: { message: '503 upstream' } };
    cfg.failedRows = [
      {
        id: 'em-3',
        template_code: 'confirmation_collecte',
        destinataire: 'dest@savr-test.local',
        variables_jsonb: { prenom: 'Jean', date: '2026-06-29' },
        tentative_numero: 3,
        created_at: new Date(T0).toISOString(),
      },
    ];
    // due pour tentative 4 = created_at + 5min + 1h + 24h ; now bien au-delà
    const res = await runEmailRetryWorker(
      mockSupabase as never,
      T0 + 26 * 60 * 60 * 1000,
    );

    expect(res.retried).toBe(1);
    expect(res.succeeded).toBe(0);
    expect(res.exhausted).toBe(1);
    const upd = captures.updates['emails_envoyes']?.[0] as Row;
    expect(upd['statut']).toBe('failed');
    expect(upd['tentative_numero']).toBe(4);
    const logs = captures.inserts['integrations_logs'] ?? [];
    expect(logs.some((l) => String(l['erreur']).includes('echec_final'))).toBe(
      true,
    );
  });
});
