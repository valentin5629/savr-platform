/**
 * Modal — verrou de défilement de la page, compté (relevé en revue le
 * 2026-10-19 sur la fiche événement du gestionnaire, qui ouvre la fiche collecte
 * par-dessus). Deux Modal sœurs démontées ensemble (bouton « Précédent » du
 * navigateur) laissaient `overflow: hidden` sur la page : elle ne défilait plus.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Modal } from './modal';

const fiche = (titre: string, open = true) => (
  <Modal key={titre} open={open} title={titre} onClose={() => undefined}>
    {titre}
  </Modal>
);

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('Modal — verrou de défilement compté', () => {
  it('M0.8/modal_verrou_defilement_soeurs_demontees_ensemble — la page défile de nouveau', () => {
    const { unmount } = render(
      <>
        {fiche('Événement')}
        {fiche('Collecte')}
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('M0.8/modal_verrou_defilement_ordre_quelconque — libérée à la dernière fermeture seulement', () => {
    const { rerender } = render(
      <>
        {fiche('Événement')}
        {fiche('Collecte')}
      </>,
    );
    // La première ouverte se ferme d'abord : l'autre est encore ouverte.
    rerender(
      <>
        {fiche('Événement', false)}
        {fiche('Collecte')}
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <>
        {fiche('Événement', false)}
        {fiche('Collecte', false)}
      </>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('M0.8/modal_verrou_defilement_valeur_initiale_rendue — la valeur d’avant la première ouverture est restaurée', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(fiche('Seule'));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });
});
