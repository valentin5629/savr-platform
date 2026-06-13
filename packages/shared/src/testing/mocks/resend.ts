import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setEmailCaptureSink, type CapturedEmail } from '../../email/index.js';

export type { CapturedEmail } from '../../email/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../../fixtures/api/resend');

function loadFixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, filename), 'utf-8'),
  ) as T;
}

// ─── Types webhook Resend/svix ────────────────────────────────────────────────

export type ResendWebhookType =
  | 'email.delivered'
  | 'email.bounced'
  | 'email.delivery_delayed';

export interface ResendWebhookTag {
  name: string;
  value: string;
}

export interface ResendWebhookData {
  email_id: string;
  from: string;
  to: string[];
  subject: string;
  tags?: ResendWebhookTag[];
  bounce_type?: string;
  bounce_description?: string;
  attempt?: number;
  max_attempts?: number;
  next_attempt?: string | null;
}

export interface ResendWebhookEvent {
  type: ResendWebhookType;
  created_at: string;
  data: ResendWebhookData;
}

export interface ResendSvixHeaders {
  'svix-id': string;
  'svix-timestamp': string;
  'svix-signature': string;
}

// ─── Email capture helper ─────────────────────────────────────────────────────

/**
 * Active la capture des emails émis par sendEmail().
 * Court-circuite Supabase + Resend — utile en test unitaire.
 * Retourne { emails, restore } où emails est le tableau vivant des captures.
 *
 * @example
 * const { emails, restore } = captureEmails();
 * afterEach(restore);
 *
 * await sendEmail('bienvenue', 'user@test.fr', { prenom: 'Alice' });
 * expect(emails).toHaveLength(1);
 * expect(emails[0]?.slug).toBe('bienvenue');
 */
export function captureEmails(): {
  emails: CapturedEmail[];
  restore: () => void;
} {
  const captured: CapturedEmail[] = [];
  setEmailCaptureSink((email) => captured.push(email));
  return {
    emails: captured,
    restore: () => setEmailCaptureSink(null),
  };
}

// ─── Webhook fixture loaders ──────────────────────────────────────────────────

export type ResendWebhookScenario =
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'signature_invalide';

export function loadResendWebhookFixture(scenario: ResendWebhookScenario): {
  event: ResendWebhookEvent;
  svixHeaders: ResendSvixHeaders;
  expectReject?: boolean;
} {
  const f = loadFixture<{
    type: ResendWebhookType;
    created_at: string;
    data: ResendWebhookData;
    _svix_headers: ResendSvixHeaders;
  }>(`${scenario}.json`);

  return {
    event: { type: f.type, created_at: f.created_at, data: f.data },
    svixHeaders: f._svix_headers,
    expectReject: scenario === 'signature_invalide',
  };
}

/**
 * Simule la validation svix en test.
 * En production, la validation utilise le SDK svix avec RESEND_WEBHOOK_SECRET.
 * En test, on accepte une clé fictive 'test-svix-secret' et on vérifie que
 * la signature n'est pas le placeholder d'une fixture invalide.
 */
export function validateResendWebhookForTest(
  headers: ResendSvixHeaders,
): boolean {
  const sig = headers['svix-signature'];
  return (
    sig.startsWith('v1,') &&
    !sig.includes('INVALID') &&
    !sig.includes('TAMPERED')
  );
}
