/**
 * M0.6 — fiche collecte Admin, Bloc 3 « Documents » (§06.06) : quand un document
 * qui n'existe pas encore est attendu. Chaîne §05 / §12 : clôture 24 h après la
 * réalisation (embargo H+24) par un cron horaire, puis traitement de nuit suivant
 * (cron batch-pdf-j1, 04:00 UTC), qui ne prend que les collectes déjà clôturées.
 */
import { describe, it, expect } from 'vitest';

import { attenteDocuments } from '@/lib/collectes/attente-documents.js';

const le = (iso: string) => new Date(iso);

describe('M0.6 / Bloc 3 Documents — attenteDocuments', () => {
  it.each(['programmee', 'validee', 'en_cours'])(
    'collecte %s : document généré après la collecte, sans date',
    (statut) => {
      expect(attenteDocuments({ statut, realisee_at: null })).toEqual({
        etat: 'apres_collecte',
      });
    },
  );

  it('réalisée le 30/09 à 23 h UTC : attendu au traitement de nuit du 02/10', () => {
    // Embargo levé le 01/10 à 23 h UTC, clôturée à 23 h → traitement du 02/10 04:00 UTC.
    const collecte = {
      statut: 'realisee',
      realisee_at: '2026-09-30T23:00:00Z',
    };
    expect(attenteDocuments(collecte, le('2026-10-01T09:00:00Z'))).toEqual({
      etat: 'attendu',
      jour: '2026-10-02',
    });
  });

  // Fin d'embargo le 02/10 : la clôture horaire passe au plus tard une heure après.
  // Clôturée à 03:00 au plus tard → traitement de 04:00 le jour même ; au-delà, la
  // clôture tombe à 04:00, en même temps que le traitement, qui peut la manquer.
  it.each([
    ['02:59', '2026-10-02'],
    ['03:00', '2026-10-02'],
    ['03:01', '2026-10-03'],
    ['03:30', '2026-10-03'],
    ['04:00', '2026-10-03'],
    ['04:01', '2026-10-03'],
  ])(
    'embargo levé le 02/10 à %s UTC : attendu au traitement de nuit du %s',
    (heure, jour) => {
      const collecte = {
        statut: 'realisee',
        realisee_at: `2026-10-01T${heure}:00Z`,
      };
      expect(attenteDocuments(collecte, le('2026-10-01T12:00:00Z'))).toEqual({
        etat: 'attendu',
        jour,
      });
    },
  );

  it('embargo levé bien avant 04:00 UTC : traitement de la même nuit', () => {
    // Réalisée le 01/10 à 01:00 UTC → embargo levé le 02/10 à 01:00 → 02/10 04:00.
    const collecte = {
      statut: 'realisee',
      realisee_at: '2026-10-01T01:00:00Z',
    };
    expect(attenteDocuments(collecte, le('2026-10-01T12:00:00Z'))).toEqual({
      etat: 'attendu',
      jour: '2026-10-02',
    });
  });

  it('embargo levé après 04:00 UTC : traitement de la nuit suivante', () => {
    // Réalisée le 01/10 à 05:00 UTC → embargo levé le 02/10 à 05:00 → 03/10 04:00.
    const collecte = {
      statut: 'realisee',
      realisee_at: '2026-10-01T05:00:00Z',
    };
    expect(attenteDocuments(collecte, le('2026-10-02T12:00:00Z'))).toEqual({
      etat: 'attendu',
      jour: '2026-10-03',
    });
  });

  it('le jour du traitement, le document reste « attendu » jusqu’à minuit (Paris)', () => {
    const collecte = {
      statut: 'cloturee',
      realisee_at: '2026-09-30T23:00:00Z',
    };
    // 02/10 à 23:30 à Paris (21:30 UTC) : encore le jour attendu.
    expect(attenteDocuments(collecte, le('2026-10-02T21:30:00Z'))).toEqual({
      etat: 'attendu',
      jour: '2026-10-02',
    });
    // 03/10 à 00:30 à Paris (02/10 22:30 UTC) : le jour attendu est passé.
    expect(attenteDocuments(collecte, le('2026-10-02T22:30:00Z'))).toEqual({
      etat: 'en_retard',
      jour: '2026-10-02',
    });
  });

  it('cas relevé en E2E le 09/10 : attendu depuis le 02/10', () => {
    expect(
      attenteDocuments(
        { statut: 'realisee', realisee_at: '2026-09-30T23:00:00Z' },
        le('2026-10-09T10:00:00Z'),
      ),
    ).toEqual({ etat: 'en_retard', jour: '2026-10-02' });
  });

  it.each([
    ['annulee', '2026-09-30T23:00:00Z'],
    ['rejetee_par_prestataire', null],
    ['realisee_sans_collecte', '2026-09-30T23:00:00Z'],
    ['brouillon', null],
    ['annulation_demandee', null],
  ])('collecte %s : rien à annoncer', (statut, realisee_at) => {
    expect(attenteDocuments({ statut, realisee_at })).toBeNull();
  });

  it.each([null, '', 'pas-une-date'])(
    'réalisée sans horodatage lisible (%s) : rien à annoncer',
    (realisee_at) => {
      expect(attenteDocuments({ statut: 'cloturee', realisee_at })).toBeNull();
    },
  );
});
