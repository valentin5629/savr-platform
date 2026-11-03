import { describe, expect, it } from 'vitest';
import { regionDepuisCodePostal, regionLieu } from './region-code-postal';

describe('regionDepuisCodePostal', () => {
  it.each([
    '75008',
    '77000',
    '78000',
    '91000',
    '92400',
    '93200',
    '94000',
    '95000',
  ])('%s → idf', (cp) => expect(regionDepuisCodePostal(cp)).toBe('idf'));

  it.each(['69000', '13001', '76000', '20000', '2A004', '97400', '60000'])(
    '%s → province',
    (cp) => expect(regionDepuisCodePostal(cp)).toBe('province'),
  );

  it('espaces autour du code postal ignorés', () => {
    expect(regionDepuisCodePostal('  92400 ')).toBe('idf');
  });

  it.each([null, undefined, '', '   ', 92400])(
    'code postal vide ou non texte (%s) → null',
    (cp) => expect(regionDepuisCodePostal(cp)).toBeNull(),
  );
});

describe('regionLieu', () => {
  it('la région saisie prime sur le code postal', () => {
    expect(regionLieu('province', '92400')).toBe('province');
    expect(regionLieu('idf', '69000')).toBe('idf');
  });

  it('région absente ou vide → déduite du code postal', () => {
    expect(regionLieu(undefined, '92400')).toBe('idf');
    expect(regionLieu(null, '69000')).toBe('province');
    expect(regionLieu('', '92400')).toBe('idf');
  });

  it('ni région ni code postal → null', () => {
    expect(regionLieu(undefined, '')).toBeNull();
  });
});
