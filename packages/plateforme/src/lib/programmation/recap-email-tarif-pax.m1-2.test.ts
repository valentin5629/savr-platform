/**
 * Email récapitulatif de programmation — le tarif ZD annoncé est calculé sur le
 * pax de LA collecte ZD (pax porté par la collecte, décision Val 2026-10-20),
 * pas sur celui de l'événement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';

const tarif = vi.hoisted(() => ({
  calculer: vi.fn(async () => ({ montant_ht: 412, montant_brut_ht: 412 })),
}));
vi.mock('@/lib/tarif-zd.js', () => ({ calculer_tarif_zd: tarif.calculer }));
// Facturation sur la plateforme allumée : ce fichier vérifie la ligne de tarif
// telle qu'elle reviendra. Au go-live elle est retirée (décision Val 2026-10-22),
// ce que prouve tests/api/facturation-hors-plateforme.test.ts.
vi.mock('@/lib/facturation-plateforme.js', () => ({
  facturationPlateformeActive: () => true,
}));

import { envoyerRecapProgrammation } from './recap-email.js';

// users(id) → le programmeur ; collectes(evenement_id) → une AG et une ZD.
const COLLECTES = [
  {
    id: 'col-ag',
    type: 'anti_gaspi',
    date_collecte: '2030-01-15',
    heure_collecte: '22:00:00',
    pax: 1200,
    created_at: null,
  },
  {
    id: 'col-zd',
    type: 'zero_dechet',
    date_collecte: '2030-01-15',
    heure_collecte: '19:00:00',
    pax: 650,
    created_at: null,
  },
];
const supabase = {
  from: (table: string) => ({
    select: () => ({
      eq: () =>
        table === 'users'
          ? {
              maybeSingle: async () => ({
                data: { email: 'julie@traiteur.local', prenom: 'Julie' },
                error: null,
              }),
            }
          : Promise.resolve({ data: COLLECTES, error: null }),
    }),
  }),
} as unknown as Parameters<typeof envoyerRecapProgrammation>[0];

let emails: CapturedEmail[] = [];
beforeEach(() => {
  emails = [];
  tarif.calculer.mockClear();
  setEmailCaptureSink((e) => emails.push(e));
});
afterEach(() => setEmailCaptureSink(null));

describe('M1.2/pax_par_collecte — email récapitulatif : tarif ZD', () => {
  it('calculé sur le pax de la collecte ZD, pas sur celui de la collecte AG', async () => {
    await envoyerRecapProgrammation(supabase, {
      programmeurUserId: 'user-1',
      evenementId: 'evt-1',
      nomEvenement: 'Gala',
      organisationId: 'org-1',
      lieuId: 'lieu-1',
      collecteIds: ['col-ag', 'col-zd'],
    });

    expect(tarif.calculer).toHaveBeenCalledTimes(1);
    const appel = tarif.calculer.mock.calls[0] as unknown as unknown[];
    expect(appel[0]).toBe(650);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.variables.tarif_ligne).toBe(
      'Tarif Zéro Déchet applicable : 412.00 € HT.',
    );
  });
});
