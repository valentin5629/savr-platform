/**
 * R-UI-2 C12 — référentiel des flux ZD : libellé, ordre et couleur uniques.
 */
import { describe, expect, it } from 'vitest';
import {
  COULEUR_FLUX,
  estFluxZd,
  FLUX_ZD,
  FLUX_ZD_CODES,
  LIBELLE_FLUX,
  libelleFlux,
} from './flux';

describe('R-UI-2 C12 — lib/libelles/flux', () => {
  it('ordre d’affichage = seed flux_dechets (§04)', () => {
    expect(FLUX_ZD_CODES).toEqual([
      'biodechet',
      'emballage',
      'carton',
      'verre',
      'dechet_residuel',
    ]);
    expect(FLUX_ZD.map((f) => f.code)).toEqual([...FLUX_ZD_CODES]);
  });

  it('libellés = `nom` du seed en base (« Cartons », D45 ouverte)', () => {
    expect(FLUX_ZD.map((f) => f.label)).toEqual([
      'Biodéchets',
      'Emballages',
      'Cartons',
      'Verre',
      'Déchet résiduel',
    ]);
    expect(Object.keys(LIBELLE_FLUX)).toEqual([...FLUX_ZD_CODES]);
  });

  it('une couleur data-viz distincte par flux', () => {
    const couleurs = FLUX_ZD_CODES.map((c) => COULEUR_FLUX[c]);
    expect(new Set(couleurs).size).toBe(FLUX_ZD_CODES.length);
    for (const c of couleurs) expect(c).toMatch(/^var\(--color-savr-dataviz-/);
  });

  it('fallback : absent → « — », inconnu → valeur brute', () => {
    expect(libelleFlux('carton')).toBe('Cartons');
    expect(libelleFlux(null)).toBe('—');
    expect(libelleFlux(undefined)).toBe('—');
    expect(libelleFlux('plastique')).toBe('plastique');
    expect(estFluxZd('verre')).toBe(true);
    expect(estFluxZd('dib')).toBe(false);
  });
});
