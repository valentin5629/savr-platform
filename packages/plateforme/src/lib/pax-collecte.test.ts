import { describe, expect, it } from 'vitest';

import {
  paxCollecteValide,
  paxEvenement,
  refusPaxCollecte,
} from './pax-collecte';

// Pax porté par la collecte (décision Val 2026-10-20). La règle de calcul du pax
// de l'événement (C1) est le miroir de `plateforme.f_pax_evenement`, prouvée en
// base par supabase/tests/collectes_pax.test.sql.

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

describe('M1.2/pax_par_collecte_evenement_calcule — paxEvenement, règle C1 : par jour le plus grand pax, puis la somme des jours', () => {
  it('une ZD et une AG du même soir comptent une fois', () => {
    expect(
      paxEvenement([
        { date_collecte: '2026-09-24', pax: 1800 },
        { date_collecte: '2026-09-24', pax: 1800 },
      ]),
    ).toBe(1800);
  });

  it('deux soirées s’additionnent', () => {
    expect(
      paxEvenement([
        { date_collecte: '2026-09-24', pax: 1800 },
        { date_collecte: '2026-09-24', pax: 1800 },
        { date_collecte: '2026-09-25', pax: 1200 },
      ]),
    ).toBe(3000);
  });

  it('le jour compte pour le plus grand pax de ses collectes', () => {
    expect(
      paxEvenement([
        { date_collecte: '2026-09-24', pax: 400 },
        { date_collecte: '2026-09-24', pax: 700 },
      ]),
    ).toBe(700);
  });

  it('une collecte annulée ne compte pas', () => {
    expect(
      paxEvenement([
        { date_collecte: '2026-09-24', pax: 2000, statut: 'cloturee' },
        { date_collecte: '2026-09-25', pax: 1200, statut: 'annulee' },
      ]),
    ).toBe(2000);
  });

  it('null sans collecte non annulée', () => {
    expect(paxEvenement([])).toBeNull();
    expect(
      paxEvenement([
        { date_collecte: '2026-09-24', pax: 10, statut: 'annulee' },
      ]),
    ).toBeNull();
  });
});
