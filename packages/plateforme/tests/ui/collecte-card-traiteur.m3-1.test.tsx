/**
 * M3.1 — Carte simplifiée liste collectes traiteur (refonte 2026-07-05, décision Val).
 * Couvre : champs affichés (Date · Heure · Lieu · Pax · Statut), présence des 3
 * actions (Modifier / Annuler / Dupliquer) et leur gating (statut + canWrite).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  TraiteurCollecteCard,
  type TraiteurCollecteCardData,
} from '@/components/collecte/collecte-card-traiteur';

function base(
  over: Partial<TraiteurCollecteCardData> = {},
): TraiteurCollecteCardData {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2026-07-08',
    heure_collecte: '23:30:00',
    lieu_nom: 'Lieu Rouen Gare',
    lieu_adresse: '9 Ruelle 76000 Rouen',
    pax: 220,
    programmee_par_tiers: false,
    ...over,
  };
}

function renderCard(
  c: TraiteurCollecteCardData,
  canWrite: boolean,
  handlers: Partial<{
    onOpen: () => void;
    onModifier: () => void;
    onAnnuler: () => void;
    onDupliquer: () => void;
  }> = {},
) {
  return render(
    <TraiteurCollecteCard
      c={c}
      canWrite={canWrite}
      onOpen={handlers.onOpen ?? (() => {})}
      onModifier={handlers.onModifier ?? (() => {})}
      onAnnuler={handlers.onAnnuler ?? (() => {})}
      onDupliquer={handlers.onDupliquer ?? (() => {})}
    />,
  );
}

function btn(name: RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('M3.1 / carte liste traiteur (refonte)', () => {
  it('M3.1/card_traiteur_champs — affiche heure, lieu, pax + 3 actions', () => {
    cleanup();
    renderCard(base(), true);
    expect(screen.getByText(/23:30/)).toBeTruthy();
    expect(screen.getByText(/Lieu Rouen Gare/)).toBeTruthy();
    expect(screen.getByText(/220 pax/)).toBeTruthy();
    expect(btn(/Modifier/)).toBeTruthy();
    expect(btn(/Annuler/)).toBeTruthy();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_gating_manager — validee + canWrite → Modifier/Annuler actifs', () => {
    cleanup();
    renderCard(base({ statut: 'validee' }), true);
    expect(btn(/Modifier/).disabled).toBe(false);
    expect(btn(/Annuler/).disabled).toBe(false);
    expect(btn(/Dupliquer/).disabled).toBe(false);
  });

  it('M3.1/card_traiteur_gating_readonly — canWrite false → Modifier/Annuler grisés, Dupliquer actif', () => {
    cleanup();
    renderCard(base({ statut: 'validee' }), false);
    expect(btn(/Modifier/).disabled).toBe(true);
    expect(btn(/Annuler/).disabled).toBe(true);
    // Dupliquer crée une nouvelle collecte → toujours disponible.
    expect(btn(/Dupliquer/).disabled).toBe(false);
  });

  it('M3.1/card_traiteur_gating_statut_terminal — cloturee → Modifier/Annuler grisés même si canWrite', () => {
    cleanup();
    renderCard(base({ statut: 'cloturee' }), true);
    expect(btn(/Modifier/).disabled).toBe(true);
    expect(btn(/Annuler/).disabled).toBe(true);
    expect(btn(/Dupliquer/).disabled).toBe(false);
  });

  it('M3.1/card_traiteur_actions — les boutons appellent leurs handlers', () => {
    cleanup();
    const onModifier = vi.fn();
    const onAnnuler = vi.fn();
    const onDupliquer = vi.fn();
    renderCard(base({ statut: 'validee' }), true, {
      onModifier,
      onAnnuler,
      onDupliquer,
    });
    fireEvent.click(btn(/Modifier/));
    fireEvent.click(btn(/Annuler/));
    fireEvent.click(btn(/Dupliquer/));
    expect(onModifier).toHaveBeenCalledOnce();
    expect(onAnnuler).toHaveBeenCalledOnce();
    expect(onDupliquer).toHaveBeenCalledOnce();
  });
});
