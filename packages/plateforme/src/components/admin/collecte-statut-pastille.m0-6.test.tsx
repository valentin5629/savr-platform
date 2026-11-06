/**
 * Statut de la fiche collecte Admin : pastille de la variante B (décision Val
 * 2026-10-27, remplace la frise). Parcours à six libellés (décision Val
 * 2026-10-07) : creee → programmee → validee → en_cours → realisee → cloturee.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollecteStatutPastille } from './collecte-statut-pastille';

const pastille = () => screen.getByTestId('statut-collecte-admin');

describe('M0.6 — CollecteStatutPastille (statut de la fiche collecte Admin)', () => {
  it('M0.6/statut_admin_frise_six_etapes — Créée · Programmée · Validée · En cours · Réalisée · Clôturée', () => {
    const attendus = [
      ['creee', 'Créée'],
      ['programmee', 'Programmée'],
      ['validee', 'Validée'],
      ['en_cours', 'En cours'],
      ['realisee', 'Réalisée'],
      ['cloturee', 'Clôturée'],
    ] as const;
    for (const [statut, libelle] of attendus) {
      const { unmount } = render(<CollecteStatutPastille statut={statut} />);
      expect(pastille()).toHaveTextContent(new RegExp(`^${libelle}$`));
      expect(pastille()).toHaveAccessibleName(
        `Statut de la collecte : ${libelle}`,
      );
      unmount();
    }
  });

  // « Sans excédent » n'est pas un statut d'avancement (décision Val 2026-10-09).
  it('M0.6/statut_sans_excedent_affiche_realisee — AG réalisée sans collecte : « Réalisée », jamais « Sans excédents »', () => {
    render(<CollecteStatutPastille statut="realisee_sans_collecte" />);
    expect(pastille()).toHaveTextContent(/^Réalisée$/);
    expect(pastille()).not.toHaveTextContent(/exc[ée]dent/i);
  });

  it.each([
    ['annulation_demandee', 'Annulation demandée'],
    ['annulee', 'Annulée'],
    ['rejetee_par_prestataire', 'Rejetée'],
  ] as const)(
    '%s : pastille rouge au libellé du statut réel',
    (statut, libelle) => {
      render(<CollecteStatutPastille statut={statut} />);
      expect(pastille()).toHaveTextContent(libelle);
      expect(pastille().className).toMatch(/bg-savr-error-subtle/);
    },
  );

  it('brouillon : pastille neutre « Brouillon »', () => {
    render(<CollecteStatutPastille statut="brouillon" />);
    expect(pastille()).toHaveTextContent('Brouillon');
    expect(pastille().className).toMatch(/bg-savr-sable-100/);
  });
});
