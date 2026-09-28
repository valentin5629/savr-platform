/**
 * Libellé date + créneau des Data Tables Collectes (« Dim 06 juil · 21h30 »).
 */
import { describe, it, expect } from 'vitest';
import { formatDateHeure, libelleDateHeure } from '@/lib/format-date-collecte';

describe('format-date-collecte', () => {
  it('jour abrégé capitalisé, points retirés, créneau en « 21h30 »', () => {
    expect(libelleDateHeure('2026-07-05', '21:30:00')).toBe(
      'Dim 05 Juil · 21h30',
    );
  });

  it('mois accentué : seule la 1re lettre du mot passe en majuscule (« Août », pas « AoÛT »)', () => {
    expect(formatDateHeure('2026-08-28', '22:00:00').jour).toBe('Ven 28 Août');
  });

  it('créneau absent : libellé sans « · »', () => {
    expect(libelleDateHeure('2026-12-26', null)).toBe('Sam 26 Déc');
  });
});
