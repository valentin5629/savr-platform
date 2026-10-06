/**
 * Grand en-tête commun des fiches en pop-up (collecte Admin et client, lieu,
 * association, transporteur). jsdom ne calcule aucune mise en page : ce sont
 * des gardes de classe, adossées aux mesures Chromium du 2026-10-01 (frise
 * coupée sous la croix ; titre descendu d'une ligne sur une fiche sans
 * sur-titre).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FicheEnTete } from '@/components/ui/fiche/fiche-en-tete';

describe('M1.1b — FicheEnTete (grand en-tête commun des fiches)', () => {
  it('avec sur-titre : le statut partage sa ligne, le titre garde toute la largeur', () => {
    render(
      <FicheEnTete
        surtitre={<span>IDF</span>}
        titre="Pavillon"
        statut={<span>Actif</span>}
      />,
    );
    const titre = screen.getByRole('heading', { name: 'Pavillon' });
    expect(titre.className).toMatch(/\bcol-span-full\b/);
    const statut = screen.getByText('Actif').parentElement as HTMLElement;
    expect(statut.className).toMatch(/\bsm:col-start-2\b/);
    expect(statut.className).toMatch(/\bsm:row-start-1\b/);
  });

  it('sans sur-titre : pas de ligne vide, le statut se place à droite du titre', () => {
    render(
      <FicheEnTete
        titre="Salle des fêtes"
        statut={<span>À normaliser</span>}
      />,
    );
    const titre = screen.getByRole('heading', { name: 'Salle des fêtes' });
    // Premier élément de la grille : aucune cellule vide ne le précède.
    expect(titre.previousElementSibling).toBeNull();
    expect(titre.className).not.toMatch(/\bcol-span-full\b/);
  });

  it('statut large (frise) : bascule à droite sur grand écran seulement', () => {
    render(
      <FicheEnTete
        surtitre={<span>ZD</span>}
        titre="Pavillon"
        statut={<span>frise</span>}
        statutLarge
      />,
    );
    const statut = screen.getByText('frise').parentElement as HTMLElement;
    expect(statut.className).toMatch(/\blg:col-start-2\b/);
    expect(statut.className).not.toMatch(/\bsm:col-start-2\b/);
  });

  it('ordre de lecture : le titre est annoncé avant le statut', () => {
    render(
      <FicheEnTete
        surtitre={<span>IDF</span>}
        titre="Pavillon"
        statut={<span>Actif</span>}
      />,
    );
    const titre = screen.getByRole('heading', { name: 'Pavillon' });
    const statut = screen.getByText('Actif');
    expect(
      titre.compareDocumentPosition(statut) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
