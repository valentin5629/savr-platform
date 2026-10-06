/**
 * R-UI-2 C13 — statut consolidé d'un événement (décision F2 2026-06-07) :
 * dérivation unique, options de filtre et variante de badge.
 */
import { describe, expect, it } from 'vitest';
import {
  OPTIONS_STATUT_EVENEMENT,
  statutEvenementConsolide,
  variantStatutEvenement,
} from './evenement';

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

  it('options du filtre : id = libellé, ordre En cours · Terminé · Annulé', () => {
    expect(OPTIONS_STATUT_EVENEMENT).toEqual([
      { id: 'En cours', nom: 'En cours' },
      { id: 'Terminé', nom: 'Terminé' },
      { id: 'Annulé', nom: 'Annulé' },
    ]);
  });

  it('variantes de badge', () => {
    expect(variantStatutEvenement('Terminé')).toBe('success');
    expect(variantStatutEvenement('Annulé')).toBe('neutral');
    expect(variantStatutEvenement('En cours')).toBe('info');
    expect(variantStatutEvenement(null)).toBe('info');
  });
});
