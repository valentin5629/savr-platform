/**
 * R-UI-2 C13 — statut consolidé d'un événement (décision F2 2026-06-07) :
 * dérivation unique.
 */
import { describe, expect, it } from 'vitest';
import { statutEvenementConsolide } from './evenement';

const c = (...statuts: string[]) => statuts.map((statut) => ({ statut }));

describe('R-UI-2 C13 — lib/libelles/evenement', () => {
  it('Annulé = toutes les collectes annulées', () => {
    expect(statutEvenementConsolide(c('annulee', 'annulee'))).toBe('Annulé');
  });

  it('Terminé = toutes terminales dont ≥ 1 réalisée ou clôturée', () => {
    expect(statutEvenementConsolide(c('cloturee', 'annulee'))).toBe('Terminé');
    expect(statutEvenementConsolide(c('realisee'))).toBe('Terminé');
  });

  it('En cours = sinon (aucune collecte, ≥ 1 non terminale)', () => {
    expect(statutEvenementConsolide([])).toBe('En cours');
    expect(statutEvenementConsolide(c('cloturee', 'validee'))).toBe('En cours');
    expect(statutEvenementConsolide(c('realisee_sans_collecte'))).toBe(
      'En cours',
    );
  });
});
