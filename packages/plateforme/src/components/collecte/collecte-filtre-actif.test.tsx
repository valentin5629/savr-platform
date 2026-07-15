/**
 * Drill-down « Top listes → liste Collectes filtrée » — briques UI partagées :
 *  - chip « filtre actif » (libellé + effacement) ;
 *  - helper sessionStorage du libellé (round-trip + garde anti-libellé périmé).
 *
 * Le drill-down « Top listes → Collectes filtrée » lui-même est désormais rendu
 * par la lib Cockpit `TopRankList` (onItemClick) sur les dashboards ; il est
 * couvert par les tests de déclinaison Cockpit (R24c) et de la lib cockpit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollecteFiltreActif } from './collecte-filtre-actif';
import {
  setCollecteFiltreLabel,
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';

beforeEach(() => {
  sessionStorage.clear();
});

describe('CollecteFiltreActif', () => {
  it('affiche le libellé et appelle onClear au clic sur ✕', () => {
    const onClear = vi.fn();
    render(
      <CollecteFiltreActif label="Lieu : Le Pavillon" onClear={onClear} />,
    );
    expect(screen.getByText('Lieu : Le Pavillon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retirer le filtre/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('affiche le périmètre (scope) quand fourni — miroir dashboard', () => {
    render(
      <CollecteFiltreActif
        label="Lieu : Le Pavillon"
        scope="clôturées · 13/07/25–13/07/26"
        onClear={() => {}}
      />,
    );
    expect(
      screen.getByText(/clôturées · 13\/07\/25–13\/07\/26/),
    ).toBeInTheDocument();
  });
});

describe('periodeCourte', () => {
  it('formate une période bornée en JJ/MM/AA', () => {
    expect(periodeCourte('2025-07-13', '2026-07-13')).toBe('13/07/25–13/07/26');
  });
  it('retourne null si une borne manque', () => {
    expect(periodeCourte(null, '2026-07-13')).toBeNull();
    expect(periodeCourte('2025-07-13', undefined)).toBeNull();
  });
});

describe('collecte-filtre-label (sessionStorage)', () => {
  it('round-trip : le libellé relu correspond au type + id mémorisés', () => {
    setCollecteFiltreLabel({ kind: 'commercial', id: 'u9', label: 'Jean D.' });
    expect(readCollecteFiltreLabel('commercial', 'u9')).toBe('Jean D.');
  });

  it('garde anti-périmé : id ou type différent → null (fallback appelant)', () => {
    setCollecteFiltreLabel({
      kind: 'lieu',
      id: 'lieu-1',
      label: 'Le Pavillon',
    });
    expect(readCollecteFiltreLabel('lieu', 'lieu-2')).toBeNull();
    expect(readCollecteFiltreLabel('traiteur', 'lieu-1')).toBeNull();
  });

  it('absence de mémorisation → null', () => {
    expect(readCollecteFiltreLabel('lieu', 'lieu-1')).toBeNull();
  });
});
