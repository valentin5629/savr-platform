/**
 * M1.2 / §06.01 étape 13 — confirmation_email_recap_issue_reelle (couche lecture).
 * Décision Val 2026-10-08 : l'écran de confirmation ne dit « email envoyé » que
 * si l'email récapitulatif est réellement parti. L'état est lu dans
 * `emails_envoyes` ; seul un état à trois valeurs en sort.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { erreurJournalisee } = vi.hoisted(() => ({
  erreurJournalisee: vi.fn(),
}));
vi.mock('@savr/shared/src/logger/index.js', () => ({
  logger: { error: erreurJournalisee },
}));

import {
  deriverEtatRecapEmail,
  lireEtatRecapEmail,
} from './suivi-recap-email.js';

type Reponse = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

// Supabase minimal qui ENREGISTRE la requête : table, colonnes, filtres, tri et
// borne. La réponse est fixée par le test.
function makeSupabase(reponse: Reponse) {
  const requete: Record<string, unknown[][]> = {};
  const note = (nom: string, args: unknown[]) => {
    (requete[nom] ??= []).push(args);
  };
  const chaine: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'order', 'limit']) {
    chaine[m] = (...args: unknown[]) => {
      note(m, args);
      return chaine;
    };
  }
  chaine.maybeSingle = () => Promise.resolve(reponse);
  return {
    supabase: chaine as unknown as Parameters<typeof lireEtatRecapEmail>[0],
    requete,
  };
}

beforeEach(() => erreurJournalisee.mockReset());

describe('M1.2/confirmation_email_recap_issue_reelle — état dérivé du dernier envoi', () => {
  it.each([
    ['accepté par Resend', { statut: 'sent', tentative_numero: 1 }, 'envoye'],
    [
      'remis au destinataire',
      { statut: 'delivered', tentative_numero: 1 },
      'envoye',
    ],
    [
      'parti à la 3e tentative',
      { statut: 'sent', tentative_numero: 3 },
      'envoye',
    ],
    [
      'refusé, 1re tentative',
      { statut: 'failed', tentative_numero: 1 },
      'en_reprise',
    ],
    [
      'refusé, 3e tentative',
      { statut: 'failed', tentative_numero: 3 },
      'en_reprise',
    ],
    [
      'refusé, 4e tentative : plus rien ne repart',
      { statut: 'failed', tentative_numero: 4 },
      'non_envoye',
    ],
    [
      'refusé par la messagerie du destinataire',
      { statut: 'bounced', tentative_numero: 1 },
      'non_envoye',
    ],
  ])('%s → %s', (_cas, dernier, attendu) => {
    expect(deriverEtatRecapEmail(dernier)).toBe(attendu);
  });

  it('aucune ligne d’envoi → non envoyé (rien ne prouve qu’un email est parti)', () => {
    expect(deriverEtatRecapEmail(null)).toBe('non_envoye');
  });

  it('statut inconnu de ce suivi → état inconnu, l’écran n’affirme rien', () => {
    expect(
      deriverEtatRecapEmail({ statut: 'queued', tentative_numero: 1 }),
    ).toBeNull();
  });
});

describe('M1.2/confirmation_email_recap_issue_reelle — lecture du journal des emails', () => {
  it('lit le DERNIER email récapitulatif de CET événement, sans adresse ni message d’erreur', async () => {
    const { supabase, requete } = makeSupabase({
      data: { statut: 'sent', tentative_numero: 1 },
      error: null,
    });

    await expect(lireEtatRecapEmail(supabase, 'evt-1')).resolves.toBe('envoye');

    expect(requete.from).toEqual([['emails_envoyes']]);
    // Ni `destinataire` ni `erreur` : la table est fermée aux rôles clients (PII).
    expect(requete.select).toEqual([['statut, tentative_numero']]);
    expect(requete.eq).toEqual([
      ['template_code', 'collecte_programmee'],
      ['entity_type', 'evenement'],
      ['entity_id', 'evt-1'],
    ]);
    expect(requete.order).toEqual([['created_at', { ascending: false }]]);
    expect(requete.limit).toEqual([[1]]);
  });

  it('aucune ligne → non envoyé', async () => {
    const { supabase } = makeSupabase({ data: null, error: null });
    await expect(lireEtatRecapEmail(supabase, 'evt-1')).resolves.toBe(
      'non_envoye',
    );
    expect(erreurJournalisee).not.toHaveBeenCalled();
  });

  it('journal illisible → état inconnu (jamais « envoyé » ni « non envoyé » par défaut), erreur journalisée sans donnée personnelle', async () => {
    const { supabase } = makeSupabase({
      data: null,
      error: { code: '57014', message: 'canceling statement — a@b.fr' },
    });

    await expect(lireEtatRecapEmail(supabase, 'evt-1')).resolves.toBeNull();

    expect(erreurJournalisee).toHaveBeenCalledTimes(1);
    expect(erreurJournalisee).toHaveBeenCalledWith(
      'programmation.recap_email.suivi_illisible',
      { evenement_id: 'evt-1', error_code: '57014' },
    );
  });
});
