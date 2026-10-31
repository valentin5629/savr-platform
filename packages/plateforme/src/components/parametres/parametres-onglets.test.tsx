/**
 * Page « Paramètres » des espaces client (décision Val 2026-10-31) : l'onglet
 * ouvert se lit dans l'adresse (`?onglet=`) et s'y écrit à chaque clic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ParametresOnglets } from './parametres-onglets';

const ONGLETS = [
  { value: 'infos', label: 'Informations légales', contenu: 'contenu infos' },
  { value: 'profil', label: 'Mon profil', contenu: 'contenu profil' },
];

const ongletActif = () =>
  screen
    .getAllByRole('tab')
    .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('Paramètres — onglet lu et écrit dans l’adresse', () => {
  beforeEach(() => window.history.replaceState(null, '', '/agence/parametres'));

  it('parametres_onglet_demande_ouvert — ?onglet=profil ouvre « Mon profil »', () => {
    render(<ParametresOnglets onglets={ONGLETS} initial="profil" />);
    expect(ongletActif()).toBe('Mon profil');
    expect(screen.getByText('contenu profil')).toBeTruthy();
  });

  it('parametres_onglet_inconnu_premier — valeur inconnue ou absente : premier onglet', () => {
    const { unmount } = render(
      <ParametresOnglets onglets={ONGLETS} initial="xyz" />,
    );
    expect(ongletActif()).toBe('Informations légales');
    unmount();
    render(<ParametresOnglets onglets={ONGLETS} />);
    expect(ongletActif()).toBe('Informations légales');
  });

  it('parametres_onglet_valeur_multiple — ?onglet répété : la première valeur', () => {
    render(
      <ParametresOnglets onglets={ONGLETS} initial={['profil', 'infos']} />,
    );
    expect(ongletActif()).toBe('Mon profil');
  });

  it('parametres_onglet_ecrit_dans_l_adresse — clic : onglet écrit, retiré au retour sur le premier, autres paramètres gardés', () => {
    window.history.replaceState(null, '', '/agence/parametres?statuts=emise');
    render(<ParametresOnglets onglets={ONGLETS} />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Mon profil' }));
    expect(ongletActif()).toBe('Mon profil');
    expect(window.location.search).toBe('?statuts=emise&onglet=profil');

    fireEvent.mouseDown(
      screen.getByRole('tab', { name: 'Informations légales' }),
    );
    expect(window.location.search).toBe('?statuts=emise');
  });

  it('parametres_onglet_suit_la_navigation — l’onglet demandé change (clic sur « Paramètres » du menu) : l’affichage suit', () => {
    const { rerender } = render(
      <ParametresOnglets onglets={ONGLETS} initial="profil" />,
    );
    expect(ongletActif()).toBe('Mon profil');
    rerender(<ParametresOnglets onglets={ONGLETS} initial={undefined} />);
    expect(ongletActif()).toBe('Informations légales');
  });
});
