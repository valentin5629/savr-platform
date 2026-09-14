/**
 * Fuseau métier unique : les helpers donnent le MÊME résultat quel que soit le
 * fuseau du process (UTC sur Vercel/Railway/CI, Europe/Paris sur un poste de dev).
 * Les cas qui piègent : l'heure tardive (le jour UTC est la veille du jour Paris)
 * et le changement d'heure (UTC+2 l'été, UTC+1 l'hiver).
 */
import { describe, it, expect } from 'vitest';

import {
  FUSEAU_SAVR,
  instantParis,
  jourParis,
  jourParisDecale,
  formatDateParis,
  formatHeureParis,
  formatDateHeureParis,
  decalerJour,
  jourDeSemaine,
  lundiDeLaSemaine,
  premierDuMois,
  formatJour,
} from './index.js';

describe('temps — jourParis', () => {
  it('été : 22h30 UTC = 00h30 Paris le LENDEMAIN (le piège toISOString)', () => {
    const t = new Date('2026-07-14T22:30:00Z');
    // eslint-disable-next-line no-restricted-syntax -- on montre ici le bug que jourParis corrige
    expect(t.toISOString().slice(0, 10)).toBe('2026-07-14'); // ce que faisait le code
    expect(jourParis(t)).toBe('2026-07-15'); // le vrai jour à Paris
  });

  it('hiver : 23h30 UTC = 00h30 Paris le lendemain', () => {
    expect(jourParis(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15');
  });

  it('même instant, même jour en journée', () => {
    expect(jourParis(new Date('2026-07-14T10:00:00Z'))).toBe('2026-07-14');
    expect(jourParis(new Date('2026-01-14T10:00:00Z'))).toBe('2026-01-14');
  });

  it('bascule heure d’été (29/03/2026) et d’hiver (25/10/2026)', () => {
    expect(jourParis(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29'); // +1 → 00h30
    expect(jourParis(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25'); // +2 → 01h30
  });

  it('une chaîne « YYYY-MM-DD » est un jour, pas un instant : rendue telle quelle', () => {
    expect(jourParis('2026-07-14')).toBe('2026-07-14');
  });

  it('entrée vide ou invalide → chaîne vide, jamais d’exception', () => {
    expect(jourParis(null)).toBe('');
    expect(jourParis('pas une date')).toBe('');
  });

  it('sans argument : le jour courant à Paris', () => {
    expect(jourParis()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('jourParisDecale franchit les mois et les années', () => {
    expect(jourParisDecale(-1, new Date('2026-01-01T12:00:00Z'))).toBe(
      '2025-12-31',
    );
    expect(jourParisDecale(1, new Date('2026-02-28T12:00:00Z'))).toBe(
      '2026-03-01',
    );
  });
});

describe('temps — formatage', () => {
  it('affiche l’heure de Paris, pas UTC', () => {
    const t = new Date('2026-07-14T22:30:00Z');
    expect(formatDateParis(t)).toBe('15/07/2026');
    expect(formatHeureParis(t)).toBe('00:30');
    expect(formatDateHeureParis(t)).toBe('15/07/2026 00:30');
  });

  it('hiver : décalage +1', () => {
    expect(formatHeureParis(new Date('2026-01-14T22:30:00Z'))).toBe('23:30');
  });

  it('date pure : aucun décalage appliqué', () => {
    expect(formatDateParis('2026-07-14')).toBe('14/07/2026');
  });

  it('vide → chaîne vide ; non parsable → valeur brute', () => {
    expect(formatDateParis(null)).toBe('');
    expect(formatDateHeureParis('')).toBe('');
    expect(formatDateParis('inconnu')).toBe('inconnu');
  });

  it('le fuseau métier est Europe/Paris', () => {
    expect(FUSEAU_SAVR).toBe('Europe/Paris');
  });
});

describe('temps — instantParis (heure murale parisienne → instant réel)', () => {
  it('été : 23h30 à Paris = 21h30 UTC', () => {
    expect(instantParis('2026-07-14', '23:30').toISOString()).toBe(
      '2026-07-14T21:30:00.000Z',
    );
  });

  it('hiver : 23h30 à Paris = 22h30 UTC', () => {
    expect(instantParis('2026-01-14', '23:30').toISOString()).toBe(
      '2026-01-14T22:30:00.000Z',
    );
  });

  it('accepte HH:MM:SS et se passe d’heure (minuit par défaut)', () => {
    expect(instantParis('2026-07-14', '08:15:30').toISOString()).toBe(
      '2026-07-14T06:15:30.000Z',
    );
    expect(instantParis('2026-07-14').toISOString()).toBe(
      '2026-07-13T22:00:00.000Z',
    );
  });

  it('jour de bascule : avant et après le changement d’heure', () => {
    // 29/03/2026, passage à l'heure d'été à 02h00 → 03h00
    expect(instantParis('2026-03-29', '01:30').toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    ); // encore UTC+1
    expect(instantParis('2026-03-29', '04:30').toISOString()).toBe(
      '2026-03-29T02:30:00.000Z',
    ); // déjà UTC+2
    // 25/10/2026, retour à l'heure d'hiver à 03h00 → 02h00
    expect(instantParis('2026-10-25', '04:30').toISOString()).toBe(
      '2026-10-25T03:30:00.000Z',
    ); // UTC+1
  });

  it('aller-retour : l’instant se relit bien comme le jour parisien attendu', () => {
    expect(jourParis(instantParis('2026-07-14', '23:59'))).toBe('2026-07-14');
    expect(formatHeureParis(instantParis('2026-07-14', '23:59'))).toBe('23:59');
  });

  it('entrée invalide → date invalide, jamais d’exception', () => {
    expect(Number.isNaN(instantParis('pas-une-date').getTime())).toBe(true);
  });
});

describe('temps — calendrier pur (aucun instant, donc aucun fuseau)', () => {
  it('decalerJour franchit mois, années et années bissextiles', () => {
    expect(decalerJour('2026-01-01', -1)).toBe('2025-12-31');
    expect(decalerJour('2026-02-28', 1)).toBe('2026-03-01');
    expect(decalerJour('2028-02-28', 1)).toBe('2028-02-29'); // bissextile
    expect(decalerJour('2026-07-14', 0)).toBe('2026-07-14');
  });

  it('decalerJour traverse les bascules d’heure sans perdre de jour', () => {
    expect(decalerJour('2026-03-28', 1)).toBe('2026-03-29'); // passage heure d'été
    expect(decalerJour('2026-10-24', 1)).toBe('2026-10-25'); // retour heure d'hiver
  });

  it('jourDeSemaine : 0 = lundi', () => {
    expect(jourDeSemaine('2026-07-13')).toBe(0); // lundi
    expect(jourDeSemaine('2026-07-19')).toBe(6); // dimanche
  });

  it('lundiDeLaSemaine ramène au lundi, et un lundi reste inchangé', () => {
    expect(lundiDeLaSemaine('2026-07-16')).toBe('2026-07-13');
    expect(lundiDeLaSemaine('2026-07-13')).toBe('2026-07-13');
    expect(lundiDeLaSemaine('2026-07-19')).toBe('2026-07-13'); // dimanche
  });

  it('premierDuMois', () => {
    expect(premierDuMois('2026-07-31')).toBe('2026-07-01');
  });

  it('entrée invalide : jamais d’exception', () => {
    expect(decalerJour('bof', 1)).toBe('');
    expect(jourDeSemaine('bof')).toBe(-1);
    expect(lundiDeLaSemaine('bof')).toBe('bof');
  });
});

describe('temps — formatJour (valeur date-seule)', () => {
  it('rend le jour demandé, quel que soit le fuseau de la machine', () => {
    expect(formatJour('2026-07-14', { day: '2-digit', month: 'short' })).toBe(
      '14 juil.',
    );
    expect(formatJour('2026-01-01', { day: '2-digit', month: '2-digit' })).toBe(
      '01/01',
    );
    expect(formatJour('2026-12-31', { month: 'short', year: '2-digit' })).toBe(
      'déc. 26',
    );
  });

  it('les bords de mois ne basculent pas', () => {
    expect(formatJour('2026-07-01', { day: '2-digit', month: '2-digit' })).toBe(
      '01/07',
    );
    expect(formatJour('2026-07-31', { day: '2-digit', month: '2-digit' })).toBe(
      '31/07',
    );
  });

  it('entrée invalide → valeur brute', () => {
    expect(formatJour('bof', { day: '2-digit' })).toBe('bof');
  });
});
