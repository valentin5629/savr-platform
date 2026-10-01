/**
 * Frise d'avancement de la fiche collecte Admin (revue E2E 2026-09-29, décision
 * Val C2) : programmee → validee → en_cours → realisee → cloturee.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CollecteStatutFrise } from './collecte-statut-frise';

function etapeCourante(): HTMLElement | null {
  return (
    within(screen.getByRole('list', { name: 'Avancement de la collecte' }))
      .getAllByRole('listitem')
      .find((li) => li.getAttribute('aria-current') === 'step') ?? null
  );
}

describe('M0.6 — CollecteStatutFrise (frise de la fiche collecte Admin)', () => {
  it('marque l’étape courante du parcours nominal', () => {
    render(<CollecteStatutFrise statut="en_cours" />);
    expect(etapeCourante()).toHaveTextContent('En cours');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('AG réalisée sans collecte : étape « Réalisée » avec le libellé propre', () => {
    render(<CollecteStatutFrise statut="realisee_sans_collecte" />);
    expect(etapeCourante()).toHaveTextContent('Sans excédents');
  });

  // jsdom ne calcule aucune mise en page : garde de classe. Une frise non
  // rétractable débordait de l'en-tête et passait sous la croix de la modale
  // (5 étapes ≈ 590 px, mesuré dans Chromium — revue du 2026-10-01).
  it('la frise peut se replier : jamais de largeur incompressible', () => {
    render(<CollecteStatutFrise statut="realisee_sans_collecte" />);
    const frise = screen.getByRole('list', {
      name: 'Avancement de la collecte',
    });
    expect(frise.className).toMatch(/\bflex-wrap\b/);
    expect(frise.className).not.toMatch(/\bshrink-0\b/);
  });

  it.each([
    ['annulee', 'Annulée'],
    ['rejetee_par_prestataire', 'Rejetée'],
    ['brouillon', 'Créée'],
  ])('%s : aucune étape courante, statut réel en badge', (statut, libelle) => {
    render(<CollecteStatutFrise statut={statut} />);
    expect(etapeCourante()).toBeNull();
    expect(screen.getByText(libelle)).toBeInTheDocument();
  });
});
