// Tests webhook Resend entrant — BL-P1-API-09 (M0.11).
// Vérifie : validation svix (signature réelle calculée, pas mockée), dédup svix-id,
// resend_id inconnu → 200, mapping statut + non-régression terminale.
// Le chemin sous test (la route) N'EST PAS mocké ; seul Supabase l'est.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { computeSvixSignature } from '@/lib/webhooks/svix.js';

const SECRET =
  'whsec_' + Buffer.from('r10b-resend-test-secret-key').toString('base64');

// ─── Mock Supabase ────────────────────────────────────────────────────────────
let mockInboxInsertResult: { data: unknown; error: unknown } = {
  data: { id: 'inbox-001' },
  error: null,
};
let mockEmailRow: unknown = { id: 'em-001', statut: 'sent' };

const insertedRows: Record<string, unknown[]> = {};
const updatedRows: Record<string, unknown[]> = {};

const makeQuery = (table: string) => {
  const q: Record<string, unknown> = {};
  q['select'] = vi.fn().mockReturnThis();
  q['eq'] = vi.fn().mockReturnThis();
  q['insert'] = vi.fn((data: unknown) => {
    if (!insertedRows[table]) insertedRows[table] = [];
    insertedRows[table]!.push(data);
    if (table === 'integrations_inbox') {
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(mockInboxInsertResult),
      };
    }
    return { eq: vi.fn().mockReturnThis() };
  });
  q['update'] = vi.fn((data: unknown) => {
    if (!updatedRows[table]) updatedRows[table] = [];
    updatedRows[table]!.push(data);
    return { eq: vi.fn().mockReturnThis() };
  });
  q['maybeSingle'] = vi.fn().mockImplementation(async () => {
    if (table === 'emails_envoyes') return { data: mockEmailRow, error: null };
    return { data: null, error: null };
  });
  return q;
};

const mockTables: Record<string, ReturnType<typeof makeQuery>> = {};
const mockSupabase = {
  from: vi.fn((table: string) => {
    if (!mockTables[table]) mockTables[table] = makeQuery(table);
    return mockTables[table];
  }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabase,
}));

const { POST } = await import('@/app/api/webhooks/resend/route.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeResendRequest(
  event: Record<string, unknown>,
  opts: { sign?: boolean; tamper?: boolean; id?: string } = {},
): NextRequest {
  const body = JSON.stringify(event);
  const id = opts.id ?? 'msg_001';
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.sign !== false) {
    let sig = computeSvixSignature(SECRET, id, ts, body);
    if (opts.tamper) sig = sig.slice(0, -3) + 'XYZ';
    headers['svix-id'] = id;
    headers['svix-timestamp'] = ts;
    headers['svix-signature'] = `v1,${sig}`;
  }
  return new NextRequest('http://localhost/api/webhooks/resend', {
    method: 'POST',
    body,
    headers,
  });
}

const deliveredEvent = (emailId = 're_123') => ({
  type: 'email.delivered',
  created_at: '2026-06-29T10:00:00Z',
  data: {
    email_id: emailId,
    to: ['dest@savr-test.local'],
    subject: 'Sujet',
    tags: [{ name: 'email_envoye_id', value: 'em-001' }],
  },
});

describe('M0.11 / webhook Resend — validation svix', () => {
  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    mockEmailRow = { id: 'em-001', statut: 'sent' };
    process.env['RESEND_WEBHOOK_SECRET'] = SECRET;
  });

  it('signature valide + email.delivered → 200 et statut emails_envoyes = delivered', async () => {
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(200);
    expect(insertedRows['integrations_inbox']).toHaveLength(1);
    const upd = updatedRows['emails_envoyes']?.[0] as Record<string, unknown>;
    expect(upd?.['statut']).toBe('delivered');
  });

  it('signature absente → 401, aucune écriture inbox', async () => {
    const res = await POST(
      makeResendRequest(deliveredEvent(), { sign: false }),
    );
    expect(res.status).toBe(401);
    expect(insertedRows['integrations_inbox']).toBeUndefined();
  });

  it('signature falsifiée → 401', async () => {
    const res = await POST(
      makeResendRequest(deliveredEvent(), { tamper: true }),
    );
    expect(res.status).toBe(401);
    expect(insertedRows['integrations_inbox']).toBeUndefined();
  });

  it('svix-id déjà vu (23505) → 200 deduplicated, aucune MAJ email', async () => {
    mockInboxInsertResult = { data: null, error: { code: '23505' } };
    const res = await POST(makeResendRequest(deliveredEvent()));
    const json = (await res.json()) as { deduplicated?: boolean };
    expect(res.status).toBe(200);
    expect(json.deduplicated).toBe(true);
    expect(updatedRows['emails_envoyes']).toBeUndefined();
  });

  it('resend_id inconnu → 200 skipped + anomalie tracée, pas de MAJ statut', async () => {
    mockEmailRow = null;
    const res = await POST(makeResendRequest(deliveredEvent('re_inconnu')));
    const json = (await res.json()) as { skipped?: string };
    expect(res.status).toBe(200);
    expect(json.skipped).toBe('resend_id_inconnu');
    expect(updatedRows['emails_envoyes']).toBeUndefined();
    const logs = insertedRows['integrations_logs'] as Array<
      Record<string, unknown>
    >;
    expect(
      logs.some((l) => String(l['erreur']).includes('resend_id_inconnu')),
    ).toBe(true);
  });

  it('event tardif (delivered) sur statut terminal bounced → pas de régression', async () => {
    mockEmailRow = { id: 'em-001', statut: 'bounced' };
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(200);
    expect(updatedRows['emails_envoyes']).toBeUndefined();
  });

  it('email.bounced → statut bounced', async () => {
    const res = await POST(
      makeResendRequest({
        type: 'email.bounced',
        data: { email_id: 're_123', bounce_type: 'hard' },
      }),
    );
    expect(res.status).toBe(200);
    const upd = updatedRows['emails_envoyes']?.[0] as Record<string, unknown>;
    expect(upd?.['statut']).toBe('bounced');
  });
});
