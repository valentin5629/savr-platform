/**
 * AUTH-9 — sendEmail : sink technique quand RESEND_API_KEY === 'test'.
 *
 * Vérifie qu'en dev/CI (RESEND_API_KEY='test'), SANS passer par le sink de capture
 * applicatif (_captureFn null), aucun appel Resend réel n'est émis ET que la ligne
 * `emails_envoyes` est insérée avec le bon statut. Le client Supabase est mocké
 * (lecture du template + insert) ; le client Resend est mocké et ne doit jamais
 * être instancié ni appelé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEMPLATE = {
  code: 'verification_email',
  sujet: 'Bienvenue {{prenom}}',
  corps_html: '<p>Bonjour {{prenom}}</p>',
  actif: true,
};

// vi.mock est hoisté en tête de fichier → les mocks partagés doivent l'être aussi
// (vi.hoisted) pour être initialisés avant que les factories ne s'exécutent.
const h = vi.hoisted(() => {
  const mockResendSend = vi.fn();
  const ResendCtor = vi.fn(() => ({ emails: { send: mockResendSend } }));
  const state = { insertCalls: [] as Array<Record<string, unknown>> };
  return { mockResendSend, ResendCtor, state };
});

vi.mock('resend', () => ({ Resend: h.ResendCtor }));
vi.mock('../supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'email_templates') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: TEMPLATE, error: null }),
            }),
          }),
        };
      }
      // emails_envoyes
      return {
        insert: (payload: Record<string, unknown>) => {
          h.state.insertCalls.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  }),
}));

import { sendEmail, setEmailCaptureSink } from './index.js';

beforeEach(() => {
  vi.clearAllMocks();
  h.state.insertCalls = [];
  // _captureFn null : on exerce le vrai chemin (template + insert), pas la capture.
  setEmailCaptureSink(null);
  process.env.RESEND_API_KEY = 'test';
});

describe('AUTH-9 — sendEmail sink (RESEND_API_KEY=test)', () => {
  it("n'émet AUCUN appel Resend réel et insère emails_envoyes en statut 'sent'", async () => {
    await sendEmail('verification_email', 'jean@traiteur-test.fr', {
      prenom: 'Jean',
    });

    // Aucun envoi réel : ni instanciation du client ni .send().
    expect(h.ResendCtor).not.toHaveBeenCalled();
    expect(h.mockResendSend).not.toHaveBeenCalled();

    // Trace persistée avec le bon statut.
    expect(h.state.insertCalls).toHaveLength(1);
    const row = h.state.insertCalls[0]!;
    expect(row.template_code).toBe('verification_email');
    expect(row.destinataire).toBe('jean@traiteur-test.fr');
    expect(row.statut).toBe('sent');
    expect(row.resend_id).toBeNull();
    expect(row.envoye_at).toBeTruthy();
    // Sujet interpolé depuis le template.
    expect(row.sujet).toBe('Bienvenue Jean');
  });
});
