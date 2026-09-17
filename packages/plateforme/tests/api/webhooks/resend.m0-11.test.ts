// Tests webhook Resend entrant — BL-P1-API-09 (M0.11).
// Vérifie : validation svix (signature réelle calculée, pas mockée), dédup svix-id,
// resend_id inconnu → 200, mapping statut + non-régression terminale.
// Le chemin sous test (la route) N'EST PAS mocké ; seul Supabase l'est.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';

import { computeSvixSignature } from '@/lib/webhooks/svix.js';

const SECRET =
  'whsec_' + Buffer.from('r10b-resend-test-secret-key').toString('base64');

// ─── Mock Supabase ────────────────────────────────────────────────────────────
type ErreurMock = { code?: string; message: string };

let mockInboxInsertResult: { data: unknown; error: unknown } = {
  data: { id: 'inbox-001' },
  error: null,
};
let mockEmailRow: unknown = { id: 'em-001', statut: 'sent' };
// Relecture de la ligne inbox existante sur conflit 23505.
let mockInboxExistant: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

// Échecs injectables (lecture/écriture refusée : CHECK, blip PostgREST).
let readErrors: Record<string, ErreurMock> = {};
let insertErrors: Record<string, ErreurMock> = {};
let updateErrors: Record<
  string,
  (data: Record<string, unknown>) => ErreurMock | null
> = {};

const insertedRows: Record<string, unknown[]> = {};
// Chaque UPDATE avec l'id ciblé par .eq('id', …).
const updatedRows: Record<
  string,
  Array<{ data: Record<string, unknown>; id: unknown }>
> = {};

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
    return Promise.resolve({ data: null, error: insertErrors[table] ?? null });
  });
  q['update'] = vi.fn((data: Record<string, unknown>) => {
    const error = updateErrors[table]?.(data) ?? null;
    return {
      eq: vi.fn(async (_col: string, id: unknown) => {
        if (!updatedRows[table]) updatedRows[table] = [];
        updatedRows[table]!.push({ data, id });
        return { data: null, error };
      }),
    };
  });
  q['maybeSingle'] = vi.fn().mockImplementation(async () => {
    if (readErrors[table]) return { data: null, error: readErrors[table] };
    if (table === 'emails_envoyes') return { data: mockEmailRow, error: null };
    if (table === 'integrations_inbox') return mockInboxExistant;
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

const ERREUR_DB: ErreurMock = { code: 'XX000', message: 'blip PostgREST' };

// Mises à jour de l'inbox qui la marquent traitée.
const inboxTraitee = () =>
  (updatedRows['integrations_inbox'] ?? []).filter(
    (u) => u.data['traite'] === true,
  );

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
    mockInboxExistant = { data: null, error: null };
    readErrors = {};
    insertErrors = {};
    updateErrors = {};
    process.env['RESEND_WEBHOOK_SECRET'] = SECRET;
  });

  it('signature valide + email.delivered → 200 et statut emails_envoyes = delivered', async () => {
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(200);
    expect(insertedRows['integrations_inbox']).toHaveLength(1);
    const upd = updatedRows['emails_envoyes']?.[0]?.data;
    expect(upd?.['statut']).toBe('delivered');
    expect(inboxTraitee()).toHaveLength(1);
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

  it('svix-id déjà vu et traité (23505) → 200 deduplicated, aucune MAJ email', async () => {
    mockInboxInsertResult = { data: null, error: { code: '23505' } };
    mockInboxExistant = {
      data: { id: 'inbox-existant', traite: true },
      error: null,
    };
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
    const upd = updatedRows['emails_envoyes']?.[0]?.data;
    expect(upd?.['statut']).toBe('bounced');
  });
});

