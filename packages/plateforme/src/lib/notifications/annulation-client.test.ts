/**
 * Template 5 (`annulation_collecte`) — revue des emails, Val 2026-10-29 :
 * heure, événement, motif ; plus de phrase de facturation (retirée par Val).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import { envoyerConfirmationAnnulation } from './annulation-client.js';

const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { email: 'prog@exemple.test', prenom: 'Zoé', nom: 'D' },
        }),
      }),
    }),
  }),
} as never;

let emails: CapturedEmail[] = [];
beforeEach(() => {
  emails = [];
  setEmailCaptureSink((e) => emails.push(e));
});
afterEach(() => setEmailCaptureSink(null));

describe('envoyerConfirmationAnnulation', () => {
  it('formats lisibles, textes échappés, aucune phrase de facturation', async () => {
    await envoyerConfirmationAnnulation(supabase, {
      programmateurId: 'u-prog',
      dateCollecte: '2026-07-20',
      heureCollecte: '18:00:00',
      lieuNom: 'Salle <A>',
      nomEvenement: 'Gala',
      motif: 'Pluie & vent',
    });
    expect(emails[0]!.slug).toBe('annulation_collecte');
    expect(emails[0]!.variables).toEqual({
      prenom: 'Zoé',
      date_collecte: '20/07/2026',
      heure_collecte: '18:00',
      lieu_nom: 'Salle &lt;A&gt;',
      nom_evenement: 'Gala',
      motif: 'Pluie &amp; vent',
    });
  });
});
