/**
 * R-UI-2 C13 — statut consolidé d'un événement (décision F2 2026-06-07) :
 * dérivation unique.
 */
import { describe, expect, it } from 'vitest';
import { statutEvenementConsolide, variantStatutEvenement } from './evenement';

const c = (...statuts: string[]) => statuts.map((statut) => ({ statut }));

describe('R-UI-2 C13 — lib/libelles/evenement', () => {
  it('Annulé = toutes les collectes annulées', () => {
    expect(statutEvenementConsolide(c('annulee', 'annulee'))).toBe('Annulé');
    // Annulation demandée = annulée (Val 2026-11-01), comme sur la fiche.
    expect(statutEvenementConsolide(c('annulation_demandee'))).toBe('Annulé');
    expect(statutEvenementConsolide(c('annulation_demandee', 'annulee'))).toBe(
      'Annulé',
    );
    expect(statutEvenementConsolide(c('annulation_demandee', 'realisee'))).toBe(
      'Terminé',
    );
  });

  it('Terminé = toutes terminales dont ≥ 1 réalisée ou clôturée', () => {
    expect(statutEvenementConsolide(c('cloturee', 'annulee'))).toBe('Terminé');
    expect(statutEvenementConsolide(c('realisee'))).toBe('Terminé');
  });

  it('Terminé = une collecte AG sans excédent compte réalisée (décision Val 2026-10-18)', () => {
    expect(statutEvenementConsolide(c('realisee_sans_collecte'))).toBe(
      'Terminé',
    );
    expect(
      statutEvenementConsolide(c('cloturee', 'realisee_sans_collecte')),
    ).toBe('Terminé');
    expect(
      statutEvenementConsolide(c('realisee_sans_collecte', 'annulee')),
    ).toBe('Terminé');
  });

  it('En cours = sinon (aucune collecte, ≥ 1 non terminale)', () => {
    expect(statutEvenementConsolide([])).toBe('En cours');
    expect(statutEvenementConsolide(c('cloturee', 'validee'))).toBe('En cours');
    expect(
      statutEvenementConsolide(c('realisee_sans_collecte', 'programmee')),
    ).toBe('En cours');
  });

  it('badge : En cours = info, Terminé = success, Annulé = neutral, inconnu = info', () => {
    expect(variantStatutEvenement('En cours')).toBe('info');
    expect(variantStatutEvenement('Terminé')).toBe('success');
    expect(variantStatutEvenement('Annulé')).toBe('neutral');
    expect(variantStatutEvenement('autre')).toBe('info');
    expect(variantStatutEvenement(null)).toBe('info');
  });
});
