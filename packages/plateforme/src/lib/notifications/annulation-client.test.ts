/**
 * Template 5 (`annulation_collecte`) — revue des emails, Val 2026-10-29 :
 * heure, événement, motif, et phrase de facturation à moins de 4 h du créneau,
 * jugée à l'heure de la demande pour une demande confirmée par l'Admin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import { instantParis } from '@savr/shared/src/temps/index.js';
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

const BASE = {
  programmateurId: 'u-prog',
  dateCollecte: '2026-07-20',
  heureCollecte: '18:00:00',
  lieuNom: 'Salle <A>',
  nomEvenement: 'Gala',
  motif: 'Pluie & vent',
};

let emails: CapturedEmail[] = [];
beforeEach(() => {
  emails = [];
  setEmailCaptureSink((e) => emails.push(e));
});
afterEach(() => setEmailCaptureSink(null));

describe('envoyerConfirmationAnnulation', () => {
  it('à plus de 4 h : formats lisibles, textes échappés, aucune phrase de facturation', async () => {
    await envoyerConfirmationAnnulation(supabase, {
      ...BASE,
      typeCollecte: 'zero_dechet',
      nowMs: instantParis('2026-07-20', '10:00').getTime(),
    });
    expect(emails[0]!.slug).toBe('annulation_collecte');
    expect(emails[0]!.variables).toEqual({
      prenom: 'Zoé',
      date_collecte: '20/07/2026',
      heure_collecte: '18:00',
      lieu_nom: 'Salle &lt;A&gt;',
      nom_evenement: 'Gala',
      motif: 'Pluie &amp; vent',
      info_facturation: '',
    });
  });

  it('à moins de 4 h, Zéro Déchet : la collecte reste facturée', async () => {
    await envoyerConfirmationAnnulation(supabase, {
      ...BASE,
      typeCollecte: 'zero_dechet',
      nowMs: instantParis('2026-07-20', '15:00').getTime(),
    });
    expect(emails[0]!.variables['info_facturation']).toContain(
      'la collecte reste facturée',
    );
  });

  it('à moins de 4 h, Anti-Gaspi : un crédit du pack est décompté', async () => {
    await envoyerConfirmationAnnulation(supabase, {
      ...BASE,
      typeCollecte: 'anti_gaspi',
      nowMs: instantParis('2026-07-20', '15:00').getTime(),
    });
    expect(emails[0]!.variables['info_facturation']).toContain(
      'pack Anti-Gaspi a été décompté',
    );
  });

  it('demande faite à 8 h du créneau, confirmée à 3 h : jugée à la demande, rien de facturé', async () => {
    await envoyerConfirmationAnnulation(supabase, {
      ...BASE,
      typeCollecte: 'anti_gaspi',
      statutAvant: 'annulation_demandee',
      annulationDemandeeAt: instantParis('2026-07-20', '10:00').toISOString(),
      nowMs: instantParis('2026-07-20', '15:00').getTime(),
    });
    expect(emails[0]!.variables['info_facturation']).toBe('');
  });

  it('phrase imposée (incident non imputable au client) : remplace la règle des 4 h', async () => {
    await envoyerConfirmationAnnulation(supabase, {
      ...BASE,
      typeCollecte: 'zero_dechet',
      infoFacturation: 'Cet incident ne vous sera pas facturé.',
      nowMs: instantParis('2026-07-20', '15:00').getTime(),
    });
    expect(emails[0]!.variables['info_facturation']).toBe(
      'Cet incident ne vous sera pas facturé.',
    );
  });
});
