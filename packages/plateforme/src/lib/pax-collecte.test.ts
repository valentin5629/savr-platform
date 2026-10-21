import { describe, expect, it } from 'vitest';

import { paxCollecteValide, refusPaxCollecte } from './pax-collecte';

// Pax porté par la collecte (décision Val 2026-10-20). La règle de calcul du pax
// de l'événement (C1) vit en base (`plateforme.f_pax_evenement`), prouvée par
// supabase/tests/collectes_pax.test.sql.

describe('paxCollecteValide — entier >= 1', () => {
  it.each([1, 80, 1800, 2_147_483_647])('accepte %s', (v) => {
    expect(paxCollecteValide(v)).toBe(true);
  });

  it.each([
    ['zéro', 0],
    ['négatif', -5],
    ['décimal', 12.5],
    ['au-delà de l’entier SQL', 2_147_483_648],
    ['texte', '80'],
    ['nul', null],
    ['absent', undefined],
    ['NaN', Number.NaN],
  ])('refuse un pax %s', (_cas, v) => {
    expect(paxCollecteValide(v)).toBe(false);
  });
});

describe('refusPaxCollecte — réponse 422 ou rien', () => {
  it('rien pour un pax valide', () => {
    expect(refusPaxCollecte(120)).toBeNull();
  });

  it('422 qui nomme le champ pour un pax invalide', async () => {
    const r = refusPaxCollecte(0);
    expect(r?.status).toBe(422);
    const corps = (await r!.json()) as {
      error: string;
      champs_invalides: string[];
    };
    expect(corps.champs_invalides).toEqual(['pax']);
    expect(corps.error).toContain('nombre de convives');
  });
});
