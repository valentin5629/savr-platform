// Services au choix quand l'Admin force un transporteur (décision Val 2026-11-03).
import { describe, expect, it } from 'vitest';

import { BRANCHE_TO_SERVICE } from './everest/adapter.js';
import { brancheCompatible, servicesAuChoix } from './services-transporteur.js';

describe('services au choix du transporteur forcé', () => {
  it('A Toutes! : exactement les branches que son adapter sait envoyer', () => {
    expect(
      servicesAuChoix('a_toutes')
        .map((s) => s.branche)
        .sort(),
    ).toEqual(Object.keys(BRANCHE_TO_SERVICE).sort());
  });

  it("une branche Marathon n'est pas un service A Toutes! (cas du 2026-11-02)", () => {
    expect(brancheCompatible('a_toutes', 'ag_marathon_volume')).toBe(false);
    expect(brancheCompatible('a_toutes', null)).toBe(false);
    expect(brancheCompatible('a_toutes', 'ag_velo_programme')).toBe(true);
  });

  it('un transporteur sans services distincts accepte toute branche', () => {
    expect(servicesAuChoix('mts1')).toEqual([]);
    expect(brancheCompatible('mts1', 'ag_velo_programme')).toBe(true);
    expect(brancheCompatible('par_mail', null)).toBe(true);
    expect(brancheCompatible(null, 'x')).toBe(true);
  });
});
