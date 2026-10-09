/**
 * Frise d'avancement de la fiche collecte Admin (revue E2E 2026-09-29, décision
 * Val C2 ; 6 étapes depuis la décision Val 2026-10-07) : creee → programmee →
 * validee → en_cours → realisee → cloturee.
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
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('M0.6/statut_admin_frise_six_etapes — Créée · Programmée · Validée · En cours · Réalisée · Clôturée', () => {
    render(<CollecteStatutFrise statut="creee" />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      [
        expect.stringContaining('Créée'),
        expect.stringContaining('Programmée'),
        expect.stringContaining('Validée'),
        expect.stringContaining('En cours'),
        expect.stringContaining('Réalisée'),
        expect.stringContaining('Clôturée'),
      ],
    );
    expect(etapeCourante()).toHaveTextContent('Créée');
  });

  it('demande envoyée : l’étape courante est « Programmée », « Créée » est passée', () => {
    render(<CollecteStatutFrise statut="programmee" />);
    expect(etapeCourante()).toHaveTextContent('Programmée');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Créée');
    expect(screen.getAllByRole('listitem')[0]).not.toHaveAttribute(
      'aria-current',
    );
  });

  // « Sans excédent » n'est pas un statut d'avancement (décision Val
  // 2026-10-09) : la frise est celle de toutes les collectes.
  it('M0.6/statut_sans_excedent_affiche_realisee — AG réalisée sans collecte : étape courante « Réalisée », jamais « Sans excédents »', () => {
    render(<CollecteStatutFrise statut="realisee_sans_collecte" />);
    expect(etapeCourante()).toHaveTextContent(/^Réalisée$/);
    expect(
      screen.getByRole('list', { name: 'Avancement de la collecte' }),
    ).not.toHaveTextContent(/exc[ée]dent/i);
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
    ['annulation_demandee', 'Annulation demandée'],
    ['annulee', 'Annulée'],
    ['rejetee_par_prestataire', 'Rejetée'],
    ['brouillon', 'Brouillon'],
  ] as const)(
    '%s : aucune étape courante, frise estompée, statut réel en badge',
    (statut, libelle) => {
      render(<CollecteStatutFrise statut={statut} />);
      expect(etapeCourante()).toBeNull();
      // Frise estompée : aucune étape passée non plus (ni courante, ci-dessus).
      expect(screen.queryByText(/étape passée/)).toBeNull();
      expect(screen.getByText(libelle)).toBeInTheDocument();
    },
  );
});
