import { describe, it, expect } from 'vitest';
import { normaliserSiretOrganisation } from './siret-organisation.js';

describe('normaliserSiretOrganisation', () => {
  it.each([
    ['12345678900012', '12345678900012'],
    ['123 456 789 00012', '12345678900012'],
    ['123 456 789\t00012', '12345678900012'],
    ['00000000000000', '00000000000000'],
  ])('%j ⇒ %j', (entree, attendu) => {
    expect(normaliserSiretOrganisation(entree)).toEqual({
      valide: true,
      siret: attendu,
    });
  });

  it.each([null, '', '   '])('%j ⇒ null (facultatif)', (entree) => {
    expect(normaliserSiretOrganisation(entree)).toEqual({
      valide: true,
      siret: null,
    });
  });

  it.each([
    '1234567890123',
    '123456789012345',
    '1234567890123A',
    '123-456-789-01234',
    '１２３４５６７８９０１２３４',
    '١٢٣٤٥٦٧٨٩٠١٢٣٤',
    12345678901234,
    true,
    {},
  ])('%j ⇒ invalide', (entree) => {
    expect(normaliserSiretOrganisation(entree)).toEqual({ valide: false });
  });
});