// Chaque lecture/écriture critique lit son `error` : 500 générique et inbox
// laissée `traite=false` pour que le rejeu Resend (svix relance sur non-2xx)
// retraite l'event.
describe('M0.11 / webhook Resend — échecs de lecture/écriture et rejeu', () => {
  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    mockEmailRow = { id: 'em-001', statut: 'sent' };
    mockInboxExistant = { data: null, error: null };
    readErrors = {};
    insertErrors = {};
    updateErrors = {};
    process.env['RESEND_WEBHOOK_SECRET'] = SECRET;
  });

  it('lecture emails_envoyes en échec → 500, jamais prise pour un resend_id inconnu', async () => {
    readErrors['emails_envoyes'] = ERREUR_DB;
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
    expect(inboxTraitee()).toHaveLength(0);
    const logs = (insertedRows['integrations_logs'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      logs.some((l) => String(l['erreur']).includes('resend_id_inconnu')),
    ).toBe(false);
    expect(updatedRows['integrations_inbox']?.[0]).toEqual({
      data: { erreur: 'non_enregistre: email_lecture' },
      id: 'inbox-001',
    });
  });

  it('MAJ du statut emails_envoyes refusée → 500, inbox non marquée traitée', async () => {
    updateErrors['emails_envoyes'] = () => ERREUR_DB;
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
    expect(updatedRows['emails_envoyes']).toHaveLength(1);
    expect(inboxTraitee()).toHaveLength(0);
    expect(updatedRows['integrations_inbox']?.[0]?.data).toEqual({
      erreur: 'non_enregistre: email_statut',
    });
  });

  it('resend_id inconnu mais anomalie non tracée → 500, inbox non marquée traitée', async () => {
    mockEmailRow = null;
    insertErrors['integrations_logs'] = ERREUR_DB;
    const res = await POST(makeResendRequest(deliveredEvent('re_inconnu')));
    expect(res.status).toBe(500);
    expect(inboxTraitee()).toHaveLength(0);
    expect(updatedRows['integrations_inbox']?.[0]?.data).toEqual({
      erreur: 'non_enregistre: anomalie_resend_id_inconnu',
    });
  });

  it('resend_id inconnu, marquage inbox refusé → 500', async () => {
    mockEmailRow = null;
    updateErrors['integrations_inbox'] = (d) =>
      d['traite'] === true ? ERREUR_DB : null;
    const res = await POST(makeResendRequest(deliveredEvent('re_inconnu')));
    expect(res.status).toBe(500);
  });

  it('statut écrit, marquage inbox refusé → 500 (le rejeu réécrit le même statut)', async () => {
    updateErrors['integrations_inbox'] = (d) =>
      d['traite'] === true ? ERREUR_DB : null;
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(500);
    expect(updatedRows['emails_envoyes']?.[0]?.data['statut']).toBe(
      'delivered',
    );
  });

  it('trace systématique integrations_logs en échec → best-effort, 200 et inbox traitée', async () => {
    insertErrors['integrations_logs'] = ERREUR_DB;
    const spy = vi.spyOn(logger, 'error');
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(200);
    expect(inboxTraitee()).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith('webhooks.resend.trace_non_ecrite', {
      event_type: 'email.delivered',
      error_code: 'XX000',
    });
    spy.mockRestore();
  });

  it('insertion inbox en échec (hors 23505) → 500, aucune lecture ni MAJ email', async () => {
    mockInboxInsertResult = { data: null, error: ERREUR_DB };
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(500);
    expect(mockTables['emails_envoyes']).toBeUndefined();
  });

  it('rejeu : 23505 sur une ligne inbox traite=false → event retraité, ligne existante marquée traitée', async () => {
    mockInboxInsertResult = { data: null, error: { code: '23505' } };
    mockInboxExistant = {
      data: { id: 'inbox-existant', traite: false },
      error: null,
    };
    const res = await POST(makeResendRequest(deliveredEvent()));
    const json = (await res.json()) as { deduplicated?: boolean };
    expect(res.status).toBe(200);
    expect(json.deduplicated).toBeUndefined();
    expect(updatedRows['emails_envoyes']?.[0]?.data['statut']).toBe(
      'delivered',
    );
    expect(inboxTraitee()).toEqual([
      expect.objectContaining({ id: 'inbox-existant' }),
    ]);
  });

  it('23505 et relecture de la ligne inbox en échec → 500, aucune MAJ email', async () => {
    mockInboxInsertResult = { data: null, error: { code: '23505' } };
    readErrors['integrations_inbox'] = ERREUR_DB;
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(500);
    expect(updatedRows['emails_envoyes']).toBeUndefined();
  });

  it('23505 et ligne inbox introuvable à la relecture → 500, aucune MAJ email', async () => {
    mockInboxInsertResult = { data: null, error: { code: '23505' } };
    const res = await POST(makeResendRequest(deliveredEvent()));
    expect(res.status).toBe(500);
    expect(updatedRows['emails_envoyes']).toBeUndefined();
  });
});
