/**
 * R-UI-2 C12 — référentiel des flux ZD : libellé, ordre et couleur uniques.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('couleur figée par flux (Val 2026-10-30), écran et PDF identiques', () => {
    const attendu: Record<string, string> = {
      emballage: '#ffbd59',
      biodechet: '#12a459',
      verre: '#09337a',
      carton: '#87684d',
      dechet_residuel: '#a6b1b7',
    };
    const css = readFileSync(
      resolve(__dirname, '../../app/globals.css'),
      'utf8',
    );
    const pdf = readFileSync(
      resolve(
        __dirname,
        '../../../../../apps/pdf-renderer/src/templates/rapport-recyclage-zd.ts',
      ),
      'utf8',
    );
    for (const code of FLUX_ZD_CODES) {
      const jeton = /^var\((--color-savr-flux-[a-z]+)\)$/.exec(
        COULEUR_FLUX[code],
      )?.[1];
      expect(jeton, code).toBeDefined();
      const valeur = new RegExp(`${jeton}:\\s*(#[0-9a-f]{6});`).exec(css)?.[1];
      expect(valeur, code).toBe(attendu[code]);
      const ligne = new RegExp(
        `code: '${code}',[\\s\\S]*?couleur: '(#[0-9a-f]{6})'`,
      ).exec(pdf)?.[1];
      expect(ligne, `PDF ${code}`).toBe(attendu[code]);
    }
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
