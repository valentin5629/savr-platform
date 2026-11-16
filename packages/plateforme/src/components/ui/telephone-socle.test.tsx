// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterBar } from '@/components/ui/filter-bar';
import { Modal } from '@/components/ui/modal';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';

// Adaptations téléphone (< 640 px) des briques partagées. jsdom n'applique pas
// les feuilles de style : on lit les classes `max-sm:` / `sm:hidden` qui
// portent le comportement, et l'état des contrôles.

describe('FilterBar — filtres repliés sur téléphone', () => {
  function barre(actif = false) {
    render(
      <FilterBar count="3 résultats" actif={actif} onReset={() => {}}>
        <span>Un filtre</span>
      </FilterBar>,
    );
    const bouton = screen.getByRole('button', { name: /^Filtres/ });
    const zone = document.getElementById(
      bouton.getAttribute('aria-controls')!,
    )!;
    return { bouton, zone };
  }

  it('le bouton « Filtres » n’existe que sous 640 px et replie la ligne de filtres', () => {
    const { bouton, zone } = barre();
    expect(bouton.className).toContain('sm:hidden');
    expect(bouton.getAttribute('aria-expanded')).toBe('false');
    // Repliée sous 640 px seulement : au-delà la ligne reste affichée.
    expect(zone.className).toContain('max-sm:hidden');
    expect(zone.className).not.toMatch(/(^| )hidden( |$)/);
    expect(zone.textContent).toContain('Un filtre');

    fireEvent.click(bouton);
    expect(bouton.getAttribute('aria-expanded')).toBe('true');
    expect(zone.className).not.toContain('max-sm:hidden');
  });

  it('signale un filtre posé sur le bouton replié', () => {
    expect(barre(true).bouton.textContent).toContain('au moins un filtre posé');
  });

  it('sans filtre posé, le bouton ne signale rien', () => {
    expect(barre(false).bouton.textContent).toBe('Filtres');
  });
});

describe('Modal — feuille montée du bas sur téléphone', () => {
  it('le voile cale le panneau en bas, le panneau perd ses angles bas', () => {
    render(
      <Modal open title="Titre" onClose={vi.fn()}>
        corps
      </Modal>,
    );
    const panneau = screen.getByRole('dialog');
    expect(panneau.parentElement!.className).toContain('max-sm:items-end');
    expect(panneau.parentElement!.className).toContain('max-sm:p-0');
    expect(panneau.className).toContain('max-sm:rounded-b-none');
    // Croix : cible tactile de 44 px.
    expect(screen.getByRole('button', { name: 'Fermer' }).className).toContain(
      'max-sm:h-11',
    );
  });

  it('une fiche qui règle sa croix garde son réglage', () => {
    render(
      <Modal open title="Titre" onClose={vi.fn()} fermetureClassName="top-5">
        corps
      </Modal>,
    );
    const croix = screen.getByRole('button', { name: 'Fermer' });
    expect(croix.className).toContain('top-5');
    expect(croix.className).not.toContain('max-sm:top-3');
  });
});

describe('ToggleTypeCollecte — pleine largeur sur téléphone', () => {
  it('à trois items, les pictos sont retirés sous 640 px', () => {
    const { container } = render(
      <ToggleTypeCollecte value="tous" onChange={() => {}} avecTous />,
    );
    expect(container.firstElementChild!.className).toContain('max-sm:w-full');
    const pictos = [...container.querySelectorAll('svg')];
    expect(pictos.length).toBe(4);
    for (const p of pictos)
      expect(p.closest('.max-sm\\:hidden')).not.toBe(null);
  });

  it('à deux items, les pictos restent', () => {
    const { container } = render(
      <ToggleTypeCollecte value="zero_dechet" onChange={() => {}} />,
    );
    for (const p of container.querySelectorAll('svg'))
      expect(p.closest('.max-sm\\:hidden')).toBe(null);
  });
});
