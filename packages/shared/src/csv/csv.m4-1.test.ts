import { describe, it, expect } from 'vitest';
import {
  toCsv,
  escapeCsvField,
  formatDateFr,
  formatNombreFr,
  formatPoidsKg,
  csvFilename,
  CSV_BOM,
  CSV_SEP,
  CSV_EOL,
  type CsvColumn,
} from './index';

describe('M4.1 / escapeCsvField (RFC 4180)', () => {
  it('laisse une valeur simple intacte', () => {
    expect(escapeCsvField('Palais')).toBe('Palais');
  });
  it('quote quand le séparateur est présent', () => {
    expect(escapeCsvField('Dupont; Cie')).toBe('"Dupont; Cie"');
  });
  it('quote et double les guillemets internes', () => {
    expect(escapeCsvField('Le "Grand" Palais')).toBe('"Le ""Grand"" Palais"');
  });
  it('quote sur saut de ligne', () => {
    expect(escapeCsvField('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });
  it('null/undefined → chaîne vide', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });
  it('ne remplace JAMAIS « ; » par « , » (régression dette M3.2)', () => {
    expect(escapeCsvField('a;b')).not.toContain(',');
    expect(escapeCsvField('a;b')).toBe('"a;b"');
  });
});

describe('M4.1 / escapeCsvField injection de formule', () => {
  it('préfixe une apostrophe sur les amorces de formule = + @', () => {
    expect(escapeCsvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvField('@cmd')).toBe("'@cmd");
    expect(escapeCsvField('+33 6 12 34 56')).toBe("'+33 6 12 34 56");
  });
  it('préserve les nombres FR (négatifs, virgule décimale)', () => {
    expect(escapeCsvField('-5,2')).toBe('-5,2');
    expect(escapeCsvField('125,5')).toBe('125,5');
    expect(escapeCsvField(-5.2)).toBe('-5.2');
  });
  it('C6 : préfixe un + initial même quand la valeur est numérique (téléphone, formule)', () => {
    // Avant le fix, Number('+33612345678') étant valide, la cellule passait brute
    // → Excel évaluait le + initial comme une formule.
    expect(escapeCsvField('+33612345678')).toBe("'+33612345678");
    expect(escapeCsvField('+1')).toBe("'+1");
    expect(escapeCsvField('+1,5')).toBe("'+1,5");
  });
});

describe('M4.1 / toCsv', () => {
  interface Row {
    nom: string;
    poids: number;
  }
  const cols: CsvColumn<Row>[] = [
    { header: 'Nom', value: (r) => r.nom },
    { header: 'Poids (kg)', value: (r) => formatPoidsKg(r.poids) },
  ];

  it('démarre par le BOM UTF-8', () => {
    const csv = toCsv([], cols);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
  });

  it('utilise « ; » comme séparateur et CRLF entre lignes', () => {
    const csv = toCsv([{ nom: 'A', poids: 12.5 }], cols);
    const sansBom = csv.slice(CSV_BOM.length);
    const [header, line1] = sansBom.split(CSV_EOL);
    expect(header).toBe(['Nom', 'Poids (kg)'].join(CSV_SEP));
    expect(line1).toBe('A;12,5');
  });

  it("émet l'en-tête même sans ligne de données", () => {
    const csv = toCsv([], cols).slice(CSV_BOM.length);
    expect(csv).toBe('Nom;Poids (kg)');
  });

  it('échappe les valeurs contenant le séparateur', () => {
    const csv = toCsv([{ nom: 'X; Y', poids: 1 }], cols).slice(CSV_BOM.length);
    expect(csv.split(CSV_EOL)[1]).toBe('"X; Y";1');
  });
});

describe('M4.1 / formatDateFr', () => {
  it('date pure YYYY-MM-DD → DD/MM/YYYY (sans heure, pas de décalage TZ)', () => {
    expect(formatDateFr('2026-01-15')).toBe('15/01/2026');
  });
  it('horodatage ISO → DD/MM/YYYY HH:MM (Europe/Paris)', () => {
    // 2026-01-15T22:30:00Z = 23:30 Paris (CET, UTC+1)
    expect(formatDateFr('2026-01-15T22:30:00Z')).toBe('15/01/2026 23:30');
  });
  it('vide → chaîne vide', () => {
    expect(formatDateFr(null)).toBe('');
    expect(formatDateFr('')).toBe('');
  });
  it("valeur non parsable → renvoyée brute (jamais d'exception)", () => {
    expect(formatDateFr('pas-une-date')).toBe('pas-une-date');
  });
});

describe('M4.1 / formatNombreFr / formatPoidsKg', () => {
  it('virgule décimale, pas de séparateur de milliers', () => {
    expect(formatPoidsKg(1234.5)).toBe('1234,5');
  });
  it('arrondi à 2 décimales, zéros de fin supprimés', () => {
    expect(formatPoidsKg(12.504)).toBe('12,5');
    expect(formatPoidsKg(12)).toBe('12');
  });
  it('null → vide', () => {
    expect(formatPoidsKg(null)).toBe('');
    expect(formatNombreFr(undefined)).toBe('');
  });
  it('respecte le nombre de décimales demandé', () => {
    expect(formatNombreFr(0.125, 3)).toBe('0,125');
  });
});

describe('M4.1 / csvFilename', () => {
  it('format <prefixe>-savr-YYYYMMDD.csv', () => {
    expect(csvFilename('collectes', new Date('2026-06-19T10:00:00Z'))).toBe(
      'collectes-savr-20260619.csv',
    );
  });
});
