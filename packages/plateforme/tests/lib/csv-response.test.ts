/**
 * `csvResponse` interpole le nom de fichier dans Content-Disposition. Tous les
 * préfixes sont littéraux aujourd'hui : ce test verrouille la garde pour le jour
 * où l'un d'eux deviendra dynamique.
 */
import { describe, it, expect } from 'vitest';

import { csvResponse } from '@/lib/csv.js';

const disposition = (nom: string): string =>
  csvResponse(nom, 'a;b\n1;2').headers.get('Content-Disposition') ?? '';

describe('csvResponse — nom de fichier', () => {
  it('laisse intacts les noms produits par csvFilename', () => {
    expect(disposition('registre-savr-20260914.csv')).toBe(
      'attachment; filename="registre-savr-20260914.csv"',
    );
  });

  it('neutralise le guillemet qui fermerait l’en-tête', () => {
    expect(disposition('a".csv')).toBe('attachment; filename="a_.csv"');
  });

  it('neutralise un CR/LF (injection d’en-tête)', () => {
    const d = disposition('x.csv\r\nX-Injecte: 1');
    expect(d).not.toContain('\n');
    expect(d).toBe('attachment; filename="x.csv__X-Injecte__1"');
  });

  it('un nom vide retombe sur un défaut', () => {
    expect(disposition('')).toBe('attachment; filename="export.csv"');
    expect(disposition('«»')).toBe('attachment; filename="__"');
  });
});
