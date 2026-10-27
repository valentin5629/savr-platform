import { describe, it, expect } from 'vitest';
import {
  joursFenetre,
  repasCumulesParAssociation,
  type AttributionVoisine,
} from './repas-cumules';

// Compteur « repas cumulés / capacité » (décision Val 2026-10-27) : ±12 h autour
// du créneau, réalisé sinon estimé, annulées / rejetées / brouillons exclus.
const cible = {
  id: 'c0',
  date_collecte: '2026-03-18',
  heure_collecte: '12:00:00',
  volume_estime_repas: 40,
};

function v(
  id: string,
  date: string,
  heure: string | null,
  estime: number | null,
  opts: { realise?: number | null; statut?: string; asso?: string } = {},
): AttributionVoisine {
  return {
    association_id: opts.asso ?? 'a',
    volume_repas_realise: opts.realise ?? null,
    collecte: {
      id,
      statut: opts.statut ?? 'validee',
      date_collecte: date,
      heure_collecte: heure,
      volume_estime_repas: estime,
    },
  };
}

describe('M2.3 — repas cumulés d’une association à ±12 h du créneau', () => {
  it('lit de la veille au lendemain', () => {
    expect(joursFenetre(cible)).toEqual(['2026-03-17', '2026-03-19']);
  });

  it('bornes comprises, au-delà exclu, à l’heure de Paris', () => {
    const cumul = repasCumulesParAssociation(cible, [
      v('1', '2026-03-18', '00:00:00', 10), // −12 h : compté
      v('2', '2026-03-17', '23:59:00', 20), // −12 h 01 : exclu
      v('3', '2026-03-19', '00:00:00', 30), // +12 h : compté
      v('4', '2026-03-19', '00:01:00', 40), // +12 h 01 : exclu
    ]);
    expect(cumul.get('a')).toBe(10 + 30);
  });

  it('réalisé sinon estimé ; sans excédent = 0 ; annulée, rejetée, brouillon exclus', () => {
    const cumul = repasCumulesParAssociation(cible, [
      v('1', '2026-03-18', '13:00:00', 50, { realise: 35 }),
      v('2', '2026-03-18', '14:00:00', 20),
      v('3', '2026-03-18', '15:00:00', 60, {
        statut: 'realisee_sans_collecte',
      }),
      v('4', '2026-03-18', '15:00:00', 70, { statut: 'annulee' }),
      v('5', '2026-03-18', '15:00:00', 70, {
        statut: 'rejetee_par_prestataire',
      }),
      v('6', '2026-03-18', '15:00:00', 70, { statut: 'brouillon' }),
      v('7', '2026-03-18', '15:00:00', null),
    ]);
    expect(cumul.get('a')).toBe(35 + 20);
  });

  it('ignore la collecte cible elle-même et sépare les associations', () => {
    const cumul = repasCumulesParAssociation(cible, [
      v('c0', '2026-03-18', '12:00:00', 40),
      v('1', '2026-03-18', '12:00:00', 15, { asso: 'b' }),
    ]);
    expect(cumul.get('a')).toBeUndefined();
    expect(cumul.get('b')).toBe(15);
  });
});
