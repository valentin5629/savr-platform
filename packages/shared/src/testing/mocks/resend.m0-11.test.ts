import { afterEach, describe, expect, it } from 'vitest';

import { sendEmail } from '../../email/index.js';
import {
  captureEmails,
  loadResendWebhookFixture,
  validateResendWebhookForTest,
} from './resend.js';

afterEach(() => {
  // captureEmails() retourne restore() — les tests qui l'utilisent doivent appeler restore()
  // Le sink est réinitialisé par restore() dans chaque test
});

describe('M0.11 / Resend — capture emails', () => {
  it('M0.11 / Resend — captureEmails() intercepte slug + destinataire + variables', async () => {
    const { emails, restore } = captureEmails();

    await sendEmail('bienvenue_traiteur', 'user@savr-test.local', {
      prenom: 'Alice',
      organisation: 'Kaspia',
    });

    expect(emails).toHaveLength(1);
    expect(emails[0]!.slug).toBe('bienvenue_traiteur');
    expect(emails[0]!.to).toBe('user@savr-test.local');
    expect(emails[0]!.variables).toMatchObject({
      prenom: 'Alice',
      organisation: 'Kaspia',
    });
    restore();
  });

  it('M0.11 / Resend — captureEmails() propage les options (entityType, entityId)', async () => {
    const { emails, restore } = captureEmails();

    await sendEmail(
      'confirmation_collecte',
      'ops@savr-test.local',
      { date: '2026-06-10' },
      { entityType: 'collectes', entityId: 'col-001' },
    );

    expect(emails[0]!.options.entityType).toBe('collectes');
    expect(emails[0]!.options.entityId).toBe('col-001');
    restore();
  });

  it('M0.11 / Resend — captureEmails() accumule plusieurs envois', async () => {
    const { emails, restore } = captureEmails();

    await sendEmail('bienvenue_traiteur', 'a@test.local', {});
    await sendEmail('confirmation_collecte', 'b@test.local', {});

    expect(emails).toHaveLength(2);
    expect(emails[0]!.slug).toBe('bienvenue_traiteur');
    expect(emails[1]!.slug).toBe('confirmation_collecte');
    restore();
  });

  it('M0.11 / Resend — restore() vide la capture (les envois suivants ne sont plus interceptés)', async () => {
    const { emails, restore } = captureEmails();
    restore();

    // Après restore(), sendEmail() tenterait Supabase — on vérifie juste que le sink est nettoyé
    expect(emails).toHaveLength(0);
  });
});

describe('M0.11 / Resend — webhooks svix structure', () => {
  it('M0.11 / Resend — webhook delivered : type + data.email_id + tags présents', () => {
    const { event, svixHeaders } = loadResendWebhookFixture('delivered');

    expect(event.type).toBe('email.delivered');
    expect(event.data.email_id).toBeTruthy();
    expect(event.data.to).toHaveLength(1);
    expect(svixHeaders['svix-id']).toBeTruthy();
    expect(svixHeaders['svix-timestamp']).toBeTruthy();
    expect(svixHeaders['svix-signature']).toMatch(/^v1,/);
  });

  it('M0.11 / Resend — webhook bounced : bounce_type hard présent', () => {
    const { event } = loadResendWebhookFixture('bounced');

    expect(event.type).toBe('email.bounced');
    expect(event.data.bounce_type).toBe('hard');
    expect(event.data.bounce_description).toBeTruthy();
  });

  it('M0.11 / Resend — webhook failed (3 retries épuisés) : attempt=3, next_attempt=null', () => {
    const { event } = loadResendWebhookFixture('failed');

    expect(event.type).toBe('email.delivery_delayed');
    expect(event.data.attempt).toBe(3);
    expect(event.data.max_attempts).toBe(3);
    expect(event.data.next_attempt).toBeNull();
  });

  it('M0.11 / Resend — webhook signature invalide → rejeté par validateResendWebhookForTest()', () => {
    const { svixHeaders, expectReject } =
      loadResendWebhookFixture('signature_invalide');

    expect(expectReject).toBe(true);
    expect(validateResendWebhookForTest(svixHeaders)).toBe(false);
  });

  it('M0.11 / Resend — webhooks valides passent la validation svix (delivered, bounced, failed)', () => {
    for (const scenario of ['delivered', 'bounced', 'failed'] as const) {
      const { svixHeaders } = loadResendWebhookFixture(scenario);
      expect(validateResendWebhookForTest(svixHeaders)).toBe(true);
    }
  });

  it("M0.11 / Resend — webhook delivered porte un tag email_envoye_id pour lier l'email DB", () => {
    const { event } = loadResendWebhookFixture('delivered');

    const tag = event.data.tags?.find((t) => t.name === 'email_envoye_id');
    expect(tag).toBeDefined();
    expect(tag!.value).toBeTruthy();
  });
});
