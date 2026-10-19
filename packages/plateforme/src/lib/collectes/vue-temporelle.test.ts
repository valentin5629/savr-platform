import { describe, it, expect } from 'vitest';
import {
  lireVueCollectes,
  periodeDeLaVue,
  triDateDescendant,
} from './vue-temporelle';

// Vues « Collectes à venir / passées » (décision Val 2026-10-19) : rangement
// par date, aujourd'hui compris dans « à venir ».
const AUJOURDHUI = '2026-10-19';

describe('vues à venir / passées de la page Collectes', () => {
  it('vue_temporelle/periode_bornee_a_la_vue — aujourd’hui à venir, hier passé, période de la barre conservée dedans', () => {
    const vide = { from: '', to: '' };
    expect(periodeDeLaVue('a_venir', vide, AUJOURDHUI)).toEqual({
      from: '2026-10-19',
      to: '',
    });
    expect(periodeDeLaVue('passees', vide, AUJOURDHUI)).toEqual({
      from: '',
      to: '2026-10-18',
    });

    // Période à cheval : chaque vue n'en garde que sa part.
    const cheval = { from: '2026-10-01', to: '2026-10-31' };
    expect(periodeDeLaVue('a_venir', cheval, AUJOURDHUI)).toEqual({
      from: '2026-10-19',
      to: '2026-10-31',
    });
    expect(periodeDeLaVue('passees', cheval, AUJOURDHUI)).toEqual({
      from: '2026-10-01',
      to: '2026-10-18',
    });

    // Période entièrement de l'autre côté : `from > to`, aucune ligne.
    const passee = periodeDeLaVue(
      'a_venir',
      { from: '2026-01-01', to: '2026-06-30' },
      AUJOURDHUI,
    );
    expect(passee.from > passee.to).toBe(true);
    const future = periodeDeLaVue(
      'passees',
      { from: '2026-12-01', to: '' },
      AUJOURDHUI,
    );
    expect(future.from > future.to).toBe(true);
  });

  it('vue_temporelle/anciens_liens_et_tri — `programmees` / `historique` restent lisibles ; la plus proche d’abord', () => {
    expect(lireVueCollectes('a_venir')).toBe('a_venir');
    expect(lireVueCollectes('passees')).toBe('passees');
    expect(lireVueCollectes('programmees')).toBe('a_venir');
    expect(lireVueCollectes('historique')).toBe('passees');
    expect(lireVueCollectes('')).toBeNull();
    expect(lireVueCollectes(null)).toBeNull();
    expect(lireVueCollectes('autre')).toBeNull();

    expect(triDateDescendant('a_venir')).toBe(false);
    expect(triDateDescendant('passees')).toBe(true);
  });
});
